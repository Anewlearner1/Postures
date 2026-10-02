/**
 * 這個檔案做什麼：
 *   1. 由事件組出步態週期：同側 HS → TO → 下一個 HS（§2.4）
 *   2. 週期合理性檢查（事件順序、週期時間、支撐期比例、關鍵點完整、畫面邊緣，§2.4）
 *   3. 加減速週期標記與排除（§2.2 第 6 點）
 *   4. 每個有效週期依時相窗（§2.5）計算指標：PHE、TE（§3.2）、PKF_sw、KIC、KLR（§4.2）、TRK、NCK（§5.2）
 *      以及正規化步速（§2.7）與各指標出現的代表時間點（D38）
 */

import { CYCLE_CHECK, PHASE, SEGMENTATION } from "@/lib/rules/thresholds";
import { hipAngle, kneeAngle, segmentAngleDown, segmentAngleUp } from "./angles";
import type { PassEvents } from "./events";
import { mean, parabolicOffset } from "./math";
import { pelvisSeries, type Pass } from "./passes";
import type { Track } from "./preprocess";
import type { CycleDetail, GaitMetrics } from "./types";

/** 時間 → 最接近的格點索引。 */
export function indexAt(track: Track, timeSec: number): number {
  return Math.min(track.n - 1, Math.max(0, Math.round((timeSec - track.t[0]) / track.dt)));
}

/** 時間區間 [t1, t2] 內的格點索引範圍（含兩端）。 */
export function indexRange(track: Track, t1: number, t2: number): [number, number] {
  const from = Math.max(0, Math.ceil((t1 - track.t[0]) / track.dt - 1e-9));
  const to = Math.min(track.n - 1, Math.floor((t2 - track.t[0]) / track.dt + 1e-9));
  return [from, to];
}

function mid(a: number, b: number, fallback: number): number {
  return Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : fallback;
}

/** 單一格點的角度（近側；軀幹用肩、髖中點，遠側看不清時改用近側點，§5.2）。 */
export function framesAngles(track: Track, pass: Pass, k: number) {
  const d = pass.direction;
  const near = track.side[pass.nearSide];
  const far = track.side[pass.nearSide === "left" ? "right" : "left"];
  const thigh = segmentAngleDown(d, near.hip.X[k], near.hip.Y[k], near.knee.X[k], near.knee.Y[k]);
  const shank = segmentAngleDown(d, near.knee.X[k], near.knee.Y[k], near.ankle.X[k], near.ankle.Y[k]);
  const shX = mid(near.shoulder.X[k], far.shoulder.X[k], near.shoulder.X[k]);
  const shY = mid(near.shoulder.Y[k], far.shoulder.Y[k], near.shoulder.Y[k]);
  const hipX = mid(near.hip.X[k], far.hip.X[k], near.hip.X[k]);
  const hipY = mid(near.hip.Y[k], far.hip.Y[k], near.hip.Y[k]);
  const trunk = segmentAngleUp(d, hipX, hipY, shX, shY);
  const neck = segmentAngleUp(d, near.shoulder.X[k], near.shoulder.Y[k], near.ear.X[k], near.ear.Y[k]);
  return { thigh, shank, trunk, neck, hip: hipAngle(thigh, trunk), knee: kneeAngle(thigh, shank) };
}

type AngleKey = "thigh" | "trunk" | "neck" | "hip" | "knee";

/** 區間內某角度的極值與其時間；有效值不到一半時回傳 undefined。 */
function extremum(track: Track, pass: Pass, from: number, to: number, key: AngleKey, mode: "min" | "max") {
  let best = NaN;
  let bestK = -1;
  let count = 0;
  for (let k = from; k <= to; k++) {
    const value = framesAngles(track, pass, k)[key];
    if (!Number.isFinite(value)) continue;
    count++;
    if (bestK < 0 || (mode === "min" ? value < best : value > best)) {
      best = value;
      bestK = k;
    }
  }
  if (bestK < 0 || count < (to - from + 1) / 2) return undefined;
  return refineExtremum(track, pass, bestK, key, mode);
}

/**
 * 次幀精細化（M5，A-1／A-8）：以極值格與前後兩格做拋物線內插，求出真正的峰值／谷值與時間。
 * 影格率低或走得快時，峰值常落在兩格之間，只取格點會讓 PKF_sw 低估、KIC 高估。
 * 只有在中間格確實是局部極值時才內插，否則直接用格點值。
 */
export function refineExtremum(track: Track, pass: Pass, k: number, key: AngleKey, mode: "min" | "max") {
  const value = framesAngles(track, pass, k)[key];
  const fallback = { value, timeSec: track.t[k] };
  if (k <= 0 || k >= track.n - 1) return fallback;
  const a = framesAngles(track, pass, k - 1)[key];
  const c = framesAngles(track, pass, k + 1)[key];
  if (!Number.isFinite(a) || !Number.isFinite(c)) return fallback;
  const isExtremum = mode === "min" ? value <= a && value <= c : value >= a && value >= c;
  if (!isExtremum) return fallback;
  const offset = parabolicOffset([a, value, c], 1);
  return { value: value - 0.25 * (a - c) * offset, timeSec: track.t[k] + offset * track.dt };
}

function average(track: Track, pass: Pass, from: number, to: number, key: AngleKey): number | undefined {
  const values: number[] = [];
  for (let k = from; k <= to; k++) {
    const value = framesAngles(track, pass, k)[key];
    if (Number.isFinite(value)) values.push(value);
  }
  if (values.length === 0 || values.length < (to - from + 1) / 2) return undefined;
  return mean(values);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** §2.5、§3.2、§4.2、§5.2：單一週期的指標。 */
export function computeCycleMetrics(
  track: Track,
  pass: Pass,
  hs: number,
  to: number,
  nextHs: number,
): { metrics: GaitMetrics; timesSec: CycleDetail["timesSec"] } {
  const T = nextHs - hs;
  const metrics: GaitMetrics = {};
  const timesSec: CycleDetail["timesSec"] = {};

  // 支撐中後期 HS+15% → TO：PHE = −min(θ_hip)、TE = −min(φ_thigh)
  const [lateFrom, lateTo] = indexRange(track, hs + PHASE.loadingResponseFraction * T, to);
  const hipMin = extremum(track, pass, lateFrom, lateTo, "hip", "min");
  if (hipMin) {
    metrics.PHE = -hipMin.value;
    timesSec.PHE = round2(hipMin.timeSec);
  }
  const thighMin = extremum(track, pass, lateFrom, lateTo, "thigh", "min");
  if (thighMin) metrics.TE = -thighMin.value;

  // 擺盪期 TO → 下一個 HS：PKF_sw = max(θ_knee)
  const [swingFrom, swingTo] = indexRange(track, to, nextHs);
  const kneeMax = extremum(track, pass, swingFrom, swingTo, "knee", "max");
  if (kneeMax) {
    metrics.PKF_sw = kneeMax.value;
    timesSec.PKF_sw = round2(kneeMax.timeSec);
  }

  // 初始著地（M5 修正 A-1）：在 HS ± 40 毫秒（至少 ±1 格）內找膝角的局部最小值，再做拋物線次幀內插。
  // 原規格「HS ±1 幀平均」在著地這個膝角最小值附近取平均，必然偏高，且影格越少、走越快偏越多
  // （合成資料 30 fps +3°、15 fps +5–9°）。著地瞬間膝角接近擺盪末期伸直的最小值（§4.1），
  // 事件偵測誤差約 ±1 格（Zeni 2008），所以在小視窗內找最小值比固定取平均更準。
  const kicHalf = Math.max(1, Math.round(PHASE.kicSearchSec / track.dt));
  const k0 = indexAt(track, hs);
  let kicBest = -1;
  for (let k = Math.max(0, k0 - kicHalf); k <= Math.min(track.n - 1, k0 + kicHalf); k++) {
    const value = framesAngles(track, pass, k).knee;
    if (Number.isFinite(value) && (kicBest < 0 || value < framesAngles(track, pass, kicBest).knee)) kicBest = k;
  }
  if (kicBest >= 0) {
    metrics.KIC = refineExtremum(track, pass, kicBest, "knee", "min").value;
    timesSec.KIC = round2(hs);
  }

  // 承重期 HS → HS+15%：KLR = max(θ_knee)（輔助）
  const [lrFrom, lrTo] = indexRange(track, hs, hs + PHASE.loadingResponseFraction * T);
  const klr = extremum(track, pass, lrFrom, lrTo, "knee", "max");
  if (klr) metrics.KLR = klr.value;

  // 整個週期：TRK、NCK 平均
  const [cycleFrom, cycleTo] = indexRange(track, hs, nextHs);
  const trk = average(track, pass, cycleFrom, cycleTo, "trunk");
  if (trk !== undefined) {
    metrics.TRK = trk;
    timesSec.TRK = round2((hs + nextHs) / 2);
  }
  const nck = average(track, pass, cycleFrom, cycleTo, "neck");
  if (nck !== undefined) metrics.NCK = nck;

  return { metrics, timesSec };
}

/** 週期內近側必要關鍵點的最大缺值比例（未內插的缺口，§2.4）。 */
function missingFraction(track: Track, pass: Pass, from: number, to: number): number {
  const limb = track.side[pass.nearSide];
  const joints = pass.usedAnkleFallback ? (["hip", "knee", "ankle"] as const) : (["hip", "knee", "ankle", "heel", "toe"] as const);
  let worst = 0;
  for (const joint of joints) {
    let missing = 0;
    for (let k = from; k <= to; k++) if (!Number.isFinite(limb[joint].X[k])) missing++;
    worst = Math.max(worst, missing / Math.max(1, to - from + 1));
  }
  return worst;
}

/** 由一趟的事件組出週期並檢查、計算指標（§2.4）。加減速週期的排除在 `applyAccelerationRule`。 */
export function buildPassCycles(track: Track, pass: Pass, events: PassEvents, L: number): CycleDetail[] {
  const pelvis = pelvisSeries(track);
  const cycles: CycleDetail[] = [];
  const hsList = events.heelStrikes;
  for (let i = 0; i + 1 < hsList.length; i++) {
    const hs = hsList[i];
    const nextHs = hsList[i + 1];
    const tos = events.toeOffs.filter((time) => time > hs && time < nextHs);
    const to = tos.length === 1 ? tos[0] : NaN;
    const T = nextHs - hs;
    const isAccelerationCycle =
      hs < pass.startSec + SEGMENTATION.accelMarginSec || nextHs > pass.endSec - SEGMENTATION.accelMarginSec;

    let rejectReason: CycleDetail["rejectReason"];
    const [from, toIndex] = indexRange(track, hs, nextHs);
    if (tos.length !== 1) rejectReason = "event_order";
    else if (T < CYCLE_CHECK.minCycleSec || T > CYCLE_CHECK.maxCycleSec) rejectReason = "cycle_time";
    else if ((to - hs) / T < CYCLE_CHECK.minStanceFraction || (to - hs) / T > CYCLE_CHECK.maxStanceFraction)
      rejectReason = "stance_ratio";
    else if (missingFraction(track, pass, from, toIndex) >= CYCLE_CHECK.maxMissingFraction) rejectReason = "missing_keypoints";
    else {
      const edge = CYCLE_CHECK.frameEdgeFraction * track.width;
      for (let k = from; k <= toIndex; k++) {
        const x = pelvis.X[k];
        if (Number.isFinite(x) && (x < edge || x > track.width - edge)) {
          rejectReason = "frame_edge";
          break;
        }
      }
    }

    const cycle: CycleDetail = {
      cycle: {
        side: pass.nearSide,
        passIndex: pass.passIndex,
        heelStrikeSec: hs,
        toeOffSec: to,
        nextHeelStrikeSec: nextHs,
        valid: rejectReason === undefined,
        isAccelerationCycle,
      },
      metrics: {},
      timesSec: {},
      used: false,
    };
    if (rejectReason) {
      cycle.rejectReason = rejectReason;
    } else {
      const computed = computeCycleMetrics(track, pass, hs, to, nextHs);
      cycle.metrics = computed.metrics;
      cycle.timesSec = computed.timesSec;
      const x1 = pelvis.X[indexAt(track, hs)];
      const x2 = pelvis.X[indexAt(track, nextHs)];
      const speed = (pass.direction * (x2 - x1)) / T / L;
      if (Number.isFinite(speed)) cycle.speedLegPerSec = speed;
    }
    cycles.push(cycle);
  }
  return cycles;
}

/**
 * §2.2 第 6 點：同一趟（同一側）扣除加減速週期後仍有 ≥ 1 個有效週期，就排除加減速週期；
 * 否則保留它們（回傳 true 表示有保留加減速週期，可信度要降低）。會設定每個週期的 `used`。
 */
export function applyAccelerationRule(passCycles: CycleDetail[]): boolean {
  const valid = passCycles.filter((cycle) => cycle.cycle.valid);
  const steady = valid.filter((cycle) => !cycle.cycle.isAccelerationCycle);
  if (steady.length >= 1) {
    for (const cycle of valid) cycle.used = !cycle.cycle.isAccelerationCycle;
    return false;
  }
  for (const cycle of valid) cycle.used = true;
  return valid.length > 0;
}
