/**
 * 這個檔案做什麼：
 *   可信度（docs/spec/gait-rules.md §6.3、§6.4、D28）：
 *   - 13 個可信度因子各自依量測值分成「高／中／低」
 *   - 整體可信度：任一「低」→ 低；「中」≥ 3 個 → 低；「中」≥ 1 個 → 中；否則高
 *   - 指標層級可信度：用該指標自己的 occlusion／few_cycles／high_variability 重算，再與整體取較低者
 *   - 主要原因：最多 2 個（先列「低」的因子，再列「中」的因子，同級依 REASON_PRIORITY）
 *   - D28 顯示對應：高 → good；中 → good_with_tip；低 → low
 *   量測值的計算在 `src/lib/gait/quality.ts`，這裡只做判斷。
 */

import type {
  Confidence,
  ConfidenceDisplay,
  ConfidenceFactors,
  ConfidenceReason,
} from "@/lib/gait/types";
import { CONFIDENCE } from "./thresholds";

const RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };

export function minConfidence(a: Confidence, b: Confidence): Confidence {
  return RANK[a] <= RANK[b] ? a : b;
}

/** 降一級（高 → 中 → 低）。 */
export function downgrade(level: Confidence): Confidence {
  return level === "high" ? "medium" : "low";
}

/** 越大越不好的量測：≤ high → 高；≤ medium → 中；其餘低。缺值視為「高」（沒有證據就不扣分）。 */
export function levelHigherWorse(value: number | undefined, high: number, medium: number): Confidence {
  if (value === undefined || !Number.isFinite(value)) return "high";
  if (value <= high) return "high";
  if (value <= medium) return "medium";
  return "low";
}

/** 越小越不好的量測：≥ high → 高；≥ medium → 中；其餘低。缺值視為「高」。 */
export function levelLowerWorse(value: number | undefined, high: number, medium: number): Confidence {
  if (value === undefined || !Number.isFinite(value)) return "high";
  if (value >= high) return "high";
  if (value >= medium) return "medium";
  return "low";
}

/** 量測值（由 gait/quality.ts 算出）。 */
export interface ConfidenceMeasurements {
  /** angle_off (a)：有效週期的髖寬比中位數。 */
  hipWidthRatio?: number;
  /** angle_off (b)：有效週期所在各趟的走道偏轉角估計中位數（度，M5）。 */
  yawDeg?: number;
  /** occlusion：近側必要關鍵點平均 visibility。 */
  nearVisibility?: number;
  /** occlusion：近側必要關鍵點被內插的比例。 */
  interpolatedFraction?: number;
  /** occlusion：有效週期所在的趟次中，近側判定（visibility 與 z）不一致（§1.4 降一級）。 */
  nearSideDisagreement?: boolean;
  /** few_cycles：每側有效週期數。 */
  cyclesLeft: number;
  cyclesRight: number;
  /** high_variability：主要指標跨週期標準差的最大值。 */
  maxStdDev?: number;
  /** subject_small：人體高度 ÷ 畫面高度。 */
  subjectHeightFraction?: number;
  /** partial_out_of_frame：直線段中必要關鍵點出畫的影格比例。 */
  outOfFrameFraction?: number;
  /** camera_tilt：|α|（度）。 */
  rollAbsDeg?: number;
  /** camera_motion：各趟 roll 估計差異（度）。 */
  rollRangeDeg?: number;
  /** low_fps：有效影格率。 */
  fps: number;
  /** lr_swap：被修正的影格比例。 */
  swapFraction: number;
  /** lens_distortion：骨盆位於畫面左右 10% 邊緣內的比例。 */
  edgeFraction?: number;
  /** low_light：關鍵點跳動 ÷ 腿長。 */
  jitterLeg?: number;
  /** irregular_pace：週期時間變異係數。 */
  paceCV?: number;
  /** irregular_pace：是否保留了加減速週期（§2.2 第 6 點，至少「中」）。 */
  accelerationCyclesKept?: boolean;
}

export function fewCyclesLevel(left: number, right: number): Confidence {
  const total = left + right;
  const c = CONFIDENCE.fewCycles;
  if (left >= c.perSideHigh && right >= c.perSideHigh && total >= c.totalHigh) return "high";
  if (total <= c.totalLowMax) return "low";
  return "medium";
}

export function occlusionLevel(visibility: number | undefined, interpolated: number | undefined, disagreement = false): Confidence {
  const c = CONFIDENCE.occlusion;
  const level = minConfidence(
    levelLowerWorse(visibility, c.visHigh, c.visMedium),
    levelHigherWorse(interpolated, c.interpHigh, c.interpMedium),
  );
  return disagreement ? minConfidence(level, "medium") : level;
}

export function variabilityLevel(maxStdDev: number | undefined): Confidence {
  return levelHigherWorse(maxStdDev, CONFIDENCE.highVariability.sdHigh, CONFIDENCE.highVariability.sdMedium);
}

/** §6.3：13 個因子。 */
export function computeFactors(m: ConfidenceMeasurements): ConfidenceFactors {
  const c = CONFIDENCE;
  const angleOff = minConfidence(
    levelHigherWorse(m.hipWidthRatio, c.angleOff.hipRatioHigh, c.angleOff.hipRatioMedium),
    levelHigherWorse(m.yawDeg, c.angleOff.yawHighDeg, c.angleOff.yawMediumDeg),
  );
  const pace = levelHigherWorse(m.paceCV, c.irregularPace.high, c.irregularPace.medium);
  // 關鍵點跳動（low_light 的代理量測）以腿長正規化：人很小時同樣的像素跳動會被放大。
  // M5（A-7）：人在畫面中偏小時，把跳動歸因於「距離太遠」——跳動等級併入 subject_small，low_light 不另外列，
  // 避免在沒有光線問題時告訴使用者「畫面比較暗」。可信度的嚴重程度不變。
  let subjectSmall = levelLowerWorse(m.subjectHeightFraction, c.subjectSmall.high, c.subjectSmall.medium);
  let lowLight = levelHigherWorse(m.jitterLeg, c.lowLight.high, c.lowLight.medium);
  if (subjectSmall !== "high" && lowLight !== "high") {
    // 兩者都是「中」時合併為「低」：原本兩個「中」因子的影響不因改名而消失（人小又抖動，誤差明顯上升）
    subjectSmall = subjectSmall === "medium" && lowLight === "medium" ? "low" : minConfidence(subjectSmall, lowLight);
    lowLight = "high";
  }
  return {
    angle_off: { level: angleOff, value: m.hipWidthRatio },
    occlusion: { level: occlusionLevel(m.nearVisibility, m.interpolatedFraction, m.nearSideDisagreement), value: m.nearVisibility },
    few_cycles: { level: fewCyclesLevel(m.cyclesLeft, m.cyclesRight), value: m.cyclesLeft + m.cyclesRight },
    high_variability: { level: variabilityLevel(m.maxStdDev), value: m.maxStdDev },
    subject_small: { level: subjectSmall, value: m.subjectHeightFraction },
    partial_out_of_frame: {
      level: levelHigherWorse(m.outOfFrameFraction, c.partialOutOfFrame.high, c.partialOutOfFrame.medium),
      value: m.outOfFrameFraction,
    },
    low_light: { level: lowLight, value: m.jitterLeg },
    camera_motion: {
      level: levelHigherWorse(m.rollRangeDeg, c.cameraMotion.high, c.cameraMotion.medium),
      value: m.rollRangeDeg,
    },
    camera_tilt: { level: levelHigherWorse(m.rollAbsDeg, c.cameraTilt.high, c.cameraTilt.medium), value: m.rollAbsDeg },
    lens_distortion: {
      level: levelHigherWorse(m.edgeFraction, c.lensDistortion.high, c.lensDistortion.medium),
      value: m.edgeFraction,
    },
    low_fps: { level: levelLowerWorse(m.fps, c.lowFps.high, c.lowFps.medium), value: m.fps },
    lr_swap: { level: levelHigherWorse(m.swapFraction, c.lrSwap.high, c.lrSwap.medium), value: m.swapFraction },
    irregular_pace: {
      level: m.accelerationCyclesKept ? minConfidence(pace, "medium") : pace,
      value: m.paceCV,
    },
  };
}

/**
 * 原因的優先順序（同一等級時）：越前面越優先列出。
 * 先放使用者最能「重拍改善」的拍攝條件，再放資料量與一致性。【實作選擇】
 */
export const REASON_PRIORITY: readonly ConfidenceReason[] = [
  "angle_off",
  "occlusion",
  "camera_tilt",
  "subject_small",
  "partial_out_of_frame",
  "low_light",
  "few_cycles",
  "low_fps",
  "lens_distortion",
  "camera_motion",
  "lr_swap",
  "irregular_pace",
  "high_variability",
];

/** §6.4：整體可信度與主要原因（最多 2 個）。 */
export function combineFactors(factors: ConfidenceFactors): { overall: Confidence; reasons: ConfidenceReason[] } {
  const lows = REASON_PRIORITY.filter((reason) => factors[reason].level === "low");
  const mediums = REASON_PRIORITY.filter((reason) => factors[reason].level === "medium");
  let overall: Confidence = "high";
  if (lows.length > 0 || mediums.length >= CONFIDENCE.mediumCountForLow) overall = "low";
  else if (mediums.length > 0) overall = "medium";
  const reasons = overall === "high" ? [] : [...lows, ...mediums].slice(0, CONFIDENCE.maxReasons);
  return { overall, reasons };
}

/** D28：內部三級 → 使用者兩級（中附小提示）。 */
export function displayFor(overall: Confidence): ConfidenceDisplay {
  return overall === "high" ? "good" : overall === "medium" ? "good_with_tip" : "low";
}

/**
 * §6.4 指標層級可信度：以該指標自己的 occlusion／few_cycles／high_variability 取代整體因子後重算，
 * 再與整體可信度取較低者；`downgradeOne` 用於 §4.5「low_light 時 PKF_sw 降一級」。
 */
export function metricConfidence(
  factors: ConfidenceFactors,
  overall: Confidence,
  overrides: Partial<Record<"occlusion" | "few_cycles" | "high_variability", Confidence>>,
  downgradeOne = false,
): Confidence {
  const replaced: ConfidenceFactors = { ...factors };
  for (const [reason, level] of Object.entries(overrides) as Array<[keyof typeof overrides, Confidence]>) {
    replaced[reason] = { ...replaced[reason], level };
  }
  let level = minConfidence(overall, combineFactors(replaced).overall);
  if (downgradeOne) level = downgrade(level);
  return level;
}
