/**
 * 數學工具的單元測試：統計量、內插、零相位低通濾波（§1.2）、峰值搜尋（§2.3）。
 */
import { describe, expect, it } from "vitest";
import {
  fillShortGaps,
  findPeaks,
  linearSlope,
  lowpassZeroPhase,
  median,
  movingAverage,
  parabolicOffset,
  percentile,
  sampleStd,
} from "./math";

describe("統計量", () => {
  it("中位數、百分位數、樣本標準差", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([0, 10], 90)).toBe(9);
    expect(sampleStd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(sampleStd([1])).toBeNaN();
    expect(median([])).toBeNaN();
  });
  it("線性迴歸斜率", () => {
    expect(linearSlope([0, 1, 2, 3], [1, 3, 5, 7])).toBeCloseTo(2);
    expect(linearSlope([1, 1], [0, 5])).toBeNaN();
  });
});

describe("缺口內插（§1.2）", () => {
  it("只補兩端都有值、且長度 ≤ 上限的缺口，並標記內插位置", () => {
    const values = Float64Array.from([0, NaN, NaN, 3, NaN, NaN, NaN, NaN, 8, NaN]);
    const filled = fillShortGaps(values, 3);
    expect(Array.from(values.slice(0, 4))).toEqual([0, 1, 2, 3]);
    expect(Number.isNaN(values[5])).toBe(true); // 4 格的缺口不補
    expect(Number.isNaN(values[9])).toBe(true); // 尾端不外插
    expect(Array.from(filled)).toEqual([0, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
  });
  it("移動平均忽略 NaN", () => {
    const out = movingAverage([1, NaN, 3, 5], 3);
    expect(out[0]).toBe(1);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(out[2]).toBe(4);
  });
});

describe("零相位 Butterworth 低通（§1.2）", () => {
  const fs = 30;
  const n = 300;
  const tone = (hz: number) => Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * hz * i) / fs));
  const rms = (values: ArrayLike<number>, from = 30, to = n - 30) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += values[i] ** 2;
    return Math.sqrt(sum / (to - from));
  };

  it("保留直流與 1 Hz 步態成分，且不產生相位延遲", () => {
    const slow = tone(1);
    const out = lowpassZeroPhase(slow, 6, fs);
    expect(rms(out) / rms(slow)).toBeGreaterThan(0.99);
    let maxErr = 0;
    for (let i = 30; i < n - 30; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - slow[i]));
    expect(maxErr).toBeLessThan(0.02);
    const dc = lowpassZeroPhase(new Float64Array(n).fill(5), 6, fs);
    expect(dc[0]).toBeCloseTo(5, 6);
    expect(dc[n - 1]).toBeCloseTo(5, 6);
  });

  it("大幅衰減 12 Hz 雜訊", () => {
    expect(rms(lowpassZeroPhase(tone(12), 6, fs))).toBeLessThan(0.15 * rms(tone(12)));
  });

  it("NaN 區段分開處理，NaN 位置保持 NaN", () => {
    const values = Float64Array.from({ length: 60 }, (_, i) => (i === 30 ? NaN : 1));
    const out = lowpassZeroPhase(values, 6, fs);
    expect(Number.isNaN(out[30])).toBe(true);
    expect(out[10]).toBeCloseTo(1, 6);
  });
});

describe("峰值搜尋（§2.3）", () => {
  it("依突出度與最小間距篩選，平台取中點", () => {
    const signal = [0, 1, 0, 0.05, 0, 0, 2, 2, 2, 0, 0, 1.5, 0];
    expect(findPeaks(signal, { minDistance: 1, minProminence: 0.5 })).toEqual([1, 7, 11]);
    // 間距 ≥ 5：保留較高的峰
    expect(findPeaks(signal, { minDistance: 5, minProminence: 0.5 })).toEqual([1, 7]);
  });
  it("NaN 視為斷點", () => {
    expect(findPeaks([0, 1, NaN, 1, 0], { minDistance: 1, minProminence: 0.1 })).toEqual([]);
  });
  it("拋物線內插給出次幀偏移", () => {
    // y = −(x − 2.3)²：峰在 2.3
    const signal = [0, 1, 2, 3, 4].map((x) => -((x - 2.3) ** 2));
    expect(2 + parabolicOffset(signal, 2)).toBeCloseTo(2.3, 6);
    expect(parabolicOffset(signal, 0)).toBe(0);
  });
});
