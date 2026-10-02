/**
 * 拒絕規則的單元測試（gait-rules.md §7.1）。整條管線的拒絕情境另見 src/lib/gait/analyze.test.ts。
 */
import { describe, expect, it } from "vitest";
import { cycleReject, earlyReject, qualityReject, sideViewReject, type RejectMeasurements } from "./reject";

const OK: RejectMeasurements = {
  durationSec: 12,
  fps: 30,
  detectedFraction: 0.98,
  identityJumps: 0,
  completeBodyFraction: 0.9,
};

describe("影片層級拒絕", () => {
  it("條件都符合時不拒絕", () => {
    expect(earlyReject(OK)).toBeUndefined();
  });
  it.each([
    [{ durationSec: 5.9 }, "too_short"],
    [{ fps: 14 }, "low_fps_reject"],
    [{ detectedFraction: 0.49 }, "no_person"],
    [{ multiPoseFraction: 0.6 }, "multi_person"],
  ] as const)("%o → %s", (change, code) => {
    expect(earlyReject({ ...OK, ...change })).toBe(code);
  });
  it.each([
    [{ identityJumps: 4 }, "multi_person"],
    [{ completeBodyFraction: 0.59 }, "body_incomplete"],
  ] as const)("確認側面之後：%o → %s", (change, code) => {
    expect(earlyReject({ ...OK, ...change })).toBeUndefined();
    expect(qualityReject({ ...OK, ...change })).toBe(code);
  });
  it("依序判斷：太短優先於沒有人", () => {
    expect(earlyReject({ ...OK, durationSec: 3, detectedFraction: 0 })).toBe("too_short");
  });
  it("剛好在門檻上不拒絕（6 秒、15 fps、50%、60%）", () => {
    expect(earlyReject({ ...OK, durationSec: 6, fps: 15, detectedFraction: 0.5, completeBodyFraction: 0.6 })).toBeUndefined();
    expect(qualityReject({ ...OK, identityJumps: 3, completeBodyFraction: 0.6 })).toBeUndefined();
  });
});

describe("拍攝角度與週期", () => {
  it("所有直線段髖寬比 > 0.5 → not_side_view；只要有一段是側面就不拒絕", () => {
    expect(sideViewReject([0.6, 0.7], 0)).toBe("not_side_view");
    expect(sideViewReject([0.6, 0.1], 0)).toBeUndefined();
  });
  it("沒有直線段時：身體寬度比大（正面）→ not_side_view；側面站著不動 → 交給 no_gait_cycle", () => {
    expect(sideViewReject([], 0.6)).toBe("not_side_view");
    expect(sideViewReject([], 0.1)).toBeUndefined();
  });
  it("有效週期 0 → no_gait_cycle", () => {
    expect(cycleReject(0)).toBe("no_gait_cycle");
    expect(cycleReject(1)).toBeUndefined();
  });
});
