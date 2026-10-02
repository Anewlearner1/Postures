/**
 * 這個檔案做什麼：測試「播放取格」時，播放時間（mediaTime）如何對應到要分析的格子（含 60 fps 隔格取樣）。
 * 實際逐格讀取影片需要瀏覽器，由 e2e 測試（e2e/upload-flow.spec.ts）涵蓋。
 */

import { describe, expect, it } from "vitest";
import { sampleIndexForMediaTime } from "./extract-poses";
import { evaluateVideo, frameSamples, type VideoMeta } from "./preflight";

function planFor(fps: number, durationSec = 10) {
  const meta: VideoMeta = { durationSec, width: 1920, height: 1080, fps, fpsSource: "container" };
  const result = evaluateVideo(meta);
  if (!result.ok) throw new Error("expected ok");
  return { plan: result.plan, samples: frameSamples(result.plan) };
}

describe("sampleIndexForMediaTime", () => {
  it("30 fps：每一格都對應到一個取樣格", () => {
    const { plan, samples } = planFor(30);
    expect(sampleIndexForMediaTime(0, plan, samples)).toBe(0);
    expect(sampleIndexForMediaTime(1 / 30, plan, samples)).toBe(1);
    expect(sampleIndexForMediaTime(2.5, plan, samples)).toBe(75);
  });

  it("60 fps 隔格取樣：奇數格不取（回傳 -1）", () => {
    const { plan, samples } = planFor(60);
    expect(sampleIndexForMediaTime(2 / 60, plan, samples)).toBe(1);
    expect(sampleIndexForMediaTime(3 / 60, plan, samples)).toBe(-1);
  });

  it("超過分析範圍時回傳格數（代表已經結束）", () => {
    const { plan, samples } = planFor(30, 45); // 太長：只分析前 20 秒
    expect(sampleIndexForMediaTime(25, plan, samples)).toBe(samples.length);
  });
});
