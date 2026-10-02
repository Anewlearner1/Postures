/**
 * 這個檔案做什麼：
 *   1. 骨盆中點與腿長（§2.2）
 *   2. 切出直線行走段（pass），排除停頓、轉身、方向改變點（§2.2）
 *   3. 每一趟判定行走方向 d（§0.3）與近側肢體（§1.4）
 *   4. 每一趟估計鏡頭 roll 並校正（§1.5）
 *   5. 每一趟的髖寬比、腿長變化（§6.3 angle_off、§7.1 not_side_view）
 */

import { CONFIDENCE, ROLL, SEGMENTATION } from "@/lib/rules/thresholds";
import { DEG2RAD, RAD2DEG, finite, linearSlope, mean, median, movingAverage, percentile } from "./math";
import { JOINTS, LEG_JOINTS, type PointSeries, type Track } from "./preprocess";
import type { PassDetail, Side, WalkDirection } from "./types";

export interface Pass extends PassDetail {
  /** 第一個與最後一個格點索引（含）。 */
  startIndex: number;
  endIndex: number;
}

/** 兩點中點；一點缺值時用另一點（側拍時左右幾乎重疊）。 */
function midOrEither(a: number, b: number): number {
  if (Number.isFinite(a) && Number.isFinite(b)) return (a + b) / 2;
  return Number.isFinite(a) ? a : b;
}

/** 骨盆中點 P =（左髖＋右髖）/ 2（§2.2）。 */
export function pelvisSeries(track: Track): { X: Float64Array; Y: Float64Array } {
  const X = new Float64Array(track.n);
  const Y = new Float64Array(track.n);
  const L = track.side.left.hip;
  const R = track.side.right.hip;
  for (let k = 0; k < track.n; k++) {
    X[k] = midOrEither(L.X[k], R.X[k]);
    Y[k] = midOrEither(L.Y[k], R.Y[k]);
  }
  return { X, Y };
}

/** 軀幹長（肩中點到髖中點，像素）。 */
export function trunkLengthAt(track: Track, k: number): number {
  const s = track.side;
  const sx = midOrEither(s.left.shoulder.X[k], s.right.shoulder.X[k]);
  const sy = midOrEither(s.left.shoulder.Y[k], s.right.shoulder.Y[k]);
  const hx = midOrEither(s.left.hip.X[k], s.right.hip.X[k]);
  const hy = midOrEither(s.left.hip.Y[k], s.right.hip.Y[k]);
  return Math.hypot(sx - hx, sy - hy);
}

/** 寬度比：|X_左 − X_右| ÷ 軀幹長（肩寬比用於轉身偵測、髖寬比用於 angle_off）。 */
export function widthRatioAt(track: Track, k: number, joint: "shoulder" | "hip"): number {
  const width = Math.abs(track.side.left[joint].X[k] - track.side.right[joint].X[k]);
  const trunk = trunkLengthAt(track, k);
  return trunk > 0 ? width / trunk : NaN;
}

/** 某側在格點 k 的腿長（髖→膝＋膝→踝，像素）。 */
export function legLengthAt(track: Track, side: Side, k: number): number {
  const p = track.side[side];
  return (
    Math.hypot(p.knee.X[k] - p.hip.X[k], p.knee.Y[k] - p.hip.Y[k]) +
    Math.hypot(p.ankle.X[k] - p.knee.X[k], p.ankle.Y[k] - p.knee.Y[k])
  );
}

/** 腿長 L（§2.2）：每格取 visibility 較高（較可能是近側）那一側，取第 90 百分位數。 */
export function legLength(track: Track): number {
  const lengths: number[] = [];
  for (let k = 0; k < track.n; k++) {
    const visL = track.side.left.hip.vis[k] + track.side.left.knee.vis[k] + track.side.left.ankle.vis[k];
    const visR = track.side.right.hip.vis[k] + track.side.right.knee.vis[k] + track.side.right.ankle.vis[k];
    const first = legLengthAt(track, visL >= visR ? "left" : "right", k);
    const length = Number.isFinite(first) ? first : legLengthAt(track, visL >= visR ? "right" : "left", k);
    if (Number.isFinite(length)) lengths.push(length);
  }
  return percentile(lengths, SEGMENTATION.legLengthPercentile);
}

/** 正規化骨盆水平速度 v̂（腿長/秒），以 0.5 秒移動平均後的骨盆位置計算（§2.2）。 */
export function pelvisSpeed(track: Track, L: number): Float64Array {
  const { X } = pelvisSeries(track);
  const smooth = movingAverage(X, Math.max(1, Math.round(SEGMENTATION.pelvisSmoothSec / track.dt)));
  const v = new Float64Array(track.n).fill(NaN);
  for (let k = 1; k < track.n - 1; k++) {
    const dx = smooth[k + 1] - smooth[k - 1];
    if (Number.isFinite(dx)) v[k] = dx / (2 * track.dt) / L;
  }
  return v;
}

function markAround(mask: Uint8Array, center: number, half: number) {
  for (let k = Math.max(0, center - half); k <= Math.min(mask.length - 1, center + half); k++) mask[k] = 1;
}

/** §2.2：切出直線行走段（尚未判定近側、尚未做 roll 校正）。 */
export function segmentPasses(track: Track, L: number): Array<{ startIndex: number; endIndex: number; direction: WalkDirection }> {
  const n = track.n;
  if (n < 3 || !(L > 0)) return [];
  const v = pelvisSpeed(track, L);
  const excluded = new Uint8Array(n);

  // 轉身：肩寬比 > 0.35，前後各延伸 0.3 秒
  const turnHalf = Math.round(SEGMENTATION.turnMarginSec / track.dt);
  for (let k = 0; k < n; k++) {
    if (widthRatioAt(track, k, "shoulder") > SEGMENTATION.turnShoulderRatio) markAround(excluded, k, turnHalf);
  }
  // 方向改變點前後各 0.5 秒：只看「移動中」（|v̂| ≥ 0.4）的兩段方向相反時，
  // 在兩段之間找速度的零交越點作為改變點（站著不動時的雜訊正負跳動不算方向改變）
  const signHalf = Math.round(SEGMENTATION.signChangeMarginSec / track.dt);
  const moving = (k: number) => Number.isFinite(v[k]) && Math.abs(v[k]) >= SEGMENTATION.minSpeedLegPerSec;
  let lastMoving = -1;
  for (let k = 0; k < n; k++) {
    if (!moving(k)) continue;
    if (lastMoving >= 0 && Math.sign(v[k]) !== Math.sign(v[lastMoving])) {
      const newSign = Math.sign(v[k]);
      let crossing = k;
      for (let i = lastMoving + 1; i <= k; i++) {
        if (Number.isFinite(v[i]) && (v[i] === 0 || Math.sign(v[i]) === newSign)) {
          crossing = i;
          break;
        }
      }
      markAround(excluded, crossing, signHalf);
    }
    lastMoving = k;
  }

  const passes: Array<{ startIndex: number; endIndex: number; direction: WalkDirection }> = [];
  let k = 0;
  while (k < n) {
    const ok = (i: number) =>
      !excluded[i] && Number.isFinite(v[i]) && Math.abs(v[i]) >= SEGMENTATION.minSpeedLegPerSec;
    if (!ok(k)) {
      k++;
      continue;
    }
    const sign = Math.sign(v[k]);
    const start = k;
    while (k < n && ok(k) && Math.sign(v[k]) === sign) k++;
    const end = k - 1;
    if (track.t[end] - track.t[start] + track.dt >= SEGMENTATION.minPassSec) {
      passes.push({ startIndex: start, endIndex: end, direction: sign > 0 ? 1 : -1 });
    }
  }
  return passes;
}

/** §1.4：近側判定。visibility 與 z 一致時採用；不一致時以 visibility 為準並記錄。 */
export function nearSideOf(track: Track, startIndex: number, endIndex: number): { near: Side; agreement: boolean } {
  const visMean = (side: Side) => {
    const values: number[] = [];
    for (const joint of LEG_JOINTS) for (let k = startIndex; k <= endIndex; k++) if (track.detected[k]) values.push(track.side[side][joint].vis[k]);
    return mean(values);
  };
  const zMean = (side: Side) => {
    const values: number[] = [];
    for (const joint of LEG_JOINTS) for (let k = startIndex; k <= endIndex; k++) values.push(track.side[side][joint].z[k]);
    return mean(finite(values));
  };
  const near: Side = visMean("left") >= visMean("right") ? "left" : "right";
  const zL = zMean("left");
  const zR = zMean("right");
  if (!Number.isFinite(zL) || !Number.isFinite(zR) || zL === zR) return { near, agreement: true };
  const zNear: Side = zL < zR ? "left" : "right";
  return { near, agreement: zNear === near };
}

/** §1.5：骨盆軌跡線性迴歸的斜率角（度）。 */
export function estimateRollDeg(track: Track, startIndex: number, endIndex: number): number {
  const { X, Y } = pelvisSeries(track);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = startIndex; k <= endIndex; k++) {
    if (Number.isFinite(X[k]) && Number.isFinite(Y[k])) {
      xs.push(X[k]);
      ys.push(Y[k]);
    }
  }
  const slope = linearSlope(xs, ys);
  return Number.isFinite(slope) ? Math.atan(slope) * RAD2DEG : 0;
}

/** 把格點範圍內所有關鍵點繞畫面中心旋轉 −α（§1.5）。 */
export function rotateRange(track: Track, startIndex: number, endIndex: number, alphaDeg: number) {
  const cx = track.width / 2;
  const cy = track.height / 2;
  const c = Math.cos(alphaDeg * DEG2RAD);
  const s = Math.sin(alphaDeg * DEG2RAD);
  const all: PointSeries[] = [track.nose];
  for (const side of ["left", "right"] as const) for (const joint of JOINTS) all.push(track.side[side][joint]);
  for (const series of all) {
    for (let k = startIndex; k <= endIndex; k++) {
      const dx = series.X[k] - cx;
      const dy = series.Y[k] - cy;
      series.X[k] = cx + dx * c + dy * s;
      series.Y[k] = cy - dx * s + dy * c;
    }
  }
}

/**
 * §6.3 angle_off（M5 修正 A-4）：由透視幾何估計走道相對影像平面的偏轉角 ψ（度）。
 * 近側腿長的像素長度與深度成反比，所以「相對深度」z̃ = L_中位數 / L(t)；
 * 骨盆的橫向位置（以中位深度為單位）x̃ = (X_P − 畫面中心) · z̃ / f。走道是直線時 z̃ 對 x̃ 的斜率 = tan ψ。
 * f（焦距像素）未知，以一般手機主鏡頭（1×、長邊視角約 69°）推估為長邊 × 0.73【推估】；f 估錯 ±15% 時 ψ 約差 ±15%。
 */
export function estimateYawDeg(track: Track, pass: { startIndex: number; endIndex: number; nearSide: Side }): number {
  const { X } = pelvisSeries(track);
  const f = CONFIDENCE.angleOff.assumedFocalFraction * Math.max(track.width, track.height);
  const cx = track.width / 2;
  const legs: number[] = [];
  for (let k = pass.startIndex; k <= pass.endIndex; k++) legs.push(legLengthAt(track, pass.nearSide, k));
  const legMedian = median(finite(legs));
  if (!(legMedian > 0)) return NaN;
  const xs: number[] = [];
  const zs: number[] = [];
  for (let k = pass.startIndex; k <= pass.endIndex; k++) {
    const leg = legs[k - pass.startIndex];
    if (!Number.isFinite(leg) || leg <= 0 || !Number.isFinite(X[k])) continue;
    const z = legMedian / leg;
    zs.push(z);
    xs.push(((X[k] - cx) * z) / f);
  }
  const slope = linearSlope(xs, zs);
  return Number.isFinite(slope) ? Math.abs(Math.atan(slope) * RAD2DEG) : NaN;
}

/** 切段＋近側＋roll 校正，回傳每一趟的完整資訊。會直接修改 track 的座標（roll 校正）。 */
export function detectPasses(track: Track, L: number): Pass[] {
  return segmentPasses(track, L).map((segment, passIndex) => {
    const { startIndex, endIndex, direction } = segment;
    const { near, agreement } = nearSideOf(track, startIndex, endIndex);
    const rollDeg = estimateRollDeg(track, startIndex, endIndex);
    if (Math.abs(rollDeg) > ROLL.noCorrectionMaxDeg) rotateRange(track, startIndex, endIndex, rollDeg);

    const hipRatios: number[] = [];
    const legs: number[] = [];
    for (let k = startIndex; k <= endIndex; k++) {
      const ratio = widthRatioAt(track, k, "hip");
      if (Number.isFinite(ratio)) hipRatios.push(ratio);
      const leg = legLengthAt(track, near, k);
      if (Number.isFinite(leg)) legs.push(leg);
    }
    const legMedian = median(legs);
    return {
      passIndex,
      direction,
      startSec: track.t[startIndex],
      endSec: track.t[endIndex],
      nearSide: near,
      startIndex,
      endIndex,
      rollDeg,
      nearSideAgreement: agreement,
      hipWidthRatio: median(hipRatios),
      legLengthVariation: legMedian > 0 ? (percentile(legs, 95) - percentile(legs, 5)) / legMedian : NaN,
      yawDeg: estimateYawDeg(track, { startIndex, endIndex, nearSide: near }),
      usedAnkleFallback: false,
    };
  });
}
