/**
 * 這個檔案做什麼：測試「下載報告」關鍵畫面的時間點挑選（最優先問題的第一個時間點；沒有標記時挑中段最清楚的一格）。
 */

import { describe, expect, it } from "vitest";
import type { Landmark, PoseFrame } from "@/lib/gait/types";
import { pickKeyframe } from "./keyframe";
import type { ReplayMarker } from "./replay-markers";

const pose = (visibility: number): Landmark[] => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility }));

describe("pickKeyframe", () => {
  it("有標記時：用編號最前面問題的第一個時間點", () => {
    const markers: ReplayMarker[] = [
      { cardId: "knee_swing_flexion_low", markerNumber: 2, label: "膝蓋彎得較少", problem: "knee_flexion_abnormal", timeSec: 1.2 },
      { cardId: "hip_extension_deficit", markerNumber: 1, label: "後腳推蹬不足", problem: "hip_extension_deficit", timeSec: 5.5 },
      { cardId: "hip_extension_deficit", markerNumber: 1, label: "後腳推蹬不足", problem: "hip_extension_deficit", timeSec: 3.1 },
    ];
    expect(pickKeyframe([], markers)).toEqual({ timeSec: 3.1, problem: "hip_extension_deficit", caption: "1 後腳推蹬不足" });
  });

  it("沒有標記時：分析範圍中段、關節最清楚的一格", () => {
    const frames: PoseFrame[] = Array.from({ length: 100 }, (_, i) => ({
      frameIndex: i,
      timeSec: i / 30,
      landmarks: pose(i === 10 ? 1 : i === 60 ? 0.95 : 0.7),
    }));
    // 第 10 格最清楚但不在中段（25%–75%），所以選第 60 格
    expect(pickKeyframe(frames, [])).toEqual({ timeSec: 2, problem: null, caption: null });
  });

  it("整段偵測不到人：不產生關鍵畫面", () => {
    expect(pickKeyframe([{ frameIndex: 0, timeSec: 0, landmarks: null }], [])).toBeNull();
  });
});
