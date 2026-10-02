/**
 * 可信度規則的單元測試（gait-rules.md §6.3、§6.4、D28）。
 */
import { describe, expect, it } from "vitest";
import type { ConfidenceFactors, ConfidenceReason } from "@/lib/gait/types";
import {
  REASON_PRIORITY,
  combineFactors,
  computeFactors,
  displayFor,
  downgrade,
  fewCyclesLevel,
  levelHigherWorse,
  levelLowerWorse,
  metricConfidence,
  occlusionLevel,
  type ConfidenceMeasurements,
} from "./confidence";

const GOOD: ConfidenceMeasurements = {
  hipWidthRatio: 0.1,
  yawDeg: 3,
  nearVisibility: 0.95,
  interpolatedFraction: 0,
  nearSideDisagreement: false,
  cyclesLeft: 3,
  cyclesRight: 3,
  maxStdDev: 1,
  subjectHeightFraction: 0.6,
  outOfFrameFraction: 0,
  rollAbsDeg: 1,
  rollRangeDeg: 0.5,
  fps: 30,
  swapFraction: 0,
  edgeFraction: 0,
  jitterLeg: 0.005,
  paceCV: 0.02,
  accelerationCyclesKept: false,
};

function factorsWith(overrides: Partial<Record<ConfidenceReason, "high" | "medium" | "low">>): ConfidenceFactors {
  const base = computeFactors(GOOD);
  for (const [reason, level] of Object.entries(overrides)) base[reason as ConfidenceReason] = { level: level! };
  return base;
}

describe("因子分級（§6.3）", () => {
  it("良好條件下 13 個因子都是「高」", () => {
    const factors = computeFactors(GOOD);
    expect(Object.keys(factors)).toHaveLength(13);
    expect(Object.values(factors).every((factor) => factor.level === "high")).toBe(true);
  });

  it.each([
    ["angle_off", { hipWidthRatio: 0.2 }, "medium"],
    ["angle_off", { yawDeg: 20 }, "medium"],
    ["angle_off", { yawDeg: 30 }, "low"],
    ["angle_off", { yawDeg: 12 }, "high"],
    ["occlusion", { nearVisibility: 0.7 }, "medium"],
    ["occlusion", { interpolatedFraction: 0.2 }, "low"],
    ["occlusion", { nearSideDisagreement: true }, "medium"],
    ["few_cycles", { cyclesLeft: 3, cyclesRight: 0 }, "medium"],
    ["few_cycles", { cyclesLeft: 1, cyclesRight: 1 }, "low"],
    ["high_variability", { maxStdDev: 5 }, "medium"],
    ["high_variability", { maxStdDev: 8 }, "low"],
    ["subject_small", { subjectHeightFraction: 0.4 }, "medium"],
    ["subject_small", { subjectHeightFraction: 0.2 }, "low"],
    ["partial_out_of_frame", { outOfFrameFraction: 0.05 }, "medium"],
    ["partial_out_of_frame", { outOfFrameFraction: 0.2 }, "low"],
    ["camera_tilt", { rollAbsDeg: 5 }, "medium"],
    ["camera_tilt", { rollAbsDeg: 9 }, "low"],
    ["camera_motion", { rollRangeDeg: 3 }, "medium"],
    ["camera_motion", { rollRangeDeg: 6 }, "low"],
    ["low_fps", { fps: 25 }, "medium"],
    ["low_fps", { fps: 20 }, "low"],
    ["low_fps", { fps: 29.97 }, "high"],
    ["lr_swap", { swapFraction: 0.08 }, "medium"],
    ["lr_swap", { swapFraction: 0.2 }, "low"],
    ["lens_distortion", { edgeFraction: 0.2 }, "medium"],
    ["lens_distortion", { edgeFraction: 0.4 }, "low"],
    ["low_light", { jitterLeg: 0.02 }, "medium"],
    ["low_light", { jitterLeg: 0.03 }, "low"],
    ["irregular_pace", { paceCV: 0.1 }, "medium"],
    ["irregular_pace", { paceCV: 0.2 }, "low"],
    ["irregular_pace", { accelerationCyclesKept: true }, "medium"],
  ] as const)("%s：%o → %s", (reason, change, level) => {
    expect(computeFactors({ ...GOOD, ...change })[reason].level).toBe(level);
  });

  it("few_cycles 表格：兩側 ≥ 2 且合計 ≥ 5 高；合計 ≤ 2 低；其餘中", () => {
    expect(fewCyclesLevel(2, 3)).toBe("high");
    expect(fewCyclesLevel(2, 2)).toBe("medium");
    expect(fewCyclesLevel(5, 0)).toBe("medium");
    expect(fewCyclesLevel(2, 0)).toBe("low");
    expect(fewCyclesLevel(1, 1)).toBe("low");
  });

  it("缺值視為「高」（沒有證據不扣分）", () => {
    expect(levelHigherWorse(undefined, 1, 2)).toBe("high");
    expect(levelLowerWorse(NaN, 1, 2)).toBe("high");
    expect(occlusionLevel(undefined, undefined)).toBe("high");
  });
});

describe("整體可信度（§6.4）與 D28 顯示", () => {
  it("全部高 → 高、沒有原因", () => {
    expect(combineFactors(computeFactors(GOOD))).toEqual({ overall: "high", reasons: [] });
  });
  it("任一低 → 低", () => {
    expect(combineFactors(factorsWith({ low_fps: "low" })).overall).toBe("low");
  });
  it("中 ≥ 3 個 → 低；1–2 個 → 中", () => {
    expect(combineFactors(factorsWith({ angle_off: "medium", lr_swap: "medium" })).overall).toBe("medium");
    expect(combineFactors(factorsWith({ angle_off: "medium", lr_swap: "medium", camera_tilt: "medium" })).overall).toBe("low");
  });
  it("原因最多 2 個：先列「低」，再依優先順序列「中」", () => {
    const { reasons } = combineFactors(factorsWith({ lr_swap: "medium", few_cycles: "low", angle_off: "medium" }));
    expect(reasons).toEqual(["few_cycles", "angle_off"]);
  });
  it("優先順序包含全部 13 個因子", () => {
    expect(new Set(REASON_PRIORITY).size).toBe(13);
  });
  it("D28：高 → good、中 → good_with_tip、低 → low", () => {
    expect(displayFor("high")).toBe("good");
    expect(displayFor("medium")).toBe("good_with_tip");
    expect(displayFor("low")).toBe("low");
  });
});

describe("指標層級可信度（§6.4）", () => {
  it("取「整體」與「該指標」較低者", () => {
    const factors = computeFactors(GOOD);
    expect(metricConfidence(factors, "high", { occlusion: "low" })).toBe("low");
    expect(metricConfidence(factors, "medium", { occlusion: "high" })).toBe("medium");
  });
  it("§4.5 光線不足時 PKF_sw 降一級", () => {
    expect(metricConfidence(computeFactors(GOOD), "high", {}, true)).toBe("medium");
    expect(downgrade("medium")).toBe("low");
    expect(downgrade("low")).toBe("low");
  });

  it("M5（A-7）人小時關鍵點跳動歸因於「人太小」：low_light 不列，subject_small 取較差者", () => {
    const f = computeFactors({ ...GOOD, subjectHeightFraction: 0.2, jitterLeg: 0.02 });
    expect(f.low_light.level).toBe("high");
    expect(f.subject_small.level).toBe("low");
  });
  it("M5（A-7）人小（中）＋跳動（中）合併為「低」，不讓整體可信度因改名而變好", () => {
    const f = computeFactors({ ...GOOD, subjectHeightFraction: 0.4, jitterLeg: 0.02 });
    expect(f.subject_small.level).toBe("low");
    expect(f.low_light.level).toBe("high");
  });
  it("人不小時，跳動照常算 low_light", () => {
    const f = computeFactors({ ...GOOD, jitterLeg: 0.03 });
    expect(f.low_light.level).toBe("low");
    expect(f.subject_small.level).toBe("high");
  });
});
