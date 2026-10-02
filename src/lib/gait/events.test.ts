/**
 * 步態事件偵測準確度（gait-rules.md §2.3，Zeni 座標法）：與合成資料的真值事件比對。
 *
 * 容差依據：Zeni 2008 在 60 Hz 下 98% 的事件誤差 ≤ 2 幀；本產品 30 fps 時 1 幀 = 33 ms。
 * 合成步態的足部軌跡會讓 HS 系統性提早約半幀、TO 提早約 1 幀（與真實人體的 Zeni 法偏差同方向），
 * 因此以「平均絕對誤差」與「最大誤差」兩個門檻檢查。
 */
import { describe, expect, it } from "vitest";
import { analyzeGait } from "./analyze";
import { detectPassEvents } from "./events";
import { detectPasses, legLength } from "./passes";
import { buildTrack } from "./preprocess";
import { eventAccuracy, maxAbs, meanAbs } from "./testing/accuracy";
import { generateWalk, type SyntheticOptions } from "./testing/synthetic";

function accuracy(options: SyntheticOptions) {
  const sim = generateWalk({ passes: 4, ...options });
  const outcome = analyzeGait(sim.frames, sim.meta);
  if (outcome.status !== "ok" || !outcome.details) throw new Error(`analysis rejected: ${JSON.stringify(outcome)}`);
  return { sim, details: outcome.details, acc: eventAccuracy(sim.truth, outcome.details) };
}

describe("事件偵測準確度（近側、直線段內）", () => {
  it.each([
    { name: "30 fps、無雜訊", options: { fps: 30 }, hsMean: 25, toMean: 45 },
    { name: "30 fps、雜訊 3 px", options: { fps: 30, noisePx: 3 }, hsMean: 30, toMean: 50 },
    { name: "60 fps、雜訊 3 px", options: { fps: 60, noisePx: 3 }, hsMean: 30, toMean: 50 },
    { name: "25 fps、雜訊 2 px", options: { fps: 25, noisePx: 2 }, hsMean: 30, toMean: 50 },
    { name: "往左開始走", options: { startDirection: -1 as const, noisePx: 2 }, hsMean: 30, toMean: 50 },
    { name: "走得慢", options: { speedMps: 0.8, noisePx: 2 }, hsMean: 30, toMean: 55 },
    { name: "手機歪 6°", options: { rollDeg: 6, noisePx: 2 }, hsMean: 30, toMean: 50 },
    { name: "左右錯置 6%", options: { swapFraction: 0.06, noisePx: 2 }, hsMean: 30, toMean: 50 },
  ])("$name：HS 平均誤差 < $hsMean ms、TO < $toMean ms，偵測率 ≥ 95%，無誤報", ({ options, hsMean, toMean }) => {
    const { acc } = accuracy(options);
    expect(acc.total).toBeGreaterThanOrEqual(12);
    expect(acc.matched / acc.total).toBeGreaterThanOrEqual(0.95);
    expect(meanAbs(acc.errorsMs.heel_strike)).toBeLessThan(hsMean);
    expect(meanAbs(acc.errorsMs.toe_off)).toBeLessThan(toMean);
    // 最大誤差不超過 3 幀
    const frameMs = 1000 / ("fps" in options && options.fps ? options.fps : 30);
    expect(maxAbs(acc.errorsMs.heel_strike)).toBeLessThan(3 * frameMs);
    expect(maxAbs(acc.errorsMs.toe_off)).toBeLessThan(3 * frameMs);
    expect(acc.falsePositives).toBe(0);
  });

  it("只偵測近側事件（§0.6），每趟的事件都屬於該趟近側", () => {
    const { details } = accuracy({ noisePx: 2 });
    for (const event of details.events) {
      expect(event.side).toBe(details.passes[event.passIndex].nearSide);
    }
  });

  it("週期合理：週期時間 ≈ 真值、支撐期比例 ≈ 60%", () => {
    const { sim, details } = accuracy({ noisePx: 2 });
    const used = details.cycles.filter((c) => c.used);
    expect(used.length).toBeGreaterThanOrEqual(5);
    for (const { cycle } of used) {
      const T = cycle.nextHeelStrikeSec - cycle.heelStrikeSec;
      expect(Math.abs(T - sim.truth.cycleSec)).toBeLessThan(0.05);
      expect((cycle.toeOffSec - cycle.heelStrikeSec) / T).toBeGreaterThan(0.55);
      expect((cycle.toeOffSec - cycle.heelStrikeSec) / T).toBeLessThan(0.65);
    }
  });

  it("腳跟、腳尖看不清時改用腳踝點（§2.1 備援），仍能找到事件", () => {
    const sim = generateWalk({ passes: 4, noisePx: 2 });
    const track = buildTrack(sim.frames, sim.meta);
    for (const side of ["left", "right"] as const) {
      track.side[side].heel.X.fill(NaN);
      track.side[side].toe.X.fill(NaN);
    }
    const L = legLength(track);
    const passes = detectPasses(track, L);
    let matched = 0;
    let total = 0;
    const errors: number[] = [];
    for (const pass of passes) {
      const events = detectPassEvents(track, pass, L);
      expect(events.usedAnkleFallback).toBe(true);
      const truth = sim.truth.events.filter(
        (e) => e.type === "heel_strike" && e.side === pass.nearSide && e.timeSec > pass.startSec + 0.15 && e.timeSec < pass.endSec - 0.15,
      );
      for (const t of truth) {
        total++;
        const best = Math.min(...events.heelStrikes.map((time) => Math.abs(time - t.timeSec)));
        if (best < 0.15) {
          matched++;
          errors.push(best * 1000);
        }
      }
    }
    expect(matched / total).toBeGreaterThanOrEqual(0.9);
    expect(meanAbs(errors)).toBeLessThan(80);
  });
});
