# 步態分析網站（暫名：走路姿勢分析）

讓一般大眾上傳一段 10–20 秒、從側面拍攝的走路影片，在**自己的手機或電腦上**分析走路姿勢，
得到白話報告和對應的訓練動作建議。

- 影片只在使用者的裝置上分析，不會上傳；只會送出計算出來的角度數字（不含影像）。
- 本產品**不是醫療器材**，不提供診斷。
- 只支援繁體中文；手機與電腦同等重要。

完整規格請看 **[`docs/SPEC.md`](docs/SPEC.md)**。

> 目前進度：里程碑 2（專案骨架）。所有頁面都已建立，可以從首頁一路點到報告頁，
> 但**還沒有真正的影片分析功能**——報告頁用示範用的分析結果呼叫報告 API（`/api/report`），
> 沒有設定 Claude API 金鑰時，報告使用固定範本文字。

---

## 在自己的電腦上執行

### 1. 安裝 Node.js（只需要做一次）

到 <https://nodejs.org/> 下載並安裝 **LTS 版**（建議 22 版以上）。
安裝完成後，打開「終端機」（Mac）或「命令提示字元」（Windows），輸入下面這行確認安裝成功：

```bash
node -v
```

看到類似 `v22.x.x` 的版本號就代表成功了。

### 2. 下載套件（第一次執行，或套件有更新時）

在終端機中切換到這個專案的資料夾，然後輸入：

```bash
npm install
```

### 3. 啟動網站

```bash
npm run dev
```

看到 `Local: http://localhost:3000` 之後，用瀏覽器打開 <http://localhost:3000> 就能看到網站。
修改程式後，畫面會自動更新。要停止網站，在終端機按 `Ctrl + C`。

### 其他常用指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 啟動開發用網站（改了程式會自動更新） |
| `npm run build` | 建置正式版網站（上線前檢查用） |
| `npm run start` | 執行建置好的正式版網站（要先 `npm run build`） |
| `npm run lint` | 檢查程式寫法有沒有常見問題 |
| `npm run typecheck` | 檢查資料型別有沒有寫錯 |
| `npm test` | 執行自動化測試 |

---

## 網站有哪些頁面

| 網址 | 頁面 | 說明 |
|---|---|---|
| `/` | 首頁 | 產品說明、開始按鈕、免責聲明、常見問題 |
| `/guide` | 拍攝教學 | 7 個拍攝重點、常見錯誤、小提醒 |
| `/upload` | 上傳影片 | 選擇影片、檢查格式與大小、上傳前確認清單（必勾「年滿 18 歲」） |
| `/analyze` | 分析中 | 進度畫面（目前是示意） |
| `/report` | 報告 | 用示範分析結果呼叫 `/api/report`，展示報告版面 |
| `/api/report` | 報告 API（給程式用） | 收到分析結果（角度與判斷，不含影像），回傳白話報告；說明見 `src/lib/report/README.md` |
| `/retake/錯誤代碼` | 錯誤／請重拍 | 例如 `/retake/no_person`，依代碼顯示不同說明 |
| `/privacy` | 隱私權說明 | 草稿，待法律審閱 |
| `/disclaimer` | 免責聲明 | 草稿，待法律審閱 |

---

## 資料夾導覽

```
docs/                    規格文件（產品規格、判斷規則、動作庫、UX 文案）
src/
  app/                   每個資料夾就是一個網址（例如 app/guide/ → /guide）
    api/report/          報告 API（POST /api/report，只在伺服器上執行）
    layout.tsx           全站外框：頁首、頁尾
    page.tsx             首頁
    globals.css          全站顏色與字型
  components/            可重複使用的畫面元件
    layout/              頁首、頁尾
    ui/                  按鈕、圖示、免責聲明條、嚴重度指示條等
    home/                首頁示意圖
    guide/               拍攝重點清單
    upload/              上傳頁的互動部分
    analyze/             分析中畫面（目前是示意）
    report/              報告頁的問題卡片、骨架回放、就醫提醒
    retake/              錯誤／請重拍畫面
    session/             在頁面之間暫時記住使用者選的影片（只在瀏覽器記憶體中）
  data/                  文案與資料（想改字先來這裡）——說明見 src/data/README.md
  lib/                   程式邏輯
    pose/                骨架偵測（MediaPipe）——尚未實作
    gait/                步態事件與指標計算——目前只有資料型別 types.ts
    rules/               規則判斷與可信度——尚未實作
    report/              報告組裝：挑選練習、模板文字、呼叫 Claude、檢查 AI 文字（含測試）
    upload/              上傳前的檔案格式／大小檢查（含測試）
```

每個程式檔最上方都有一段中文註解，說明「這個檔案做什麼」。

**想改網站上的文字？** 大部分固定文案都在 `src/data/`：

- 產品名稱、隱私說法、免責聲明短版 → `src/data/site.ts`
- 拍攝教學 → `src/data/guide-tips.ts`
- 錯誤訊息 → `src/data/retake-messages.ts`
- 報告頁固定文案（嚴重度標籤、就醫提醒）→ `src/data/report-copy.ts`
- 問題卡片文案與總結語範本 → `src/data/problem-copy.ts`；可信度原因文案 → `src/data/confidence-copy.ts`
- 訓練動作庫 → `src/data/exercises.json`（改完要同步 `docs/spec/exercise-library.md` 結尾的 JSON，否則測試會失敗）

---

## 技術選型（簡述）

- **Next.js + TypeScript**：前後端放在同一個專案
- **Tailwind CSS**：樣式與響應式設計
- **Vitest**：自動化測試（之後的步態演算法都要有測試）
- 字型使用裝置內建的系統字型，不需要從網路下載

詳細理由見 [`docs/SPEC.md`](docs/SPEC.md) 第 4 節。

---

## 部署到 Vercel

Vercel 是放網站的服務：把程式放在 GitHub 上，Vercel 會自動建置並給你一個網址，之後每次更新 GitHub 上的程式，網站就會自動更新。

> **費用與帳號**：需要一個 Vercel 帳號（可以直接用 GitHub 帳號登入）。Vercel 的免費方案（Hobby）**只限個人、非商業用途**；
> 本產品規劃商業化，正式對外營運前，請改用付費的 Pro 方案（以 Vercel 官網公告的價格為準）。**這一步由產品負責人決定與處理。**
> 下面的步驟中，畫面上的按鈕名稱可能因 Vercel 改版而略有不同，意思相同即可。

### 第一次部署

1. 確認這個專案已經在 GitHub 上（專案經理會把程式推到 GitHub 的 repo）。
2. 打開 <https://vercel.com>，按 **Sign Up**（註冊）或 **Log In**，選擇 **Continue with GitHub**，用 GitHub 帳號登入。
   - 第一次登入時，GitHub 會詢問是否允許 Vercel 讀取你的 repo，選擇允許（可以只允許這一個 repo）。
3. 登入後，按 **Add New…** → **Project**。
4. 在清單中找到這個專案的 repo，按 **Import**。
5. 設定畫面中：
   - **Framework Preset** 應該會自動顯示 **Next.js**，不用改。
   - **Root Directory**、**Build Command**、**Output Directory** 都維持預設，不用改。
   - **Environment Variables**：如果已經有 Claude API 金鑰，可以在這裡先加（見下一節「設定 Claude API 金鑰」）；沒有也沒關係，之後再加。
6. 按 **Deploy**，等 1–3 分鐘。看到恭喜畫面後，按畫面上的網址（類似 `https://專案名稱.vercel.app`）就能看到網站。

### 之後怎麼更新網站

- 程式更新並合併到 GitHub 的主要分支（main）後，Vercel 會**自動**重新部署，不需要再按任何按鈕。
- 推到其他分支時，Vercel 會產生一個「預覽網址」，可以先檢查再合併。
- 在 Vercel 專案頁面的 **Deployments** 可以看到每次部署的狀態；如果顯示失敗，把錯誤畫面截圖給專案經理。

### 部署後的檢查

1. 打開網站首頁，從「開始」一路點到報告頁，確認畫面正常。
2. 報告頁最上方的虛線框會顯示「文字使用固定範本」（還沒設定金鑰）或「文字由 AI 依分析結果撰寫」（已設定金鑰）。

---

## 設定 Claude API 金鑰

報告中的總結語、「我們看到什麼」與練習說明句，可以交給 Claude（Anthropic 公司的 AI）寫得更自然。
**不設定也可以**：沒有金鑰、或 Claude 暫時無法使用時，網站會自動改用固定範本文字，照常產生報告。

> **費用與帳號**：需要 Anthropic 的開發者帳號，並**預先儲值或綁定付款方式**（按使用量計費）。**這一步需要付費，由產品負責人處理。**
> 粗估：每產生一份報告約新台幣 1–3 元（以預設模型 claude-opus-5-5 估算；實際以 Anthropic 官網價格與帳單為準）。
> 想節省費用，可以把 `CLAUDE_MODEL` 設成較便宜的模型（例如 `claude-sonnet-5-5`）。

### 1. 申請金鑰

1. 打開 Anthropic 的開發者平台 Claude Console：<https://platform.claude.com>，註冊並登入。
2. 依畫面指示設定付款方式、購買額度（Billing）。
3. **強烈建議**在 Billing／Limits 設定每月花費上限，避免網站被大量使用時產生意外費用。
4. 到 **API Keys** 頁面，按 **Create Key**，名稱可以寫 `postures-vercel`。
5. 畫面會顯示一串以 `sk-ant-` 開頭的金鑰。**金鑰只會顯示這一次**，請立刻複製，貼到安全的地方（例如密碼管理器）。
   - **不要**把金鑰貼在 GitHub、聊天訊息、Email 或任何程式檔案裡。
   - 如果懷疑金鑰外流，回到 API Keys 頁面把它停用（Disable／Delete），再建立一把新的。

### 2. 把金鑰放到 Vercel

1. 打開 Vercel 上這個專案的頁面，按上方的 **Settings**，再按左側的 **Environment Variables**。
2. 新增一個變數：
   - **Key（名稱）**：`ANTHROPIC_API_KEY`（一字不差，前面**不可以**加 `NEXT_PUBLIC_`，否則金鑰會被放進網頁裡）
   - **Value（值）**：貼上剛剛複製的金鑰
   - **Environments**：勾選 **Production**（正式網站）；如果也想讓預覽網址使用 AI，再勾 **Preview**
3. （選填）再新增 `CLAUDE_MODEL`，值填想使用的模型名稱；不填就用預設的 `claude-opus-5-5`。
4. 按 **Save**。
5. **重新部署才會生效**：到 **Deployments**，找到最新一次部署，按右側「⋯」→ **Redeploy**。
6. 部署完成後打開報告頁，最上方虛線框顯示「文字由 AI 依分析結果撰寫」就代表成功。
   如果仍顯示「固定範本」，請確認變數名稱沒有打錯、有重新部署，以及 Anthropic 帳號還有額度。

### 在自己的電腦上測試（選做）

1. 把專案中的 `.env.example` 複製一份，改名為 `.env.local`。
2. 用文字編輯器打開 `.env.local`，在 `ANTHROPIC_API_KEY=` 後面貼上金鑰（等號前後不要空格），存檔。
3. 重新執行 `npm run dev`。`.env.local` 不會被上傳到 GitHub。

### 隱私說明（給產品負責人）

- 送到 Claude 的只有：問題的白話名稱、嚴重度、時間點、身體前傾的平均角度、已選好的練習名稱與目的；
  **不含影片、影像、左右腳資訊或頭部角度**。
- 伺服器不保存這些資料，也不寫入紀錄（SPEC D18）；出錯時只記錄錯誤類型（例如「逾時」）。
- 金鑰只存在 Vercel 的伺服器設定中，不會出現在網頁程式碼裡。
