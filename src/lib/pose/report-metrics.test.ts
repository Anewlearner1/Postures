/**
 * 這個檔案做什麼：測試「查看數據」（D44）文字：代表角度與常見範圍（只有一側界線）、依卡片整理；
 * 以及演算法提供的步數、整段持續前傾長條。
 */

import { describe, expect, it } from "vitest";
import { SAMPLE_ANALYSIS } from "@/data/sample-analysis";
import type { AnalysisResult } from "@/lib/gait/types";
import { estimateSteps } from "./pipeline";
import { buildReplayBars, buildReplayMarkers } from "./replay-markers";
import { metricRow, metricsByCard } from "./report-metrics";

describe("metricRow", () => {
  it("下限型（髖伸展 ≥ 12°）", () => {
    expect(metricRow({ key: "PHE", valueDeg: 7, normalMinDeg: 12 })).toEqual({
      label: "髖部最大後伸",
      value: "約 7 度",
      range: "約 12 度以上",
    });
  });
  it("髖部後伸是 0 或負值時不顯示負數（F-08）", () => {
    expect(metricRow({ key: "PHE", valueDeg: -7, normalMinDeg: 12 }).value).toBe("幾乎沒有往後伸（大腿沒有伸到身體後方）");
    expect(metricRow({ key: "PHE", valueDeg: 0, normalMinDeg: 12 }).value).not.toContain("0 度");
  });
  it("上限型：KIC 含界線、TRK 不含界線", () => {
    expect(metricRow({ key: "KIC", valueDeg: 15, normalMaxDeg: 12, normalMaxInclusive: true }).range).toBe("約 12 度以下");
    expect(metricRow({ key: "TRK", valueDeg: 9, normalMaxDeg: 7, normalMaxInclusive: false }).range).toBe("小於 7 度");
  });
});

describe("metricsByCard", () => {
  it("只有演算法提供 userMetric 的問題才有數據", () => {
    const result: AnalysisResult = {
      ...SAMPLE_ANALYSIS,
      findings: SAMPLE_ANALYSIS.findings.map((finding, index) =>
        index === 0 ? { ...finding, userMetric: { key: "PHE", valueDeg: 7, normalMinDeg: 12 } } : finding,
      ),
    };
    expect(Object.keys(metricsByCard(result))).toEqual(["hip_extension_deficit"]);
    expect(metricsByCard(SAMPLE_ANALYSIS)).toEqual({});
  });
});

describe("estimateSteps", () => {
  it("優先用演算法的步數，沒有時用週期數 × 2", () => {
    expect(estimateSteps({ ...SAMPLE_ANALYSIS, walking: { ...SAMPLE_ANALYSIS.walking, stepsAnalyzed: 13 } })).toBe(13);
    expect(estimateSteps(SAMPLE_ANALYSIS)).toBe(SAMPLE_ANALYSIS.walking.validCyclesTotal * 2);
  });
});

describe("整段持續前傾", () => {
  const result: AnalysisResult = {
    ...SAMPLE_ANALYSIS,
    findings: [
      {
        problem: "trunk_head_forward_lean",
        subtype: "trunk_forward_lean",
        severity: "mild",
        metrics: { TRK: 9 },
        metricConfidence: "high",
        nearThreshold: false,
        candidateCauses: [],
        timestampsSec: [2, 5],
        trunkLeanPersistent: true,
      },
    ],
  };
  const cards = [{ id: "trunk_forward_lean", markerNumber: 1, plainName: "身體往前傾" }];

  it("改畫整段長條，不放點狀標記", () => {
    expect(buildReplayMarkers(result, cards)).toEqual([]);
    expect(buildReplayBars(result, cards)).toEqual([
      { cardId: "trunk_forward_lean", markerNumber: 1, label: "身體往前傾", problem: "trunk_head_forward_lean" },
    ]);
  });

  it("沒有整段前傾時不畫長條", () => {
    expect(buildReplayBars(SAMPLE_ANALYSIS, cards)).toEqual([]);
  });
});
