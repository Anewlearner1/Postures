/**
 * 角度正負號的單元測試（gait-rules.md §0.4、§0.5、§5.2）。影像 Y 軸向下。
 */
import { describe, expect, it } from "vitest";
import { hipAngle, kneeAngle, segmentAngleDown, segmentAngleUp } from "./angles";

describe("節段角（§0.4）", () => {
  it("往右走（d = +1）：膝在髖前方（右邊）為正", () => {
    expect(segmentAngleDown(1, 0, 0, 10, 100)).toBeCloseTo(5.71, 2);
    expect(segmentAngleDown(1, 0, 0, -10, 100)).toBeCloseTo(-5.71, 2);
    expect(segmentAngleDown(1, 0, 0, 0, 100)).toBe(0);
  });
  it("往左走（d = −1）：同樣的姿勢鏡像後角度相同", () => {
    expect(segmentAngleDown(-1, 0, 0, -10, 100)).toBeCloseTo(segmentAngleDown(1, 0, 0, 10, 100), 10);
  });
  it("軀幹（向上節段）：肩在髖前方為前傾（正）", () => {
    // 髖在 (0, 100)，肩在 (10, 0)：往右走時前傾
    expect(segmentAngleUp(1, 0, 100, 10, 0)).toBeCloseTo(5.71, 2);
    expect(segmentAngleUp(-1, 0, 100, 10, 0)).toBeCloseTo(-5.71, 2);
  });
});

describe("關節角（§0.5 驗算）", () => {
  it("站直：髖角 0、膝角 0", () => {
    expect(hipAngle(0, 0)).toBe(0);
    expect(kneeAngle(0, 0)).toBe(0);
  });
  it("軀幹前傾 10°、大腿垂直 → 髖屈曲 +10°", () => {
    expect(hipAngle(0, 10)).toBe(10);
  });
  it("大腿在身體後方 15°、軀幹垂直 → 髖伸展 −15°（PHE = 15）", () => {
    expect(hipAngle(-15, 0)).toBe(-15);
  });
  it("膝屈曲為正：大腿往前 20°、小腿往後 30° → 膝屈曲 50°；小腿比大腿更前 → 過伸為負", () => {
    expect(kneeAngle(20, -30)).toBe(50);
    expect(kneeAngle(10, 15)).toBe(-5);
  });
  it("像素座標算出的膝角：擺盪期膝屈曲 60°", () => {
    const d = 1;
    const hip = [0, 0];
    const knee = [Math.sin((20 * Math.PI) / 180) * 100, Math.cos((20 * Math.PI) / 180) * 100];
    const ankle = [knee[0] + Math.sin((-40 * Math.PI) / 180) * 100, knee[1] + Math.cos((-40 * Math.PI) / 180) * 100];
    const thigh = segmentAngleDown(d, hip[0], hip[1], knee[0], knee[1]);
    const shank = segmentAngleDown(d, knee[0], knee[1], ankle[0], ankle[1]);
    expect(kneeAngle(thigh, shank)).toBeCloseTo(60, 6);
  });
});
