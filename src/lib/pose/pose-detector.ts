/**
 * 這個檔案做什麼：
 *   主畫面這一端的「骨架偵測器」：啟動背景工作（pose.worker.ts）、載入模型、
 *   把一張張畫面送過去並等結果回來。只能在瀏覽器中使用。
 *
 *   錯誤分兩種：
 *   - PoseModelLoadError：模型或 WASM 下載／啟動失敗 → 顯示「無法載入分析工具」（UX §5.9）
 *   - 其他錯誤：分析中斷 → 顯示「分析中斷了」（UX §5.8）
 */

import type { Landmark } from "@/lib/gait/types";
import { DEFAULT_DELEGATE, DELEGATE_OVERRIDE_KEY, MEDIAPIPE_ASSETS, type PoseDelegate } from "./mediapipe-config";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

export class PoseModelLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoseModelLoadError";
  }
}

export interface DetectionResult {
  landmarks: Landmark[] | null;
  inferenceMs: number;
}

/** 偵測器介面（測試時可以換成假的）。 */
export interface PoseDetectorLike {
  readonly delegate: PoseDelegate;
  detect(bitmap: ImageBitmap, timestampMs: number): Promise<DetectionResult>;
  close(): void;
}

export interface CreateDetectorOptions {
  signal?: AbortSignal;
  /** 模型下載進度（0–1；不知道總大小時為 null）。 */
  onModelProgress?: (fraction: number | null) => void;
}

function preferredDelegate(): PoseDelegate {
  try {
    const override = window.localStorage.getItem(DELEGATE_OVERRIDE_KEY)?.toUpperCase();
    if (override === "CPU" || override === "GPU") return override;
  } catch {
    // 無法讀 localStorage（例如私密瀏覽）時用預設值
  }
  return DEFAULT_DELEGATE;
}

class WorkerPoseDetector implements PoseDetectorLike {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (r: DetectionResult) => void; reject: (e: Error) => void }>();
  private crashed: Error | null = null;

  constructor(
    private readonly worker: Worker,
    public readonly delegate: PoseDelegate,
  ) {
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type !== "result" && message.type !== "detect-error") return;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.type === "result") entry.resolve({ landmarks: message.landmarks, inferenceMs: message.inferenceMs });
      else entry.reject(new Error(message.message));
    });
    worker.addEventListener("error", (event) => this.fail(new Error(event.message || "worker error")));
  }

  private fail(error: Error) {
    this.crashed = error;
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  detect(bitmap: ImageBitmap, timestampMs: number): Promise<DetectionResult> {
    if (this.crashed) {
      bitmap.close();
      return Promise.reject(this.crashed);
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const request: WorkerRequest = { type: "detect", id, bitmap, timestampMs };
      this.worker.postMessage(request, [bitmap]);
    });
  }

  close() {
    this.fail(new Error("closed"));
    try {
      this.worker.postMessage({ type: "close" } satisfies WorkerRequest);
    } catch {
      // 背景工作已結束
    }
    // 給背景工作一點時間釋放模型，再強制結束
    window.setTimeout(() => this.worker.terminate(), 500);
  }
}

/** 啟動背景工作並載入模型。 */
export async function createPoseDetector(options: CreateDetectorOptions = {}): Promise<PoseDetectorLike> {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./pose.worker.ts", import.meta.url));
  } catch (error) {
    throw new PoseModelLoadError(`worker: ${String(error)}`);
  }

  const origin = window.location.origin;
  const request: WorkerRequest = {
    type: "init",
    wasmBase: new URL(MEDIAPIPE_ASSETS.wasmBase, origin).toString(),
    modelUrl: new URL(MEDIAPIPE_ASSETS.modelPath, origin).toString(),
    delegate: preferredDelegate(),
  };

  return new Promise<PoseDetectorLike>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      worker.terminate();
      reject(new DOMException("aborted", "AbortError"));
    };
    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "model-progress") {
        options.onModelProgress?.(message.totalBytes ? message.loadedBytes / message.totalBytes : null);
      } else if (message.type === "ready") {
        cleanup();
        resolve(new WorkerPoseDetector(worker, message.delegate));
      } else if (message.type === "init-error") {
        cleanup();
        worker.terminate();
        reject(new PoseModelLoadError(`${message.stage}: ${message.message}`));
      }
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      worker.terminate();
      reject(new PoseModelLoadError(`worker: ${event.message}`));
    };
    function cleanup() {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      options.signal?.removeEventListener("abort", onAbort);
    }

    if (options.signal?.aborted) return onAbort();
    options.signal?.addEventListener("abort", onAbort);
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage(request);
  });
}
