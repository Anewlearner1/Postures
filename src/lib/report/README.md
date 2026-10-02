# `src/lib/report/` — 報告組裝

**這個資料夾做什麼**：把判斷結果（`AnalysisResult`）組成報告頁要顯示的內容——總結語、問題卡片、建議練習、頭部觀察、低可信度提示——並準備送給後端 Claude API 的資料。

**目前狀態**：只有說明，尚未實作（M4 才做）。報告頁目前用 `src/data/sample-report.ts` 的假資料呈現版面。

**之後會放的東西（預計）**

- 依 UX 文件 §4 的範本產生固定文案（AI 失敗時的降級方案也用這個）
- 從動作庫挑選練習（AI 只能從動作庫挑，SPEC D7）
- 檢查 AI 輸出是否含禁用詞（UX 文件 §8.5）、是否寫到左右腳（D26）
- 下載 PDF 報告（D21）

**注意**：呼叫 Claude API 的程式放在後端（Next.js API Route），由後端工程師負責，不放在這裡。

**規格依據**：`docs/spec/ux-flow-and-copy.md` §4、`docs/spec/exercise-library.md`
