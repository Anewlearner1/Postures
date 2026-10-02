/**
 * 這個檔案做什麼：
 *   把演算法給的本機代表角度（Finding.userMetric，D44）整理成問題卡片「查看數據」要顯示的文字。
 *   只在瀏覽器裡使用，不送 API（toReportRequest 本來就不送 userMetric）。
 */

import { METRICS_COPY } from "@/data/report-copy";
import type { AnalysisResult, UserMetric } from "@/lib/gait/types";
import { cardIdOf } from "@/lib/report/card-id";

export interface MetricRowText {
  label: string;
  value: string;
  range?: string;
}

/** 單一指標 → 一列文字。 */
export function metricRow(metric: UserMetric): MetricRowText {
  let range: string | undefined;
  if (metric.normalMinDeg !== undefined) range = METRICS_COPY.rangeAtLeast(metric.normalMinDeg);
  else if (metric.normalMaxDeg !== undefined) {
    range =
      metric.normalMaxInclusive === false
        ? METRICS_COPY.rangeBelow(metric.normalMaxDeg)
        : METRICS_COPY.rangeAtMost(metric.normalMaxDeg);
  }
  return { label: METRICS_COPY.labels[metric.key], value: METRICS_COPY.value(metric.valueDeg), ...(range ? { range } : {}) };
}

/** 依卡片 id 整理（只有演算法有提供 userMetric 的問題才有）。 */
export function metricsByCard(result: AnalysisResult): Record<string, MetricRowText[]> {
  const out: Record<string, MetricRowText[]> = {};
  for (const finding of result.findings) {
    if (!finding.userMetric) continue;
    (out[cardIdOf(finding)] ??= []).push(metricRow(finding.userMetric));
  }
  return out;
}
