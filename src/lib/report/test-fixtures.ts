/**
 * 測試用的資料（只給 *.test.ts 使用）。
 * exampleRequest() 是 docs/spec/gait-rules.md §8 的輸出範例。
 */

import type { ReportRequest, ReportRequestFinding } from "./request";

export function exampleRequest(): ReportRequest {
  return {
    rules_version: "gait-rules-v0.2",
    standard_label: "beta",
    confidence: { overall: "medium", display: "good_with_tip", reasons: ["angle_off", "few_cycles"] },
    walking: { passes: 2, valid_cycles_total: 5, slow_speed: false },
    population_caveat: false,
    findings: [
      {
        problem: "hip_extension_deficit",
        severity: "mild",
        metrics: { PHE: 9.4 },
        metric_confidence: "medium",
        near_threshold: false,
        candidate_causes: ["hip_flexor_tightness", "glute_weakness", "weak_push_off", "slow_short_stride"],
      },
      {
        problem: "knee_flexion_abnormal",
        subtype: "knee_swing_flexion_low",
        severity: "normal",
        metrics: { PKF_sw: 58.2 },
        metric_confidence: "high",
        near_threshold: false,
        candidate_causes: [],
      },
      {
        problem: "trunk_head_forward_lean",
        subtype: "trunk_forward_lean",
        severity: "normal",
        metrics: { TRK: 3.1 },
        metric_confidence: "high",
        near_threshold: false,
        candidate_causes: [],
      },
    ],
    observations: [{ item: "head_forward", status: "observed" }],
  };
}

/** 四個問題都有狀況的請求（用來測數量上限）。 */
export function allProblemsRequest(severity: "mild" | "marked" = "marked"): ReportRequest {
  const findings: ReportRequestFinding[] = [
    {
      problem: "hip_extension_deficit",
      severity,
      metrics: { PHE: 6 },
      metric_confidence: "high",
      near_threshold: false,
      candidate_causes: ["hip_flexor_tightness", "glute_weakness", "weak_push_off"],
      timestamps_sec: [3.1, 8.2],
    },
    {
      problem: "knee_flexion_abnormal",
      subtype: "knee_swing_flexion_low",
      severity,
      metrics: { PKF_sw: 40 },
      metric_confidence: "high",
      near_threshold: false,
      candidate_causes: ["quad_rectus_tightness", "weak_push_off"],
      timestamps_sec: [4.2],
    },
    {
      problem: "knee_flexion_abnormal",
      subtype: "knee_stance_flexion_high",
      severity,
      metrics: { KIC: 22 },
      metric_confidence: "high",
      near_threshold: false,
      candidate_causes: ["hamstring_tightness", "quad_weakness"],
    },
    {
      problem: "trunk_head_forward_lean",
      subtype: "trunk_forward_lean",
      severity,
      metrics: { TRK: 14.3 },
      metric_confidence: "high",
      near_threshold: false,
      candidate_causes: ["thoracic_stiffness", "pec_tightness", "hip_flexor_tightness"],
    },
  ];
  return { ...exampleRequest(), confidence: { overall: "high", display: "good", reasons: [] }, findings };
}
