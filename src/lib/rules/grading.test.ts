/**
 * 分級規則的單元測試（gait-rules.md §3.3、§4.3、§5.3、§2.6、D29、D23／D31）。
 */
import { describe, expect, it } from "vitest";
import {
  BOUNDARIES,
  applyCycleGuard,
  capSeverity,
  gradeDeltaPKF,
  gradeHipSide,
  gradeKIC,
  gradePHE,
  gradePKF,
  gradeTRK,
  gradeTrunk,
  isNearThreshold,
  nearThresholdBand,
  pickDecidingSide,
} from "./grading";

describe("各指標分級界線（含等號歸屬，§8）", () => {
  it("PHE：≥ 12 正常；[8, 12) 輕度；< 8 明顯", () => {
    expect(gradePHE(12)).toBe("normal");
    expect(gradePHE(11.99)).toBe("mild");
    expect(gradePHE(8)).toBe("mild");
    expect(gradePHE(7.99)).toBe("marked");
    expect(gradePHE(-3)).toBe("marked");
  });

  it("PKF_sw：≥ 52 正常；[45, 52) 輕度；< 45 明顯", () => {
    expect(gradePKF(52)).toBe("normal");
    expect(gradePKF(51.9)).toBe("mild");
    expect(gradePKF(45)).toBe("mild");
    expect(gradePKF(44.9)).toBe("marked");
  });

  it("ΔPKF：≤ 10 正常；(10, 17] 輕度；> 17 明顯", () => {
    expect(gradeDeltaPKF(10)).toBe("normal");
    expect(gradeDeltaPKF(10.1)).toBe("mild");
    expect(gradeDeltaPKF(17)).toBe("mild");
    expect(gradeDeltaPKF(17.1)).toBe("marked");
  });

  it("KIC：≤ 12 正常；(12, 20) 輕度；≥ 20 明顯", () => {
    expect(gradeKIC(12)).toBe("normal");
    expect(gradeKIC(12.1)).toBe("mild");
    expect(gradeKIC(19.9)).toBe("mild");
    expect(gradeKIC(20)).toBe("marked");
  });

  it("TRK：< 7 正常；[7, 12) 輕度；≥ 12 明顯；後仰（負值）為正常", () => {
    expect(gradeTRK(6.99)).toBe("normal");
    expect(gradeTRK(7)).toBe("mild");
    expect(gradeTRK(11.99)).toBe("mild");
    expect(gradeTRK(12)).toBe("marked");
    expect(gradeTRK(-5)).toBe("normal");
  });
});

describe("接近臨界（§3.3：任一界線 ±1.5°）", () => {
  it("PHE 10.5–13.5 與 6.5–9.5 為接近臨界", () => {
    expect(isNearThreshold(10.5, BOUNDARIES.PHE)).toBe(true);
    expect(isNearThreshold(13.5, BOUNDARIES.PHE)).toBe(true);
    expect(isNearThreshold(13.6, BOUNDARIES.PHE)).toBe(false);
    expect(isNearThreshold(10, BOUNDARIES.PHE)).toBe(false);
    expect(isNearThreshold(7, BOUNDARIES.PHE)).toBe(true);
  });
  it("TRK 5.5 接近 7；KIC 21 接近 20", () => {
    expect(isNearThreshold(5.5, BOUNDARIES.TRK)).toBe(true);
    expect(isNearThreshold(21, BOUNDARIES.KIC)).toBe(true);
    expect(isNearThreshold(3, BOUNDARIES.TRK)).toBe(false);
  });
});

describe("D29 有效週期防護", () => {
  it("n < 2 時「明顯」降為「輕度」；輕度、正常不變", () => {
    expect(applyCycleGuard("marked", 1)).toBe("mild");
    expect(applyCycleGuard("mild", 1)).toBe("mild");
    expect(applyCycleGuard("normal", 0)).toBe("normal");
    expect(applyCycleGuard("marked", 2)).toBe("marked");
  });
  it("capSeverity 只往下限制", () => {
    expect(capSeverity("normal", "mild")).toBe("normal");
    expect(capSeverity("marked", "mild")).toBe("mild");
  });
});

describe("D26 決定整體分級的一側", () => {
  it("取較重的一側", () => {
    const decided = pickDecidingSide(
      [
        { side: "left", severity: "normal", value: 15, validCycles: 3 },
        { side: "right", severity: "mild", value: 10, validCycles: 3 },
      ],
      "lower",
    );
    expect(decided?.side).toBe("right");
  });
  it("同級時取較接近異常方向的值（PHE 取較小、KIC 取較大）", () => {
    const lower = pickDecidingSide(
      [
        { side: "left", severity: "mild", value: 9, validCycles: 3 },
        { side: "right", severity: "mild", value: 11, validCycles: 3 },
      ],
      "lower",
    );
    expect(lower?.value).toBe(9);
    const higher = pickDecidingSide(
      [
        { side: "left", severity: "mild", value: 14, validCycles: 3 },
        { side: "right", severity: "mild", value: 18, validCycles: 3 },
      ],
      "higher",
    );
    expect(higher?.value).toBe(18);
  });
  it("沒有任何一側時回傳 undefined", () => {
    expect(pickDecidingSide([], "lower")).toBeUndefined();
  });
});

describe("D23／D31 髖伸展歸因於軀幹前傾（每側）", () => {
  it("PHE 偏小、TE ≥ 12、TRK ≥ 7 → 不判髖伸展不足", () => {
    expect(gradeHipSide(8, 17, 10, 3)).toEqual({ severity: "normal", attributedToTrunk: true });
  });
  it("TE 也偏小 → 仍判髖伸展不足", () => {
    expect(gradeHipSide(2, 8, 10, 3)).toEqual({ severity: "marked", attributedToTrunk: false });
  });
  it("軀幹沒有前傾 → 依 PHE 分級", () => {
    expect(gradeHipSide(10, 14, 4, 3)).toEqual({ severity: "mild", attributedToTrunk: false });
  });
  it("PHE 正常時不需要歸因", () => {
    expect(gradeHipSide(15, 20, 10, 3)).toEqual({ severity: "normal", attributedToTrunk: false });
  });
  it("D29 先套用：單一週期最多輕度", () => {
    expect(gradeHipSide(3, 5, 2, 1).severity).toBe("mild");
  });
});

describe("軀幹分級的附加條件（§5.3）", () => {
  it("有效週期合計 < 2 最多輕度（D29）", () => {
    expect(gradeTrunk(15, 1, false)).toBe("mild");
  });
  it("鏡頭歪斜可信度低時最多輕度", () => {
    expect(gradeTrunk(15, 4, true)).toBe("mild");
    expect(gradeTrunk(15, 4, false)).toBe("marked");
  });
});

describe("M5：依量測不確定度調整的「接近臨界」帶寬", () => {
  it("週期數值一致時用下限 1.5°", () => {
    expect(nearThresholdBand([10, 10.2, 9.9, 10.1])).toBe(1.5);
  });
  it("週期間差異大時加寬（中位數 95% 信賴區間半寬），最多 3°", () => {
    const band = nearThresholdBand([8, 12, 10, 11]); // SD ≈ 1.71 → 1.96 × 1.2533 × 1.71 / 2 ≈ 2.1
    expect(band).toBeGreaterThan(2);
    expect(band).toBeLessThan(2.2);
    expect(nearThresholdBand([0, 10, 20])).toBe(3);
  });
  it("只有 1 個週期（無法估變異）時用上限 3°", () => {
    expect(nearThresholdBand([10])).toBe(3);
    expect(nearThresholdBand([])).toBe(3);
  });
  it("帶寬套用在界線判斷", () => {
    expect(isNearThreshold(14.5, BOUNDARIES.PHE)).toBe(false);
    expect(isNearThreshold(14.5, BOUNDARIES.PHE, 3)).toBe(true);
  });
});
