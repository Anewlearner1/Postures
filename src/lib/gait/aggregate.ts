/**
 * 這個檔案做什麼：
 *   跨週期彙總（docs/spec/gait-rules.md §2.6 第 1–3、6 點）：
 *   - 每側（近側週期）各指標取中位數，記錄有效週期數 n 與標準差（一致性可信度因子用）
 *   - 軀幹與頭頸不分側：合併所有有效週期取中位數
 *   分級與跨側彙總（§2.6 第 4–5 點）在 `src/lib/rules/grading.ts`。
 */

import { finite, median, sampleStd } from "./math";
import type { CycleDetail, GaitMetrics, Side, SideSummary } from "./types";

const METRIC_KEYS = ["PHE", "TE", "PKF_sw", "KIC", "KLR", "TRK", "NCK"] as const satisfies readonly (keyof GaitMetrics)[];

function summarize(cycles: readonly CycleDetail[]): { median: GaitMetrics; stdDev: GaitMetrics; counts: Partial<Record<keyof GaitMetrics, number>> } {
  const med: GaitMetrics = {};
  const sd: GaitMetrics = {};
  const counts: Partial<Record<keyof GaitMetrics, number>> = {};
  for (const key of METRIC_KEYS) {
    const values = finite(cycles.map((cycle) => cycle.metrics[key]));
    counts[key] = values.length;
    if (values.length === 0) continue;
    med[key] = median(values);
    const std = sampleStd(values);
    if (Number.isFinite(std)) sd[key] = std;
  }
  return { median: med, stdDev: sd, counts };
}

export interface SideAggregate extends SideSummary {
  /** 各指標實際有數值的週期數（指標層級的 few_cycles 用）。 */
  counts: Partial<Record<keyof GaitMetrics, number>>;
  cycles: CycleDetail[];
}

/** 每側彙總（只用 used = true 的有效週期）。沒有週期的一側不會出現在結果中。 */
export function aggregateSides(cycles: readonly CycleDetail[]): Partial<Record<Side, SideAggregate>> {
  const out: Partial<Record<Side, SideAggregate>> = {};
  for (const side of ["left", "right"] as const) {
    const sideCycles = cycles.filter((cycle) => cycle.used && cycle.cycle.side === side);
    if (sideCycles.length === 0) continue;
    const { median: med, stdDev, counts } = summarize(sideCycles);
    out[side] = { side, validCycles: sideCycles.length, median: med, stdDev, counts, cycles: sideCycles };
  }
  return out;
}

/** 不分側的彙總（軀幹 TRK、頸 NCK，§2.6 第 6 點）。 */
export function aggregateAll(cycles: readonly CycleDetail[]) {
  const used = cycles.filter((cycle) => cycle.used);
  return { ...summarize(used), validCycles: used.length, cycles: used };
}
