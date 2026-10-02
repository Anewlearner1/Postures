# `src/lib/pose/` — 骨架偵測（MediaPipe）與分析流程

**這個資料夾做什麼**：在使用者的瀏覽器裡，用 MediaPipe Pose Landmarker 逐格找出影片中人體的 33 個關節位置，
輸出 `PoseSequence`（型別在 `src/lib/gait/types.ts`），再交給演算法（`src/lib/gait/analyze.ts`）與報告 API。
影片只在使用者的裝置上處理，**不上傳**（SPEC D12）。

| 檔案 | 內容 |
|---|---|
| `mediapipe-config.ts` | MediaPipe 設定（VIDEO 模式、numPoses 1、門檻 0.5、full 模型，gait-rules §1.1）、自架檔案位置、CPU／GPU 預設 |
| `pose.worker.ts` | 背景執行緒（Web Worker）：載入模型、逐格偵測；**擋下所有對外連線**（MediaPipe 內建的使用統計回傳） |
| `pose-detector.ts` | 主畫面這端的偵測器：啟動背景執行緒、回報模型下載進度、送畫面、收結果 |
| `extract-poses.ts` | 逐格讀影片：先「慢速播放取格」，漏掉的格子再「跳轉補格」；時間戳嚴格遞增；可取消 |
| `preflight.ts` | 前置檢查：太短（< 6 秒）、影格率太低（< 15 fps）、讀不到畫面、太長（> 30 秒只分析前 20 秒，暫定）；分析計畫（60 fps 隔格取樣） |
| `read-video-meta.ts` | 讀影片長度、解析度、影格率、編碼（瀏覽器端） |
| `mp4-metadata.ts` | 直接讀 MP4／MOV 的目錄取得影格數與影格率（瀏覽器不提供 fps） |
| `browser-support.ts` | 瀏覽器功能檢查、LINE／Facebook／Instagram 內建瀏覽器偵測（UX §5.8） |
| `gait-adapter.ts` | 與演算法的接口：動態載入 `analyzeGait` |
| `pipeline.ts` | 「分析中」四個步驟的流程與進度計算（可用假的偵測器測試） |
| `skeleton.ts` | 在 canvas 上畫骨架：近側實線、遠側淡色虛線、低信心半透明（UX §4.6） |
| `replay-markers.ts` | 骨架回放時間軸：問題時間點標記、偵測較不穩定的片段 |

**模型與 WASM 自架**：放在 `public/mediapipe/`，由 `scripts/fetch-mediapipe-model.mjs` 準備
（`npm run dev`／`npm run build` 前自動執行）。執行時瀏覽器只向本網站下載，不連到 Google。

**測試**：`*.test.ts`（`npm test`）；在真的瀏覽器裡的流程測試在 `e2e/`（`npm run test:e2e`）。

**規格依據**：`docs/spec/gait-rules.md` §0、§1、§7.1；`docs/spec/ux-flow-and-copy.md` §2.3、§2.4、§4.6、§5
