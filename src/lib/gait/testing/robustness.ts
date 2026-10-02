/**
 * 這個檔案做什麼：
 *   演算法穩健性「參數掃描」的共用工具（只給測試與分析腳本使用，網站不會引用）。
 *
 *   用合成走路骨架（synthetic.ts）在各種拍攝條件下（走速、雜訊、遮擋、手機歪斜、影格率、趟數、
 *   人在畫面中的大小、左右錯置比例、拍攝角度…）重複跑 analyzeGait，統計三種錯誤：
 *   - 誤報：正常步態被判成「輕度／明顯」
 *   - 漏判：有問題的步態被判成「在常見範圍內」
 *   - 誤拒：可以分析的影片被要求重拍
 *   掃描報告見 docs/review/M5-qa.md；執行方式見 robustness-sweep.test.ts。
 */

import { analyzeGait } from "../analyze";
import type { Finding, Severity } from "../types";
import { generateWalk, type GaitShape, type SyntheticOptions } from "./synthetic";

/** 要檢查的問題項目（對應報告卡片）。 */
export type ProblemKey = "hip" | "swing" | "stance" | "trunk";

/** 一種步態「真值」：步態參數＋每個項目應有的判斷。 */
export interface GaitProfile {
  name: string;
  gait: Partial<GaitShape>;
  /** 每個項目「應該」是否被標成問題（輕度或明顯）。沒列出的項目不計分。 */
  expectProblem: Partial<Record<ProblemKey, boolean>>;
}

export const PROFILES: Record<string, GaitProfile> = {
  /** 典型健康成人（各指標離界線都有幾度餘裕）。 */
  normal: { name: "正常（典型）", gait: {}, expectProblem: { hip: false, swing: false, stance: false, trunk: false } },
  /**
   * 仍屬正常、但比較靠近界線的人（期望值 PHE 14.3、PKF_sw 55、KIC 7、TRK 4.5，離界線 2–5°）：
   * 最容易被雜訊推過界線。
   */
  normalBorder: {
    name: "正常（接近界線）",
    gait: { thighExtDeg: 19, pkfDeg: 55, kicDeg: 7, trunkLeanDeg: 4.5 },
    expectProblem: { hip: false, swing: false, stance: false, trunk: false },
  },
  hipMarked: { name: "髖伸展不足（明顯，TE 7）", gait: { thighExtDeg: 7 }, expectProblem: { hip: true } },
  swingMarked: { name: "擺盪期膝屈曲不足（明顯，PKF 40）", gait: { pkfDeg: 40 }, expectProblem: { swing: true } },
  stanceMarked: { name: "著地膝屈曲過大（明顯，KIC 24）", gait: { kicDeg: 24 }, expectProblem: { stance: true } },
  trunkMarked: { name: "軀幹前傾（明顯，15°）", gait: { trunkLeanDeg: 15 }, expectProblem: { trunk: true } },
  hipMild: { name: "髖伸展不足（輕度，TE 12）", gait: { thighExtDeg: 12 }, expectProblem: { hip: true } },
  swingMild: { name: "擺盪期膝屈曲不足（輕度，PKF 48）", gait: { pkfDeg: 48 }, expectProblem: { swing: true } },
};

export function findingFor(findings: readonly Finding[], key: ProblemKey): Finding | undefined {
  return findings.find((f) =>
    key === "hip"
      ? f.problem === "hip_extension_deficit"
      : key === "swing"
        ? f.subtype === "knee_swing_flexion_low"
        : key === "stance"
          ? f.subtype === "knee_stance_flexion_high"
          : f.subtype === "trunk_forward_lean",
  );
}

/** 某個項目在結果中的嚴重度（沒有這個 finding 時：髖伸展若被歸因於軀幹前傾 → 視為「未標記」）。 */
export function severityOf(findings: readonly Finding[], key: ProblemKey): Severity | "absent" {
  return findingFor(findings, key)?.severity ?? "absent";
}

export interface TrialOutcome {
  rejected: string | null;
  /** 每個計分項目是否判斷正確（被拒絕時為空）。 */
  correct: Partial<Record<ProblemKey, boolean>>;
  /** 誤報的項目（正常卻被標成問題）。 */
  falsePositives: ProblemKey[];
  /** 漏判的項目（有問題卻被判常見範圍內）。 */
  misses: ProblemKey[];
  /** 誤報的項目中，報告有標「接近分界」（near_threshold，用保守說法）的項目（M5 新增）。 */
  falsePositivesNearThreshold: ProblemKey[];
  confidence: "high" | "medium" | "low" | null;
}

/** 跑一次：產生合成骨架 → analyzeGait → 依 profile 計分。 */
export function runTrial(profile: GaitProfile, options: SyntheticOptions): TrialOutcome {
  const sim = generateWalk({ ...options, gait: { ...profile.gait, ...options.gait } });
  const outcome = analyzeGait(sim.frames, sim.meta);
  if (outcome.status !== "ok") {
    return { rejected: outcome.code, correct: {}, falsePositives: [], misses: [], falsePositivesNearThreshold: [], confidence: null };
  }
  const correct: TrialOutcome["correct"] = {};
  const falsePositives: ProblemKey[] = [];
  const misses: ProblemKey[] = [];
  const falsePositivesNearThreshold: ProblemKey[] = [];
  for (const [key, expected] of Object.entries(profile.expectProblem) as Array<[ProblemKey, boolean]>) {
    const severity = severityOf(outcome.result.findings, key);
    // 髖伸展被歸因於軀幹前傾（D31）時沒有 finding，當作「未標記」
    const flagged = severity === "mild" || severity === "marked";
    correct[key] = flagged === expected;
    if (!expected && flagged) {
      falsePositives.push(key);
      if (findingFor(outcome.result.findings, key)?.nearThreshold) falsePositivesNearThreshold.push(key);
    }
    if (expected && !flagged) misses.push(key);
  }
  return { rejected: null, correct, falsePositives, misses, falsePositivesNearThreshold, confidence: outcome.result.confidence.overall };
}

export interface ConditionSummary {
  trials: number;
  /** 被拒絕的比例（0–1）。 */
  rejectRate: number;
  rejectCodes: Record<string, number>;
  /** 有分析的試次中：至少一個項目誤報的比例。 */
  falsePositiveRate: number;
  /** 有分析的試次中：漏判的比例（有問題的 profile 才有意義）。 */
  missRate: number;
  /** 有分析的試次中：可信度為「低」的比例。 */
  lowConfidenceRate: number;
  falsePositiveItems: Record<string, number>;
  /** 有誤報的試次中，所有誤報項目都標了「接近分界」的比例（M5 新增）。 */
  falsePositiveNearThresholdRate: number;
}

/** 同一條件跑多個 seed，彙總成比例。 */
export function runCondition(profile: GaitProfile, options: SyntheticOptions, seeds: readonly number[]): ConditionSummary {
  const outcomes = seeds.map((seed) => runTrial(profile, { ...options, seed }));
  const analysed = outcomes.filter((o) => o.rejected === null);
  const rejectCodes: Record<string, number> = {};
  const falsePositiveItems: Record<string, number> = {};
  for (const o of outcomes) if (o.rejected) rejectCodes[o.rejected] = (rejectCodes[o.rejected] ?? 0) + 1;
  for (const o of analysed) for (const k of o.falsePositives) falsePositiveItems[k] = (falsePositiveItems[k] ?? 0) + 1;
  const rate = (n: number, d: number) => (d > 0 ? n / d : 0);
  return {
    trials: outcomes.length,
    rejectRate: rate(outcomes.length - analysed.length, outcomes.length),
    rejectCodes,
    falsePositiveRate: rate(analysed.filter((o) => o.falsePositives.length > 0).length, analysed.length),
    missRate: rate(analysed.filter((o) => o.misses.length > 0).length, analysed.length),
    lowConfidenceRate: rate(analysed.filter((o) => o.confidence === "low").length, analysed.length),
    falsePositiveItems,
    falsePositiveNearThresholdRate: rate(
      analysed.filter((o) => o.falsePositives.length > 0 && o.falsePositivesNearThreshold.length === o.falsePositives.length).length,
      analysed.filter((o) => o.falsePositives.length > 0).length,
    ),
  };
}

/** 基準拍攝條件：依拍攝教學（來回 3 趟、4.5 m 走道、距離 4 m、30 fps），加上輕微雜訊與遮擋。 */
export const BASELINE: SyntheticOptions = {
  passes: 3,
  fps: 30,
  noisePx: 3,
  dropoutFraction: 0.03,
  swapFraction: 0.02,
};

/** 單一變因掃描：每一列只改一個條件，其餘維持 BASELINE。 */
export const SWEEPS: Array<{ factor: string; label: (v: number) => string; values: number[]; apply: (v: number) => SyntheticOptions }> = [
  { factor: "走速（m/s）", label: (v) => `${v}`, values: [0.6, 0.8, 1.0, 1.3, 1.6, 1.9], apply: (v) => ({ speedMps: v }) },
  { factor: "關鍵點雜訊（像素，1080p）", label: (v) => `${v}`, values: [0, 3, 6, 9, 12, 16], apply: (v) => ({ noisePx: v }) },
  { factor: "近側下肢短暫遮擋比例", label: (v) => `${Math.round(v * 100)}%`, values: [0, 0.05, 0.1, 0.2, 0.3, 0.4], apply: (v) => ({ dropoutFraction: v }) },
  { factor: "偵測不到人的影格比例", label: (v) => `${Math.round(v * 100)}%`, values: [0, 0.05, 0.1, 0.2, 0.3], apply: (v) => ({ missingFrameFraction: v }) },
  { factor: "手機歪斜 roll（度）", label: (v) => `${v}°`, values: [0, 3, 5, 8, 10, 15], apply: (v) => ({ rollDeg: v }) },
  { factor: "影格率（fps）", label: (v) => `${v}`, values: [15, 20, 24, 30, 60], apply: (v) => ({ fps: v }) },
  { factor: "來回趟數", label: (v) => `${v}`, values: [1, 2, 3, 4, 6], apply: (v) => ({ passes: v }) },
  {
    factor: "人在畫面中的高度（相機距離）",
    label: (v) => `${v} m（約 ${Math.round(((1400 * 1.7) / v / 1080) * 100)}%）`,
    values: [3, 3.5, 4, 6, 8, 10, 12],
    apply: (v) => ({ cameraDistanceM: v }),
  },
  {
    factor: "走道長度（相機距離 3.5 m，拍攝教學的建議距離）",
    label: (v) => `${v} m`,
    values: [3, 3.5, 4, 4.5, 5],
    apply: (v) => ({ walkwayM: v, cameraDistanceM: 3.5 }),
  },
  { factor: "左右錯置比例", label: (v) => `${Math.round(v * 100)}%`, values: [0, 0.05, 0.1, 0.2, 0.3], apply: (v) => ({ swapFraction: v }) },
  { factor: "拍攝角度偏離側面（度）", label: (v) => `${v}°`, values: [0, 5, 10, 20, 30, 40], apply: (v) => ({ walkwayYawDeg: v }) },
  {
    factor: "綜合干擾等級（雜訊 3k 像素、遮擋 5k%、缺偵測 3k%、歪斜 2k°、錯置 3k%）",
    label: (v) => `k=${v}`,
    values: [0, 1, 2, 3],
    apply: (v) => ({ noisePx: 3 * v, dropoutFraction: 0.05 * v, missingFrameFraction: 0.03 * v, rollDeg: 2 * v, swapFraction: 0.03 * v }),
  },
  { factor: "步頻不穩定（wobble）", label: (v) => `${v}`, values: [0, 0.1, 0.2, 0.3], apply: (v) => ({ paceWobble: v }) },
];
