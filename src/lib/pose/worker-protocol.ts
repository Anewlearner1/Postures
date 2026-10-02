/**
 * 這個檔案做什麼：
 *   主畫面與「骨架偵測背景工作」（pose.worker.ts）之間傳遞的訊息格式（只有型別）。
 *   骨架偵測放在背景執行（Web Worker），分析時畫面才不會卡住。
 */

import type { Landmark } from "@/lib/gait/types";
import type { PoseDelegate } from "./mediapipe-config";

export type WorkerRequest =
  | { type: "init"; wasmBase: string; modelUrl: string; delegate: PoseDelegate }
  | { type: "detect"; id: number; bitmap: ImageBitmap; timestampMs: number }
  | { type: "close" };

export type WorkerResponse =
  | { type: "model-progress"; loadedBytes: number; totalBytes: number | null }
  | { type: "ready"; delegate: PoseDelegate; loadMs: number }
  | { type: "init-error"; message: string; stage: "model" | "runtime" }
  | { type: "result"; id: number; landmarks: Landmark[] | null; inferenceMs: number }
  | { type: "detect-error"; id: number; message: string };
