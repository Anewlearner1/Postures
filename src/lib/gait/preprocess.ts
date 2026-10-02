/**
 * 這個檔案做什麼：
 *   步態分析的前處理（docs/spec/gait-rules.md §0.2、§1.2、§1.3）：
 *   1. 把影格放到等間隔的時間格點上（掉幀的位置變成缺值）
 *   2. 正規化座標 → 像素座標（X = x × 寬、Y = y × 高，§0.2）
 *   3. visibility < 0.5 視為缺值（§1.2）
 *   4. 左右錯置（L/R swap）偵測與修正（§1.3）
 *   5. ≤ 0.12 秒的缺口線性內插，並記錄被內插的影格（§1.2）
 *   6. 零相位 4 階 Butterworth 6 Hz 低通濾波（§1.2）
 *
 *   輸出 `Track`：之後所有模組都從這裡讀關鍵點座標。
 */

import { LANDMARK, type PoseFrame, type Side } from "./types";
import { PREPROCESS, SEGMENTATION } from "@/lib/rules/thresholds";
import { fillShortGaps, lowpassZeroPhase, median, percentile } from "./math";

/** 本產品用到的關節（每側一組）。 */
export type Joint = "ear" | "shoulder" | "hip" | "knee" | "ankle" | "heel" | "toe";
export const JOINTS: readonly Joint[] = ["ear", "shoulder", "hip", "knee", "ankle", "heel", "toe"];
/** 左右錯置修正時一起交換的下肢關節（§1.3）。 */
export const LEG_JOINTS: readonly Joint[] = ["hip", "knee", "ankle", "heel", "toe"];

const LANDMARK_INDEX: Record<Side, Record<Joint, number>> = {
  left: {
    ear: LANDMARK.leftEar,
    shoulder: LANDMARK.leftShoulder,
    hip: LANDMARK.leftHip,
    knee: LANDMARK.leftKnee,
    ankle: LANDMARK.leftAnkle,
    heel: LANDMARK.leftHeel,
    toe: LANDMARK.leftFootIndex,
  },
  right: {
    ear: LANDMARK.rightEar,
    shoulder: LANDMARK.rightShoulder,
    hip: LANDMARK.rightHip,
    knee: LANDMARK.rightKnee,
    ankle: LANDMARK.rightAnkle,
    heel: LANDMARK.rightHeel,
    toe: LANDMARK.rightFootIndex,
  },
};

/** 單一關鍵點在時間格點上的序列。缺值為 NaN。 */
export interface PointSeries {
  /** 處理後（錯置修正、內插、濾波；之後可能再做 roll 校正）的像素座標。 */
  X: Float64Array;
  Y: Float64Array;
  /** 錯置修正後、內插前的原始像素座標（缺值為 NaN）。 */
  rawX: Float64Array;
  rawY: Float64Array;
  /** MediaPipe 的相對深度 z（越小越靠近鏡頭）；缺值為 NaN。 */
  z: Float64Array;
  /** visibility（沒偵測到人時為 0）。 */
  vis: Float64Array;
  /** 原始正規化座標是否在畫面內（0–1）。 */
  inFrame: Uint8Array;
  /** 1 = 這一格是內插補出來的。 */
  interp: Uint8Array;
  /** 原始座標與濾波後座標的距離（像素；只在原始有效的格點有值），給關鍵點跳動（low_light）使用。 */
  residual: Float64Array;
}

export interface Track {
  /** 格點數。 */
  n: number;
  /** 格點間距（秒）＝ 1 / 有效影格率。 */
  dt: number;
  fps: number;
  /** 各格點的時間（秒，對齊原始影格時間）。 */
  t: Float64Array;
  width: number;
  height: number;
  /** 這一格有原始影格。 */
  hasFrame: Uint8Array;
  /** 這一格有偵測到人。 */
  detected: Uint8Array;
  /** 這一格偵測到的人數（有 poseCount 才有；否則為 −1）。 */
  poseCount: Int16Array;
  nose: PointSeries;
  side: Record<Side, Record<Joint, PointSeries>>;
  /** 1 = 這一格的下肢左右標籤被交換修正過（§1.3）。 */
  swapped: Uint8Array;
  /** 偵測到人的格點中被修正的比例。 */
  swapFraction: number;
}

function newSeries(n: number): PointSeries {
  return {
    X: new Float64Array(n).fill(NaN),
    Y: new Float64Array(n).fill(NaN),
    rawX: new Float64Array(n).fill(NaN),
    rawY: new Float64Array(n).fill(NaN),
    z: new Float64Array(n).fill(NaN),
    vis: new Float64Array(n),
    inFrame: new Uint8Array(n),
    interp: new Uint8Array(n),
    residual: new Float64Array(n).fill(NaN),
  };
}

/** 由影格時間戳推得的有效影格率（中位數間隔）；資料不足時用 fallbackFps。 */
export function estimateFps(frames: readonly PoseFrame[], fallbackFps: number): number {
  const diffs: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const diff = frames[i].timeSec - frames[i - 1].timeSec;
    if (diff > 1e-6) diffs.push(diff);
  }
  const dt = median(diffs);
  if (!Number.isFinite(dt) || dt <= 0) return fallbackFps;
  return 1 / dt;
}

/** 依時間排序並去除重複時間的影格。 */
export function sortFrames(frames: readonly PoseFrame[]): PoseFrame[] {
  const sorted = frames.filter((frame) => Number.isFinite(frame.timeSec)).sort((a, b) => a.timeSec - b.timeSec);
  const out: PoseFrame[] = [];
  for (const frame of sorted) {
    if (out.length === 0 || frame.timeSec - out[out.length - 1].timeSec > 1e-6) out.push(frame);
  }
  return out;
}

function fillFromLandmark(series: PointSeries, k: number, frame: PoseFrame, index: number, width: number, height: number) {
  const landmark = frame.landmarks?.[index];
  if (!landmark) return;
  const { x, y, z, visibility } = landmark;
  if (![x, y].every(Number.isFinite)) return;
  series.vis[k] = Number.isFinite(visibility) ? visibility : 0;
  series.inFrame[k] = x >= 0 && x <= 1 && y >= 0 && y <= 1 ? 1 : 0;
  if (series.vis[k] < PREPROCESS.minVisibility) return;
  series.rawX[k] = x * width; // §0.2：先換成像素座標
  series.rawY[k] = y * height;
  series.z[k] = Number.isFinite(z) ? z : NaN;
}

/** 粗估腿長（像素）：每格取 visibility 較高那一側的「髖→膝＋膝→踝」，再取第 90 百分位數（§2.2）。 */
export function roughLegLength(side: Record<Side, Record<Joint, PointSeries>>, n: number, useRaw: boolean): number {
  const lengths: number[] = [];
  for (let k = 0; k < n; k++) {
    let best = NaN;
    let bestVis = -1;
    for (const s of ["left", "right"] as const) {
      const p = side[s];
      const X = (joint: Joint) => (useRaw ? p[joint].rawX[k] : p[joint].X[k]);
      const Y = (joint: Joint) => (useRaw ? p[joint].rawY[k] : p[joint].Y[k]);
      const length =
        Math.hypot(X("knee") - X("hip"), Y("knee") - Y("hip")) + Math.hypot(X("ankle") - X("knee"), Y("ankle") - Y("knee"));
      const vis = p.hip.vis[k] + p.knee.vis[k] + p.ankle.vis[k];
      if (Number.isFinite(length) && vis > bestVis) {
        best = length;
        bestVis = vis;
      }
    }
    if (Number.isFinite(best)) lengths.push(best);
  }
  return percentile(lengths, SEGMENTATION.legLengthPercentile);
}

const SWAP_COST_JOINTS: readonly Joint[] = ["knee", "ankle", "heel", "toe"];

/**
 * §1.3 左右錯置修正。
 * 規格的做法是「逐幀連續性檢查」；這裡把它一般化成兩狀態（不交換／交換）的動態規劃（Viterbi）：
 * 相鄰影格的代價 = 各下肢點的位移總和，每一格「交換」另加一個小的先驗代價（腿長 × swapPriorLeg）。
 * 這樣短暫的錯置（前後都有大跳動）會被修正，而在兩腳交會（位移本來就小）時也不會誤判；
 * 比逐幀貪婪法更不會因為漏掉一次邊界而讓整段標籤一路反過來。回傳被交換的格點旗標。
 */
export function correctLeftRightSwaps(
  side: Record<Side, Record<Joint, PointSeries>>,
  n: number,
  legLength: number,
  maxGapFrames: number,
): Uint8Array {
  const swapped = new Uint8Array(n);
  if (!(legLength > 0)) return swapped;
  const prior = PREPROCESS.swapPriorLeg * legLength;

  const usable: number[] = [];
  for (let k = 0; k < n; k++) {
    const ok = (["knee", "ankle"] as const).every(
      (joint) => Number.isFinite(side.left[joint].rawX[k]) && Number.isFinite(side.right[joint].rawX[k]),
    );
    if (ok) usable.push(k);
  }

  const dist = (a: PointSeries, ka: number, b: PointSeries, kb: number) => {
    const d = Math.hypot(a.rawX[ka] - b.rawX[kb], a.rawY[ka] - b.rawY[kb]);
    return Number.isFinite(d) ? d : 0;
  };
  /** 前一格狀態 s1、這一格狀態 s2 的轉移代價（只取決於兩者是否相同）。 */
  const transition = (k1: number, k2: number, same: boolean) => {
    let cost = 0;
    for (const joint of SWAP_COST_JOINTS) {
      const L = side.left[joint];
      const R = side.right[joint];
      cost += same ? dist(L, k2, L, k1) + dist(R, k2, R, k1) : dist(R, k2, L, k1) + dist(L, k2, R, k1);
    }
    return cost;
  };

  // 依缺口切成數條鏈，每條鏈各自做 Viterbi
  let chainStart = 0;
  for (let i = 1; i <= usable.length; i++) {
    const broken = i === usable.length || usable[i] - usable[i - 1] > maxGapFrames + 1;
    if (!broken) continue;
    const chain = usable.slice(chainStart, i);
    chainStart = i;
    if (chain.length < 2) continue;

    const m = chain.length;
    const cost = [new Float64Array(m), new Float64Array(m)];
    const back = [new Uint8Array(m), new Uint8Array(m)];
    cost[0][0] = 0;
    cost[1][0] = prior;
    for (let j = 1; j < m; j++) {
      const same = transition(chain[j - 1], chain[j], true);
      const diff = transition(chain[j - 1], chain[j], false);
      for (const s of [0, 1] as const) {
        const fromSame = cost[s][j - 1] + same;
        const fromOther = cost[1 - s][j - 1] + diff;
        const unary = s === 1 ? prior : 0;
        if (fromSame <= fromOther) {
          cost[s][j] = fromSame + unary;
          back[s][j] = s;
        } else {
          cost[s][j] = fromOther + unary;
          back[s][j] = 1 - s;
        }
      }
    }
    let state = cost[0][m - 1] <= cost[1][m - 1] ? 0 : 1;
    for (let j = m - 1; j >= 0; j--) {
      if (state === 1) swapped[chain[j]] = 1;
      state = back[state][j];
    }
  }

  // 套用交換：下肢的所有欄位一起左右互換
  for (let k = 0; k < n; k++) {
    if (!swapped[k]) continue;
    for (const joint of LEG_JOINTS) {
      const L = side.left[joint];
      const R = side.right[joint];
      for (const key of ["rawX", "rawY", "z", "vis"] as const) {
        const tmp = L[key][k];
        L[key][k] = R[key][k];
        R[key][k] = tmp;
      }
      const tmp = L.inFrame[k];
      L.inFrame[k] = R.inFrame[k];
      R.inFrame[k] = tmp;
    }
  }
  return swapped;
}

function finishSeries(series: PointSeries, maxGapFrames: number, cutoffHz: number, fps: number) {
  const X = Float64Array.from(series.rawX);
  const Y = Float64Array.from(series.rawY);
  const filledX = fillShortGaps(X, maxGapFrames);
  fillShortGaps(Y, maxGapFrames);
  series.interp = filledX;
  series.X = lowpassZeroPhase(X, cutoffHz, fps);
  series.Y = lowpassZeroPhase(Y, cutoffHz, fps);
  for (let k = 0; k < X.length; k++) {
    if (Number.isFinite(series.rawX[k]) && Number.isFinite(series.X[k])) {
      series.residual[k] = Math.hypot(series.rawX[k] - series.X[k], series.rawY[k] - series.Y[k]);
    }
  }
}

/** 建立前處理後的 Track。 */
export function buildTrack(inputFrames: readonly PoseFrame[], meta: { fps: number; width: number; height: number }): Track {
  const frames = sortFrames(inputFrames);
  const fps = estimateFps(frames, meta.fps);
  const dt = 1 / fps;
  const t0 = frames.length > 0 ? frames[0].timeSec : 0;
  const tEnd = frames.length > 0 ? frames[frames.length - 1].timeSec : 0;
  const n = frames.length > 0 ? Math.round((tEnd - t0) / dt) + 1 : 0;

  const t = new Float64Array(n);
  for (let k = 0; k < n; k++) t[k] = t0 + k * dt;
  const hasFrame = new Uint8Array(n);
  const detected = new Uint8Array(n);
  const poseCount = new Int16Array(n).fill(-1);
  const nose = newSeries(n);
  const side: Record<Side, Record<Joint, PointSeries>> = {
    left: Object.fromEntries(JOINTS.map((joint) => [joint, newSeries(n)])) as Record<Joint, PointSeries>,
    right: Object.fromEntries(JOINTS.map((joint) => [joint, newSeries(n)])) as Record<Joint, PointSeries>,
  };

  for (const frame of frames) {
    const k = Math.round((frame.timeSec - t0) / dt);
    if (k < 0 || k >= n || hasFrame[k]) continue;
    hasFrame[k] = 1;
    t[k] = frame.timeSec;
    if (typeof frame.poseCount === "number") poseCount[k] = frame.poseCount;
    if (!frame.landmarks || frame.landmarks.length < 33) continue;
    detected[k] = 1;
    fillFromLandmark(nose, k, frame, LANDMARK.nose, meta.width, meta.height);
    for (const s of ["left", "right"] as const) {
      for (const joint of JOINTS) fillFromLandmark(side[s][joint], k, frame, LANDMARK_INDEX[s][joint], meta.width, meta.height);
    }
  }

  const maxGapFrames = Math.max(1, Math.round(PREPROCESS.maxGapSec * fps));
  const legLength = roughLegLength(side, n, true);
  const swapped = correctLeftRightSwaps(side, n, legLength, maxGapFrames);
  let detectedCount = 0;
  let swappedCount = 0;
  for (let k = 0; k < n; k++) {
    detectedCount += detected[k];
    swappedCount += swapped[k];
  }

  const cutoffHz = Math.min(PREPROCESS.lowpassHz, (fps / 2) * PREPROCESS.lowpassMaxNyquistFraction);
  finishSeries(nose, maxGapFrames, cutoffHz, fps);
  for (const s of ["left", "right"] as const) {
    for (const joint of JOINTS) finishSeries(side[s][joint], maxGapFrames, cutoffHz, fps);
  }

  return {
    n,
    dt,
    fps,
    t,
    width: meta.width,
    height: meta.height,
    hasFrame,
    detected,
    poseCount,
    nose,
    side,
    swapped,
    swapFraction: detectedCount > 0 ? swappedCount / detectedCount : 0,
  };
}

export function otherSide(side: Side): Side {
  return side === "left" ? "right" : "left";
}
