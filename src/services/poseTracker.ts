/**
 * Track A, stage 1: turn a video file into a time series of pose landmarks.
 *
 * Everything here runs in the browser. The video is read through an object URL
 * and never leaves the device; the only thing that survives this module is the
 * landmark array plus a handful of downscaled JPEG key frames.
 *
 * Frames are collected by seeking rather than by playing the video. Playback
 * with `requestVideoFrameCallback` drops frames under load, which corrupts
 * every temporal metric downstream. Seeking gives evenly spaced samples at a
 * known rate, which is what the gait event detector needs.
 */

import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseFrame, PoseSequence, Point3 } from '../types/gait';
import { CORE_JOINTS } from './landmarks';

const WASM_PATH =
  import.meta.env.VITE_MEDIAPIPE_WASM_PATH ||
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';

const MODEL_URL =
  import.meta.env.VITE_POSE_MODEL_URL ||
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';

export interface ExtractOptions {
  /** Frames per second to sample at. Higher is more accurate but slower. */
  targetFps?: number;
  /** Hard cap on frames so a long clip cannot lock up the tab. */
  maxFrames?: number;
  /** How many JPEG key frames to keep for track B and for the history record. */
  keyFrameCount?: number;
  /** Longest edge of the stored key frames, in pixels. */
  keyFrameMaxEdge?: number;
  /** JPEG quality for the stored key frames. */
  keyFrameQuality?: number;
}

const DEFAULTS: Required<ExtractOptions> = {
  targetFps: 30,
  maxFrames: 450,
  keyFrameCount: 14,
  keyFrameMaxEdge: 480,
  keyFrameQuality: 0.7,
};

export interface ExtractProgress {
  phase: 'loading-model' | 'decoding' | 'detecting' | 'done';
  processed: number;
  total: number;
}

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

/**
 * Loads the pose model once per page.
 *
 * The vision runtime is imported dynamically so its bundle stays out of the
 * initial page load — nothing needs it until an analysis actually starts. The
 * WASM binary and the .task weights are a few megabytes on top of that, so the
 * whole thing is cached across analyses.
 */
export async function loadPoseLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      return PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
    })().catch((e) => {
      // Let the next attempt retry instead of caching a rejected promise.
      landmarkerPromise = null;
      throw e;
    });
  }
  return landmarkerPromise;
}

function loadVideoElement(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    const onError = () =>
      reject(new Error('無法讀取此影片檔案,請改用 MP4 或 MOV 格式。'));

    video.addEventListener('error', onError, { once: true });
    video.addEventListener(
      'loadeddata',
      () => {
        if (!video.videoWidth || !video.videoHeight) {
          onError();
          return;
        }
        resolve(video);
      },
      { once: true },
    );

    video.src = url;
    video.load();
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error('影片解碼逾時,請嘗試較短或較低解析度的影片。')),
      10_000,
    );
    const done = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    video.addEventListener('seeked', done, { once: true });
    video.currentTime = time;
  });
}

function toPoint3(p: { x: number; y: number; z: number; visibility: number }): Point3 {
  return { x: p.x, y: p.y, z: p.z, visibility: p.visibility };
}

function captureKeyFrame(
  video: HTMLVideoElement,
  maxEdge: number,
  quality: number,
): string {
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Runs pose detection over an entire video file.
 *
 * Frames where no pose is found are skipped rather than interpolated — the
 * metrics layer needs to know how much of the clip was actually usable, and
 * inventing landmarks would hide exactly the failure the two-track design is
 * meant to catch.
 */
export async function extractPoseSequence(
  file: File,
  options: ExtractOptions = {},
  onProgress?: (p: ExtractProgress) => void,
): Promise<PoseSequence> {
  const opts = { ...DEFAULTS, ...options };

  onProgress?.({ phase: 'loading-model', processed: 0, total: 0 });
  const landmarker = await loadPoseLandmarker();

  const url = URL.createObjectURL(file);
  let video: HTMLVideoElement | null = null;

  try {
    onProgress?.({ phase: 'decoding', processed: 0, total: 0 });
    video = await loadVideoElement(url);

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('無法取得影片長度,請改用其他影片檔案。');
    }
    if (duration < 3) {
      throw new Error('影片太短,請至少拍攝 5 秒以上的連續行走。');
    }

    // Decimate rather than truncate: a 30 s clip becomes a lower-rate sample of
    // the whole walk instead of only its first few seconds.
    let fps = opts.targetFps;
    let frameCount = Math.floor(duration * fps);
    if (frameCount > opts.maxFrames) {
      frameCount = opts.maxFrames;
      fps = frameCount / duration;
    }
    const interval = 1 / fps;

    // Key frames are captured during the same pass so the video is only seeked
    // once end to end.
    const keyFrameStride = Math.max(1, Math.floor(frameCount / opts.keyFrameCount));
    const keyFrames: string[] = [];
    const frames: PoseFrame[] = [];

    for (let i = 0; i < frameCount; i++) {
      const t = Math.min(i * interval, duration - 1e-3);
      await seekTo(video, t);

      if (keyFrames.length < opts.keyFrameCount && i % keyFrameStride === 0) {
        keyFrames.push(
          captureKeyFrame(video, opts.keyFrameMaxEdge, opts.keyFrameQuality),
        );
      }

      // Timestamps must increase monotonically for VIDEO running mode.
      const result = landmarker.detectForVideo(video, Math.round(t * 1000));
      const landmarks = result.landmarks?.[0];
      const world = result.worldLandmarks?.[0];

      if (landmarks && world && landmarks.length >= 33 && world.length >= 33) {
        const quality =
          CORE_JOINTS.reduce((sum, idx) => sum + (landmarks[idx]?.visibility ?? 0), 0) /
          CORE_JOINTS.length;

        frames.push({
          t,
          landmarks: landmarks.map(toPoint3),
          world: world.map(toPoint3),
          quality,
        });
      }

      if (i % 5 === 0 || i === frameCount - 1) {
        onProgress?.({ phase: 'detecting', processed: i + 1, total: frameCount });
      }
    }

    if (frames.length < frameCount * 0.4) {
      throw new Error(
        '影片中偵測到人體的畫面過少,請確認全身完整入鏡、光線充足後重新拍攝。',
      );
    }

    onProgress?.({ phase: 'done', processed: frameCount, total: frameCount });

    return {
      frames,
      fps,
      durationSec: duration,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      keyFrames,
    };
  } finally {
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    URL.revokeObjectURL(url);
  }
}
