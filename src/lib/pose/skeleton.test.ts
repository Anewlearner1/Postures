/**
 * 這個檔案做什麼：測試骨架回放的計算：近側判斷、依時間找影格、影片在畫布中的顯示範圍、問題對應關節、
 * 時間軸標記與「偵測較不穩定」片段。
 */

import { describe, expect, it } from "vitest";
import { SAMPLE_ANALYSIS } from "@/data/sample-analysis";
import { LANDMARK, type Landmark, type PoseFrame } from "@/lib/gait/types";
import { buildReplayMarkers, unstableRanges } from "./replay-markers";
import { containRect, frameIndexAt, highlightJoints, nearSides, nearSideScore } from "./skeleton";

function pose(nearSide: "left" | "right", visibility = 0.95): Landmark[] {
  return Array.from({ length: 33 }, (_, index) => {
    const isLeft = index % 2 === 1; // MediaPipe：奇數編號是左側
    const near = (nearSide === "left") === isLeft;
    return { x: 0.5, y: 0.5, z: near ? -0.1 : 0.1, visibility: near ? visibility : visibility * 0.4 };
  });
}

const frame = (i: number, landmarks: Landmark[] | null, fps = 30): PoseFrame => ({ frameIndex: i, timeSec: i / fps, landmarks });

describe("近側判斷", () => {
  it("visibility 較高的一側是近側", () => {
    expect(nearSideScore(pose("right"))).toBeGreaterThan(0);
    expect(nearSideScore(pose("left"))).toBeLessThan(0);
    expect(nearSideScore(null)).toBeNull();
  });

  it("前後平滑：單一格判斷錯誤不會讓顏色跳動", () => {
    const frames = Array.from({ length: 20 }, (_, i) => frame(i, i === 10 ? pose("left") : pose("right")));
    expect(nearSides(frames)[10]).toBe("right");
  });

  it("偵測不到人的格子沿用附近的判斷；全部偵測不到時為 null", () => {
    const frames = [frame(0, pose("left")), frame(1, null), frame(2, pose("left"))];
    expect(nearSides(frames)).toEqual(["left", "left", "left"]);
    expect(nearSides([frame(0, null)])).toEqual([null]);
  });
});

describe("frameIndexAt", () => {
  const frames = Array.from({ length: 30 }, (_, i) => frame(i, null));
  it("找最接近的影格", () => {
    expect(frameIndexAt(frames, 0.5, 0.05)).toBe(15);
    expect(frameIndexAt(frames, 0.51, 0.05)).toBe(15);
    expect(frameIndexAt(frames, 0, 0.05)).toBe(0);
  });
  it("超出分析範圍時回傳 -1（例如只分析了前 20 秒）", () => {
    expect(frameIndexAt(frames, 5, 0.05)).toBe(-1);
    expect(frameIndexAt([], 0, 1)).toBe(-1);
  });
});

describe("containRect", () => {
  it("橫式影片放進直式框：上下留黑邊", () => {
    expect(containRect(400, 400, 1920, 1080)).toEqual({ x: 0, y: 87.5, width: 400, height: 225 });
  });
  it("直式影片放進橫式框：左右留黑邊", () => {
    expect(containRect(1600, 900, 1080, 1920)).toMatchObject({ y: 0, height: 900 });
  });
});

describe("highlightJoints", () => {
  it("依問題與近側選關節", () => {
    expect(highlightJoints("hip_extension_deficit", "right")).toEqual([LANDMARK.rightHip]);
    expect(highlightJoints("knee_flexion_abnormal", "left")).toEqual([LANDMARK.leftKnee]);
    expect(highlightJoints("trunk_head_forward_lean", "left")).toEqual([LANDMARK.leftShoulder, LANDMARK.leftHip]);
  });
});

describe("buildReplayMarkers", () => {
  it("依卡片編號與演算法的時間點組出標記，依時間排序", () => {
    const markers = buildReplayMarkers(SAMPLE_ANALYSIS, [
      { id: "hip_extension_deficit", markerNumber: 1, plainName: "後腳推蹬不足" },
      { id: "knee_swing_flexion_low", markerNumber: 2, plainName: "膝蓋彎得較少" },
    ]);
    expect(markers.map((m) => m.timeSec)).toEqual([3.1, 4.2, 8.2, 9.1, 10.4, 11.5, 12.0]);
    expect(markers[0]).toMatchObject({ markerNumber: 1, label: "後腳推蹬不足", problem: "hip_extension_deficit" });
  });

  it("演算法沒有提供時間點時沒有標記", () => {
    const result = { ...SAMPLE_ANALYSIS, findings: SAMPLE_ANALYSIS.findings.map((f) => ({ ...f, timestampsSec: undefined })) };
    expect(buildReplayMarkers(result, [{ id: "hip_extension_deficit", markerNumber: 1, plainName: "x" }])).toEqual([]);
  });
});

describe("unstableRanges", () => {
  it("連續偵測不到人至少 0.3 秒才標示", () => {
    const frames = Array.from({ length: 60 }, (_, i) => frame(i, i >= 20 && i < 35 ? null : pose("right")));
    frames[50] = frame(50, null); // 單一格不算
    expect(unstableRanges(frames, 30)).toEqual([{ startSec: 20 / 30, endSec: 35 / 30 }]);
  });

  it("腿部關節大多看不清楚也算不穩定", () => {
    const frames = Array.from({ length: 30 }, (_, i) => frame(i, pose("right", 0.3)));
    expect(unstableRanges(frames, 30)).toHaveLength(1);
  });
});
