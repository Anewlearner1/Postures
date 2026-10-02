/**
 * 這個檔案做什麼：
 *   MediaPipe Pose Landmarker 的設定（gait-rules.md §1.1）與「自架」檔案的位置。
 *   模型與 WASM 都放在本網站的 public/mediapipe/（由 scripts/fetch-mediapipe-model.mjs 準備），
 *   使用者的瀏覽器只會向本網站下載，不會在執行時連到 Google 的伺服器。
 */

export const MEDIAPIPE_ASSETS = {
  /** WASM 檔所在的資料夾（網址路徑）。 */
  wasmBase: "/mediapipe/wasm",
  /** 姿態模型（full 版，float16，版本 1）。 */
  modelPath: "/mediapipe/pose_landmarker_full.task",
  /** 給使用者看的下載大小（模型約 9 MB＋WASM 約 12 MB；第一次之後瀏覽器會快取）。 */
  downloadSizeMB: 21,
} as const;

/** Pose Landmarker 參數（gait-rules.md §1.1：VIDEO 模式、numPoses 1、三個門檻用預設 0.5）。 */
export const POSE_LANDMARKER_OPTIONS = {
  runningMode: "VIDEO",
  numPoses: 1,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  outputSegmentationMasks: false,
} as const;

/** 送進模型前把畫面縮小到長邊最多幾像素（關鍵點座標是 0–1 比例，縮放不影響結果，只省記憶體與傳輸）。 */
export const MAX_INPUT_LONG_SIDE = 960;

/** 運算方式：CPU（WASM＋SIMD）或 GPU（WebGL）。選 GPU 但無法使用時自動改用 CPU。 */
export type PoseDelegate = "GPU" | "CPU";

/**
 * 預設用 CPU（前端工程師暫定，M5 用實機量測後再決定）：
 * - 沙盒實測：CPU 約 18–20 格／秒；GPU 在沒有顯示卡的環境（軟體模擬 WebGL）只有約 1.6 格／秒。
 * - 背景執行緒裡用 GPU 需要 OffscreenCanvas＋WebGL，iPhone 的 Safari 16 不支援。
 * 實機比較時，可在瀏覽器主控台執行 localStorage.setItem("postures:pose-delegate", "GPU") 改用 GPU。
 */
export const DEFAULT_DELEGATE: PoseDelegate = "CPU";

/** 開發者量測速度用的覆寫設定（一般使用者不會碰到）。 */
export const DELEGATE_OVERRIDE_KEY = "postures:pose-delegate";
