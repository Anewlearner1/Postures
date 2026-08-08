// CV/Pose Estimation Agent (per gaitappagentteamPRD.md 第2節)。
// 職責僅限於：拿到準確的關鍵點座標 + 信心分數。禁止在此檔案內加入
// 角度計算、步態語意判斷或任何「異常」判斷邏輯 — 那是步態演算法 Agent 的範圍。

import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';

export const CONFIDENCE_THRESHOLD = 0.5;

export interface Keypoint {
  x: number;
  y: number;
  confidence: number;
  unreliable: boolean;
}

export interface PoseFrame {
  timestamp: number;
  keypoints: Record<string, Keypoint>;
  fps_actual: number;
  inference_latency_ms: number;
}

// 只取步態分析會用到的關鍵點（肩、髖、膝、踝、腳跟、腳尖），
// 對應 MediaPipe Pose Landmarker 的 33 點模型索引。
const GAIT_LANDMARKS: Record<string, number> = {
  left_shoulder: 11,
  right_shoulder: 12,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
  left_heel: 29,
  right_heel: 30,
  left_foot_index: 31,
  right_foot_index: 32,
};

// MediaPipe wasm 執行檔 + 模型檔皆由 CDN 載入（官方文件建議做法），
// 在使用者裝置的瀏覽器執行期間需要網路連線；此 sandbox 環境無法實測。
const WASM_BASE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_ASSET_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

export function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_ASSET_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
    })();
  }
  return landmarkerPromise;
}

export function disposePoseLandmarker(): void {
  if (landmarkerPromise) {
    landmarkerPromise.then((landmarker) => landmarker.close()).catch(() => {});
    landmarkerPromise = null;
  }
}

/**
 * 對單一影格做姿態偵測，回傳符合 PRD 第2節 JSON 結構的關鍵點資料。
 * 信心分數低於 CONFIDENCE_THRESHOLD 時標記 unreliable=true，
 * 座標本身不做平滑或估計值填補（保留原始輸出，交由呼叫端決定如何處理）。
 */
export function detectPoseFrame(
  landmarker: PoseLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): { keypoints: Record<string, Keypoint>; inferenceLatencyMs: number } | null {
  const start = performance.now();
  const result: PoseLandmarkerResult = landmarker.detectForVideo(video, timestampMs);
  const inferenceLatencyMs = performance.now() - start;

  const landmarks = result.landmarks?.[0];
  if (!landmarks) return null;

  const keypoints: Record<string, Keypoint> = {};
  for (const [name, index] of Object.entries(GAIT_LANDMARKS)) {
    const lm = landmarks[index];
    if (!lm) continue;
    const confidence = lm.visibility ?? 0;
    keypoints[name] = {
      x: lm.x,
      y: lm.y,
      confidence,
      unreliable: confidence < CONFIDENCE_THRESHOLD,
    };
  }

  return { keypoints, inferenceLatencyMs };
}

// 用於畫骨架線段的關鍵點連線對照表（僅視覺化，不涉及步態語意）。
export const SKELETON_CONNECTIONS: [string, string][] = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['right_hip', 'right_knee'],
  ['left_knee', 'left_ankle'],
  ['right_knee', 'right_ankle'],
  ['left_ankle', 'left_heel'],
  ['right_ankle', 'right_heel'],
  ['left_heel', 'left_foot_index'],
  ['right_heel', 'right_foot_index'],
  ['left_ankle', 'left_foot_index'],
  ['right_ankle', 'right_foot_index'],
];
