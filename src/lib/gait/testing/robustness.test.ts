/**
 * 演算法穩健性的回歸測試（M5 品質驗證；完整參數掃描在 robustness-sweep.test.ts，結果見 docs/review/M5-qa.md）。
 *
 * 這裡只放「穩定、跑得快」的檢查，每個條件用固定的幾個亂數種子：
 *   1. 依拍攝教學拍的正常步態：不誤報、不誤拒；每種「明顯」問題都抓得到。
 *   2. 輕微的真實干擾（雜訊、短暫遮擋、手機稍歪、少量左右錯置、只走 2 趟）下仍然如此。
 *   3. 安全網：拍攝條件差到結果可能不準時，可信度一定顯示「較低」（使用者至少會被提醒）。
 *   4. M5 已修正的問題（A-1～A-4，原本以 it.fails 記錄）與新增的回歸檢查（A-6、A-7、A-8、KIC 各影格率）。
 */

import { describe, expect, it } from "vitest";
import { analyzeGait } from "../analyze";
import { BASELINE, findingFor, PROFILES, runCondition, runTrial, type GaitProfile } from "./robustness";
import { generateWalk, type SyntheticOptions } from "./synthetic";

const SEEDS = [101, 108, 115, 122, 129, 136];

function summary(profile: GaitProfile, options: SyntheticOptions = {}) {
  return runCondition(profile, { ...BASELINE, ...options }, SEEDS);
}

describe("基準拍攝條件（拍攝教學：來回 3 趟、30 fps、輕微雜訊）", () => {
  it("典型正常步態：不誤拒、不誤報", () => {
    const s = summary(PROFILES.normal);
    expect(s.rejectRate).toBe(0);
    expect(s.falsePositiveRate).toBe(0);
  });

  it("接近界線的正常步態（離界線 2–5°）：不誤拒，誤報最多 1/6（主要來自 KIC 高估，見已知問題 A-1）", () => {
    const s = summary(PROFILES.normalBorder);
    expect(s.rejectRate).toBe(0);
    expect(s.falsePositiveRate).toBeLessThanOrEqual(1 / 6);
  });

  it.each(["hipMarked", "swingMarked", "stanceMarked", "trunkMarked", "hipMild", "swingMild"])(
    "%s：每個種子都抓得到",
    (key) => {
      const s = summary(PROFILES[key]);
      expect(s.rejectRate).toBe(0);
      expect(s.missRate).toBe(0);
    },
  );
});

describe("輕微的真實干擾下仍然穩定", () => {
  const MILD: Array<[string, SyntheticOptions]> = [
    ["走得慢（0.8 m/s）", { speedMps: 0.8 }],
    ["雜訊 3 像素＋遮擋 10%", { noisePx: 3, dropoutFraction: 0.1 }],
    ["手機歪 5°", { rollDeg: 5 }],
    ["左右錯置 5%", { swapFraction: 0.05 }],
    ["只走 2 趟", { passes: 2 }],
  ];

  it.each(MILD)("典型正常步態：%s → 不誤拒、不誤報", (_name, options) => {
    const s = summary(PROFILES.normal, options);
    expect(s.rejectRate).toBe(0);
    expect(s.falsePositiveRate).toBe(0);
  });

  it.each(MILD)("明顯髖伸展不足與明顯軀幹前傾：%s → 不漏判", (_name, options) => {
    for (const key of ["hipMarked", "trunkMarked"]) {
      const s = summary(PROFILES[key], options);
      expect(s.rejectRate, key).toBe(0);
      expect(s.missRate, key).toBe(0);
    }
  });
});

describe("安全網：條件差到可能不準時，一定標示低可信度", () => {
  it.each<[string, SyntheticOptions]>([
    ["關鍵點雜訊 9 像素", { noisePx: 9 }],
    ["關鍵點雜訊 16 像素", { noisePx: 16 }],
    ["手機歪 10°", { rollDeg: 10 }],
    ["左右錯置 20%", { swapFraction: 0.2 }],
    ["影格率 15 fps", { fps: 15 }],
    ["影格率 20 fps", { fps: 20 }],
    ["人比較小（距離 6 m，約 37% 畫面高）", { cameraDistanceM: 6 }],
    ["人很小（距離 8 m）", { cameraDistanceM: 8 }],
    ["拍攝角度偏 20°", { walkwayYawDeg: 20 }],
    ["偵測不到人的影格 30%", { missingFrameFraction: 0.3 }],
  ])("%s → 每次分析都是「較低」", (_name, options) => {
    for (const seed of SEEDS) {
      const outcome = runTrial(PROFILES.normal, { ...BASELINE, ...options, seed });
      if (outcome.rejected) continue; // 拒絕也是安全的結果
      expect(outcome.confidence, `seed ${seed}`).toBe("low");
    }
  });
});

describe("M5 已修正的問題（原記錄於 docs/review/M5-qa.md 的 it.fails）", () => {
  it("A-1 著地膝角（KIC）在 30 fps 不再系統性高估：誤差小於 2°", () => {
    // 實測（無雜訊）：30 fps 約 +3°、24 fps 約 +4–5°、15 fps 約 +5–9°
    const sim = generateWalk({ passes: 3, noisePx: 0 });
    const outcome = analyzeGait(sim.frames, sim.meta);
    if (outcome.status !== "ok") throw new Error(outcome.code);
    const kic = findingFor(outcome.result.findings, "stance")!.metrics.KIC!;
    expect(Math.abs(kic - sim.truth.expected.KIC)).toBeLessThan(2);
  });

  it("A-2 低影格率（15 fps）下，典型正常步態不會被判「著地膝蓋彎太多」", () => {
    const s = summary(PROFILES.normal, { fps: 15 });
    expect(s.falsePositiveItems.stance ?? 0).toBe(0);
  });

  it.each<[number, number]>([
    [3, 4.5],
    [4, 4.5],
    [4, 5],
  ])("A-3 手機距離 %s m、走道 %s m（舊教學 3 m；D47 改為約 4 m）不會被要求重拍", (cameraDistanceM, walkwayM) => {
    const s = summary(PROFILES.normal, { cameraDistanceM, walkwayM });
    expect(s.rejectRate).toBe(0);
  });

  it("A-4 拍攝角度只偏 10°（一般人很難拿得更正）時，典型正常步態的可信度不會一律是「較低」", () => {
    const s = summary(PROFILES.normal, { walkwayYawDeg: 10 });
    expect(s.lowConfidenceRate).toBeLessThan(0.5);
  });

  // 修正前（無雜訊）：15 fps +5–9°、20 fps +4–6°、24 fps +4–5°。剩下約 +1–2.5° 主要來自 6 Hz 低通濾波把著地時的膝角谷底磨平
  it.each([15, 20, 24, 60])("A-1 著地膝角在 %s fps、快走（1.9 m/s）的偏差 < 3°（修正前最多 +9°）", (fps) => {
    const errors: number[] = [];
    for (const seed of SEEDS) {
      const sim = generateWalk({ ...BASELINE, fps, speedMps: 1.9, seed });
      const outcome = analyzeGait(sim.frames, sim.meta);
      if (outcome.status !== "ok") throw new Error(outcome.code);
      errors.push(findingFor(outcome.result.findings, "stance")!.metrics.KIC! - sim.truth.expected.KIC);
    }
    expect(Math.abs(errors.reduce((a, b) => a + b, 0) / errors.length)).toBeLessThan(3);
  });

  it("A-6 拍攝角度偏 40°：被要求重拍時，理由是「不是從側面拍」而不是「步伐不夠」", () => {
    const s = summary(PROFILES.normal, { walkwayYawDeg: 40 });
    expect(s.rejectCodes.no_gait_cycle ?? 0).toBe(0);
    expect(s.rejectCodes.not_side_view ?? 0).toBeGreaterThan(0);
  });

  it("A-7 人很小（距離 8 m）時，可信度原因是「人太小」，不會說「畫面比較暗」", () => {
    for (const seed of SEEDS) {
      const sim = generateWalk({ ...BASELINE, cameraDistanceM: 8, seed });
      const outcome = analyzeGait(sim.frames, sim.meta);
      if (outcome.status !== "ok") continue;
      expect(outcome.result.confidence.reasons).not.toContain("low_light");
      expect(outcome.result.confidence.reasons).toContain("subject_small");
    }
  });

  it.each([1.6, 1.9])("A-8 快走（%s m/s）的接近界線正常人：誤報都標示「接近分界」（報告用保守說法）", (speedMps) => {
    for (const seed of SEEDS) {
      const t = runTrial(PROFILES.normalBorder, { ...BASELINE, speedMps, seed });
      expect(t.falsePositivesNearThreshold, `seed ${seed}`).toEqual(t.falsePositives);
    }
  });
});
