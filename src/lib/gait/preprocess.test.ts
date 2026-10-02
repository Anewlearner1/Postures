/**
 * 前處理的測試：像素座標轉換（§0.2）、掉幀格點化、缺口內插（§1.2）、左右錯置修正（§1.3）。
 */
import { describe, expect, it } from "vitest";
import { LANDMARK, type Landmark, type PoseFrame } from "./types";
import { buildTrack, estimateFps } from "./preprocess";
import { generateWalk } from "./testing/synthetic";

function frameWith(index: number, fps: number, overrides: Record<number, Partial<Landmark>> = {}): PoseFrame {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  for (const [i, value] of Object.entries(overrides)) landmarks[Number(i)] = { ...landmarks[Number(i)], ...value };
  return { frameIndex: index, timeSec: index / fps, landmarks };
}

describe("座標轉換與格點化", () => {
  it("正規化座標乘上寬、高變成像素（非正方形影片，§0.2）", () => {
    const frames = [0, 1, 2].map((i) => frameWith(i, 30, { [LANDMARK.leftKnee]: { x: 0.25, y: 0.5 } }));
    const track = buildTrack(frames, { fps: 30, width: 1920, height: 1080 });
    expect(track.side.left.knee.rawX[1]).toBeCloseTo(480);
    expect(track.side.left.knee.rawY[1]).toBeCloseTo(540);
  });

  it("visibility < 0.5 視為缺值（§1.2）", () => {
    const frames = [0, 1, 2].map((i) => frameWith(i, 30, { [LANDMARK.leftKnee]: { visibility: 0.4 } }));
    const track = buildTrack(frames, { fps: 30, width: 100, height: 100 });
    expect(Number.isNaN(track.side.left.knee.rawX[1])).toBe(true);
    expect(track.side.left.knee.vis[1]).toBeCloseTo(0.4);
  });

  it("掉幀的位置變成缺值，短缺口（≤ 0.12 秒）會內插、長缺口不補", () => {
    const keep = [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
    const frames = keep.map((i) => frameWith(i, 30, { [LANDMARK.leftKnee]: { x: i / 100 } }));
    const track = buildTrack(frames, { fps: 30, width: 100, height: 100 });
    expect(track.n).toBe(26);
    expect(track.hasFrame[4]).toBe(0);
    expect(track.side.left.knee.interp[4]).toBe(1);
    expect(track.side.left.knee.X[4]).toBeCloseTo(4, 0);
    expect(track.side.left.knee.interp[13]).toBe(0); // 5 格（0.17 秒）缺口不補（30 fps 上限 4 格）
    expect(Number.isNaN(track.side.left.knee.X[13])).toBe(true);
  });

  it("有效影格率由時間戳推得（中位數間隔）", () => {
    const frames = [0, 1, 2, 4, 5, 6].map((i) => frameWith(i, 20));
    expect(estimateFps(frames, 30)).toBeCloseTo(20);
    expect(estimateFps([], 30)).toBe(30);
  });

  it("影格順序打亂或重複不影響結果", () => {
    const sim = generateWalk({ seed: 2 });
    const shuffled = [...sim.frames].reverse();
    shuffled.push(sim.frames[10]);
    const a = buildTrack(sim.frames, sim.meta);
    const b = buildTrack(shuffled, sim.meta);
    expect(b.n).toBe(a.n);
    expect(Array.from(b.side.right.ankle.X.slice(0, 50))).toEqual(Array.from(a.side.right.ankle.X.slice(0, 50)));
  });
});

describe("左右錯置修正（§1.3）", () => {
  it.each([0.04, 0.1])("注入 %s 的錯置影格，修正後位置與未錯置的資料一致", (fraction) => {
    const clean = generateWalk({ seed: 5, noisePx: 1.5 });
    const dirty = generateWalk({ seed: 5, noisePx: 1.5, swapFraction: fraction });
    const a = buildTrack(clean.frames, clean.meta);
    const b = buildTrack(dirty.frames, dirty.meta);
    // 錯置比例被正確估計（容許兩腳交會時無法分辨的少數影格）
    expect(b.swapFraction).toBeGreaterThan(fraction * 0.7);
    expect(b.swapFraction).toBeLessThan(fraction * 1.3 + 0.01);
    expect(a.swapFraction).toBeLessThan(0.01);
    let maxDiff = 0;
    for (let k = 0; k < a.n; k++) {
      const diff = Math.abs(a.side.right.ankle.rawX[k] - b.side.right.ankle.rawX[k]);
      if (Number.isFinite(diff)) maxDiff = Math.max(maxDiff, diff);
    }
    // 兩腳交會（距離很近）時即使沒交換也只差幾個像素
    expect(maxDiff).toBeLessThan(25);
  });
});
