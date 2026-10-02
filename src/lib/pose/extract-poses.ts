/**
 * 這個檔案做什麼：
 *   逐格讀取影片並偵測骨架，輸出 PoseSequence（型別見 src/lib/gait/types.ts）。只能在瀏覽器中使用。
 *
 *   做法：用一個 <video> 依分析計畫逐格「跳到」每個時間點（seek），把畫面縮小複製一份，
 *   交給背景執行的偵測器（pose.worker.ts）。偵測器處理這一格時，主畫面同時去準備下一格，
 *   讓兩邊都不閒著。每一格都記錄時間戳；可以回報進度、可以取消（AbortSignal）。
 *
 *   影片只在這台裝置的記憶體中處理，不會上傳。
 */

import type { PoseFrame, PoseSequence } from "@/lib/gait/types";
import { MAX_INPUT_LONG_SIDE } from "./mediapipe-config";
import type { PoseDetectorLike } from "./pose-detector";
import { frameSamples, type AnalysisPlan } from "./preflight";

export interface ExtractProgress {
  done: number;
  total: number;
  frame: PoseFrame;
}

export interface ExtractOptions {
  /** 已設定好 src 的 <video>（可以不顯示在畫面上）。 */
  video: HTMLVideoElement;
  plan: AnalysisPlan;
  detector: PoseDetectorLike;
  signal?: AbortSignal;
  onProgress?: (progress: ExtractProgress) => void;
  /** 每一格畫面準備好時呼叫（給「分析中」頁畫預覽；畫面送去偵測後就會被釋放）。 */
  onPreviewFrame?: (canvas: HTMLCanvasElement) => void;
  /** 每一格開始前呼叫；例如頁面被切到背景時，回傳一個等到回到前景才完成的 Promise。 */
  beforeFrame?: () => Promise<void> | void;
}

export interface ExtractStats {
  totalMs: number;
  framesPerSecond: number;
  avgInferenceMs: number;
  avgPrepareMs: number;
}

const SEEK_TIMEOUT_MS = 8_000;

function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}

/** 跳到指定時間，等畫面準備好。 */
function seek(video: HTMLVideoElement, timeSec: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error(`seek timeout at ${timeSec.toFixed(3)}s`)), SEEK_TIMEOUT_MS);
    function finish(error?: Error) {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    }
    function onSeeked() {
      finish();
    }
    function onError() {
      finish(new Error(`video error ${video.error?.code ?? "?"}`));
    }
    function onAbort() {
      finish(abortError() as unknown as Error);
    }
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort);
    video.currentTime = timeSec;
  });
}

/** 等 <video> 至少讀到 metadata。 */
export function waitForVideoReady(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    function cleanup() {
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    }
    function onReady() {
      cleanup();
      resolve();
    }
    function onError() {
      cleanup();
      reject(new Error(`video error ${video.error?.code ?? "?"}`));
    }
    function onAbort() {
      cleanup();
      reject(abortError());
    }
    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort);
  });
}

export async function extractPoses(options: ExtractOptions): Promise<{ sequence: PoseSequence; stats: ExtractStats }> {
  const { video, plan, detector, signal } = options;
  await waitForVideoReady(video, signal);

  const width = video.videoWidth;
  const height = video.videoHeight;
  const scale = Math.min(1, MAX_INPUT_LONG_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("canvas 2d unavailable");

  const samples = frameSamples(plan);
  const frames: PoseFrame[] = [];
  const started = performance.now();
  let inferenceTotal = 0;
  let prepareTotal = 0;
  let lastTimestampMs = -1;

  let pending: { promise: Promise<{ landmarks: PoseFrame["landmarks"]; inferenceMs: number }>; sampleIndex: number } | null =
    null;

  async function collect() {
    if (!pending) return;
    const { landmarks, inferenceMs } = await pending.promise;
    const sample = samples[pending.sampleIndex];
    pending = null;
    inferenceTotal += inferenceMs;
    const frame: PoseFrame = { frameIndex: sample.index, timeSec: sample.timeSec, landmarks };
    frames.push(frame);
    options.onProgress?.({ done: frames.length, total: samples.length, frame });
  }

  try {
    for (let i = 0; i < samples.length; i += 1) {
      if (signal?.aborted) throw abortError();
      await options.beforeFrame?.();

      const prepareStart = performance.now();
      await seek(video, Math.min(samples[i].seekSec, Math.max(0, video.duration - 0.001)), signal);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      options.onPreviewFrame?.(canvas);
      const bitmap = await createImageBitmap(canvas);
      prepareTotal += performance.now() - prepareStart;

      // 上一格的偵測結果先收回來，再送出這一格（同時只有一格在偵測中）
      await collect();
      if (signal?.aborted) {
        bitmap.close();
        throw abortError();
      }

      // MediaPipe VIDEO 模式要求時間戳嚴格遞增（毫秒）
      const timestampMs = Math.max(lastTimestampMs + 1, Math.round(samples[i].timeSec * 1000));
      lastTimestampMs = timestampMs;
      pending = { promise: detector.detect(bitmap, timestampMs), sampleIndex: i };
    }
    await collect();
  } catch (error) {
    // 取消或出錯時，等正在偵測的那一格結束（避免未處理的 Promise 錯誤）
    if (pending) await pending.promise.catch(() => undefined);
    throw error;
  }

  const totalMs = performance.now() - started;
  return {
    sequence: {
      frames,
      fps: plan.effectiveFps,
      videoWidth: width,
      videoHeight: height,
      durationSec: plan.untilSec,
    },
    stats: {
      totalMs,
      framesPerSecond: frames.length / (totalMs / 1000),
      avgInferenceMs: inferenceTotal / Math.max(1, frames.length),
      avgPrepareMs: prepareTotal / Math.max(1, frames.length),
    },
  };
}
