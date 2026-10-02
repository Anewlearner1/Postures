/**
 * 這個檔案做什麼：
 *   產生「下載報告」用的一張關鍵畫面（D21、D43）：從使用者的影片（本機 blob: 網址）取一格，
 *   疊上骨架與問題關節的圓圈，轉成圖片（data: 網址）。只在這台裝置上產生，不上傳。
 *   - pickKeyframe()：挑時間點（純函式，可測試）
 *   - captureKeyframe()：真的取畫面（只能在瀏覽器中使用）
 */

import type { PoseFrame, PoseSequence, ProblemCode } from "@/lib/gait/types";
import type { ReplayMarker } from "./replay-markers";
import { containRect, drawSkeleton, frameIndexAt, highlightJoints, nearSides } from "./skeleton";

export interface KeyframeChoice {
  timeSec: number;
  /** 要標示的問題（決定畫圓圈的關節）；沒有問題時為 null。 */
  problem: ProblemCode | null;
  /** 圖說用的卡片編號與名稱。 */
  caption: string | null;
}

function meanVisibility(frame: PoseFrame): number {
  if (!frame.landmarks) return 0;
  return frame.landmarks.reduce((sum, point) => sum + point.visibility, 0) / frame.landmarks.length;
}

/**
 * 挑關鍵畫面：有問題標記時，用編號最前面（最優先）問題的第一個時間點；
 * 沒有標記時，用分析範圍中段、關節最清楚（平均 visibility 最高）的一格。
 */
export function pickKeyframe(frames: PoseFrame[], markers: ReplayMarker[]): KeyframeChoice | null {
  if (markers.length > 0) {
    const top = [...markers].sort((a, b) => a.markerNumber - b.markerNumber || a.timeSec - b.timeSec)[0];
    return { timeSec: top.timeSec, problem: top.problem, caption: `${top.markerNumber} ${top.label}` };
  }
  const detected = frames.filter((frame) => frame.landmarks);
  if (detected.length === 0) return null;
  const from = Math.floor(detected.length * 0.25);
  const to = Math.max(from + 1, Math.ceil(detected.length * 0.75));
  let best = detected[from];
  for (const frame of detected.slice(from, to)) {
    if (meanVisibility(frame) > meanVisibility(best)) best = frame;
  }
  return { timeSec: best.timeSec, problem: null, caption: null };
}

const CAPTURE_TIMEOUT_MS = 10_000;

function once(target: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${event} timeout`)), CAPTURE_TIMEOUT_MS);
    target.addEventListener(
      event,
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    target.addEventListener("error", () => reject(new Error("video error")), { once: true });
  });
}

/** 取一格畫面並疊上骨架，回傳 JPEG 的 data: 網址；失敗時回傳 null（報告照常列印，只是沒有圖）。 */
export async function captureKeyframe(
  videoUrl: string,
  poses: PoseSequence,
  choice: KeyframeChoice,
  maxWidth = 720,
): Promise<string | null> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    const loaded = once(video, "loadeddata");
    video.src = videoUrl;
    await loaded;
    const seeked = once(video, "seeked");
    video.currentTime = Math.min(choice.timeSec, Math.max(0, video.duration - 0.05));
    await seeked;

    const scale = Math.min(1, maxWidth / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const index = frameIndexAt(poses.frames, choice.timeSec, 1.5 / Math.max(1, poses.fps));
    const landmarks = index >= 0 ? poses.frames[index].landmarks : null;
    if (landmarks) {
      const nearSide = nearSides(poses.frames)[index];
      drawSkeleton(ctx, landmarks, {
        rect: containRect(canvas.width, canvas.height, canvas.width, canvas.height),
        nearSide,
        scale: Math.max(0.8, canvas.width / 640),
        highlight: choice.problem ? { joints: highlightJoints(choice.problem, nearSide), pulse: 0.6 } : null,
      });
    }
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
