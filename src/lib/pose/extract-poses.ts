/**
 * 這個檔案做什麼：
 *   逐格讀取影片並偵測骨架，輸出 PoseSequence（型別見 src/lib/gait/types.ts）。只能在瀏覽器中使用。
 *
 *   做法（兩段式，確保每一個要分析的影格都拿得到、時間戳嚴格遞增）：
 *   1. 播放取格：把影片靜音、慢速（0.5x）播放，每當畫面換到下一格（requestVideoFrameCallback）
 *      就把畫面縮小複製一份，交給背景執行的偵測器（pose.worker.ts）。偵測器來不及時先暫停影片等它。
 *      播放時解碼器按順序往下解，比每格都「跳轉」快很多（1080p 影片實測快 3–5 倍）。
 *   2. 跳轉補格：播放中漏掉的格子（例如手機一時忙不過來），或瀏覽器不支援播放取格時，
 *      改用「跳到指定時間（seek）→ 取畫面」逐格補齊。
 *   每一格都記錄時間戳；可以回報進度、可以取消（AbortSignal）。
 *
 *   影片只在這台裝置的記憶體中處理，不會上傳。
 */

import type { PoseFrame, PoseSequence } from "@/lib/gait/types";
import { MAX_INPUT_LONG_SIDE } from "./mediapipe-config";
import type { DetectionResult, PoseDetectorLike } from "./pose-detector";
import { frameSamples, type AnalysisPlan, type FrameSample } from "./preflight";

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
  /** 頁面被切到背景時，回傳一個等到回到前景才完成的 Promise（其他時候回傳 undefined）。 */
  waitUntilVisible?: () => Promise<void> | void;
  /** 測試或除錯用：強制只用跳轉逐格。 */
  forceSeek?: boolean;
}

export interface ExtractStats {
  totalMs: number;
  framesPerSecond: number;
  avgInferenceMs: number;
  /** 播放取得的格數與跳轉補上的格數。 */
  playedFrames: number;
  seekedFrames: number;
}

/** 播放取格的起始速度；之後依偵測速度自動調整（0.1x–1x），偵測器來不及時也會暫停等待。 */
const INITIAL_PLAYBACK_RATE = 0.5;
const MIN_PLAYBACK_RATE = 0.1;
const MAX_PLAYBACK_RATE = 1;
/** 同時送去偵測、還沒回來的格數上限；超過就先暫停影片。 */
const MAX_IN_FLIGHT = 2;
/** 播放中超過這麼久沒有新畫面，就放棄播放取格，改用跳轉補完。 */
const STALL_MS = 4000;
const SEEK_TIMEOUT_MS = 8000;

function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}

/** 跳到指定時間，等畫面準備好。 */
function seek(video: HTMLVideoElement, timeSec: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error(`seek timeout at ${timeSec.toFixed(3)}s`)), SEEK_TIMEOUT_MS);
    function finish(error?: Error | DOMException) {
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
      finish(abortError());
    }
    if (signal?.aborted) return onAbort();
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort);
    video.currentTime = Math.min(timeSec, Math.max(0, video.duration - 0.001));
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

/**
 * 某個播放時間（mediaTime）對應到第幾個取樣格；不是要取的格子（例如 60 fps 隔格取樣的那一格）回傳 -1。
 * 純函式，給測試使用。
 */
export function sampleIndexForMediaTime(mediaTime: number, plan: AnalysisPlan, samples: FrameSample[]): number {
  const index = Math.round(mediaTime * plan.effectiveFps);
  if (index < 0 || index >= samples.length) return index >= samples.length ? samples.length : -1;
  return Math.abs(mediaTime - samples[index].timeSec) <= 0.5 / plan.sourceFps ? index : -1;
}

/**
 * 「送去偵測」的管線：依格子編號由小到大送出（MediaPipe VIDEO 模式要求時間戳遞增），
 * 收回結果、回報進度，並限制同時在偵測中的格數。
 */
class DetectionSink {
  nextIndex = 0;
  readonly frames: PoseFrame[] = [];
  inferenceTotal = 0;
  private inFlight = 0;
  private lastTimestampMs = -1;
  private waiters: (() => void)[] = [];
  private failure: unknown = null;
  private readonly pending: Promise<void>[] = [];

  constructor(
    private readonly detector: PoseDetectorLike,
    private readonly samples: FrameSample[],
    private readonly canvas: HTMLCanvasElement,
    private readonly context: CanvasRenderingContext2D,
    private readonly video: HTMLVideoElement,
    private readonly onProgress?: (progress: ExtractProgress) => void,
    private readonly onPreviewFrame?: (canvas: HTMLCanvasElement) => void,
  ) {}

  get busy(): number {
    return this.inFlight;
  }

  /** 目前平均每格偵測花多少毫秒（還沒有資料時為 null）。 */
  get avgInferenceMs(): number | null {
    return this.frames.length >= 5 ? this.inferenceTotal / this.frames.length : null;
  }

  /** 把 <video> 目前的畫面複製下來（同步完成，之後畫面換掉也不影響）。 */
  capture(): Promise<ImageBitmap> {
    this.context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    this.onPreviewFrame?.(this.canvas);
    return createImageBitmap(this.canvas);
  }

  /** 送出第 nextIndex 格。 */
  submit(bitmap: Promise<ImageBitmap>) {
    if (this.failure) throw this.failure;
    const sample = this.samples[this.nextIndex];
    this.nextIndex += 1;
    this.inFlight += 1;
    // MediaPipe VIDEO 模式要求時間戳（毫秒）嚴格遞增
    const timestampMs = Math.max(this.lastTimestampMs + 1, Math.round(sample.timeSec * 1000));
    this.lastTimestampMs = timestampMs;
    const task = bitmap
      .then((image) => this.detector.detect(image, timestampMs))
      .then((result: DetectionResult) => {
        this.inferenceTotal += result.inferenceMs;
        const frame: PoseFrame = { frameIndex: sample.index, timeSec: sample.timeSec, landmarks: result.landmarks };
        this.frames.push(frame);
        this.onProgress?.({ done: this.frames.length, total: this.samples.length, frame });
      })
      .catch((error: unknown) => {
        this.failure ??= error;
      })
      .finally(() => {
        this.inFlight -= 1;
        const waiters = this.waiters;
        this.waiters = [];
        waiters.forEach((wake) => wake());
      });
    this.pending.push(task);
  }

  /** 等到偵測中的格數少於 limit。 */
  async waitBelow(limit: number): Promise<void> {
    while (this.inFlight >= limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    if (this.failure) throw this.failure;
  }

  async drain(): Promise<void> {
    await Promise.all(this.pending);
    if (this.failure) throw this.failure;
    this.frames.sort((a, b) => a.frameIndex - b.frameIndex);
  }
}

/** 第 1 段：播放取格。回傳後，sink.nextIndex 之前的格子都已送出。 */
async function playPass(
  video: HTMLVideoElement,
  plan: AnalysisPlan,
  samples: FrameSample[],
  sink: DetectionSink,
  options: ExtractOptions,
): Promise<{ played: number; filled: number }> {
  const { signal } = options;
  let played = 0;
  let filled = 0;
  await seek(video, samples[0].seekSec, signal);
  setRate(INITIAL_PLAYBACK_RATE);

  function setRate(rate: number) {
    video.playbackRate = rate;
    video.defaultPlaybackRate = rate;
  }

  /** 依偵測速度調整播放速度：讓「畫面換格的間隔」略大於每格偵測時間，減少暫停。 */
  function adaptRate() {
    const avg = sink.avgInferenceMs;
    if (avg === null) return;
    const ideal = plan.frameStep / (plan.sourceFps * (avg / 1000) * 1.15);
    const rate = Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, ideal));
    if (Math.abs(rate - video.playbackRate) / video.playbackRate > 0.1) setRate(rate);
  }

  await new Promise<void>((resolve, reject) => {
    let finished = false;
    let lastFrameAt = performance.now();
    let pausedByUs = false;

    const watchdog = window.setInterval(() => {
      if (!pausedByUs && performance.now() - lastFrameAt > STALL_MS) finish();
    }, 500);

    function finish(error?: unknown) {
      if (finished) return;
      finished = true;
      window.clearInterval(watchdog);
      video.removeEventListener("ended", onEnded);
      signal?.removeEventListener("abort", onAbort);
      video.pause();
      if (error) reject(error);
      else resolve();
    }
    function onEnded() {
      finish();
    }
    function onAbort() {
      finish(abortError());
    }

    async function resume() {
      if (finished) return;
      video.requestVideoFrameCallback(onFrame);
      pausedByUs = false;
      lastFrameAt = performance.now();
      await video.play();
    }

    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      if (finished) return;
      lastFrameAt = performance.now();
      const index = sampleIndexForMediaTime(metadata.mediaTime, plan, samples);
      if (index >= samples.length || metadata.mediaTime >= plan.untilSec) return finish();

      if (index < 0 || index < sink.nextIndex) {
        video.requestVideoFrameCallback(onFrame);
        return;
      }
      const hasGap = index > sink.nextIndex;
      const mustWait = hasGap || sink.busy >= MAX_IN_FLIGHT || document.hidden;

      // 這一格要先複製下來（同步），之後畫面換掉也沒關係
      const bitmap = sink.capture();
      if (!mustWait) {
        sink.submit(bitmap);
        played += 1;
        adaptRate();
        video.requestVideoFrameCallback(onFrame);
        return;
      }

      // 需要暫停：漏格要補、偵測器忙不過來，或頁面切到背景
      pausedByUs = true;
      video.pause();
      void (async () => {
        try {
          // 先用跳轉補上漏掉的格子（時間戳必須遞增），再送出手上這一格
          while (sink.nextIndex < index) {
            await sink.waitBelow(MAX_IN_FLIGHT);
            await seek(video, samples[sink.nextIndex].seekSec, signal);
            sink.submit(sink.capture());
            filled += 1;
          }
          await sink.waitBelow(MAX_IN_FLIGHT);
          sink.submit(bitmap);
          played += 1;
          adaptRate();
          await options.waitUntilVisible?.();
          if (signal?.aborted) throw abortError();
          await resume();
        } catch (error) {
          bitmap.then((image) => image.close()).catch(() => undefined);
          finish(error);
        }
      })();
    };

    video.addEventListener("ended", onEnded);
    signal?.addEventListener("abort", onAbort);
    resume().catch((error: unknown) => finish(error));
  });
  return { played, filled };
}

/** 第 2 段：跳轉逐格，補齊 sink.nextIndex 之後所有還沒送出的格子。 */
async function seekPass(video: HTMLVideoElement, samples: FrameSample[], sink: DetectionSink, options: ExtractOptions) {
  let seeked = 0;
  while (sink.nextIndex < samples.length) {
    if (options.signal?.aborted) throw abortError();
    await options.waitUntilVisible?.();
    await seek(video, samples[sink.nextIndex].seekSec, options.signal);
    // 同時最多一格在偵測中：偵測這一格時，主畫面同時去跳下一格
    await sink.waitBelow(MAX_IN_FLIGHT - 1);
    sink.submit(sink.capture());
    seeked += 1;
  }
  return seeked;
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
  const sink = new DetectionSink(detector, samples, canvas, context, video, options.onProgress, options.onPreviewFrame);
  const started = performance.now();
  let playedFrames = 0;
  let seekedFrames = 0;

  try {
    const canPlayPass = !options.forceSeek && typeof video.requestVideoFrameCallback === "function";
    if (canPlayPass) {
      try {
        const pass = await playPass(video, plan, samples, sink, options);
        playedFrames = pass.played;
        seekedFrames = pass.filled;
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
        // 播放失敗（例如省電模式禁止自動播放）：改用跳轉補完，不算錯誤
      }
    }
    seekedFrames += await seekPass(video, samples, sink, options);
    await sink.drain();
  } catch (error) {
    await sink.drain().catch(() => undefined);
    throw error;
  } finally {
    video.pause();
  }

  const totalMs = performance.now() - started;
  return {
    sequence: {
      frames: sink.frames,
      fps: plan.effectiveFps,
      videoWidth: width,
      videoHeight: height,
      durationSec: plan.untilSec,
    },
    stats: {
      totalMs,
      framesPerSecond: sink.frames.length / (totalMs / 1000),
      avgInferenceMs: sink.inferenceTotal / Math.max(1, sink.frames.length),
      playedFrames,
      seekedFrames,
    },
  };
}
