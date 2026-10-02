/**
 * 這個檔案做什麼：
 *   把前端的分析結果（AnalysisResult，駝峰寫法）轉成 POST /api/report 的請求格式（底線寫法，
 *   見 request.ts）。轉換時只保留允許送出的欄位：
 *   - 每個問題只送它自己的代表指標（髖：PHE；膝擺盪期：PKF_sw；膝著地：KIC；軀幹：TRK）。
 *   - TE、NCK、KLR 等內部數值一律不送（D18、D25）；本來就沒有左右側欄位（D26）。
 *   這個檔案刻意不引用動作庫，讓前端程式保持輕量。
 */

import type { AnalysisResult } from "@/lib/gait/types";
import type { ReportRequest } from "./request";

type RequestMetricKey = "PHE" | "PKF_sw" | "KIC" | "TRK";

/** 每種「問題/子型態」只能帶的指標（gait-rules.md §8）。 */
export const ALLOWED_METRIC: Record<string, RequestMetricKey> = {
  "hip_extension_deficit/": "PHE",
  "knee_flexion_abnormal/knee_swing_flexion_low": "PKF_sw",
  "knee_flexion_abnormal/knee_stance_flexion_high": "KIC",
  "trunk_head_forward_lean/trunk_forward_lean": "TRK",
};

export function toReportRequest(result: AnalysisResult): ReportRequest {
  return {
    rules_version: result.rulesVersion,
    standard_label: result.standardLabel,
    confidence: {
      overall: result.confidence.overall,
      display: result.confidence.display,
      reasons: [...result.confidence.reasons],
    },
    walking: {
      passes: result.walking.passes,
      valid_cycles_total: result.walking.validCyclesTotal,
      slow_speed: result.walking.slowSpeed,
    },
    population_caveat: result.populationCaveat,
    findings: result.findings.map((finding) => {
      const subtype =
        finding.problem === "trunk_head_forward_lean" ? (finding.subtype ?? "trunk_forward_lean") : finding.subtype;
      const metricKey = ALLOWED_METRIC[`${finding.problem}/${subtype ?? ""}`];
      const metricValue = metricKey ? finding.metrics[metricKey] : undefined;
      return {
        problem: finding.problem,
        ...(subtype ? { subtype } : {}),
        severity: finding.severity,
        metrics: metricKey && metricValue !== undefined ? { [metricKey]: metricValue } : {},
        metric_confidence: finding.metricConfidence,
        near_threshold: finding.nearThreshold,
        candidate_causes: [...finding.candidateCauses],
        ...(finding.timestampsSec ? { timestamps_sec: [...finding.timestampsSec] } : {}),
      };
    }),
    observations: result.observations.map((observation) => ({ item: observation.item, status: observation.status })),
  };
}
