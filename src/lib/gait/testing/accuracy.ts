/**
 * 這個檔案做什麼：
 *   測試用：把分析管線偵測到的步態事件和合成資料的真值配對，算出偵測率與時間誤差。
 *   只計算「近側」且落在偵測到的直線段內部的真值事件（遠側本來就不偵測，§0.6；
 *   直線段兩端被切掉的部分本來就不分析，§2.2）。
 */

import type { AnalysisDetails, GaitEventType } from "../types";
import type { SyntheticTruth } from "./synthetic";

export interface EventAccuracy {
  /** 可偵測的真值事件數。 */
  total: number;
  /** 在 ±matchSec 內找到對應偵測事件的數量。 */
  matched: number;
  /** 偵測時間 − 真值時間（毫秒）。 */
  errorsMs: Record<GaitEventType, number[]>;
  /** 沒有對應真值的偵測事件數（誤報）。 */
  falsePositives: number;
}

export function eventAccuracy(truth: SyntheticTruth, details: AnalysisDetails, matchSec = 0.15, edgeSec = 0.15): EventAccuracy {
  const errorsMs: EventAccuracy["errorsMs"] = { heel_strike: [], toe_off: [] };
  let total = 0;
  let matched = 0;
  const used = new Set<object>();
  for (const pass of details.passes) {
    const truthEvents = truth.events.filter(
      (event) =>
        event.side === pass.nearSide && event.timeSec >= pass.startSec + edgeSec && event.timeSec <= pass.endSec - edgeSec,
    );
    for (const event of truthEvents) {
      total++;
      const candidates = details.events.filter(
        (detected) => detected.type === event.type && detected.side === event.side && detected.passIndex === pass.passIndex,
      );
      const best = candidates.sort((a, b) => Math.abs(a.timeSec - event.timeSec) - Math.abs(b.timeSec - event.timeSec))[0];
      if (best && Math.abs(best.timeSec - event.timeSec) <= matchSec) {
        matched++;
        used.add(best);
        errorsMs[event.type].push((best.timeSec - event.timeSec) * 1000);
      }
    }
  }
  const falsePositives = details.events.filter((detected) => {
    if (used.has(detected)) return false;
    return !truth.events.some(
      (event) => event.type === detected.type && event.side === detected.side && Math.abs(event.timeSec - detected.timeSec) <= matchSec,
    );
  }).length;
  return { total, matched, errorsMs, falsePositives };
}

export function meanAbs(values: readonly number[]): number {
  return values.length ? values.reduce((acc, v) => acc + Math.abs(v), 0) / values.length : NaN;
}

export function maxAbs(values: readonly number[]): number {
  return values.length ? Math.max(...values.map(Math.abs)) : NaN;
}
