# `src/lib/report/` — 報告組裝

**這個資料夾做什麼**：把判斷結果（分析結果 JSON）組成報告頁要顯示的內容——總結語、問題卡片、建議練習、
頭部觀察、低可信度提示——並在伺服器端呼叫 Claude 把部分段落寫成白話。

## 流程

```
瀏覽器：AnalysisResult ──toReportRequest()──▶ POST /api/report（只有分析結果，不含影像、不含左右側）
伺服器：
  1. request.ts          zod 嚴格驗證（多欄位、超過 16 KB、數值不合理 → 400／413）
  2. select-exercises.ts 依動作庫規則選練習（只有程式能決定練習，SPEC D7）
  3. template-report.ts  用固定文案組出完整報告（降級方案，一定會成功）
  4. claude-writer.ts    有 ANTHROPIC_API_KEY 時，請 Claude 寫白話段落（結構化 JSON 輸出）
  5. ai-merge.ts         檢查 AI 文字（content-filter.ts）後合併；不合格的段落換回模板
瀏覽器：fetch-report.ts 補上影片資訊（步數、長度、時間軸標記）→ 報告頁顯示
```

## 檔案

| 檔案 | 用途 |
|---|---|
| `types.ts` | 報告頁的資料格式（ReportView）與 API 回應格式（ReportApiResponse） |
| `exercises.ts` | 讀取並檢查 `src/data/exercises.json`（動作庫） |
| `request.ts` | API 請求格式與驗證 |
| `to-request.ts` | 前端：AnalysisResult → API 請求（濾掉 TE、NCK 等內部數值） |
| `card-id.ts` | 問題＋子型態 → 卡片代碼 |
| `select-exercises.ts` | 動作挑選規則（exercise-library.md §3） |
| `template-report.ts` | 模板報告（UX 文件 §4 範本） |
| `content-filter.ts` | AI 文字檢查：禁用詞（UX §8.5）、左右腳（D26）、頭部（D25）、數字、長度 |
| `ai-merge.ts` | 交給 Claude 的資料、Claude 的輸出格式、合併與檢查 |
| `claude-writer.ts` | 呼叫 Claude API（只在伺服器端，`server-only`） |
| `generate-report.ts` | 伺服器端整體流程與降級 |
| `fetch-report.ts` | 前端呼叫 API 的函式；連不到伺服器時在瀏覽器用模板組報告 |
| `*.test.ts`、`test-fixtures.ts` | 自動化測試（`npm test`），不會真的呼叫 Claude |

## API 摘要：`POST /api/report`

- 請求：`Content-Type: application/json`，內容為 gait-rules.md §8 的分析結果 JSON；
  每個問題可選填 `timestamps_sec`（問題出現的秒數，最多 20 個）。上限 16 KB。
- 回應 200：`{ "source": "ai" | "template", "report": ReportBody }`
- 回應 400：`{ "error": "invalid_json" }` 或 `{ "error": "invalid_request", "issues": [{ "path", "code" }] }`
- 回應 413／415：請求太大／不是 JSON。

## 規格依據

`docs/spec/exercise-library.md` §3、§9；`docs/spec/ux-flow-and-copy.md` §4、§8；`docs/spec/gait-rules.md` §2.6、§8；SPEC D7、D18、D25、D26、D30、D34、D35
