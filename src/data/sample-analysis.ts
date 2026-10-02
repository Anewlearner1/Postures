/**
 * 這個檔案做什麼：
 *   示範用的「分析結果」假資料（格式同 src/lib/gait/types.ts 的 AnalysisResult）。
 *   在真正的影片分析（M3）完成前，報告頁用這份資料呼叫 POST /api/report，
 *   展示「分析結果 → 報告」的完整流程。這不是任何人真實的分析結果。
 */

import type { AnalysisResult } from "@/lib/gait/types";

export const SAMPLE_ANALYSIS: AnalysisResult = {
  rulesVersion: "gait-rules-v0.2",
  standardLabel: "beta",
  confidence: { overall: "medium", display: "good_with_tip", reasons: ["camera_tilt"] },
  walking: { passes: 2, validCyclesTotal: 5, slowSpeed: false },
  populationCaveat: false,
  findings: [
    {
      problem: "hip_extension_deficit",
      severity: "marked",
      metrics: { PHE: 7.2 },
      metricConfidence: "medium",
      nearThreshold: false,
      candidateCauses: ["hip_flexor_tightness", "glute_weakness", "weak_push_off", "slow_short_stride"],
      timestampsSec: [3.1, 8.2, 10.4, 12.0],
    },
    {
      problem: "knee_flexion_abnormal",
      subtype: "knee_swing_flexion_low",
      severity: "mild",
      metrics: { PKF_sw: 48.5 },
      metricConfidence: "high",
      nearThreshold: false,
      candidateCauses: ["quad_rectus_tightness", "weak_push_off", "slow_short_stride"],
      timestampsSec: [4.2, 9.1, 11.5],
    },
    {
      problem: "knee_flexion_abnormal",
      subtype: "knee_stance_flexion_high",
      severity: "normal",
      metrics: { KIC: 6.0 },
      metricConfidence: "high",
      nearThreshold: false,
      candidateCauses: [],
    },
    {
      problem: "trunk_head_forward_lean",
      subtype: "trunk_forward_lean",
      severity: "normal",
      metrics: { TRK: 3.1 },
      metricConfidence: "high",
      nearThreshold: false,
      candidateCauses: [],
    },
  ],
  observations: [{ item: "head_forward", status: "observed" }],
};

/** 示範影片的基本資訊（只存在瀏覽器，不送到伺服器）。 */
export const SAMPLE_VIDEO = { stepsAnalyzed: 8, durationSec: 14 } as const;
