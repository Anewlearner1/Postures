/**
 * 這個檔案做什麼：
 *   計算品質把關（§7.1）與可信度因子（§6.3）需要的「量測值」。
 *   判斷（高／中／低、是否拒絕）在 `src/lib/rules/confidence.ts`、`src/lib/rules/reject.ts`。
 */

import type { ConfidenceMeasurements } from "@/lib/rules/confidence";
import type { RejectMeasurements } from "@/lib/rules/reject";
import { CONFIDENCE, PREPROCESS, REJECT } from "@/lib/rules/thresholds";
import { finite, mean, median, sampleStd } from "./math";
import { indexRange } from "./cycles";
import { pelvisSeries, widthRatioAt, type Pass } from "./passes";
import { roughLegLength, type Joint, type Track } from "./preprocess";
import type { CycleDetail, Side } from "./types";

// ---------------------------------------------------------------------------
// §7.1 拒絕用的量測
// ---------------------------------------------------------------------------

const BODY_JOINTS: readonly Joint[] = ["shoulder", "hip", "knee", "ankle", "heel", "toe"];

function rawOk(track: Track, side: Side, joint: Joint, k: number): boolean {
  const p = track.side[side][joint];
  return p.vis[k] >= PREPROCESS.minVisibility && p.inFrame[k] === 1;
}

/** 這一格較可能是近側的一側（下肢 visibility 較高者）。 */
function likelyNear(track: Track, k: number): Side {
  const sum = (side: Side) => BODY_JOINTS.reduce((acc, joint) => acc + track.side[side][joint].vis[k], 0);
  return sum("left") >= sum("right") ? "left" : "right";
}

export function rejectMeasurements(track: Track, durationSec: number): RejectMeasurements {
  let frames = 0;
  let detected = 0;
  let complete = 0;
  let poseKnown = 0;
  let multiPose = 0;
  for (let k = 0; k < track.n; k++) {
    if (!track.hasFrame[k]) continue;
    frames++;
    if (track.poseCount[k] >= 0) {
      poseKnown++;
      if (track.poseCount[k] >= 2) multiPose++;
    }
    if (!track.detected[k]) continue;
    detected++;
    const near = likelyNear(track, k);
    const head =
      (track.nose.vis[k] >= PREPROCESS.minVisibility && track.nose.inFrame[k] === 1) ||
      rawOk(track, "left", "ear", k) ||
      rawOk(track, "right", "ear", k);
    if (head && BODY_JOINTS.every((joint) => rawOk(track, near, joint, k))) complete++;
  }

  // 骨架整體跳動：骨盆單幀位移 > 0.5 L，或軀幹長度驟變 > 35%（疑似換成另一個人，§7.1 multi_person）
  const L0 = roughLegLength(track.side, track.n, true);
  const maxGap = Math.max(1, Math.round(PREPROCESS.maxGapSec * track.fps)) + 1;
  let jumps = 0;
  let prev = -1;
  const pelvisRaw = (k: number) => {
    const L = track.side.left.hip;
    const R = track.side.right.hip;
    return [(L.rawX[k] + R.rawX[k]) / 2, (L.rawY[k] + R.rawY[k]) / 2];
  };
  const trunkRaw = (k: number) => {
    const s = track.side;
    return Math.hypot(
      (s.left.shoulder.rawX[k] + s.right.shoulder.rawX[k]) / 2 - (s.left.hip.rawX[k] + s.right.hip.rawX[k]) / 2,
      (s.left.shoulder.rawY[k] + s.right.shoulder.rawY[k]) / 2 - (s.left.hip.rawY[k] + s.right.hip.rawY[k]) / 2,
    );
  };
  if (L0 > 0) {
    for (let k = 0; k < track.n; k++) {
      const [x, y] = pelvisRaw(k);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (prev >= 0 && k - prev <= maxGap) {
        const [px, py] = pelvisRaw(prev);
        const trunkNow = trunkRaw(k);
        const trunkPrev = trunkRaw(prev);
        const scaleJump =
          Number.isFinite(trunkNow) && Number.isFinite(trunkPrev) && trunkPrev > 0
            ? Math.abs(trunkNow / trunkPrev - 1) > REJECT.identityScaleJump
            : false;
        if (Math.hypot(x - px, y - py) > REJECT.identityJumpLeg * L0 || scaleJump) jumps++;
      }
      prev = k;
    }
  }

  return {
    durationSec,
    fps: track.fps,
    detectedFraction: frames > 0 ? detected / frames : 0,
    multiPoseFraction: poseKnown > 0 && detected > 0 ? multiPose / detected : undefined,
    identityJumps: jumps,
    completeBodyFraction: frames > 0 ? complete / frames : 0,
  };
}

/** 沒有直線段時，身體寬度比（肩寬比、髖寬比中位數的較大者），用於判斷是否正面朝鏡頭。 */
export function bodyWidthRatio(track: Track): number {
  const shoulder: number[] = [];
  const hip: number[] = [];
  for (let k = 0; k < track.n; k++) {
    if (!track.detected[k]) continue;
    const s = widthRatioAt(track, k, "shoulder");
    const h = widthRatioAt(track, k, "hip");
    if (Number.isFinite(s)) shoulder.push(s);
    if (Number.isFinite(h)) hip.push(h);
  }
  return Math.max(median(shoulder) || 0, median(hip) || 0);
}

// ---------------------------------------------------------------------------
// §6.3 可信度用的量測
// ---------------------------------------------------------------------------

/** 有效週期涵蓋的格點（與該週期所屬趟次的近側）。 */
export function cycleFrames(track: Track, cycles: readonly CycleDetail[], passes: readonly Pass[]): Array<{ k: number; pass: Pass }> {
  const out: Array<{ k: number; pass: Pass }> = [];
  const seen = new Set<number>();
  for (const cycle of cycles) {
    const pass = passes[cycle.cycle.passIndex];
    const [from, to] = indexRange(track, cycle.cycle.heelStrikeSec, cycle.cycle.nextHeelStrikeSec);
    for (let k = from; k <= to; k++) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ k, pass });
    }
  }
  return out;
}

/** 近側某些關節的平均 visibility 與內插比例（occlusion，§6.3）。 */
export function visibilityStats(track: Track, frames: ReadonlyArray<{ k: number; pass: Pass }>, joints: readonly Joint[]) {
  const vis: number[] = [];
  let interp = 0;
  let total = 0;
  for (const { k, pass } of frames) {
    for (const joint of joints) {
      const p = track.side[pass.nearSide][joint];
      vis.push(p.vis[k]);
      interp += p.interp[k];
      total++;
    }
  }
  return { visibility: mean(vis), interpolated: total > 0 ? interp / total : undefined };
}

export interface QualityInputs {
  track: Track;
  passes: readonly Pass[];
  usedCycles: readonly CycleDetail[];
  L: number;
  cyclesLeft: number;
  cyclesRight: number;
  maxStdDev?: number;
  accelerationCyclesKept: boolean;
}

export function confidenceMeasurements(input: QualityInputs): ConfidenceMeasurements {
  const { track, passes, usedCycles, L } = input;
  const frames = cycleFrames(track, usedCycles, passes);
  const usedPassIndices = new Set(usedCycles.map((cycle) => cycle.cycle.passIndex));
  const usedPasses = passes.filter((pass) => usedPassIndices.has(pass.passIndex));
  const pelvis = pelvisSeries(track);

  const hipRatios: number[] = [];
  const heights: number[] = [];
  const jitter: number[] = [];
  let edge = 0;
  const edgeBand = CONFIDENCE.lensDistortion.edgeFraction * track.width;
  for (const { k, pass } of frames) {
    const ratio = widthRatioAt(track, k, "hip");
    if (Number.isFinite(ratio)) hipRatios.push(ratio);
    const near = track.side[pass.nearSide];
    const footY = Math.max(near.heel.Y[k], near.toe.Y[k]);
    const noseY = track.nose.Y[k];
    const earY = near.ear.Y[k];
    if (Number.isFinite(footY) && Number.isFinite(noseY)) heights.push((footY - noseY) / CONFIDENCE.subjectSmall.noseHeightFraction);
    else if (Number.isFinite(footY) && Number.isFinite(earY)) heights.push((footY - earY) / 0.93);
    for (const joint of ["hip", "knee", "ankle"] as const) {
      const r = near[joint].residual[k];
      if (Number.isFinite(r)) jitter.push(r * r);
    }
    const x = pelvis.X[k];
    if (Number.isFinite(x) && (x < edgeBand || x > track.width - edgeBand)) edge++;
  }

  // 出畫比例：所有直線段影格中，必要關鍵點（鼻、近側肩髖膝踝跟尖）任一超出畫面
  let passFrames = 0;
  let outFrames = 0;
  for (const pass of passes) {
    for (let k = pass.startIndex; k <= pass.endIndex; k++) {
      if (!track.detected[k]) continue;
      passFrames++;
      const near = track.side[pass.nearSide];
      const out = track.nose.inFrame[k] === 0 || BODY_JOINTS.some((joint) => near[joint].inFrame[k] === 0);
      if (out) outFrames++;
    }
  }

  const rollPasses = usedPasses.length > 0 ? usedPasses : passes;
  const weights = rollPasses.map((pass) => pass.endSec - pass.startSec);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const rollAbs =
    totalWeight > 0 ? rollPasses.reduce((acc, pass, i) => acc + Math.abs(pass.rollDeg) * weights[i], 0) / totalWeight : undefined;
  const rolls = rollPasses.map((pass) => pass.rollDeg);
  const durations = usedCycles.map((cycle) => cycle.cycle.nextHeelStrikeSec - cycle.cycle.heelStrikeSec);
  const paceCV = durations.length >= 2 ? sampleStd(durations) / mean(durations) : undefined;
  const vis = visibilityStats(track, frames, BODY_JOINTS);

  return {
    hipWidthRatio: hipRatios.length > 0 ? median(hipRatios) : undefined,
    legLengthVariation: usedPasses.length > 0 ? Math.max(...finite(usedPasses.map((pass) => pass.legLengthVariation)), 0) : undefined,
    nearVisibility: Number.isFinite(vis.visibility) ? vis.visibility : undefined,
    interpolatedFraction: vis.interpolated,
    nearSideDisagreement: usedPasses.some((pass) => !pass.nearSideAgreement),
    cyclesLeft: input.cyclesLeft,
    cyclesRight: input.cyclesRight,
    maxStdDev: input.maxStdDev,
    subjectHeightFraction: heights.length > 0 ? median(heights) / track.height : undefined,
    outOfFrameFraction: passFrames > 0 ? outFrames / passFrames : undefined,
    rollAbsDeg: rollAbs,
    rollRangeDeg: rolls.length >= 2 ? Math.max(...rolls) - Math.min(...rolls) : undefined,
    fps: track.fps,
    swapFraction: track.swapFraction,
    edgeFraction: frames.length > 0 ? edge / frames.length : undefined,
    jitterLeg: jitter.length > 0 && L > 0 ? Math.sqrt(mean(jitter)) / L : undefined,
    paceCV,
    accelerationCyclesKept: input.accelerationCyclesKept,
  };
}

/** 頭部前傾觀察（D25）：有任何有效週期算得出 NCK 就是 observed。 */
export function headObservationStatus(cycles: readonly CycleDetail[]): "observed" | "not_assessable" {
  return cycles.some((cycle) => cycle.metrics.NCK !== undefined) ? "observed" : "not_assessable";
}

/** 步頻（步/分）＝ 2 × 60 ÷ 週期時間中位數。 */
export function cadence(cycles: readonly CycleDetail[]): number | undefined {
  const durations = cycles.map((cycle) => cycle.cycle.nextHeelStrikeSec - cycle.cycle.heelStrikeSec);
  const T = median(durations);
  return Number.isFinite(T) && T > 0 ? 120 / T : undefined;
}

/** 正規化步速中位數（§2.7）。 */
export function speedMedian(cycles: readonly CycleDetail[]): number | undefined {
  const value = median(finite(cycles.map((cycle) => cycle.speedLegPerSec)));
  return Number.isFinite(value) ? value : undefined;
}

