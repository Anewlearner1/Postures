# `src/lib/pose/` — 骨架偵測（MediaPipe）

**這個資料夾做什麼**：在使用者的瀏覽器裡，用 MediaPipe Pose Landmarker 逐格找出影片中人體的 33 個關節位置，輸出 `PoseSequence`（型別定義在 `src/lib/gait/types.ts`）。

**目前狀態**：只有說明，尚未實作（M3 才做）。

**之後會放的東西（預計）**

- 載入 MediaPipe 模型（`runningMode: "VIDEO"`、`numPoses: 1`，模型用 `full`，見 `docs/spec/gait-rules.md` §1.1）
- 逐格讀取影片、執行偵測、回報進度（給「分析中」頁的進度條使用）
- 影片只在瀏覽器裡處理，**不上傳**（SPEC D12）

**規格依據**：`docs/spec/gait-rules.md` §0、§1
