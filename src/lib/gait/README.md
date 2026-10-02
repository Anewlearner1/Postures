# `src/lib/gait/` — 步態事件與指標計算

**這個資料夾做什麼**：把骨架序列變成數字——前處理、切出直線行走段、找出腳跟著地與腳尖離地、算出每個步態週期的髖、膝、軀幹角度，再跨週期取中位數。全部是純 TypeScript，不依賴瀏覽器。

## 入口

```ts
import { analyzeGait } from "@/lib/gait/analyze";

const outcome = analyzeGait(frames, { fps, width, height, durationSec }, { populationCaveat });
if (outcome.status === "rejected") showRetake(outcome.code);           // RejectCode（§7.1）
else postReport(toReportRequest(outcome.result));                     // 只送 result，不送 details
```

- `frames: PoseFrame[]`：MediaPipe 33 點**正規化座標**＋visibility＋時間戳；偵測不到人時 `landmarks: null`；順序不拘。選填 `poseCount`（偵測到幾個人）。
- `outcome.details`：內部完整結果（含左右側、事件、週期、13 個可信度因子），給除錯、骨架回放標記、M5 校正與同意捐贈資料使用；**不可**送 AI 或顯示左右腳（D26）。

## 檔案

| 檔案 | 用途（規格章節） |
|---|---|
| `types.ts` | 共用型別（PoseFrame、AnalysisResult、AnalysisDetails…） |
| `analyze.ts` | 入口 `analyzeGait`：串起整條管線 |
| `preprocess.ts` | 時間格點化、像素座標（§0.2）、缺值、左右錯置修正（§1.3）、內插與 6 Hz 零相位濾波（§1.2） |
| `passes.ts` | 骨盆、腿長、直線段切割與轉身排除（§2.2）、近側判定（§1.4）、roll 校正（§1.5） |
| `events.ts` | Zeni 法 HS／TO 偵測（§2.1、§2.3），腳跟／腳尖看不清時改用腳踝 |
| `cycles.ts` | 週期組合與合理性檢查（§2.4）、加減速週期（§2.2-6）、時相窗與每週期指標（§2.5、§3.2、§4.2、§5.2） |
| `angles.ts` | 節段角與關節角的正負號定義（§0.4、§0.5） |
| `aggregate.ts` | 每側中位數、標準差、有效週期數（§2.6） |
| `quality.ts` | 拒絕與可信度需要的量測值（§6.3、§7.1） |
| `math.ts` | 統計、內插、Butterworth 濾波、峰值搜尋 |
| `testing/synthetic.ts` | 測試用合成走路骨架產生器（正向運動學＋針孔相機，可注入各種問題與拍攝狀況） |
| `testing/accuracy.ts` | 測試用：事件偵測與真值配對 |

判斷規則（閾值、分級、可信度、拒絕）在 `src/lib/rules/`。

**規格依據**：`docs/spec/gait-rules.md` §0–§5、§8
