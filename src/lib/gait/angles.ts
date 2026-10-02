/**
 * 這個檔案做什麼：
 *   角度定義（docs/spec/gait-rules.md §0.4、§0.5、§5.2）。全部用像素座標、單位為度。
 *   - 節段角 φ(A→B) = atan2(d·(X_B − X_A), Y_B − Y_A)：向下的節段，遠端在近端前方為正
 *   - 軀幹傾角 τ = atan2(d·(X_肩 − X_髖), Y_髖 − Y_肩)：前傾為正
 *   - 頸傾角 ν = atan2(d·(X_耳 − X_肩), Y_肩 − Y_耳)：耳在肩前方為正（D25 只觀察）
 *   - 髖角 θ_hip = φ_thigh + τ（屈曲為正、伸展為負）
 *   - 膝角 θ_knee = φ_thigh − φ_shank（屈曲為正、過伸為負）
 *   d = 行走方向（+1 往畫面右、−1 往畫面左），影像 Y 軸向下。
 */

import { RAD2DEG } from "./math";
import type { WalkDirection } from "./types";

/** 向下節段（大腿 hip→knee、小腿 knee→ankle）的前傾角（§0.4）。 */
export function segmentAngleDown(d: WalkDirection, xa: number, ya: number, xb: number, yb: number): number {
  return Math.atan2(d * (xb - xa), yb - ya) * RAD2DEG;
}

/** 向上節段（軀幹 髖→肩、頸 肩→耳）的前傾角（§5.2）。 */
export function segmentAngleUp(d: WalkDirection, xLow: number, yLow: number, xHigh: number, yHigh: number): number {
  return Math.atan2(d * (xHigh - xLow), yLow - yHigh) * RAD2DEG;
}

/** 髖角（§0.5）：大腿相對軀幹，屈曲為正、伸展為負。 */
export function hipAngle(thigh: number, trunk: number): number {
  return thigh + trunk;
}

/** 膝角（§0.5）：屈曲為正、過伸為負。 */
export function kneeAngle(thigh: number, shank: number): number {
  return thigh - shank;
}
