/**
 * 這個檔案做什麼：
 *   嚴重度分級規則（docs/spec/gait-rules.md §2.6、§3.3、§4.3、§5.3、§8）：
 *   - 各指標的「正常／輕度／明顯」判斷（閾值在 thresholds.ts）
 *   - 「接近臨界」near_threshold：數值在任一分級界線的帶寬內（§3.3；M5 起帶寬依量測不確定度 1.5–3°）
 *   - D29 有效週期防護：該側（或軀幹合計）有效週期 < 2 時最多「輕度」
 *   - D23／D31：PHE 偏小但 TE ≥ 12 且 TRK ≥ 7 → 不判髖伸展不足，歸因於軀幹前傾（每側先做）
 *   - D26 跨側彙總：整體 = 較重的一側；代表數值取決定整體分級那一側（同級取較接近異常方向者）
 *   - ΔPKF 左右差（內部輔助，兩側皆 ≥ 2 個有效週期才用）
 *   - 鏡頭歪斜可信度「低」時，TRK 最多「輕度」（§5.3）
 */

import type { Severity, Side } from "@/lib/gait/types";
import {
  CYCLE_GUARD_MIN_CYCLES,
  HIP_EXTENSION,
  KNEE_STANCE,
  KNEE_SWING,
  NEAR_THRESHOLD_ADAPTIVE,
  NEAR_THRESHOLD_BAND_DEG,
  TRUNK,
} from "./thresholds";

const RANK: Record<Severity, number> = { normal: 0, mild: 1, marked: 2 };

export function severityRank(severity: Severity): number {
  return RANK[severity];
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return RANK[a] >= RANK[b] ? a : b;
}

/** 把嚴重度限制在 cap 以下。 */
export function capSeverity(severity: Severity, cap: Severity): Severity {
  return RANK[severity] > RANK[cap] ? cap : severity;
}

/** D29：有效週期 < 2 時最多「輕度」。 */
export function applyCycleGuard(severity: Severity, validCycles: number): Severity {
  return validCycles < CYCLE_GUARD_MIN_CYCLES ? capSeverity(severity, "mild") : severity;
}

/** §3.3：PHE ≥ 12 正常；8 ≤ PHE < 12 輕度；< 8 明顯。 */
export function gradePHE(value: number): Severity {
  if (value >= HIP_EXTENSION.normalMin) return "normal";
  if (value >= HIP_EXTENSION.markedBelow) return "mild";
  return "marked";
}

/** §4.3：PKF_sw ≥ 52 正常；45 ≤ PKF_sw < 52 輕度；< 45 明顯。 */
export function gradePKF(value: number): Severity {
  if (value >= KNEE_SWING.normalMin) return "normal";
  if (value >= KNEE_SWING.markedBelow) return "mild";
  return "marked";
}

/** §4.3：ΔPKF ≤ 10 正常；(10, 17] 輕度；> 17 明顯。 */
export function gradeDeltaPKF(value: number): Severity {
  if (value <= KNEE_SWING.asymmetryNormalMax) return "normal";
  if (value <= KNEE_SWING.asymmetryMildMax) return "mild";
  return "marked";
}

/** §4.3：KIC ≤ 12 正常；12 < KIC < 20 輕度；≥ 20 明顯。 */
export function gradeKIC(value: number): Severity {
  if (value <= KNEE_STANCE.normalMax) return "normal";
  if (value < KNEE_STANCE.markedMin) return "mild";
  return "marked";
}

/** §5.3：TRK < 7 正常；7 ≤ TRK < 12 輕度；≥ 12 明顯。 */
export function gradeTRK(value: number): Severity {
  if (value < TRUNK.mildMin) return "normal";
  if (value < TRUNK.markedMin) return "mild";
  return "marked";
}

/** 各指標的分級界線（near_threshold 用）。 */
export const BOUNDARIES = {
  PHE: [HIP_EXTENSION.normalMin, HIP_EXTENSION.markedBelow],
  PKF_sw: [KNEE_SWING.normalMin, KNEE_SWING.markedBelow],
  dPKF: [KNEE_SWING.asymmetryNormalMax, KNEE_SWING.asymmetryMildMax],
  KIC: [KNEE_STANCE.normalMax, KNEE_STANCE.markedMin],
  TRK: [TRUNK.mildMin, TRUNK.markedMin],
} as const;

/** §3.3「接近臨界」：任一分級界線 ±1.5° 以內。 */
export function isNearThreshold(value: number, boundaries: readonly number[], bandDeg: number = NEAR_THRESHOLD_BAND_DEG): boolean {
  return boundaries.some((boundary) => Math.abs(value - boundary) <= bandDeg + 1e-9);
}

/**
 * M5：依週期間變異決定「接近臨界」帶寬（中位數 95% 信賴區間半寬，限制在 1.5–3°）。
 * values = 決定分級那一側（或軀幹全部）各有效週期的數值。
 */
export function nearThresholdBand(values: readonly number[]): number {
  const { minDeg, maxDeg, z, medianSeFactor } = NEAR_THRESHOLD_ADAPTIVE;
  if (values.length < 2) return maxDeg;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1));
  return Math.min(maxDeg, Math.max(minDeg, (z * medianSeFactor * sd) / Math.sqrt(values.length)));
}

/** 異常方向：PHE、PKF_sw 越小越不好；KIC、TRK 越大越不好。 */
export type WorseDirection = "lower" | "higher";

export interface SideMetricGrade {
  side: Side;
  severity: Severity;
  value: number;
  validCycles: number;
}

/**
 * D26 跨側彙總：整體嚴重度 = 較重的一側；代表數值 = 決定整體分級那一側的中位數，
 * 兩側同級時取較接近異常方向的值。沒有任何一側時回傳 undefined。
 */
export function pickDecidingSide(grades: readonly SideMetricGrade[], worse: WorseDirection): SideMetricGrade | undefined {
  let best: SideMetricGrade | undefined;
  for (const grade of grades) {
    if (!best) {
      best = grade;
      continue;
    }
    const byRank = RANK[grade.severity] - RANK[best.severity];
    const moreAbnormal = worse === "lower" ? grade.value < best.value : grade.value > best.value;
    if (byRank > 0 || (byRank === 0 && moreAbnormal)) best = grade;
  }
  return best;
}

/** 單側髖伸展分級（含 D29 與 D23／D31 歸因）。trunkTRK 為不分側的軀幹中位數。 */
export function gradeHipSide(
  PHE: number,
  TE: number | undefined,
  trunkTRK: number | undefined,
  validCycles: number,
): { severity: Severity; attributedToTrunk: boolean } {
  const raw = applyCycleGuard(gradePHE(PHE), validCycles);
  const attributed =
    raw !== "normal" &&
    TE !== undefined &&
    trunkTRK !== undefined &&
    TE >= HIP_EXTENSION.attributionMinTE &&
    trunkTRK >= HIP_EXTENSION.attributionMinTRK;
  return { severity: attributed ? "normal" : raw, attributedToTrunk: attributed };
}

/** 軀幹前傾分級（D29：合計有效週期 < 2 → 最多輕度；§5.3：鏡頭歪斜可信度低 → 最多輕度）。 */
export function gradeTrunk(TRK: number, validCyclesTotal: number, cameraTiltLow: boolean): Severity {
  const severity = applyCycleGuard(gradeTRK(TRK), validCyclesTotal);
  return cameraTiltLow ? capSeverity(severity, "mild") : severity;
}
