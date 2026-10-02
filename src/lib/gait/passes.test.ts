/**
 * 直線段切割、轉身排除、近側判定、roll 估計的測試（gait-rules.md §2.2、§1.4、§1.5）。
 */
import { describe, expect, it } from "vitest";
import { buildTrack } from "./preprocess";
import { detectPasses, legLength } from "./passes";
import { generateWalk, type SyntheticOptions } from "./testing/synthetic";

function passesFor(options: SyntheticOptions) {
  const sim = generateWalk(options);
  const track = buildTrack(sim.frames, sim.meta);
  const L = legLength(track);
  return { sim, track, L, passes: detectPasses(track, L) };
}

describe("直線段與轉身（§2.2）", () => {
  it("來回走 4 趟：切出 4 段、方向交替、每段都落在真值的行走區間內", () => {
    const { sim, passes } = passesFor({ passes: 4, noisePx: 2 });
    expect(passes.map((p) => p.direction)).toEqual([1, -1, 1, -1]);
    passes.forEach((pass, i) => {
      // 直線段在「加速開始 → 減速結束」之間（真值巡航區間前後各 0.5 秒加減速）
      expect(pass.startSec).toBeGreaterThanOrEqual(sim.truth.passes[i].startSec - 0.5);
      expect(pass.endSec).toBeLessThanOrEqual(sim.truth.passes[i].endSec + 0.5);
      expect(pass.endSec - pass.startSec).toBeGreaterThan(2.5);
    });
  });

  it("轉身段完全被排除", () => {
    const { sim, passes } = passesFor({ passes: 3, noisePx: 2 });
    for (const turn of sim.truth.turns) {
      for (const pass of passes) {
        const overlap = Math.min(pass.endSec, turn.endSec) - Math.max(pass.startSec, turn.startSec);
        expect(overlap).toBeLessThanOrEqual(0);
      }
    }
  });

  it("站著不動時沒有直線段", () => {
    const { passes } = passesFor({ passes: 1, speedMps: 0, walkwayM: 0, standSec: 4 });
    expect(passes).toHaveLength(0);
  });

  it("腿長 L 約等於真實腿長的像素數", () => {
    const { sim, L } = passesFor({});
    const expectedPx = (sim.truth.legLengthM * 1400) / 4;
    expect(L / expectedPx).toBeGreaterThan(0.95);
    expect(L / expectedPx).toBeLessThan(1.05);
  });
});

describe("近側判定（§1.4）", () => {
  it.each([1, -1] as const)("第一趟方向 %s：往右走右側近、往左走左側近，visibility 與 z 一致", (startDirection) => {
    const { passes } = passesFor({ passes: 2, startDirection });
    for (const pass of passes) {
      expect(pass.nearSide).toBe(pass.direction === 1 ? "right" : "left");
      expect(pass.nearSideAgreement).toBe(true);
    }
  });
});

describe("鏡頭 roll 估計（§1.5）", () => {
  it.each([0, 5, -7, 10])("roll %s° 估計誤差 < 0.5°", (rollDeg) => {
    const { passes } = passesFor({ passes: 2, rollDeg, noisePx: 2 });
    for (const pass of passes) expect(Math.abs(pass.rollDeg - rollDeg)).toBeLessThan(0.5);
  });

  it("正側面拍攝的髖寬比小、腿長變化小；鏡頭偏 20° 時腿長變化大（angle_off）", () => {
    const side = passesFor({ passes: 2 }).passes;
    expect(side.every((p) => p.hipWidthRatio < 0.15 && p.legLengthVariation < 0.1)).toBe(true);
    const yawed = passesFor({ passes: 2, walkwayYawDeg: 20 }).passes;
    expect(yawed.every((p) => p.legLengthVariation > 0.2)).toBe(true);
  });
});
