/**
 * 這個檔案做什麼：
 *   在「背景執行緒」（Web Worker）裡跑 MediaPipe Pose Landmarker：
 *   收到一張畫面（ImageBitmap）→ 找出 33 個關節位置 → 回傳。
 *   放在背景執行，分析時畫面（進度條、按鈕）才不會卡住。
 *
 *   - 模型與 WASM 只從本網站的 /mediapipe/ 下載（自架，見 mediapipe-config.ts），不連到 Google。
 *   - MediaPipe 內建「使用統計」回傳（每分鐘送到 odml.pa.googleapis.com，內容是任務類型、
 *     作業系統、處理速度等，不含影像）。為了讓「影片只在你的裝置上分析」的說法完全成立，
 *     這個背景執行緒只允許連到本網站，其他網址一律擋下（blockCrossOriginRequests）。
 *   - 預設用 CPU；指定 GPU 時先試 GPU，失敗就改用 CPU（見 mediapipe-config.ts）。
 *   - 畫面只在這台裝置的記憶體中處理，用完立刻釋放，不會上傳。
 */

import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark } from "@/lib/gait/types";
import { POSE_LANDMARKER_OPTIONS, type PoseDelegate } from "./mediapipe-config";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
  close(): void;
}

const scope = self as unknown as WorkerScope;

/** 只允許這個背景執行緒連到本網站；MediaPipe 的使用統計等對外連線一律擋下。 */
function blockCrossOriginRequests() {
  const global = self as unknown as {
    fetch: typeof fetch;
    location: { href: string; origin: string };
    XMLHttpRequest?: unknown;
  };
  const originalFetch = global.fetch.bind(self);
  const isSameOrigin = (input: RequestInfo | URL) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(href, global.location.href).origin === global.location.origin;
  };
  global.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    isSameOrigin(input) ? originalFetch(input, init) : Promise.reject(new TypeError("blocked cross-origin request"));
  // 背景執行緒裡用不到 XMLHttpRequest，直接移除，避免其他對外送出的管道
  global.XMLHttpRequest = undefined;
}

blockCrossOriginRequests();

let landmarker: PoseLandmarker | null = null;

async function fetchModel(modelUrl: string): Promise<Uint8Array> {
  const response = await fetch(modelUrl);
  if (!response.ok || !response.body) throw new Error(`model http ${response.status}`);
  const totalHeader = Number(response.headers.get("content-length"));
  const totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loadedBytes += value.length;
    if (loadedBytes - lastReport > 256 * 1024) {
      lastReport = loadedBytes;
      scope.postMessage({ type: "model-progress", loadedBytes, totalBytes });
    }
  }
  scope.postMessage({ type: "model-progress", loadedBytes, totalBytes: totalBytes ?? loadedBytes });
  const model = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    model.set(chunk, offset);
    offset += chunk.length;
  }
  return model;
}

async function createLandmarker(wasmBase: string, model: Uint8Array, delegate: PoseDelegate) {
  // Next.js 打包出的是傳統 worker：MediaPipe 用 importScripts 載入一般版 WASM 外殼（vision_wasm_internal.js）
  const fileset = await FilesetResolver.forVisionTasks(wasmBase, false);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: model, delegate },
    ...POSE_LANDMARKER_OPTIONS,
  });
}

async function init(request: Extract<WorkerRequest, { type: "init" }>) {
  const started = performance.now();
  let model: Uint8Array;
  try {
    model = await fetchModel(request.modelUrl);
  } catch (error) {
    scope.postMessage({ type: "init-error", stage: "model", message: String(error) });
    return;
  }

  const attempts: PoseDelegate[] = request.delegate === "GPU" ? ["GPU", "CPU"] : ["CPU"];
  let lastError: unknown = null;
  for (const delegate of attempts) {
    try {
      // modelAssetBuffer 可能被轉交給 WASM，每次嘗試都給一份新的副本
      landmarker = await createLandmarker(request.wasmBase, model.slice(), delegate);
      scope.postMessage({ type: "ready", delegate, loadMs: performance.now() - started });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  scope.postMessage({ type: "init-error", stage: "runtime", message: String(lastError) });
}

function toLandmarks(raw: { x: number; y: number; z: number; visibility?: number }[] | undefined): Landmark[] | null {
  if (!raw || raw.length === 0) return null;
  return raw.map((point) => ({ x: point.x, y: point.y, z: point.z, visibility: point.visibility ?? 0 }));
}

function detect(request: Extract<WorkerRequest, { type: "detect" }>) {
  const { id, bitmap, timestampMs } = request;
  try {
    if (!landmarker) throw new Error("landmarker not ready");
    const started = performance.now();
    const result = landmarker.detectForVideo(bitmap, timestampMs);
    scope.postMessage({
      type: "result",
      id,
      landmarks: toLandmarks(result.landmarks[0]),
      inferenceMs: performance.now() - started,
    });
  } catch (error) {
    scope.postMessage({ type: "detect-error", id, message: String(error) });
  } finally {
    bitmap.close();
  }
}

scope.addEventListener("message", (event) => {
  const request = event.data;
  if (request.type === "init") void init(request);
  else if (request.type === "detect") detect(request);
  else if (request.type === "close") {
    landmarker?.close();
    landmarker = null;
    scope.close();
  }
});
