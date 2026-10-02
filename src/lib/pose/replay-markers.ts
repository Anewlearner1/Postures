/**
 * 這個檔案做什麼：
 *   骨架回放時間軸上要標示的東西（UX 文件 §4.6；只有計算，沒有畫面）：
 *   - 問題標記：每個問題出現的時間點（演算法 finding 的 timestampsSec，D38），用卡片編號 ①②③ 區分。
 *     演算法沒有提供時間點時就沒有標記（時間軸上不顯示）。
 *   - 偵測較不穩定的片段：連續偵測不到人、或腿部關節大多看不清楚的時段（灰色斜線底紋）。
 */

import type { AnalysisResult, PoseFrame, ProblemCode } from "@/lib/gait/types";
import { LANDMARK } from "@/lib/gait/types";
import { cardIdOf } from "@/lib/report/card-id";

export interface ReplayMarker {
  cardId: string;
  markerNumber: number;
  label: string;
  problem: ProblemCode;
  timeSec: number;
}

/** 依報告卡片（編號、白話名稱）與演算法的時間點，組出時間軸標記（依時間排序）。 */
export function buildReplayMarkers(
  result: AnalysisResult,
  cards: { id: string; markerNumber: number; plainName: string }[],
): ReplayMarker[] {
  const markers: ReplayMarker[] = [];
  for (const card of cards) {
    const finding = result.findings.find((item) => cardIdOf(item) === card.id);
    if (!finding) continue;
    for (const timeSec of finding.timestampsSec ?? []) {
      if (!Number.isFinite(timeSec) || timeSec < 0) continue;
      markers.push({
        cardId: card.id,
        markerNumber: card.markerNumber,
        label: card.plainName,
        problem: finding.problem,
        timeSec,
      });
    }
  }
  return markers.sort((a, b) => a.timeSec - b.timeSec);
}

const LEG_POINTS = [
  LANDMARK.leftHip,
  LANDMARK.rightHip,
  LANDMARK.leftKnee,
  LANDMARK.rightKnee,
  LANDMARK.leftAnkle,
  LANDMARK.rightAnkle,
];

/** 這一格是否「偵測不穩定」：沒偵測到人，或髖膝踝的平均 visibility < 0.5。 */
export function isUnstableFrame(frame: PoseFrame): boolean {
  if (!frame.landmarks) return true;
  const landmarks = frame.landmarks;
  const mean = LEG_POINTS.reduce((sum, index) => sum + (landmarks[index]?.visibility ?? 0), 0) / LEG_POINTS.length;
  return mean < 0.5;
}

/** 找出連續不穩定、且至少 minDurationSec 秒的時段。 */
export function unstableRanges(
  frames: PoseFrame[],
  fps: number,
  minDurationSec = 0.3,
): { startSec: number; endSec: number }[] {
  const ranges: { startSec: number; endSec: number }[] = [];
  const frameDuration = fps > 0 ? 1 / fps : 0;
  let start: number | null = null;
  let last = 0;
  for (const frame of frames) {
    if (isUnstableFrame(frame)) {
      if (start === null) start = frame.timeSec;
      last = frame.timeSec;
    } else if (start !== null) {
      ranges.push({ startSec: start, endSec: last + frameDuration });
      start = null;
    }
  }
  if (start !== null) ranges.push({ startSec: start, endSec: last + frameDuration });
  return ranges.filter((range) => range.endSec - range.startSec >= minDurationSec - 1e-9);
}
