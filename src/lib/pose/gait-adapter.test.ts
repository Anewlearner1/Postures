/**
 * 這個檔案做什麼：測試前端與步態分析核心的接口（gait-adapter）：
 *   載入的是演算法的 analyzeGait，前端組出的影片資訊格式對方收得下，底線規則（D13）照常運作。
 */

import { describe, expect, it } from "vitest";
import { analyzeGait } from "@/lib/gait/analyze";
import type { PoseFrame } from "@/lib/gait/types";
import { loadAnalyzeGait } from "./gait-adapter";

describe("loadAnalyzeGait", () => {
  it("載入演算法的 analyzeGait", async () => {
    await expect(loadAnalyzeGait()).resolves.toBe(analyzeGait);
  });

  it("整段偵測不到人 → 請重拍（不會產生假的分析結果）", async () => {
    const analyze = await loadAnalyzeGait();
    const frames: PoseFrame[] = Array.from({ length: 300 }, (_, i) => ({ frameIndex: i, timeSec: i / 30, landmarks: null }));
    const outcome = analyze(frames, { fps: 30, width: 1920, height: 1080, durationSec: 10 }, { populationCaveat: false });
    expect(outcome).toMatchObject({ status: "rejected", code: "no_person" });
  });

  it("影片太短 → too_short（與前端前置檢查一致）", async () => {
    const analyze = await loadAnalyzeGait();
    const frames: PoseFrame[] = Array.from({ length: 120 }, (_, i) => ({ frameIndex: i, timeSec: i / 30, landmarks: null }));
    const outcome = analyze(frames, { fps: 30, width: 1920, height: 1080, durationSec: 4 });
    expect(outcome).toMatchObject({ status: "rejected", code: "too_short" });
  });
});
