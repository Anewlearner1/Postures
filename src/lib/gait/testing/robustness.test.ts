/**
 * 演算法穩健性的回歸測試（M5 品質驗證；完整參數掃描在 robustness-sweep.test.ts，結果見 docs/review/M5-qa.md）。
 *
 * 這裡只放「穩定、跑得快」的檢查，每個條件用固定的幾個亂數種子：
 *   1. 依拍攝教學拍的正常步態：不誤報、不誤拒；每種「明顯」問題都抓得到。
 *   2. 輕微的真實干擾（雜訊、短暫遮擋、手機稍歪、少量左右錯置、只走 2 趟）下仍然如此。
 *   3. 安全網：拍攝條件差到結果可能不準時，可信度一定顯示「較低」（使用者至少會被提醒）。
 *   4. 已知問題（it.fails）：目前會失敗、已寫進 M5-qa.md 的問題。修好後這些測試會「意外通過」而報錯，
 *      屆時把 it.fails 改回 it 即可。
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

describe("已知問題（記錄於 docs/review/M5-qa.md；修正後請把 it.fails 改成 it）", () => {
  it.fails("A-1 著地膝角（KIC）在 30 fps 有系統性高估：誤差應小於 2°", () => {
    // 實測（無雜訊）：30 fps 約 +3°、24 fps 約 +4–5°、15 fps 約 +5–9°
    const sim = generateWalk({ passes: 3, noisePx: 0 });
    const outcome = analyzeGait(sim.frames, sim.meta);
    if (outcome.status !== "ok") throw new Error(outcome.code);
    const kic = findingFor(outcome.result.findings, "stance")!.metrics.KIC!;
    expect(Math.abs(kic - sim.truth.expected.KIC)).toBeLessThan(2);
  });

  it.fails("A-2 低影格率（15 fps）下，典型正常步態不應被判「著地膝蓋彎太多」", () => {
    const s = summary(PROFILES.normal, { fps: 15 });
    expect(s.falsePositiveItems.stance ?? 0).toBe(0);
  });

  it.fails("A-3 依拍攝教學（手機距離 3 m、走道 4.5 m）拍攝，不應被要求重拍", () => {
    const s = summary(PROFILES.normal, { cameraDistanceM: 3, walkwayM: 4.5 });
    expect(s.rejectRate).toBe(0);
  });

  it.fails("A-4 拍攝角度只偏 10°（一般人很難拿得更正）時，典型正常步態的可信度不應一律是「較低」", () => {
    const s = summary(PROFILES.normal, { walkwayYawDeg: 10 });
    expect(s.lowConfidenceRate).toBeLessThan(0.5);
  });
});
