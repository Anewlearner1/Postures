/**
 * 這個檔案做什麼：
 *   步態事件偵測（docs/spec/gait-rules.md §2.1、§2.3，Zeni 2008 座標法）：
 *     u_heel(t) = d·(X_heel − X_P)/L，局部最大值 = 腳跟著地（HS）
 *     u_toe(t)  = d·(X_toe  − X_P)/L，局部最小值 = 腳尖離地（TO）
 *   每一趟只對近側做（§0.6）；腳跟或腳尖在該趟看不清時，改用腳踝點（Stenum 2021 做法）。
 *   峰值條件：同側間距 ≥ 0.6 秒、突出度 ≥ 0.15 L，並以拋物線內插取得次幀精度。
 */

import { EVENTS } from "@/lib/rules/thresholds";
import { findPeaks, parabolicOffset } from "./math";
import type { Pass } from "./passes";
import { pelvisSeries } from "./passes";
import type { Track } from "./preprocess";
import type { GaitEvent } from "./types";

function validFraction(values: Float64Array, startIndex: number, endIndex: number): number {
  let count = 0;
  for (let k = startIndex; k <= endIndex; k++) if (Number.isFinite(values[k])) count++;
  return count / Math.max(1, endIndex - startIndex + 1);
}

export interface PassEvents {
  heelStrikes: number[];
  toeOffs: number[];
  usedAnkleFallback: boolean;
}

/** 對單一趟的近側偵測 HS 與 TO（回傳時間，秒）。 */
export function detectPassEvents(track: Track, pass: Pass, L: number): PassEvents {
  const { startIndex, endIndex, direction: d, nearSide } = pass;
  const limb = track.side[nearSide];
  const pelvis = pelvisSeries(track);
  const minFraction = EVENTS.footPointMinValidFraction;
  const useAnkle =
    validFraction(limb.heel.X, startIndex, endIndex) < minFraction ||
    validFraction(limb.toe.X, startIndex, endIndex) < minFraction;
  const heel = useAnkle ? limb.ankle : limb.heel;
  const toe = useAnkle ? limb.ankle : limb.toe;

  const length = endIndex - startIndex + 1;
  const uHeel = new Float64Array(length);
  const negUToe = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const k = startIndex + i;
    uHeel[i] = (d * (heel.X[k] - pelvis.X[k])) / L;
    negUToe[i] = -(d * (toe.X[k] - pelvis.X[k])) / L;
  }

  const options = {
    minDistance: Math.max(1, Math.round(EVENTS.minEventIntervalSec / track.dt)),
    minProminence: EVENTS.minProminenceLeg,
  };
  const toTime = (signal: Float64Array, index: number) =>
    track.t[startIndex + index] + parabolicOffset(signal, index) * track.dt;

  return {
    heelStrikes: findPeaks(uHeel, options).map((index) => toTime(uHeel, index)),
    toeOffs: findPeaks(negUToe, options).map((index) => toTime(negUToe, index)),
    usedAnkleFallback: useAnkle,
  };
}

/** 把一趟的事件轉成 GaitEvent 清單（依時間排序）。 */
export function toGaitEvents(pass: Pass, events: PassEvents): GaitEvent[] {
  const list: GaitEvent[] = [
    ...events.heelStrikes.map((timeSec) => ({ type: "heel_strike" as const, side: pass.nearSide, passIndex: pass.passIndex, timeSec })),
    ...events.toeOffs.map((timeSec) => ({ type: "toe_off" as const, side: pass.nearSide, passIndex: pass.passIndex, timeSec })),
  ];
  return list.sort((a, b) => a.timeSec - b.timeSec);
}
