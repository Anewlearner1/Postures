/**
 * 這個檔案做什麼：
 *   測試用的「合成走路骨架」產生器（沒有真實影片時用來驗證分析管線）。
 *
 *   做法：
 *   1. 以文獻常模形狀的關節角度曲線（週期性單調三次內插，極值剛好落在關鍵點上）描述一個步態週期：
 *      大腿相對垂直角（支撐末期最大後擺 TE、擺盪期最大前擺）、膝角（著地 KIC、承重期約 15–18°、
 *      擺盪期最大屈曲 PKF 約 60°）、足部角度、軀幹前傾角、頸傾角。
 *      曲線參考 Perry & Burnfield 的典型值（gait-rules.md §3.3、§4.3、§5.3）。
 *   2. 用正向運動學（Winter 人體節段比例 × 身高）算出 3D 關鍵點；骨盆高度讓最低的腳點貼地。
 *   3. 用針孔相機投影成 2D 影像座標，再轉成 MediaPipe 的正規化座標與 visibility、z。
 *   4. 可注入：行走方向、來回走與轉身、走速／週期、步態問題（髖伸展減少、擺盪期膝屈曲減少、
 *      著地膝屈曲增加、軀幹前傾）、雜訊、遮擋（visibility 降低）、缺幀、手機 roll、
 *      左右標籤交換、低影格率、相機偏離矢狀面、正面走、多人（換人）。
 *   5. 同時回傳「真值」：每隻腳的 HS／TO 時間、每趟方向與近側、依曲線算出的指標期望值。
 *
 *   只給測試使用（不會被網站程式引用）。
 */

import { LANDMARK, type Landmark, type PoseFrame, type Side } from "../types";

// ---------------------------------------------------------------------------
// 參數
// ---------------------------------------------------------------------------

/** 步態曲線參數（度）。預設值為健康成人舒適速度的典型值。 */
export interface GaitShape {
  /** 腳跟著地時大腿前擺角。 */
  thighAtHsDeg: number;
  /** 擺盪期大腿最大前擺角。 */
  thighFlexDeg: number;
  /** 支撐末期大腿最大後擺角（= TE，正數）。 */
  thighExtDeg: number;
  /** 著地膝角 KIC。 */
  kicDeg: number;
  /** 擺盪期最大膝屈曲 PKF_sw。 */
  pkfDeg: number;
  /** 軀幹前傾角（平均）。 */
  trunkLeanDeg: number;
  /** 頸傾角（肩→耳相對垂直）。 */
  neckLeanDeg: number;
  /** 支撐期佔週期比例（TO 的相位）。 */
  stanceFraction: number;
}

export const NORMAL_GAIT: GaitShape = {
  thighAtHsDeg: 24,
  thighFlexDeg: 28,
  thighExtDeg: 18,
  kicDeg: 4,
  pkfDeg: 60,
  trunkLeanDeg: 2,
  neckLeanDeg: 12,
  stanceFraction: 0.6,
};

export type SyntheticJoint = "ear" | "shoulder" | "hip" | "knee" | "ankle" | "heel" | "toe";

export interface SyntheticOptions {
  seed?: number;
  fps?: number;
  width?: number;
  height?: number;
  bodyHeightM?: number;
  /** 巡航走速（公尺/秒）。 */
  speedMps?: number;
  /** 步態週期（秒）；沒給時依走速估計（走得慢週期較長）。 */
  cycleSec?: number;
  /** 直線趟數（來回走 = 2 以上；每趟之間轉身）。 */
  passes?: number;
  /** 每趟走的距離（公尺）。 */
  walkwayM?: number;
  /** 第一趟的方向：+1 往畫面右、−1 往畫面左（正面走時 −1 = 朝鏡頭）。 */
  startDirection?: 1 | -1;
  standSec?: number;
  rampSec?: number;
  turnSec?: number;
  cameraDistanceM?: number;
  cameraHeightM?: number;
  focalPx?: number;
  /** 走道相對影像平面的偏轉角（度）：0 = 正側面；90 = 正面走。 */
  walkwayYawDeg?: number;
  /** 手機 roll（度）：整張影像繞中心旋轉。給陣列時為每趟不同的 roll（模擬手機晃動）。 */
  rollDeg?: number | number[];
  gait?: Partial<GaitShape>;
  /** 只套用在右腳的步態參數（左右不對稱，用來測 D26、ΔPKF）。 */
  gaitRight?: Partial<GaitShape>;
  /** 步頻不規則：相位加上 wobble·sin(…)（0–0.4；用來測 irregular_pace）。 */
  paceWobble?: number;
  /** 軀幹前傾角緩慢擺動的幅度（度；用來測 high_variability）。 */
  trunkWobbleDeg?: number;
  /** 像素雜訊標準差。 */
  noisePx?: number;
  nearVisibility?: number;
  farVisibility?: number;
  /** 鼻子的 visibility（背影時鼻子看不到，例如 0.2）。 */
  noseVisibility?: number;
  /** 指定某些關節的 visibility（near = 近側、far = 遠側）。 */
  jointVisibility?: Partial<Record<"near" | "far", Partial<Record<SyntheticJoint, number>>>>;
  /** 近側下肢短暫遮擋（visibility 0.2）的影格比例（每次 2–6 格）。 */
  dropoutFraction?: number;
  /** 偵測不到人（landmarks = null）的影格比例（每次 1–3 格）。 */
  missingFrameFraction?: number;
  /** 整格被丟掉（時間戳出現缺口）的影格比例。 */
  droppedFrameFraction?: number;
  /** 下肢左右標籤被交換的影格比例（每次 3–8 格）。 */
  swapFraction?: number;
  /** 骨架短暫換成另一個人的次數（每次 5 格）。 */
  identitySwitches?: number;
  /** 每格附上的 poseCount。 */
  poseCount?: number;
  /** 只產生到這個時間（秒），用來做「太短」的影片。 */
  maxDurationSec?: number;
}

/** 真值事件（行走中，含加速與減速段；轉身與站立時不算）。 */
export interface SyntheticEvent {
  side: Side;
  type: "heel_strike" | "toe_off";
  timeSec: number;
  passIndex: number;
}

export interface SyntheticTruth {
  events: SyntheticEvent[];
  /** 每趟巡航（等速）區間。 */
  passes: Array<{ startSec: number; endSec: number; direction: 1 | -1; nearSide: Side }>;
  /** 每段轉身（含前後減速、加速以外的原地轉身）區間。 */
  turns: Array<{ startSec: number; endSec: number }>;
  cycleSec: number;
  legLengthM: number;
  speedLegPerSec: number;
  /** 依曲線算出的指標期望值（度；左腳。左右對稱時兩側相同）。 */
  expected: ExpectedMetrics;
  /** 每側的期望值。 */
  expectedBySide: Record<Side, ExpectedMetrics>;
  shape: GaitShape;
}

export interface ExpectedMetrics {
  PHE: number;
  TE: number;
  PKF_sw: number;
  KIC: number;
  TRK: number;
  NCK: number;
}

export interface SyntheticResult {
  frames: PoseFrame[];
  meta: { fps: number; width: number; height: number; durationSec: number };
  truth: SyntheticTruth;
}

// ---------------------------------------------------------------------------
// 工具：亂數、週期性單調三次內插
// ---------------------------------------------------------------------------

/** 可重現的亂數（mulberry32）。 */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(1e-12, next());
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss };
}

/**
 * 週期性單調三次內插（Fritsch–Carlson）：曲線經過所有關鍵點，且不會超出相鄰關鍵點範圍，
 * 所以最大／最小值剛好等於指定的關鍵點值。knots 的相位需在 [0, 1) 且遞增。
 */
export function periodicCurve(knots: ReadonlyArray<readonly [number, number]>): (phase: number) => number {
  const n = knots.length;
  const xs = [knots[n - 1][0] - 1, ...knots.map((k) => k[0]), knots[0][0] + 1, knots[1][0] + 1];
  const ys = [knots[n - 1][1], ...knots.map((k) => k[1]), knots[0][1], knots[1][1]];
  const m = xs.length;
  const secant = Array.from({ length: m - 1 }, (_, i) => (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const slope = new Array<number>(m).fill(0);
  for (let i = 1; i < m - 1; i++) {
    if (secant[i - 1] * secant[i] <= 0) slope[i] = 0;
    else {
      const w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]);
      const w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1]);
      slope[i] = (w1 + w2) / (w1 / secant[i - 1] + w2 / secant[i]);
    }
  }
  return (phase: number) => {
    const p = phase - Math.floor(phase);
    let i = 1;
    while (i < m - 2 && p > xs[i + 1]) i++;
    if (p < xs[i]) i = 0;
    const h = xs[i + 1] - xs[i];
    const s = (p - xs[i]) / h;
    const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
    const h10 = s ** 3 - 2 * s ** 2 + s;
    const h01 = -2 * s ** 3 + 3 * s ** 2;
    const h11 = s ** 3 - s ** 2;
    return h00 * ys[i] + h10 * h * slope[i] + h01 * ys[i + 1] + h11 * h * slope[i + 1];
  };
}

/** 依步態參數建立各角度曲線（相位 0 = 腳跟著地）。 */
export function gaitCurves(shape: GaitShape) {
  const to = shape.stanceFraction;
  const thigh = periodicCurve([
    [0, shape.thighAtHsDeg],
    [0.26, (shape.thighAtHsDeg - shape.thighExtDeg) / 2],
    [to - 0.08, -shape.thighExtDeg],
    [to + 0.12, 0.45 * shape.thighFlexDeg],
    [0.85, shape.thighFlexDeg],
  ]);
  const klr = Math.max(18, shape.kicDeg + 8);
  const midStance = Math.max(shape.kicDeg + 1, 5);
  const kneeAtTo = Math.max(0.6 * shape.pkfDeg, midStance + 5);
  const knee = periodicCurve([
    [0, shape.kicDeg],
    [0.13, klr],
    [0.4, midStance],
    [to, kneeAtTo],
    [to + 0.12, shape.pkfDeg],
    [0.88, Math.max(0.45 * shape.pkfDeg, shape.kicDeg + 3)],
  ]);
  const foot = periodicCurve([
    [0, 15],
    [0.08, 0],
    [0.42, 0],
    [to, -40],
    [0.85, 0],
    [0.95, 12],
  ]);
  const trunk = (phase: number) => shape.trunkLeanDeg + Math.sin(4 * Math.PI * phase);
  return { thigh, knee, foot, trunk, to };
}

/** 依曲線算出各指標的期望值（與分析管線的定義一致，§3.2、§4.2、§5.2）。 */
export function expectedMetrics(shape: GaitShape): ExpectedMetrics {
  const c = gaitCurves(shape);
  let minHip = Infinity;
  let minThigh = Infinity;
  let maxKnee = -Infinity;
  let trunkSum = 0;
  const steps = 2000;
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    if (p >= 0.15 && p <= c.to) {
      minHip = Math.min(minHip, c.thigh(p) + c.trunk(p));
      minThigh = Math.min(minThigh, c.thigh(p));
    }
    if (p >= c.to) maxKnee = Math.max(maxKnee, c.knee(p));
    if (i < steps) trunkSum += c.trunk(p);
  }
  return {
    PHE: -minHip,
    TE: -minThigh,
    PKF_sw: maxKnee,
    KIC: c.knee(0),
    TRK: trunkSum / steps,
    NCK: shape.neckLeanDeg,
  };
}

// ---------------------------------------------------------------------------
// 時間軸：站立 → 加速 → 等速 → 減速 → 轉身 → …
// ---------------------------------------------------------------------------

interface Phase {
  kind: "stand" | "ramp_up" | "cruise" | "ramp_down" | "turn";
  start: number;
  end: number;
  passIndex: number;
}

const DEG = Math.PI / 180;

export function generateWalk(options: SyntheticOptions = {}): SyntheticResult {
  const o = {
    seed: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    bodyHeightM: 1.7,
    speedMps: 1.3,
    passes: 2,
    walkwayM: 4.5,
    startDirection: 1 as 1 | -1,
    standSec: 0.6,
    rampSec: 0.5,
    turnSec: 1.2,
    cameraDistanceM: 4,
    cameraHeightM: 1.0,
    focalPx: 1400,
    walkwayYawDeg: 0,
    rollDeg: 0,
    noisePx: 0,
    nearVisibility: 0.95,
    farVisibility: 0.7,
    dropoutFraction: 0,
    missingFrameFraction: 0,
    droppedFrameFraction: 0,
    swapFraction: 0,
    identitySwitches: 0,
    ...options,
  };
  const shape: GaitShape = { ...NORMAL_GAIT, ...options.gait };
  const shapeRight: GaitShape = { ...shape, ...options.gaitRight };
  const random = rng(o.seed);
  const H = o.bodyHeightM;
  const seg = {
    thigh: 0.245 * H,
    shank: 0.246 * H,
    trunk: 0.288 * H,
    neck: 0.11 * H,
    hipHalf: 0.053 * H,
    shoulderHalf: 0.106 * H,
    earHalf: 0.044 * H,
    heel: [-0.03 * H, -0.03 * H] as const,
    toe: [0.088 * H, -0.03 * H] as const,
    upperArm: 0.186 * H,
    forearm: 0.146 * H,
  };
  const legLengthM = seg.thigh + seg.shank;
  const v = o.speedMps;
  const T = o.cycleSec ?? (v > 0 ? 1.05 * Math.pow(1.3 / v, 0.4) : 1.05);
  const curvesBySide = { left: gaitCurves(shape), right: gaitCurves(shapeRight) };
  const curves = curvesBySide.left;

  // 時間軸
  const phases: Phase[] = [];
  let time = 0;
  const push = (kind: Phase["kind"], duration: number, passIndex: number) => {
    phases.push({ kind, start: time, end: time + duration, passIndex });
    time += duration;
  };
  push("stand", o.standSec, -1);
  const cruiseSec = v > 0 ? Math.max(0, (o.walkwayM - v * o.rampSec) / v) : 0;
  for (let p = 0; p < o.passes; p++) {
    if (p > 0) push("turn", o.turnSec, p);
    push("ramp_up", o.rampSec, p);
    push("cruise", cruiseSec, p);
    push("ramp_down", o.rampSec, p);
  }
  push("stand", o.standSec, -1);
  const totalSec = Math.min(time, o.maxDurationSec ?? Infinity);

  const axisAngle = o.walkwayYawDeg * DEG;
  const axis = [Math.cos(axisAngle), Math.sin(axisAngle)] as const; // (X, Z)
  const center = [0, o.cameraDistanceM] as const;
  const passDirection = (passIndex: number): 1 | -1 => (passIndex % 2 === 0 ? o.startDirection : (-o.startDirection as 1 | -1));
  const phaseAt = (t: number) => phases.find((ph) => t >= ph.start && t < ph.end) ?? phases[phases.length - 1];

  /** 某時間點的位置（沿走道的座標 s，−W/2 ～ +W/2）、速度與步態幅度。 */
  const stateAt = (t: number) => {
    const ph = phaseAt(t);
    // 依序累積位移
    let s = -o.startDirection * (o.walkwayM / 2);
    let heading = o.startDirection === 1 ? axisAngle : axisAngle + Math.PI;
    let amplitude = 0;
    let speed = 0;
    for (const item of phases) {
      if (item.start > t) break;
      const dtIn = Math.min(t, item.end) - item.start;
      const d = item.passIndex >= 0 ? passDirection(item.passIndex) : o.startDirection;
      const baseHeading = d === 1 ? axisAngle : axisAngle + Math.PI;
      if (item.kind === "ramp_up") {
        s += d * (v * dtIn * dtIn) / (2 * o.rampSec);
        heading = baseHeading;
      } else if (item.kind === "cruise") {
        s += d * v * dtIn;
        heading = baseHeading;
      } else if (item.kind === "ramp_down") {
        s += d * (v * dtIn - (v * dtIn * dtIn) / (2 * o.rampSec));
        heading = baseHeading;
      } else if (item.kind === "turn") {
        const prev = passDirection(item.passIndex - 1);
        const from = prev === 1 ? axisAngle : axisAngle + Math.PI;
        heading = from + Math.PI * (dtIn / o.turnSec);
      }
      if (item === ph) {
        const local = t - item.start;
        if (item.kind === "ramp_up") speed = (v * local) / o.rampSec;
        else if (item.kind === "cruise") speed = v;
        else if (item.kind === "ramp_down") speed = v * (1 - local / o.rampSec);
        amplitude = item.kind === "turn" ? 0.3 : v > 0 ? speed / v : 0;
      }
    }
    return { s, heading, amplitude, speed, phase: ph };
  };

  const phase0 = o.standSec + 0.137; // 左腳 HS 的相位起點（刻意不對齊影格）
  const wobble = Math.min(0.4, Math.max(0, o.paceWobble ?? 0));
  /** 相位（週期數）。wobble > 0 時步頻會慢慢忽快忽慢（相位仍單調遞增）。 */
  const legPhase = (t: number, side: Side) =>
    (t - phase0) / T + wobble * Math.sin((2 * Math.PI * (t - phase0)) / (2.7 * T)) + (side === "right" ? 0.5 : 0);

  // 真值：每趟巡航區間、轉身區間
  const truthPasses: SyntheticTruth["passes"] = [];
  for (const ph of phases) {
    if (ph.kind !== "cruise" || ph.start >= totalSec) continue;
    const d = passDirection(ph.passIndex);
    truthPasses.push({ startSec: ph.start, endSec: Math.min(ph.end, totalSec), direction: d, nearSide: d === 1 ? "right" : "left" });
  }
  const turns = phases.filter((ph) => ph.kind === "turn" && ph.start < totalSec).map((ph) => ({ startSec: ph.start, endSec: ph.end }));

  // 真值事件：數值求解「相位 = 整數（HS）／整數 + 支撐期比例（TO）」，保留行走中（加速、等速、減速）的事件
  const events: SyntheticEvent[] = [];
  for (const side of ["left", "right"] as const) {
    const to = curvesBySide[side].to;
    const step = 0.002;
    for (let t = 0; t + step <= totalSec; t += step) {
      const p1 = legPhase(t, side);
      const p2 = legPhase(t + step, side);
      for (const [type, offset] of [
        ["heel_strike", 0],
        ["toe_off", to],
      ] as const) {
        const target = Math.ceil(p1 - offset) + offset;
        if (!(target > p1 && target <= p2)) continue;
        let lo = t;
        let hi = t + step;
        for (let i = 0; i < 40; i++) {
          const midT = (lo + hi) / 2;
          if (legPhase(midT, side) < target) lo = midT;
          else hi = midT;
        }
        const timeSec = (lo + hi) / 2;
        const ph = phases.find(
          (item) => (item.kind === "cruise" || item.kind === "ramp_up" || item.kind === "ramp_down") && timeSec >= item.start && timeSec <= item.end,
        );
        if (ph && timeSec <= totalSec) events.push({ side, type, timeSec, passIndex: ph.passIndex });
      }
    }
  }
  events.sort((a, b) => a.timeSec - b.timeSec);

  // 注入用的隨機區段
  const nFrames = Math.floor(totalSec * o.fps) + 1;
  const pickWindows = (fraction: number, minLen: number, maxLen: number) => {
    const mask = new Uint8Array(nFrames);
    let covered = 0;
    let guard = 0;
    while (covered < fraction * nFrames && guard++ < 10000) {
      const len = minLen + Math.floor(random.next() * (maxLen - minLen + 1));
      const start = Math.floor(random.next() * Math.max(1, nFrames - len));
      for (let k = start; k < start + len && k < nFrames; k++) {
        if (!mask[k]) covered++;
        mask[k] = 1;
      }
    }
    return mask;
  };
  const swapMask = pickWindows(o.swapFraction, 3, 8);
  const missingMask = pickWindows(o.missingFrameFraction, 1, 3);
  const dropoutMask = pickWindows(o.dropoutFraction, 2, 6);
  const dropoutJoint = Array.from({ length: nFrames }, () => (["knee", "ankle", "heel", "toe"] as const)[Math.floor(random.next() * 4)]);
  const identityMask = new Uint8Array(nFrames);
  for (let i = 0; i < o.identitySwitches; i++) {
    const start = Math.floor(((i + 1) / (o.identitySwitches + 1)) * nFrames);
    for (let k = start; k < start + 5 && k < nFrames; k++) identityMask[k] = 1;
  }

  const frames: PoseFrame[] = [];
  const cx = o.width / 2;
  const cy = o.height / 2;
  const rollFor = (passIndex: number) => {
    if (typeof o.rollDeg === "number") return o.rollDeg * DEG;
    const list = o.rollDeg;
    return (list.length > 0 ? list[Math.min(list.length - 1, Math.max(0, passIndex))] : 0) * DEG;
  };

  for (let k = 0; k < nFrames; k++) {
    const t = k / o.fps;
    if (o.droppedFrameFraction > 0 && k > 0 && random.next() < o.droppedFrameFraction) continue;
    const frame: PoseFrame = { frameIndex: k, timeSec: t, landmarks: null };
    if (o.poseCount !== undefined) frame.poseCount = o.poseCount;
    if (missingMask[k]) {
      frames.push(frame);
      continue;
    }

    const state = stateAt(t);
    const roll = rollFor(state.phase.passIndex >= 0 ? state.phase.passIndex : t < o.standSec + 0.01 ? 0 : o.passes - 1);
    const f = [Math.cos(state.heading), Math.sin(state.heading)] as const; // 前方 (X, Z)
    const r = [Math.sin(state.heading), -Math.cos(state.heading)] as const; // 右方 (X, Z)
    const a = state.amplitude;

    // 各腿的矢狀面角度（幅度 a 從中立姿勢縮放）
    const leg = (side: Side) => {
      const p = legPhase(t, side);
      const c = curvesBySide[side];
      const thigh = a * c.thigh(p);
      const knee = 3 + a * (c.knee(p) - 3);
      const foot = a * c.foot(p);
      const shank = thigh - knee;
      const kx = seg.thigh * Math.sin(thigh * DEG);
      const ky = -seg.thigh * Math.cos(thigh * DEG);
      const ax = kx + seg.shank * Math.sin(shank * DEG);
      const ay = ky - seg.shank * Math.cos(shank * DEG);
      const e = [Math.cos(foot * DEG), Math.sin(foot * DEG)];
      const nUp = [-Math.sin(foot * DEG), Math.cos(foot * DEG)];
      const heel = [ax + seg.heel[0] * e[0] + seg.heel[1] * nUp[0], ay + seg.heel[0] * e[1] + seg.heel[1] * nUp[1]];
      const toe = [ax + seg.toe[0] * e[0] + seg.toe[1] * nUp[0], ay + seg.toe[0] * e[1] + seg.toe[1] * nUp[1]];
      return { knee: [kx, ky], ankle: [ax, ay], heel, toe, thigh };
    };
    const legs = { left: leg("left"), right: leg("right") };
    const drop = Math.max(...(["left", "right"] as const).flatMap((s) => [legs[s].ankle[1], legs[s].heel[1], legs[s].toe[1]].map((y) => -y)));
    const hipHeight = drop + 0.01 * H;

    const pX = center[0] + state.s * axis[0];
    const pZ = center[1] + state.s * axis[1];
    const world = new Map<number, [number, number, number]>();
    /** 由骨盆中心＋前方 fw、上方 up、右方 rt 的偏移得到世界座標。 */
    const place = (fw: number, up: number, rt: number): [number, number, number] => [
      pX + fw * f[0] + rt * r[0],
      hipHeight + up,
      pZ + fw * f[1] + rt * r[1],
    ];

    const trunkWobble = (o.trunkWobbleDeg ?? 0) * Math.sin((2 * Math.PI * (t - phase0)) / (3.3 * T));
    const tau = (curves.trunk(legPhase(t, "left")) + trunkWobble) * DEG;
    const nu = shape.neckLeanDeg * DEG;
    const shoulderC = [seg.trunk * Math.sin(tau), seg.trunk * Math.cos(tau)];
    const earC = [shoulderC[0] + seg.neck * Math.sin(nu), shoulderC[1] + seg.neck * Math.cos(nu)];

    const sideSign = (side: Side) => (side === "right" ? 1 : -1);
    for (const side of ["left", "right"] as const) {
      const sg = sideSign(side);
      const L = legs[side];
      const idx = side === "left"
        ? { hip: LANDMARK.leftHip, knee: LANDMARK.leftKnee, ankle: LANDMARK.leftAnkle, heel: LANDMARK.leftHeel, toe: LANDMARK.leftFootIndex, shoulder: LANDMARK.leftShoulder, ear: LANDMARK.leftEar, elbow: 13, wrist: 15 }
        : { hip: LANDMARK.rightHip, knee: LANDMARK.rightKnee, ankle: LANDMARK.rightAnkle, heel: LANDMARK.rightHeel, toe: LANDMARK.rightFootIndex, shoulder: LANDMARK.rightShoulder, ear: LANDMARK.rightEar, elbow: 14, wrist: 16 };
      const lateral = sg * seg.hipHalf;
      world.set(idx.hip, place(0, 0, lateral));
      world.set(idx.knee, place(L.knee[0], L.knee[1], lateral));
      world.set(idx.ankle, place(L.ankle[0], L.ankle[1], lateral));
      world.set(idx.heel, place(L.heel[0], L.heel[1], lateral));
      world.set(idx.toe, place(L.toe[0], L.toe[1], lateral));
      world.set(idx.shoulder, place(shoulderC[0], shoulderC[1], sg * seg.shoulderHalf));
      world.set(idx.ear, place(earC[0], earC[1], sg * seg.earHalf));
      // 手臂與對側腿反向擺動
      const arm = (-0.6 * legs[side === "left" ? "right" : "left"].thigh + 0) * DEG;
      const elbow = [shoulderC[0] + seg.upperArm * Math.sin(-arm), shoulderC[1] - seg.upperArm * Math.cos(arm)];
      const wrist = [elbow[0] + seg.forearm * Math.sin(-arm + 20 * DEG), elbow[1] - seg.forearm * Math.cos(-arm + 20 * DEG)];
      world.set(idx.elbow, place(elbow[0], elbow[1], sg * seg.shoulderHalf));
      world.set(idx.wrist, place(wrist[0], wrist[1], sg * seg.shoulderHalf));
      for (const [i, extra] of [[17, 0.04], [19, 0.06], [21, 0.03]] as const) {
        const index = side === "left" ? i : i + 1;
        world.set(index, place(wrist[0] + extra, wrist[1] - extra, sg * seg.shoulderHalf));
      }
      // 眼睛（1–6）與嘴（9、10）
      const eyeBase = side === "left" ? 1 : 4;
      for (let j = 0; j < 3; j++) world.set(eyeBase + j, place(earC[0] + 0.05 * H, earC[1] + 0.012 * H, sg * (0.012 + 0.008 * j) * H));
      world.set(side === "left" ? 9 : 10, place(earC[0] + 0.052 * H, earC[1] - 0.03 * H, sg * 0.015 * H));
    }
    world.set(LANDMARK.nose, place(earC[0] + 0.06 * H, earC[1] - 0.012 * H, 0));

    // 近側：髖較靠近鏡頭的一側
    const zLeft = world.get(LANDMARK.leftHip)![2];
    const zRight = world.get(LANDMARK.rightHip)![2];
    const zMid = (zLeft + zRight) / 2;
    const nearSide: Side | "both" = Math.abs(zLeft - zRight) < 0.03 ? "both" : zLeft < zRight ? "left" : "right";

    const landmarks: Landmark[] = [];
    for (let i = 0; i < 33; i++) {
      const [X, Y, Z] = world.get(i) ?? world.get(LANDMARK.nose)!;
      let u = cx + (o.focalPx * X) / Z;
      let vv = cy - (o.focalPx * (Y - o.cameraHeightM)) / Z;
      if (o.noisePx > 0) {
        u += random.gauss() * o.noisePx;
        vv += random.gauss() * o.noisePx;
      }
      if (roll !== 0) {
        const dx = u - cx;
        const dy = vv - cy;
        u = cx + dx * Math.cos(roll) - dy * Math.sin(roll);
        vv = cy + dx * Math.sin(roll) + dy * Math.cos(roll);
      }
      const x = u / o.width;
      const y = vv / o.height;
      const pointSide: Side | "center" = [1, 2, 3, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31].includes(i)
        ? "left"
        : i === 0
          ? "center"
          : "right";
      const isNear = pointSide === "center" || nearSide === "both" || pointSide === nearSide;
      let visibility = isNear ? o.nearVisibility : o.farVisibility;
      const jointName = jointOf(i);
      if (jointName) {
        const override = o.jointVisibility?.[isNear ? "near" : "far"]?.[jointName];
        if (override !== undefined) visibility = override;
      }
      if (i === LANDMARK.nose && o.noseVisibility !== undefined) visibility = o.noseVisibility;
      if (x < 0 || x > 1 || y < 0 || y > 1) visibility = Math.min(visibility, 0.2);
      landmarks.push({ x, y, z: ((Z - zMid) * o.focalPx) / zMid / o.width, visibility });
    }

    if (dropoutMask[k] && nearSide !== "both") {
      const joint = dropoutJoint[k];
      const index = jointIndex(nearSide, joint);
      landmarks[index] = { ...landmarks[index], visibility: 0.2 };
    }
    if (swapMask[k]) {
      for (const joint of ["hip", "knee", "ankle", "heel", "toe"] as const) {
        const li = jointIndex("left", joint);
        const ri = jointIndex("right", joint);
        const tmp = landmarks[li];
        landmarks[li] = landmarks[ri];
        landmarks[ri] = tmp;
      }
    }
    if (identityMask[k]) {
      // 換成畫面另一處、較小的另一個人
      for (let i = 0; i < 33; i++) {
        const p = landmarks[i];
        landmarks[i] = { ...p, x: 0.5 + (p.x - 0.5) * 0.7 + (p.x < 0.5 ? 0.35 : -0.35), y: 0.5 + (p.y - 0.5) * 0.7 };
      }
    }
    frame.landmarks = landmarks;
    frames.push(frame);
  }

  const expected = expectedMetrics(shape);
  const expectedBySide = { left: expected, right: expectedMetrics(shapeRight) };
  return {
    frames,
    meta: { fps: o.fps, width: o.width, height: o.height, durationSec: totalSec },
    truth: {
      events,
      passes: truthPasses,
      turns,
      cycleSec: T,
      legLengthM,
      speedLegPerSec: v / legLengthM,
      expected,
      expectedBySide,
      shape,
    },
  };
}

function jointOf(index: number): SyntheticJoint | undefined {
  const table: Record<number, SyntheticJoint> = {
    7: "ear", 8: "ear", 11: "shoulder", 12: "shoulder", 23: "hip", 24: "hip", 25: "knee", 26: "knee",
    27: "ankle", 28: "ankle", 29: "heel", 30: "heel", 31: "toe", 32: "toe",
  };
  return table[index];
}

function jointIndex(side: Side, joint: SyntheticJoint): number {
  const left: Record<SyntheticJoint, number> = { ear: 7, shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 };
  return left[joint] + (side === "right" ? 1 : 0);
}

/** 站在原地不走（側面）——用來測 no_gait_cycle。 */
export function generateStanding(options: SyntheticOptions = {}): SyntheticResult {
  return generateWalk({ ...options, passes: 1, speedMps: 0, walkwayM: 0, standSec: 4, rampSec: 0.5, turnSec: 0 });
}
