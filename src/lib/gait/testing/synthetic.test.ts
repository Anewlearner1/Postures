/**
 * 合成資料產生器本身的檢查：曲線極值、輸出格式、真值、注入功能。
 */
import { describe, expect, it } from "vitest";
import { LANDMARK } from "../types";
import { NORMAL_GAIT, expectedMetrics, gaitCurves, generateWalk, periodicCurve } from "./synthetic";

describe("步態曲線", () => {
  it("週期性單調內插：經過關鍵點、不超出關鍵點範圍、首尾連續", () => {
    const curve = periodicCurve([
      [0, 10],
      [0.3, -5],
      [0.7, 20],
    ]);
    expect(curve(0)).toBeCloseTo(10, 10);
    expect(curve(0.3)).toBeCloseTo(-5, 10);
    expect(curve(0.7)).toBeCloseTo(20, 10);
    expect(curve(1)).toBeCloseTo(curve(0), 10);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i <= 1000; i++) {
      min = Math.min(min, curve(i / 1000));
      max = Math.max(max, curve(i / 1000));
    }
    expect(min).toBeCloseTo(-5, 6);
    expect(max).toBeCloseTo(20, 6);
  });

  it("期望值等於設定參數（TE、PKF_sw、KIC、TRK）", () => {
    const expected = expectedMetrics(NORMAL_GAIT);
    expect(expected.TE).toBeCloseTo(NORMAL_GAIT.thighExtDeg, 6);
    expect(expected.PKF_sw).toBeCloseTo(NORMAL_GAIT.pkfDeg, 6);
    expect(expected.KIC).toBeCloseTo(NORMAL_GAIT.kicDeg, 6);
    expect(expected.TRK).toBeCloseTo(NORMAL_GAIT.trunkLeanDeg, 2);
    // PHE ≈ TE − 軀幹前傾（§3.2）
    expect(expected.PHE).toBeGreaterThan(NORMAL_GAIT.thighExtDeg - NORMAL_GAIT.trunkLeanDeg - 1.5);
    expect(expected.PHE).toBeLessThan(NORMAL_GAIT.thighExtDeg - NORMAL_GAIT.trunkLeanDeg + 1.5);
  });

  it("正常步態曲線的典型值：承重期膝屈曲約 18°、TO 時大腿在後方", () => {
    const c = gaitCurves(NORMAL_GAIT);
    expect(c.knee(0.13)).toBeCloseTo(18, 6);
    expect(c.thigh(c.to)).toBeLessThan(0);
  });
});

describe("產生的影格", () => {
  const sim = generateWalk({ seed: 3 });

  it("MediaPipe 格式：33 點、正規化座標、時間遞增", () => {
    expect(sim.frames.length).toBeGreaterThan(250);
    for (const frame of sim.frames) {
      expect(frame.landmarks).toHaveLength(33);
    }
    const ankle = sim.frames[100].landmarks![LANDMARK.rightAnkle];
    expect(ankle.x).toBeGreaterThan(0);
    expect(ankle.x).toBeLessThan(1);
    expect(sim.frames[1].timeSec - sim.frames[0].timeSec).toBeCloseTo(1 / 30, 10);
    expect(sim.meta).toMatchObject({ fps: 30, width: 1920, height: 1080 });
  });

  it("往右走時右側是近側：visibility 較高、z 較小", () => {
    const frame = sim.frames[Math.round(2 * 30)];
    const right = frame.landmarks![LANDMARK.rightKnee];
    const left = frame.landmarks![LANDMARK.leftKnee];
    expect(right.visibility).toBeGreaterThan(left.visibility);
    expect(right.z).toBeLessThan(left.z);
    expect(sim.truth.passes[0]).toMatchObject({ direction: 1, nearSide: "right" });
    expect(sim.truth.passes[1]).toMatchObject({ direction: -1, nearSide: "left" });
  });

  it("真值事件：每隻腳 HS 與 TO 交錯、間隔 = 週期", () => {
    const leftHs = sim.truth.events.filter((e) => e.side === "left" && e.type === "heel_strike").map((e) => e.timeSec);
    for (let i = 1; i < leftHs.length; i++) {
      if (leftHs[i] - leftHs[i - 1] < 1.5) expect(leftHs[i] - leftHs[i - 1]).toBeCloseTo(sim.truth.cycleSec, 3);
    }
    expect(sim.truth.turns).toHaveLength(1);
  });

  it("同一個 seed 產生完全相同的資料", () => {
    expect(generateWalk({ seed: 3, noisePx: 2 }).frames).toEqual(generateWalk({ seed: 3, noisePx: 2 }).frames);
  });

  it("注入：缺幀、偵測不到人、左右交換", () => {
    const dropped = generateWalk({ droppedFrameFraction: 0.1 });
    expect(dropped.frames.length).toBeLessThan(sim.frames.length * 0.95);
    const missing = generateWalk({ missingFrameFraction: 0.2 });
    const nulls = missing.frames.filter((f) => f.landmarks === null).length;
    expect(nulls / missing.frames.length).toBeGreaterThan(0.15);
    const swapped = generateWalk({ swapFraction: 0.1 });
    const swappedFrames = swapped.frames.filter(
      (f, i) => f.landmarks![LANDMARK.leftKnee].x !== sim.frames[i]?.landmarks?.[LANDMARK.leftKnee].x,
    ).length;
    expect(swappedFrames / swapped.frames.length).toBeGreaterThan(0.08);
  });
});
