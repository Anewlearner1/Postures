# 步態指標、判斷規則與閾值草案（v0.1）

> 文件性質：規格草案，供產品負責人（運動科學）審閱、供工程實作參考。
> 撰寫：運動科學研究助理（AI 協作產出）｜日期：2026-10-02
> 相關文件：[`exercise-library.md`](exercise-library.md)（動作庫）、[`ux-flow-and-copy.md`](ux-flow-and-copy.md)（流程與文案，可信度原因代碼需與本文件對齊）

## 閱讀說明

- **【文獻】**：數值或方法直接來自已查證的文獻（文末附 DOI）。所有文獻都已透過 PubMed 或期刊頁面確認存在，並核對摘要內容。
- **【推估】**：沒有可直接套用的文獻數值，是依文獻範圍、2D 誤差與幾何推算得出的建議值，**必須**經過本產品自己的校正資料驗證後才能定案。
- **【待驗證】**：有來源，但來源是教科書或二手引用，頁碼或原始數值尚未逐字核對；也包括 MediaPipe 特性相關的假設。
- 本文件所有閾值都是**「2D 手機影片＋MediaPipe」專用**的草案，**不可**直接拿 3D 動作捕捉的常模當成判斷標準（理由見 §6.1）。
- 本產品不是醫療器材，判斷結果的用語是「觀察到的走路特徵」，不是診斷。

## 目錄

0. [符號、座標與角度約定](#0-符號座標與角度約定)
1. [共通前處理流程](#1-共通前處理流程)
2. [步態事件偵測與來回走處理](#2-步態事件偵測與來回走處理)
3. [問題一：髖伸展不足](#3-問題一髖伸展不足)
4. [問題二：膝屈曲異常](#4-問題二膝屈曲異常)
5. [問題三：軀幹／頭部前傾](#5-問題三軀幹頭部前傾)
6. [2D 量測限制與可信度計算](#6-2d-量測限制與可信度計算)
7. [整體品質把關規則](#7-整體品質把關規則)
8. [閾值總表（工程用）](#8-閾值總表工程用)
9. [建議的校正與驗證計畫](#9-建議的校正與驗證計畫)
10. [待產品負責人決定的問題](#10-待產品負責人決定的問題)
11. [參考文獻](#11-參考文獻)

---

## 0. 符號、座標與角度約定

### 0.1 MediaPipe 關鍵點（本文件會用到的）

MediaPipe Pose Landmarker 輸出 33 個關鍵點【文獻：MediaPipe 官方文件 [M1]】。本規格使用：

| 編號 | 名稱 | 用途 |
|---|---|---|
| 0 | nose | 人體存在判斷、面向判斷（轉身偵測） |
| 7 / 8 | left_ear / right_ear | 頭部前傾（耳朵近似耳屏 tragus） |
| 11 / 12 | left_shoulder / right_shoulder | 軀幹線上端、頭部前傾的下端 |
| 23 / 24 | left_hip / right_hip | 骨盆（髖中點）、軀幹線下端、大腿線上端 |
| 25 / 26 | left_knee / right_knee | 大腿線下端、小腿線上端 |
| 27 / 28 | left_ankle / right_ankle | 小腿線下端 |
| 29 / 30 | left_heel / right_heel | 初始著地（heel strike）偵測 |
| 31 / 32 | left_foot_index / right_foot_index | 離地（toe off）偵測 |

每個關鍵點有 `x, y`（以影像寬、高分別正規化到 0–1）、`z`（以髖中點為原點的相對深度，**數值越小越靠近鏡頭**）、`visibility`（0–1，可見且未被遮擋的可能性）【文獻：MediaPipe 文件 [M1][M2]】。另有 `worldLandmarks`（以髖中點為原點、單位公尺的 3D 估計），第一版**不用**它算角度（單鏡頭深度估計不可靠，【推估】），只作為輔助判斷近側／遠側。

### 0.2 座標轉換（重要，常見實作錯誤）

1. **先換成像素座標再算角度**：`X = x × 影像寬`、`Y = y × 影像高`。因為 x、y 分別用寬和高正規化，直接用正規化座標算角度，在非正方形影片（例如 1920×1080）會產生系統性角度誤差。
2. 影像 Y 軸向下為正。下文「垂直向上」= −Y 方向。
3. 若影片有旋轉資訊（手機直拍的 rotation metadata），要先依旋轉後的實際畫面計算。

### 0.3 行走方向 d 與「前方」

- 每一趟直線行走（pass）的方向 `d = +1`（往畫面右邊走）或 `d = −1`（往畫面左邊走），由骨盆水平速度決定（§2.2）。
- 「往前」= 行走方向。所有角度都乘上 d，讓不同方向的趟次可以直接合併比較。

### 0.4 節段角（segment angle）

對任一節段「近端點 A → 遠端點 B」，定義相對垂直線的**前傾角**：

```
φ(A→B) = atan2( d · (X_B − X_A) ,  (Y_B − Y_A) )      # 單位：度
```

- 對向下的節段（大腿 hip→knee、小腿 knee→ankle）：φ > 0 表示遠端在近端**前方**。
- 軀幹與頸部是向上的節段，另外定義（§5.2）：前傾為正。

### 0.5 關節角與正負號（臨床慣例：屈曲為正、伸展為負）

| 角度 | 定義 | 0° 的意義 | 正值 | 負值 |
|---|---|---|---|---|
| 軀幹傾角 τ | 髖中點→肩中點的連線與垂直線的夾角 | 軀幹垂直 | 往前傾 | 往後仰 |
| 大腿角 φ_thigh | φ(hip→knee) | 大腿垂直 | 膝在髖前方 | 膝在髖後方 |
| 小腿角 φ_shank | φ(knee→ankle) | 小腿垂直 | 踝在膝前方 | 踝在膝後方 |
| **髖角 θ_hip** | `θ_hip = φ_thigh + τ`（大腿相對軀幹） | 大腿與軀幹成一直線 | 髖屈曲 | **髖伸展** |
| **膝角 θ_knee** | `θ_knee = φ_thigh − φ_shank` | 大腿與小腿成一直線 | 膝屈曲 | 膝過伸（hyperextension） |
| 頸傾角 ν | 肩→耳連線與垂直線的夾角 | 耳朵在肩膀正上方 | 頭往前 | 頭往後 |

> 驗算：站直時 τ=0、φ_thigh=0 → θ_hip=0。軀幹前傾 10°、大腿垂直 → θ_hip=+10°（髖屈曲，符合解剖意義）。大腿在身體後方 15°、軀幹垂直 → θ_hip=−15°（伸展 15°）。

為了讓報告直觀，另外定義「**峰值髖伸展 PHE** = −min(θ_hip)」，以正數表示伸展了幾度。

### 0.6 近側／遠側肢體

側拍時，靠近鏡頭的那一側（近側）通常清楚，遠側常被遮擋。**第一版所有下肢指標只用近側肢體計算**；來回走剛好讓左右腳輪流當近側，所以兩側都有機會被量到。判斷方法見 §1.4。

---

## 1. 共通前處理流程

```
影片 → MediaPipe（VIDEO 模式，逐幀）→ 像素座標 → 缺值與左右錯置處理
     → 低通濾波 → 鏡頭水平校正 → 切出直線行走段 → 判定近側
     → 步態事件偵測 → 週期合理性檢查 → 各週期指標 → 跨週期彙總 → 規則判斷 → 可信度
```

### 1.1 MediaPipe 設定建議

- `runningMode: "VIDEO"`、`numPoses: 1`；三個信心門檻先用預設 0.5【文獻：[M1] 預設值】。
- 模型：桌機用 `full` 或 `heavy`；手機瀏覽器效能不足時用 `full`，**不建議 `lite`**（精度最低）。實際差異需自測【待驗證】。
- 輸入影格率：用影片原始影格率逐幀處理；若為了效能而抽幀，有效影格率不得低於 25 fps（事件時間解析度會變差，見 §6.1）。

### 1.2 缺值與平滑

1. `visibility < 0.5` 的點視為缺值。
2. 缺口 ≤ 0.12 秒（30 fps 約 4 幀）用線性內插補值；更長的缺口不補，該段不計算指標【文獻：Stenum 2024 使用 0.12 s 上限 [S2]】。
3. 零相位 4 階 Butterworth 低通濾波，截止頻率 6 Hz（30 fps 時 Nyquist 為 15 Hz）【文獻：Stenum 2024 側拍使用 5 Hz [S2]；6 Hz 為【推估】，可在 5–6 Hz 之間調整】。
4. 記錄每個關鍵點被內插的比例，作為可信度因子（§6.3）。

### 1.3 左右錯置（L/R swap）偵測與修正

側拍時姿勢估計常把左右腳標反。OpenPose 在側拍影片約有 3.5–5% 的影格左右錯置，研究中是人工修正【文獻：Stenum 2021 約 5%、Stenum 2024 約 3.5% [S1][S2]】。MediaPipe 也有同類問題【待驗證：實際比例需用本產品資料測】。自動化建議：

1. **連續性檢查**：同一側腳踝在相鄰影格的位移若超過「腿長 × 0.25」，且與另一側位置互換後位移變小，判定為錯置並交換該幀左右標籤。
2. **反相位檢查**：正常走路左右腳跟相對骨盆的前後位移應大致反相；若某段兩條曲線同相，標記為可疑段。
3. **深度一致性**：同一趟中，近側肢體的 z 應持續小於遠側；若某幀突然相反，可能是錯置。
4. 修正比例 > 5% 影格 → 可信度因子「中」；> 15% → 「低」（§6.3）。

### 1.4 判定近側肢體

每一趟直線行走中，分別計算左右兩側（髖、膝、踝、腳跟、腳尖）：
- 平均 `visibility`（越高越可能是近側）
- 平均 `z`（越小越靠近鏡頭）【文獻：z 的意義見 [M2]】

兩者一致時判定近側；不一致時以 visibility 為準並把該趟可信度降一級。
幾何上也可交叉檢查：沒有鏡像的後鏡頭影片中，往畫面右走時，人的右側朝向鏡頭；往左走時，左側朝向鏡頭。但若影片被鏡像（前鏡頭自拍、剪輯軟體翻轉），此規則會相反，所以**只作檢查用，不作主要依據**。

### 1.5 鏡頭水平（roll）校正

軀幹前傾、頭部前傾都以「垂直線」為基準，手機若沒拿正（畫面歪斜），會直接造成相同角度的誤差。
建議：在每一趟直線行走中，對髖中點的軌跡 (X, Y) 做線性迴歸，斜率角 α 即為鏡頭相對地面的傾斜估計（前提：平地、行走路線與鏡頭成像平面平行）【推估：方法合理但未見於文獻驗證】。
- |α| ≤ 3°：不需處理
- 3° < |α| ≤ 8°：把所有點繞畫面中心旋轉 −α 後再計算，可信度因子「中」
- |α| > 8°：仍校正，可信度因子「低」，並提示使用者手機要拿正

注意：骨盆在走路時本身會上下起伏（每步約數公分），所以要用整趟（≥ 2 個週期）的資料迴歸，不能用單步。

---

## 2. 步態事件偵測與來回走處理

### 2.1 方法依據

- **座標法（coordinate-based）**：Zeni 等人以「足部標記相對骨盆（sacrum）的前後位移」的極值定義事件：**腳跟最遠離骨盆前方時 = 初始著地（heel strike, HS）**；**腳尖最遠離骨盆後方時 = 離地（toe off, TO）**。與測力板比較，平地行走 98% 的事件在 2 幀（60 Hz，約 0.033 s）以內【文獻：Zeni 2008 [Z1]】。
- **用於 2D 姿勢估計**：Stenum 等人在側拍影片中，用「腳踝關鍵點相對髖中點的水平位移」的正峰值與負峰值定義 HS 與 TO，並據此算出與動作捕捉高度一致的時空參數與關節角度【文獻：Stenum 2021、2024 [S1][S2]】。
- **速度法（備用）**：O'Connor 等人以足部中心垂直速度偵測事件【文獻：O'Connor 2007 [O1]】；2D 影片的垂直速度雜訊較大，第一版僅作備援或交叉檢查。

本產品因為 MediaPipe 有 heel 與 foot_index，可比照 Zeni 原始做法：**HS 用腳跟（29/30）、TO 用腳尖（31/32）**；若腳跟或腳尖 visibility 不足，退回 Stenum 的腳踝（27/28）做法。

### 2.2 切出直線行走段（排除轉身）

1. 骨盆中點 `P = (hip_L + hip_R) / 2`。
2. 以 0.5 秒移動平均（或 1 Hz 低通）平滑後，計算水平速度 `v_x`（像素/秒），再除以腿長 L（像素，見下）得到正規化速度 `v̂ = v_x / L`（腿長/秒）。
   - 腿長 L：近側「髖→膝」＋「膝→踝」長度在整段影片的第 90 百分位數（避免彎曲時低估）。
3. **直線行走段**：`|v̂| ≥ 0.4 L/s` 且 `sign(v_x)` 不變、持續 ≥ 1.5 秒的連續區間【推估：0.4 L/s 約為 0.35 m/s，遠低於一般步速，僅用於排除停頓與轉身】。
4. **轉身段**（以下任一成立）＝排除：
   - `|v̂| < 0.4 L/s`（停下或原地轉）
   - `sign(v_x)` 改變點前後各 0.5 秒
   - 「肩寬比」`|X_LS − X_RS| / 軀幹長` > 0.35（人轉向正面或背面），前後各延伸 0.3 秒【推估】
5. 每一趟的方向 d = 該趟 `sign(v_x)` 的多數值。
6. **加減速段**：每趟起點與終點各 0.5 秒內開始的週期，標記為「加減速週期」；若該趟扣除後仍有 ≥ 1 個週期就排除它們，否則保留但降低可信度【推估：每趟只有 2–3 個週期，全部排除會造成週期不足】。

### 2.3 事件偵測（每趟、每側分開做）

以近側為主（遠側只在 visibility 足夠時計算，並標記為輔助）：

```
u_heel(t) = d · (X_heel(t) − X_P(t)) / L      # 腳跟在骨盆前方多遠（腿長倍數）
u_toe(t)  = d · (X_toe(t)  − X_P(t)) / L      # 腳尖在骨盆前方多遠（負值 = 在後方）

HS = u_heel 的局部最大值
TO = u_toe  的局部最小值
```

峰值搜尋參數（`scipy.signal.find_peaks` 類邏輯）【推估】：
- 同側兩個 HS 間距 ≥ 0.6 秒（以免把雜訊當事件）
- 峰值突出度（prominence）≥ 0.15 L
- 允許以拋物線內插取得次幀精度（30 fps 下單幀 = 33 ms）

### 2.4 週期合理性檢查（不通過的週期丟棄）

一個「完整步態週期」= 同側 HS → TO → 下一個 HS，且全部落在同一趟直線段內。須同時滿足【推估：以正常步態特徵設定寬鬆範圍】：

| 檢查 | 條件 | 依據 |
|---|---|---|
| 事件順序 | HS → TO → HS，中間沒有缺事件 | 定義 |
| 週期時間 | 0.8–1.8 秒 | 一般成人週期約 1 秒上下；放寬以容納慢走者【推估】 |
| 支撐期比例 | 50–75% | 正常約 60%【文獻：Perry & Burnfield [P1]，頁碼待核對】；放寬給慢走或 30 fps 誤差 |
| 關鍵點完整 | 該週期內近側髖、膝、踝、腳跟、腳尖的缺值（未內插）比例 < 20% | 【推估】 |
| 畫面邊緣 | 週期內骨盆不在畫面左右 5% 邊緣內 | 降低出畫與鏡頭畸變影響【推估】 |

### 2.5 時相窗（phase window）

以 HS=0%、下一個 HS=100% 正規化：

| 時相 | 窗口 | 用途 |
|---|---|---|
| 初始著地（IC） | HS 幀 ±1 幀的平均 | 膝角 @IC |
| 承重期（LR） | HS 到 HS + 15% 週期 | 承重期最大膝屈曲（輔助） |
| 支撐中後期 | HS + 15% 週期 到 TO | 最大髖伸展、支撐期最小膝角（過伸） |
| 擺盪期 | TO 到下一個 HS | 擺盪期最大膝屈曲 |
| 整個週期 | HS 到下一個 HS | 軀幹、頭頸平均傾角 |

### 2.6 跨週期彙總

1. 每個週期算出各指標。
2. **每側取中位數**（不受單一異常週期影響）。至少 2 個有效週期才算「該側有結果」；只有 1 個週期時仍可報告，但該側可信度最高只到「低」。
3. 同時記錄四分位距（IQR）或標準差，作為一致性可信度因子（§6.3）。
4. 軀幹、頭頸不分側：合併所有有效週期取中位數。
5. **嚴重度以較差的一側為準**，並在報告中註明「主要在左／右腳」或「兩側都有」。

### 2.7 走速估計（用於解讀，不直接判斷問題）

- 正規化步速 `v̂` = 有效週期內骨盆水平位移 / 時間 / 腿長（L/s）。
- 一般成人舒適步速約 0.97–1.40 m/s（依年齡、性別）【文獻：Andrews 2023 [A1]】；成人腿長約 0.8–0.9 m，換算約 1.1–1.7 L/s【推估：腿長換算】。
- `v̂ < 1.0 L/s` 標記「走得偏慢」：走速會明顯影響關節角度幅度（慢走時多數幅度變小）【文獻：Fukuchi 2019 系統性回顧 [F1]；Lelas 2003 [L2]】。此時報告須附註「可能部分與走得較慢有關」，並優先建議用平常速度重拍。
- 也可同時算步頻（cadence，步/分）供參考，暫不設閾值。

---

## 3. 問題一：髖伸展不足

### 3.1 臨床／生物力學意義

- **白話**：走路時後腳「往後推」的幅度不夠，大腿沒有充分往身體後方延伸，步伐容易變小、推進力不足。
- **專業說明**：正常步態在支撐末期（terminal stance）髖關節達到最大伸展，讓身體越過支撐腳、形成有效步長並儲存髖屈肌的彈性能量。老年人「峰值髖伸展減少」是不受走速影響、持續存在的步態改變，跌倒者更明顯，被認為反映髖屈曲攣縮（hip flexion contracture）／髖部緊繃，並常伴隨骨盆前傾增加與踝蹠屈推進力下降【文獻：Kerrigan 1998、2001 [K1][K2]】。這種減少是行走時才出現的動態現象，站姿時年輕與年長者沒有差異【文獻：Lee 2005 [L1]】。10 週居家髖屈肌伸展可增加行走時髖伸展受限者的峰值髖伸展與步幅【文獻：Watt 2011 [W1]】。

### 3.2 指標定義

| 項目 | 定義 |
|---|---|
| 使用關鍵點 | 近側 shoulder（11 或 12）、hip（23 或 24）、knee（25 或 26）；軀幹線也可用肩中點、髖中點（側拍時兩者幾乎重疊，取近側較穩定）【推估】 |
| 主要指標 | **PHE（峰值髖伸展，trunk-thigh）** = −min(θ_hip)，取值窗：支撐中後期（HS+15% → TO） |
| 輔助指標 | **TE（大腿後擺角，thigh-to-vertical）** = −min(φ_thigh)，同一時相窗；不受軀幹前傾影響 |
| 彙總 | 每側取各有效週期中位數；嚴重度以較差側為準 |

**為何同時看 PHE 與 TE**：MediaPipe 沒有骨盆前後的標記點，無法像 3D 系統一樣量「骨盆—大腿」的真正髖角。2D 只能用「軀幹—大腿」角，它會受軀幹前傾影響：軀幹前傾 10° 時，同樣的大腿位置，PHE 會少 10°。因此：

- PHE 低、TE 也低 → 判定為**髖伸展不足**。
- PHE 低、但 TE 正常、且軀幹前傾已達「輕度」以上 → **不判定為髖伸展不足**，改歸因於軀幹前傾（問題三），避免同一現象重複扣分。【推估：規則邏輯】

### 3.3 正常參考範圍（文獻）與 2D 閾值草案

**文獻值（3D 動作捕捉，定義各研究不同，不可直接套用）**：

| 族群 | 舒適速度峰值髖伸展 | 來源 |
|---|---|---|
| 年輕成人 | 20.4° ± 4.0° | Kerrigan 2001 [K2] |
| 健康老人（未跌倒） | 14.3° ± 4.4° | Kerrigan 2001 [K2] |
| 老人跌倒者 | 11.1° ± 4.8° | Kerrigan 2001 [K2] |
| 年輕成人／老人 | 11° ± 6° ／ 7° ± 6° | Lee 2005 [L1]（同一團隊，不同年代與系統，數值差了近 10°） |
| 年輕成人快走／慢走 | 14° ± 6° ／ 9° ± 5° | Lee 2005 [L1]（走速影響約 ±3–5°） |
| 正常步態教科書值 | 支撐末期大腿相對垂直約 20°「表觀過伸」（含骨盆前傾約 10°） | Perry & Burnfield [P1]【待驗證：頁碼與原文待核對】 |

> 重點：同一個「峰值髖伸展」，不同實驗室、不同骨盆定義可差到 10°。本產品的 2D「軀幹—大腿角」在軀幹直立時，概念上接近 Perry 的「大腿相對垂直」（約 20°），而不是以骨盆座標系算的 3D 髖角（約 10°）。因此**閾值只能先用推估值，必須用本產品管線量測健康受試者後再定案**（§9）。

**2D 誤差**：側拍姿勢估計的髖角平均絕對誤差（MAE）約 2.7–4.0°（OpenPose）【文獻：Stenum 2021 為 4.0°、Stenum 2024 為 2.7–3.3° [S1][S2]】；MediaPipe 在 90° 側拍、30 fps 下髖角 MAE 約 2–3°【文獻：Yang & Park 2024 [Y1]】。注意這是整條曲線的平均誤差，**峰值的誤差通常更大**【推估】。

**閾值草案（PHE，2D，近側中位數）**【推估】：

| 分級 | PHE | 設計理由 |
|---|---|---|
| 正常 | ≥ 12° | 約為年輕成人平均值減 2 個標準差（20.4 − 2×4.0），也接近健康老人平均值的下緣 |
| 輕度 | 8° ≤ PHE < 12° | 與「正常」界線相距約 1 個 2D MAE（4°），降低誤判 |
| 明顯 | < 8° | 低於跌倒老人平均值；即使加上 2D 誤差，真值也大概率低於正常範圍 |

**附加條件**：
- TE（大腿後擺角）≥ 12° 且軀幹前傾 τ ≥ 7° 時，不判髖伸展不足（§3.2）。
- 界線 ±1.5° 以內（例如 PHE 10.5–13.5°）標記為「接近臨界」，報告用較保守的說法【推估】。
- 若 `v̂ < 1.0 L/s`（偏慢），嚴重度不自動調整，但報告必須附註走速影響（理由：Kerrigan 2001 發現老人加快走速後峰值髖伸展並未顯著改善，說明髖伸展減少不全然是走速造成的 [K2]；但年輕人仍受走速影響 [L1]）。

### 3.4 可能的原因（供動作庫對應）

| 原因代碼 | 原因 | 依據 | 是否給動作 |
|---|---|---|---|
| `hip_flexor_tightness` | 髖屈肌（髂腰肌、股直肌）緊繃 | Kerrigan 1998/2001 推論為髖屈曲攣縮 [K1][K2]；Watt 2011 伸展介入有效 [W1] | 是 |
| `glute_weakness` | 臀大肌／髖伸肌無力 | Kerrigan 2001 討論 [K2]【待驗證：直接因果證據有限】 | 是 |
| `weak_push_off` | 小腿推蹬力（踝蹠屈肌）不足 | Kerrigan 1998：老人同時有踝蹠屈與推進功率下降 [K1] | 是 |
| `slow_short_stride` | 走得慢、步伐小的習慣 | 走速影響髖伸展幅度 [L1][F1] | 是（步態提示） |
| `pain_guarding` | 髖、腰或膝疼痛造成的保護性步態 | 臨床常識【推估】 | 否：提醒就醫評估 |

### 3.5 2D 量測限制與可信度因子（本問題特有）

- **骨盆無法量測**：2D 角度混入腰椎與骨盆前傾；需靠 TE 與軀幹規則交叉檢查。
- **髖關鍵點位置**：MediaPipe 的 hip 點不一定等於解剖上的髖關節中心，可能有系統性偏移【待驗證】。偏移會讓 PHE 整體平移，這也是必須以本產品資料重新建立常模的原因。
- **鏡頭偏離矢狀面**：會讓角度變小（見 §6.1 表），PHE 被低估 → 偏向「假陽性」。
- **衣物**：寬褲、長裙遮住大腿與膝，髖、膝點估計不穩。
- **遠側腳**：遠側大腿常被近側腳遮擋，遠側 PHE 不作判斷依據。

---

## 4. 問題二：膝屈曲異常

第一版分三種型態（同一人可能同時有兩種）：

| 型態代碼 | 中文 | 白話 |
|---|---|---|
| `knee_swing_flexion_low` | 擺盪期膝屈曲不足（僵直膝步態的輕微型） | 腳往前擺時膝蓋彎得太少，腳看起來「直直地」往前送 |
| `knee_stance_flexion_high` | 著地／支撐期膝屈曲過多 | 腳跟著地時膝蓋沒有伸直，或站在那隻腳上時膝蓋一直彎著 |
| `knee_stance_hyperextension` | 支撐期膝過伸 | 站在那隻腳上時膝蓋往後「鎖死」、超過伸直 |

> 與 UX 文件對齊：`ux-flow-and-copy.md` §4.3.2 目前只寫了前兩種型態。第三種（膝過伸）是否放進第一版，列為待決定（§10）。

### 4.1 臨床／生物力學意義

- **白話**：膝蓋在走路時應該「著地時接近伸直、承重時微彎吸震、往前擺時大幅彎曲讓腳離地」。彎得太少，腳容易拖地或要繞圈；彎得太多或鎖死，膝蓋和大腿的負擔會增加。
- **專業說明**：
  - 正常步態中，初始著地時膝接近完全伸直（約 0–5° 屈曲），承重期屈曲約 15° 以吸收衝擊，擺盪初期達到最大屈曲約 60° 以提供足部離地空間【文獻：Perry & Burnfield [P1]【待驗證：頁碼】】。
  - **擺盪期膝屈曲不足**（stiff-knee gait）最常見於中風、腦性麻痺等神經疾患，傳統歸因於股直肌在擺盪期過度活動【文獻：Kerrigan 1991 [K3]】；但模擬研究顯示多數個案的主因是**離地瞬間的膝屈曲角速度不足**，與推蹬不足有關，而不是擺盪期的伸膝力矩過大【文獻：Goldberg 2003 [G1]】。對一般大眾而言，較常見的是走得慢、推蹬弱、股四頭肌緊繃或膝部不適造成的「輕度」減少【推估】。
  - **支撐期屈曲過多**常見於膕旁肌緊繃、膝屈曲攣縮、股四頭肌無力或疲勞，以及為了減少膝痛的保護策略【推估：臨床常見歸因，未逐一查證】。
  - **支撐期膝過伸**常見於股四頭肌控制不佳、用「鎖膝」代替肌力支撐、或小腿後側緊繃【推估】。

### 4.2 指標定義

| 指標 | 關鍵點 | 時相 | 定義 |
|---|---|---|---|
| **PKF_sw** 擺盪期最大膝屈曲 | 近側 hip、knee、ankle（23/25/27 或 24/26/28） | TO → 下一個 HS | max(θ_knee) |
| **KIC** 初始著地膝角 | 同上 | HS 幀 ±1 幀平均 | θ_knee |
| **KMIN_st** 支撐期最小膝角 | 同上 | HS+15% → TO | min(θ_knee)；負值 = 過伸 |
| KLR 承重期最大膝屈曲（輔助，不單獨判斷） | 同上 | HS → HS+15% | max(θ_knee) |
| ΔPKF 左右差（輔助） | 兩側各自為近側時的 PKF_sw | — | \|PKF_L − PKF_R\| |

膝角正負號：`θ_knee = φ_thigh − φ_shank`，屈曲為正、過伸為負（§0.5）。這個做法用帶方向的節段角相減，能區分「微屈」與「過伸」；若只用三點夾角（0–180°）會失去正負號。

彙總：每側取有效週期中位數；嚴重度取較差側。

### 4.3 正常參考範圍與 2D 閾值草案

**文獻值**：

| 指標 | 參考值 | 來源 |
|---|---|---|
| 擺盪期最大膝屈曲 | 約 60° | Perry & Burnfield [P1]【待驗證：頁碼】 |
| 中風後僵直膝判定 | 擺盪期最大膝屈曲 < 44.3°，或左右差 > 17.0° | Lee 2024（中風族群、3D）[L3] |
| 初始著地膝角 | 約 0–5° 屈曲（接近伸直） | Perry & Burnfield [P1]【待驗證：頁碼】 |
| 承重期最大膝屈曲 | 約 15° | Perry & Burnfield [P1]【待驗證：頁碼】 |
| 走速影響 | 慢走時關節角度幅度普遍變小 | Fukuchi 2019 [F1]；Lelas 2003 提供速度—峰值回歸 [L2] |

**2D 誤差**：膝角 MAE 約 3.5–5.6°（OpenPose 側拍）【文獻：[S1][S2]】；MediaPipe 側拍約 2.4–3.9°（實驗室條件）【文獻：[Y1]】；在腦性麻痺兒童中 BlazePose 關節角誤差超過 5°【文獻：Gao 2025 [G2]】。

**閾值草案**【推估，除特別標示】：

| 型態 | 指標 | 正常 | 輕度 | 明顯 | 設計理由 |
|---|---|---|---|---|---|
| 擺盪期屈曲不足 | PKF_sw | ≥ 52° | 45°–< 52° | < 45° | 正常約 60°；「明顯」貼齊 Lee 2024 的 44.3°【文獻】；輕度帶寬約 1–2 個 MAE |
| 擺盪期屈曲不足（左右差，輔助） | ΔPKF | ≤ 10° | 10°–17° | > 17° | > 17° 來自 Lee 2024【文獻】；10° 為【推估】。只有兩側都有 ≥ 2 個有效週期時才使用 |
| 著地時屈曲過多 | KIC | ≤ 12° | 12°–< 20° | ≥ 20° | 正常 0–5°，加上 2D 誤差與 30 fps 事件誤差（HS 差 1 幀時膝角可差數度）留寬 |
| 支撐期過伸 | KMIN_st | ≥ −4° | −9° < KMIN_st < −4° | ≤ −9° | 接近伸直時 2D 估計誤差相對大，留 −4° 緩衝避免把「伸直」誤判為「過伸」 |

**附加條件**：
- 「明顯」等級需該側 ≥ 2 個有效週期；只有 1 個週期時最多報「輕度」【推估：降低單一週期雜訊造成的誤報】。
- `v̂ < 1.0 L/s` 時，PKF_sw 的判斷需附註走速影響；若 PKF_sw 只到「輕度」且走速偏慢，報告措辭改為「可能與走得較慢有關」【推估】。
- 若同一側同時為「著地屈曲過多」與「擺盪期屈曲不足」，兩者都報（可能是整體膝活動度受限，例如膝痛或腫脹），並加強就醫提醒【推估】。

### 4.4 可能的原因（供動作庫對應）

| 原因代碼 | 原因 | 對應型態 | 依據 | 是否給動作 |
|---|---|---|---|---|
| `quad_rectus_tightness` | 股四頭肌／股直肌緊繃 | 擺盪期屈曲不足 | Kerrigan 1991（神經族群）[K3]；一般族群為【推估】 | 是 |
| `weak_push_off` | 推蹬不足（離地時膝屈曲速度不夠） | 擺盪期屈曲不足 | Goldberg 2003 [G1] | 是 |
| `slow_short_stride` | 走得慢、步伐小 | 擺盪期屈曲不足 | [F1][L2] | 是（步態提示） |
| `hamstring_tightness` | 膕旁肌（大腿後側）緊繃 | 著地屈曲過多 | 【推估】 | 是 |
| `quad_weakness` | 股四頭肌無力／耐力不足 | 著地屈曲過多、膝過伸 | 【推估】 | 是 |
| `knee_control_locking` | 習慣鎖膝、膝控制不佳 | 膝過伸 | 【推估】 | 是 |
| `knee_pain_swelling` | 膝痛、腫脹、手術後 | 任何型態 | 【推估】 | 否：提醒就醫評估 |

### 4.5 2D 量測限制與可信度因子（本問題特有）

- **擺盪期遮擋**：近側腳往前擺時通常清楚，但遠側腳擺盪時常與近側腳重疊；遠側 PKF_sw 不作判斷依據。
- **動態模糊**：擺盪期小腿角速度最大，30 fps 加上室內光線不足時，膝、踝點容易糊掉，**最大值可能被低估**。光線不足（`low_light`）時 PKF_sw 的可信度降一級【推估】。
- **事件時間誤差**：30 fps 時 HS 偵測誤差 1–2 幀（33–67 ms），KIC 取值位置會偏移；因此 KIC 取 HS ±1 幀平均。
- **褲管**：長褲、寬褲會讓膝點偏移；建議穿短褲或貼身褲。
- **鏡頭偏離矢狀面**：膝角會被低估（例如偏 30° 時，60° 的膝屈曲約只量到 56°，見 §6.1），使 PKF_sw 偏向「不足」。

---

## 5. 問題三：軀幹／頭部前傾

分兩個子項，各自分級，報告合併為一張卡片：

| 子項代碼 | 中文 |
|---|---|
| `trunk_forward_lean` | 軀幹前傾 |
| `head_forward` | 頭部前傾（頭往前伸） |

### 5.1 臨床／生物力學意義

- **白話**：走路時上半身往前彎、或頭往前伸，身體重心偏前，背部、脖子與大腿後側要多出力撐住，也比較容易「追著重心走」。
- **專業說明**：
  - 頭、手臂、軀幹佔體重一半以上，軀幹的小幅前傾就會改變地面反作用力方向與下肢關節力矩【文獻：Preece 2019 [P2]】。健康人刻意增加 5° 軀幹前傾，就會讓髖、踝力矩上升，並使內側膕旁肌在支撐早期的活動量增加約 100%【文獻：Preece & Alghamdi 2021 [P3]】；健康人中習慣前傾者（比後仰者多約 5°）膝屈肌活動與共同收縮也較高【文獻：Alghamdi & Preece 2020 [A2]】。膝退化性關節炎患者行走時軀幹平均多前傾 2.6°【文獻：Preece 2019 [P2]】。
  - 頭部前傾（forward head posture, FHP）常以頭顱脊椎角（craniovertebral angle, CVA：耳屏—第七頸椎連線與水平線的夾角）評估；頸痛者 CVA 較小，且與頸部失能程度中度相關【文獻：Yip 2008 [Y2]】。近期研究以行走表現分群，提出 CVA 44° 為 FHP 切點，並發現 FHP 組在承重期與擺盪前後期的軀幹屈曲較大【文獻：Lin 2025 [L4]】。系統性回顧指出 FHP 與姿勢控制、步態的關係證據仍有限【文獻：Lin 2022 [L5]】。
  - 頭部位置在行走中也可以穩定量測（耳屏與 C7 水平距離的再測信度高）【文獻：Lee 2017 [L6]】。

### 5.2 指標定義

| 指標 | 關鍵點 | 定義 | 時相 |
|---|---|---|---|
| **TRK** 軀幹前傾角 | 肩中點 M_S（11、12）、髖中點 M_H（23、24）；遠側點 visibility 低時改用近側肩、近側髖 | `τ = atan2( d·(X_MS − X_MH), (Y_MH − Y_MS) )`，前傾為正 | 整個週期平均 → 跨週期中位數 |
| **NCK** 頸傾角 | 近側 ear（7 或 8）、近側 shoulder（11 或 12） | `ν = atan2( d·(X_ear − X_sh), (Y_sh − Y_ear) )`，耳在肩前方為正 | 同上 |
| CVA-proxy（輔助，僅研究用） | 同上 | `90° − ν`（肩→耳連線與水平線夾角） | 同上 |

注意事項：
- **CVA-proxy 不等於 CVA**：臨床 CVA 用 C7 棘突，MediaPipe 的 shoulder 點較接近肩峰（位置比 C7 更前、更低），因此 CVA-proxy 會系統性大於真正 CVA，**不可直接套用 44°、48° 等文獻切點**【推估】。
- 所有角度都需先做鏡頭水平校正（§1.5），因為這兩個指標都以「垂直線」為基準。
- 不分左右側；合併所有有效週期。
- 走路時低頭看地面會讓 ν 變大（但這是「看哪裡」而非姿勢問題）。拍攝說明需請使用者「眼睛看前方遠處」。

### 5.3 正常參考範圍與 2D 閾值草案

**文獻值**：

| 指標 | 參考值 | 來源 |
|---|---|---|
| 軀幹相對地面傾角（3D，健康成人） | −0.2° ± 3.6°（行走中變化範圍約 4°） | Chung 2010 [C1] |
| 胸廓相對垂直傾角（3D，健康成人，依中位數分組） | 後傾組 8.6° ± 3.9°、前傾組 16.1° ± 2.4° | Leardini 2013 [L7]（與 Chung 差異大，反映標記點定義不同） |
| 膝 OA vs 健康 | OA 多前傾 2.6° | Preece 2019 [P2] |
| FHP 切點（CVA，行走表現分群） | 44° | Lin 2025 [L4] |
| 站姿理想對位 | 耳、肩峰、大轉子大致落在同一鉛垂線 | Kendall 姿勢鉛垂線【待驗證：教科書，未逐字核對】 |

> 重點：「軀幹前傾」的正常值因定義而差很多（Chung 約 0°，Leardini 約 12°）。MediaPipe 的「肩—髖」連線最接近「肩峰—大轉子」連線，站直時理論上接近 0°，但實際值需用本產品資料建立。

**閾值草案**【推估】：

| 子項 | 指標 | 正常 | 輕度 | 明顯 | 設計理由 |
|---|---|---|---|---|---|
| 軀幹前傾 | TRK | < 7° | 7°–< 12° | ≥ 12° | Chung 2010 健康平均約 0°、SD 3.6°：7° ≈ +2 SD；12° 再加上約 1 個 2D 誤差與水平校正殘差 |
| 頭部前傾 | NCK | < 20° | 20°–< 30° | ≥ 30° | **完全推估**：無 MediaPipe 肩—耳角的常模；建議第一版此子項只在「明顯」時報告，或先僅作觀察（§10） |

**附加條件**：
- 鏡頭水平校正可信度為「低」（|α| > 8°）時，TRK 與 NCK 最高只報「輕度」，並提示重拍【推估】。
- 若 TRK ≥ 7°，在報告髖伸展時要套用 §3.2 的交叉規則。
- 若影片中可觀察到使用者全程低頭（NCK 明顯、但 TRK 正常），文案需提醒「可能是走路時看地面」，並建議看前方重拍【推估】。

### 5.4 可能的原因（供動作庫對應）

| 原因代碼 | 原因 | 對應子項 | 依據 | 是否給動作 |
|---|---|---|---|---|
| `thoracic_stiffness` | 胸椎（上背）活動度差、駝背習慣 | 軀幹、頭 | 【推估】 | 是 |
| `pec_tightness` | 胸前肌群緊繃（圓肩） | 頭、軀幹 | 上交叉症候群相關運動介入 [S3][S4] | 是 |
| `deep_neck_flexor_weakness` | 深層頸屈肌耐力不足 | 頭 | 矯正運動可改善 CVA [S3] | 是 |
| `back_scapular_endurance` | 背部伸肌、肩胛後收肌群耐力不足 | 軀幹、頭 | [S4]；【推估】 | 是 |
| `hip_flexor_tightness` | 髖屈肌緊繃，把骨盆和上身往前拉 | 軀幹 | 【推估】（與 §3.4 共用） | 是 |
| `gaze_habit` | 走路看地面、看手機 | 頭 | 【推估】 | 是（步態提示） |
| `pain_balance_osteoporosis` | 背痛、平衡不佳怕跌、骨質疏鬆／脊椎壓迫性骨折、帕金森氏症等 | 軀幹 | 【推估】 | 否：提醒就醫評估 |

### 5.5 2D 量測限制與可信度因子（本問題特有）

- **鏡頭傾斜（roll）** 是最大誤差來源：手機歪 5°，軀幹角就差 5°。所以 §1.5 的水平校正對本問題是必要步驟。
- **鏡頭俯仰（pitch）與高度**：手機放太低往上拍或太高往下拍，會因透視讓上身看起來前傾或後仰【推估】；建議手機放在約腰部（髖）高度、鏡頭水平。
- **耳朵被頭髮、帽子遮住**：ear 的 visibility 低時，NCK 不計算（報告該子項「無法評估」），不影響 TRK。
- **背包、外套、長髮**：會改變肩點或耳點位置估計。
- **手擺動**：肩點會隨手臂擺動前後移動，取整個週期平均可抵消大部分影響【推估】。

---

## 6. 2D 量測限制與可信度計算

### 6.1 2D 手機影片 vs 3D 動作捕捉：主要差異

| 面向 | 3D 動作捕捉 | 本產品（2D 手機＋MediaPipe） | 對閾值的影響 |
|---|---|---|---|
| 骨盆 | 有 ASIS/PSIS 標記，可算骨盆傾斜與真正髖角 | 無骨盆前後標記，只能算軀幹—大腿角 | 髖伸展數值的基準不同，不能沿用 3D 常模 |
| 關節中心 | 依標記與模型計算 | 神經網路估計的「關鍵點」，與解剖中心可能有系統偏差 | 數值可能整體平移，需自建常模 |
| 平面外動作 | 3D 可分解 | 投影到影像平面，鏡頭偏離矢狀面時角度被壓縮 | 偏向低估屈伸幅度 |
| 時間解析度 | 通常 100–200 Hz | 一般 30 fps（33 ms/幀） | 事件時間誤差 1–2 幀；峰值可能被錯過 |
| 誤差量級 | 參考標準 | 髖 MAE 約 2–4°、膝約 2.4–5.6°、踝 4.8–7.4°【文獻：[S1][S2][Y1]】；不同開源模型精度差異大 [W2]，踝等小幅動作關節易誤判 [M3] | 閾值分級間至少隔約 1 個 MAE；第一版不用踝角 |
| 遠側肢體 | 可量 | 常被遮擋 | 只用近側；靠來回走取得雙側 |

**鏡頭偏離矢狀面的角度壓縮（幾何推算）**【推估：理想投影模型，未含透視與關鍵點誤差】：若真正矢狀面角為 θ（相對垂直），鏡頭水平偏轉 ψ，投影後角度約為 `θ' = atan( tan θ · cos ψ )`。

| 真實角度 | 偏 15° | 偏 20° | 偏 30° |
|---|---|---|---|
| 20°（髖伸展量級） | 19.4°（−0.6°） | 18.9°（−1.1°） | 17.5°（−2.5°） |
| 60°（擺盪膝屈曲量級） | 59.1°（−0.9°） | 58.4°（−1.6°） | 56.3°（−3.7°） |

> 小結：偏 20° 以內影響約 1–2°，偏 30° 以上影響接近 2D MAE，應降為「低」可信度。另外，Yang & Park 2024 用 MediaPipe 比較 5 種手機位置，發現前斜 45° 時髖、膝 MAE 反而略低於正側面（側面時遠側肢體遮擋較嚴重）【文獻：[Y1]】；但斜拍會讓本產品的「近側／遠側」與軀幹垂直基準更複雜，**第一版仍建議正側面拍攝**，斜拍列為未來研究方向。

### 6.2 降低可信度的因素總覽

1. 相機角度偏離矢狀面（`angle_off`）
2. 關鍵點 visibility 低、遮擋（`occlusion`）
3. 有效週期數不足（`few_cycles`）
4. 週期之間差異大（`high_variability`）
5. 人在畫面中太小（`subject_small`）
6. 部分時間出畫面（`partial_out_of_frame`）
7. 光線不足或模糊（`low_light`）
8. 手機晃動或移動（`camera_motion`）
9. 手機歪斜（`camera_tilt`）
10. 鏡頭畸變：使用超廣角（0.5×）或人走到畫面邊緣（`lens_distortion`）
11. 影格率過低（`low_fps`）
12. 左右錯置比例高（`lr_swap`）
13. 走速不穩定或過慢（`irregular_pace`；過慢另記 `slow_speed`，只影響解讀不影響可信度）

> 與 UX 文件對齊：`angle_off`、`few_cycles`、`occlusion`、`low_light`、`camera_motion`、`subject_small`、`partial_out_of_frame`、`irregular_pace` 沿用 `ux-flow-and-copy.md` §4.5 的代碼；`high_variability`、`camera_tilt`、`lens_distortion`、`low_fps`、`lr_swap`、`slow_speed` 為本文件新增，**需請 UX 補文案**。

### 6.3 可信度因子與分級（全部為【推估】，需以校正資料調整）

| 代碼 | 量測方式 | 高 | 中 | 低 |
|---|---|---|---|---|
| `angle_off` | (a) 髖寬比 \|X_LH − X_RH\| ÷ 軀幹長（有效週期中位數）；(b) 同一趟中腿長像素變化 `(L_max − L_min)/L_med` | (a) < 0.15 且 (b) < 10% | (a) 0.15–0.30 或 (b) 10–20% | (a) > 0.30 或 (b) > 20% |
| `occlusion` | 有效週期內，近側必要關鍵點平均 visibility；及被內插的影格比例 | ≥ 0.80 且內插 < 5% | 0.65–0.80 或內插 5–15% | < 0.65 或內插 > 15% |
| `few_cycles` | 每側有效週期數（近側） | 兩側皆 ≥ 2 且合計 ≥ 5 | 合計 ≥ 3，或僅一側 ≥ 2 | 合計 1–2 |
| `high_variability` | 主要指標跨週期標準差（PHE、PKF_sw；TRK） | ≤ 4° | 4–7° | > 7° |
| `subject_small` | 人體高度（頭頂到腳跟）佔畫面高度 | ≥ 50% | 30–50% | < 30% |
| `partial_out_of_frame` | 直線段中，任一必要關鍵點超出畫面的影格比例 | < 2% | 2–10% | > 10% |
| `camera_tilt` | 鏡頭水平估計 \|α\|（§1.5） | ≤ 3° | 3–8° | > 8° |
| `camera_motion` | 背景特徵點位移（若有實作）或 roll 估計在趟次間差異 | 穩定 | 輕微 | 明顯晃動 |
| `low_fps` | 影片影格率 | ≥ 30 fps | 24–29 fps | 15–23 fps（< 15 拒絕） |
| `lr_swap` | 被修正左右錯置的影格比例 | < 5% | 5–15% | > 15% |
| `lens_distortion` | 有效週期中骨盆位於畫面左右 10% 邊緣內的比例；或影片 metadata 顯示超廣角 | < 10% | 10–30% | > 30% 或超廣角 |
| `low_light` | 影像平均亮度或關鍵點跳動（高頻能量）| 正常 | 偏暗 | 很暗／明顯模糊 |
| `irregular_pace` | 各週期時間的變異係數 | < 8% | 8–15% | > 15% |

### 6.4 整體可信度計算（簡單、可解釋版）

```
若任一因子 = 低                → 整體「低」
否則若「中」的因子數 ≥ 3        → 整體「低」
否則若「中」的因子數 ≥ 1        → 整體「中」
否則                            → 整體「高」
```

- **指標層級可信度**：每個指標另依自己用到的關鍵點重算 `occlusion`、`few_cycles`、`high_variability`；例如耳朵看不清只影響 NCK，不影響髖、膝。報告每張問題卡以「整體」與「該指標」中較低者顯示。
- **顯示對應**：UX 文件目前對使用者只分「良好／較低」。建議：高、中 → 「良好」（中可在 ⓘ 補充說明），低 → 「較低」【待決定，§10】。
- **原因呈現**：可信度為「中」或「低」時，列出觸發的因子代碼（最多 2 個主要原因），交給 UX 文案。

---

## 7. 整體品質把關規則

### 7.1 拒絕並請重拍（任一成立就不出報告）

| 代碼 | 條件 | 說明 |
|---|---|---|
| `no_person` | 偵測到人的影格 < 50% | 對應 UX §5.1 |
| `multi_person` | 持續偵測到多人且無法鎖定主要人物 | 對應 UX §5.9（`numPoses=1` 時需另以畫面變化偵測，【待驗證】） |
| `body_incomplete` | 「全身完整」影格 < 60%。全身完整 = 頭（0 或 7/8）、近側肩、髖、膝、踝、腳跟、腳尖 visibility 皆 ≥ 0.5 且都在畫面內 | 對應 UX §5.2 |
| `no_gait_cycle` | 通過 §2.4 檢查的完整步態週期 = 0（任一側皆無） | 對應 UX §5.3；這是產品規定的底線 |
| `not_side_view` | 所有直線段的髖寬比 > 0.5，或幾乎沒有水平位移（正面朝鏡頭走） | 建議新增 UX 文案 |
| `too_short` / `low_fps_reject` | 影片 < 6 秒；或影格率 < 15 fps | 6 秒沿用 UX §5.4 的建議 |

### 7.2 分析但標示「低可信度」

不符合拒絕條件，但 §6.4 整體可信度為「低」，例如：
- 只有 1–2 個有效週期
- 只有一側腳有結果（例如只走了一趟）
- 角度明顯偏斜、手機歪斜 > 8°、光線很暗
- 關鍵點平均 visibility 0.5–0.65

此時：
- 報告照常產出，最上方顯示低可信度提示與主要原因、具體重拍建議。
- 嚴重度照算並照常顯示（SPEC D20：加註「僅供參考」）；但「明顯」需同時滿足「該側 ≥ 2 個有效週期」，否則最多「輕度」（§4.3）。
- LLM 撰寫白話時，用「可能」「影片中看起來」等保留語氣（交給 UX/Prompt 規格）。

### 7.3 最低資料量建議

- **最低**：≥ 1 個完整有效週期（產品底線，低於此拒絕）。
- **建議**：每側 ≥ 2 個近側有效週期，合計 ≥ 5 個（達到「高」可信度）。
- 以 10–20 秒、來回 2 趟、每趟 2–3 個週期估算：每側約 2–3 個近側週期，剛好達標；若走道太短（< 4 m）或轉身太慢，就容易掉到「中／低」。拍攝教學應強調**走道 4–5 公尺、來回 2 趟**。

### 7.4 拍攝條件建議（給 UX 拍攝教學參考）

| 項目 | 建議 | 依據 |
|---|---|---|
| 相機位置 | 與走道垂直、距走道約 3–3.5 m | Stenum 2021 約 3.3 m [S1]；Yang & Park 2024 為 3 m [Y1] |
| 相機高度 | 約髖部高度（0.8–1.3 m），鏡頭水平 | Stenum 1.3 m、Yang 0.8 m |
| 方向 | 橫式（landscape） | 讓 4–5 m 走道和全身都入鏡 |
| 鏡頭 | 主鏡頭 1×，不用超廣角 0.5× | 降低邊緣畸變【推估】 |
| 影格率 | 30 fps 以上（有 60 fps 更好） | 事件時間解析度 |
| 服裝 | 短褲或貼身褲、露出腳踝；穿平常走路的鞋 | 膝踝點估計穩定 |
| 環境 | 光線充足、背景單純、無他人或鏡子 | 減少誤偵測 |
| 走法 | 平常速度、眼睛看前方、走 4–5 m 直線、轉身、走回來，共 2 趟 | 有效週期數、頭部指標 |

---

## 8. 閾值總表（工程用）

所有數值皆為**近側、跨週期中位數**；正負號見 §0.5。

```yaml
version: gait-rules-v0.1-draft
hip_extension_deficit:
  metric: PHE            # 峰值髖伸展（軀幹—大腿），度，正值=伸展
  window: [HS+15%, TO]
  normal: ">= 12"
  mild: "[8, 12)"
  marked: "< 8"
  guard:
    - "if TE >= 12 and TRK >= 7: do not flag (attribute to trunk lean)"
    - "borderline band ±1.5 deg -> wording 'near threshold'"
  evidence: estimated   # 推估
knee_flexion_abnormal:
  swing_flexion_low:
    metric: PKF_sw       # 擺盪期最大膝屈曲
    window: [TO, next HS]
    normal: ">= 52"
    mild: "[45, 52)"
    marked: "< 45"       # 貼齊 Lee 2024 的 44.3（中風族群）
    asymmetry_aux: { metric: dPKF, mild: "(10, 17]", marked: "> 17" }
  stance_flexion_high:
    metric: KIC          # 初始著地膝角（HS ±1 幀平均）
    normal: "<= 12"
    mild: "(12, 20)"
    marked: ">= 20"
  stance_hyperextension:
    metric: KMIN_st      # 支撐期最小膝角，負值=過伸
    window: [HS+15%, TO]
    normal: ">= -4"
    mild: "(-9, -4)"
    marked: "<= -9"
  marked_requires_cycles_per_side: 2
trunk_head_forward:
  trunk_forward_lean:
    metric: TRK          # 軀幹前傾角，整週期平均
    normal: "< 7"
    mild: "[7, 12)"
    marked: ">= 12"
  head_forward:
    metric: NCK          # 頸傾角（肩→耳 相對垂直）
    normal: "< 20"
    mild: "[20, 30)"
    marked: ">= 30"
    evidence: fully_estimated   # 完全推估，建議 v1 僅報告「明顯」或僅作觀察
interpretation_flags:
  slow_speed: "v_hat < 1.0 leg_length/s"
```

建議的單次分析輸出（交給 LLM 的結構化結果，LLM 不得改動數值與分級）：

```json
{
  "rules_version": "gait-rules-v0.1-draft",
  "confidence": { "overall": "medium", "reasons": ["angle_off", "few_cycles"] },
  "walking": { "passes": 2, "valid_cycles": { "left": 2, "right": 3 }, "speed_leg_per_s": 1.25, "slow_speed": false },
  "findings": [
    {
      "problem": "hip_extension_deficit",
      "severity": "mild",
      "side": "right",
      "metrics": { "PHE_left": 13.1, "PHE_right": 9.4, "TE_right": 10.2 },
      "metric_confidence": "medium",
      "near_threshold": false,
      "candidate_causes": ["hip_flexor_tightness", "glute_weakness", "weak_push_off", "slow_short_stride"]
    }
  ]
}
```

---

## 9. 建議的校正與驗證計畫

閾值要從「推估」變成「可上線」，建議至少做以下幾件事（對應 SPEC 里程碑 M5「真人影片校正」與風險 R4）：

1. **建立本產品的 2D 常模（必要）**：招募 30–50 位自述無下肢疼痛、無神經疾患的成人（分年齡層），依拍攝教學各拍 2 段影片，用本產品管線計算 PHE、TE、PKF_sw、KIC、KMIN_st、TRK、NCK 的分布與再測信度（ICC、測量標準誤 SEM、最小可偵測變化 MDC）。閾值可改以「本產品常模的百分位數」設定（例如 < 第 10 百分位 = 輕度、< 第 3 百分位 = 明顯），再由產品負責人審核臨床合理性。
2. **對照驗證（強烈建議）**：
   - 若可取得動作捕捉實驗室：同步拍攝，評估 MediaPipe 在我們定義下的偏差（Bland-Altman）與峰值誤差，而非只看整條曲線的 MAE。
   - 若無實驗室：可用公開資料集作初步比對，例如 Fukuchi 2018 公開的平地與跑步機行走運動學資料【文獻：[F2]】（需確認是否含同步影片；若無影片，只能用於比較常模範圍）。
   - 人為模擬：請受試者刻意小步走、刻意前傾、刻意僵直膝走，確認規則能抓到（敏感度），正常走時不誤報（特異度）。
3. **捐贈資料的用途與限制**：依 SPEC D19，使用者只捐骨架數據與分析結果。這些資料可用來觀察真實使用者的指標分布與可信度因子觸發率，但樣本自我選擇、沒有臨床標記，**不能單獨用來定義「正常」**，只能輔助調整。
4. **故障情境測試**：故意偏 15°/30° 拍、手機歪 5°/10°、穿長褲、暗光、超廣角，確認可信度因子有正確觸發。

---

## 10. 待產品負責人決定的問題

1. **閾值策略**：第一版上線時，閾值要用本文件的「推估值」，還是先完成 §9 的常模研究、改用「本產品常模百分位數」？若先上線，是否要在報告標示「測試版標準」？
2. **髖伸展的定義**：主要指標用「軀幹—大腿角（PHE）」並以「大腿相對垂直（TE）」交叉檢查（本文件建議），還是直接改用 TE 當主要指標（較不受軀幹前傾影響，但與「髖角」的臨床直覺不同）？
3. **膝過伸是否納入第一版**：UX 文件目前只有「彎太少」「彎太多」兩型。膝過伸在 2D 接近伸直時誤差相對大，誤報風險較高，是否延後到第二版？
4. **頭部前傾的處理**：NCK 閾值完全是推估、也沒有 MediaPipe 版 CVA 的常模。第一版是否 (a) 照常分級、(b) 只在「明顯」時報告、或 (c) 只作「觀察」不觸發動作建議？
5. **左右側報告**：靠來回走取得兩側近側資料，但每側只有 2–3 個週期。是否要對使用者顯示「主要在左／右腳」？還是只報整體？
6. **走速偏慢的處理**：偏慢時是否要自動降低嚴重度、或只在文案附註（本文件建議只附註）？是否要在拍攝教學中強調「用平常速度」？
7. **可信度對使用者的呈現**：內部三級（高／中／低）是否對應到 UX 的兩級（良好／較低），「中」要歸哪一邊？
8. **低可信度時的「明顯」等級**：SPEC D20 已決定「低可信度時仍顯示等級，加註僅供參考」。本文件另加一道規則層的防護：該側有效週期 < 2 時最多判「輕度」（§4.3、§7.2）。請確認這道防護與 D20 不衝突。
9. **族群範圍**：第一版是否限定成人（例如 18 歲以上）？兒童、孕婦、明顯神經疾患（中風、帕金森）的步態超出本規則設計範圍，是否在上傳前用問卷排除或加警示？
10. **跨問題歸因**：當軀幹前傾與髖伸展不足同時出現時，本文件建議以軀幹前傾為主、避免重複報告；這個優先順序是否符合你的臨床判斷？
11. **要不要讓使用者輸入身高**：若輸入身高，可把速度換算成 m/s，並與 Andrews 2023 的年齡性別常模比較；代價是多一個步驟。

---

## 11. 參考文獻

> 以下文獻皆已在 PubMed（E-utilities）或期刊官網查證存在，數值取自摘要或全文；標【待驗證】者為教科書或尚未逐字核對的內容。

**步態事件與 2D 姿勢估計**

- [Z1] Zeni JA Jr, Richards JG, Higginson JS. Two simple methods for determining gait events during treadmill and overground walking using kinematic data. *Gait & Posture*. 2008;27(4):710–714. doi:10.1016/j.gaitpost.2007.07.007
- [O1] O'Connor CM, Thorpe SK, O'Malley MJ, Vaughan CL. Automatic detection of gait events using kinematic data. *Gait & Posture*. 2007;25:469–474. doi:10.1016/j.gaitpost.2006.05.016
- [S1] Stenum J, Rossi C, Roemmich RT. Two-dimensional video-based analysis of human gait using pose estimation. *PLoS Computational Biology*. 2021;17(4):e1008935. doi:10.1371/journal.pcbi.1008935
- [S2] Stenum J, Hsu MM, Pantelyat AY, Roemmich RT. Clinical gait analysis using video-based pose estimation: Multiple perspectives, clinical populations, and measuring change. *PLOS Digital Health*. 2024;3(3):e0000467. doi:10.1371/journal.pdig.0000467
- [Y1] Yang J, Park K. Improving gait analysis techniques with markerless pose estimation based on smartphone location. *Bioengineering*. 2024;11(2):141. doi:10.3390/bioengineering11020141
- [W2] Washabaugh EP, Shanmugam TA, Ranganathan R, Krishnan C. Comparing the accuracy of open-source pose estimation methods for measuring gait kinematics. *Gait & Posture*. 2022;97:188–195. doi:10.1016/j.gaitpost.2022.08.008（比較 OpenPose、MoveNet、DeepLabCut，未含 MediaPipe）
- [M3] Menychtas D, et al. Gait analysis comparison between manual marking, 2D pose estimation algorithms, and 3D marker-based system. *Frontiers in Rehabilitation Sciences*. 2023;4:1238134. doi:10.3389/fresc.2023.1238134（OpenPose、MediaPipe 在老人跑步機步態；踝等小幅動作關節易誤判）
- [G2] Gao X, Cheng X, Jiao Y, Reading S, Zhang Y. Can gait deviations be identified through video-based gait analysis? Validation of the BlazePose pose estimation algorithm. *Annu Int Conf IEEE Eng Med Biol Soc*. 2025:1–5. doi:10.1109/EMBC58623.2025.11254531
- [M1] Google AI Edge. MediaPipe Pose Landmarker guide. https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker（33 個關鍵點、預設信心門檻、模型版本）
- [M2] MediaPipe Pose（legacy solution 文件）. https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md（x、y 正規化方式、z 深度與 visibility 定義）

**髖伸展**

- [K1] Kerrigan DC, Todd MK, Della Croce U, Lipsitz LA, Collins JJ. Biomechanical gait alterations independent of speed in the healthy elderly: evidence for specific limiting impairments. *Archives of Physical Medicine and Rehabilitation*. 1998;79(3):317–322. doi:10.1016/s0003-9993(98)90013-2
- [K2] Kerrigan DC, Lee LW, Collins JJ, Riley PO, Lipsitz LA. Reduced hip extension during walking: healthy elderly and fallers versus young adults. *Archives of Physical Medicine and Rehabilitation*. 2001;82(1):26–30. doi:10.1053/apmr.2001.18584
- [L1] Lee LW, Zavarei K, Evans J, Lelas JJ, Riley PO, Kerrigan DC. Reduced hip extension in the elderly: dynamic or postural? *Archives of Physical Medicine and Rehabilitation*. 2005;86(9):1851–1854. doi:10.1016/j.apmr.2005.03.008
- [W1] Watt JR, Jackson K, Franz JR, Dicharry J, Evans J, Kerrigan DC. Effect of a supervised hip flexor stretching program on gait in elderly individuals. *PM&R*. 2011;3(4):324–329. doi:10.1016/j.pmrj.2010.11.012

**膝屈曲**

- [K3] Kerrigan DC, Gronley J, Perry J. Stiff-legged gait in spastic paresis: a study of quadriceps and hamstrings muscle activity. *American Journal of Physical Medicine & Rehabilitation*. 1991;70(6):294–300.
- [G1] Goldberg SR, Õunpuu S, Delp SL. The importance of swing-phase initial conditions in stiff-knee gait. *Journal of Biomechanics*. 2003;36(8):1111–1116. doi:10.1016/s0021-9290(03)00106-4
- [L3] Lee J, Lee RK, Seamon BA, Kautz SA, Neptune RR, Sulzer J. Between-limb difference in peak knee flexion angle can identify persons post-stroke with Stiff-Knee gait. *Clinical Biomechanics*. 2024;120:106351. doi:10.1016/j.clinbiomech.2024.106351

**軀幹與頭部**

- [C1] Chung CY, Park MS, Lee SH, Kong SJ, Lee KM. Kinematic aspects of trunk motion and gender effect in normal adults. *Journal of NeuroEngineering and Rehabilitation*. 2010;7:9. doi:10.1186/1743-0003-7-9
- [L7] Leardini A, Berti L, Begon M, Allard P. Effect of trunk sagittal attitude on shoulder, thorax and pelvis three-dimensional kinematics in able-bodied subjects during gait. *PLoS ONE*. 2013;8(10):e77168. doi:10.1371/journal.pone.0077168
- [P2] Preece SJ, Algarni AS, Jones RK. Trunk flexion during walking in people with knee osteoarthritis. *Gait & Posture*. 2019;72:202–205. doi:10.1016/j.gaitpost.2019.06.012
- [A2] Alghamdi W, Preece SJ. How does normal variability in trunk flexion affect lower limb muscle activity during walking? *Human Movement Science*. 2020;72:102630. doi:10.1016/j.humov.2020.102630
- [P3] Preece SJ, Alghamdi W. The effect of increasing trunk flexion during normal walking. *Gait & Posture*. 2021;83:250–255. doi:10.1016/j.gaitpost.2020.10.021
- [Y2] Yip CH, Chiu TT, Poon AT. The relationship between head posture and severity and disability of patients with neck pain. *Manual Therapy*. 2008;13(2):148–154. doi:10.1016/j.math.2006.11.002
- [L4] Lin G, Zhao X, Tao Z, Wang W. Gait biomechanics and postural adaptations in forward head posture: a comparative cross-sectional study. *BMC Musculoskeletal Disorders*. 2025;26:754. doi:10.1186/s12891-025-08882-8
- [L5] Lin G, Zhao X, Wang W, Wilkinson T. The relationship between forward head posture, postural control and gait: A systematic review. *Gait & Posture*. 2022;98:316–329. doi:10.1016/j.gaitpost.2022.10.008
- [L6] Lee CH, Lee S, Shin G. Reliability of forward head posture evaluation while sitting, standing, walking and running. *Human Movement Science*. 2017;55:81–86. doi:10.1016/j.humov.2017.07.008
- [S3] Sheikhhoseini R, Shahrbanian S, Sayyadi P, O'Sullivan K. Effectiveness of therapeutic exercise on forward head posture: a systematic review and meta-analysis. *Journal of Manipulative and Physiological Therapeutics*. 2018;41(6):530–539. doi:10.1016/j.jmpt.2018.02.002
- [S4] Sepehri S, Sheikhhoseini R, Piri H, Sayyadi P. The effect of various therapeutic exercises on forward head posture, rounded shoulder, and hyperkyphosis among people with upper crossed syndrome: a systematic review and meta-analysis. *BMC Musculoskeletal Disorders*. 2024;25:105. doi:10.1186/s12891-024-07224-4

**走速與常模**

- [L2] Lelas JL, Merriman GJ, Riley PO, Kerrigan DC. Predicting peak kinematic and kinetic parameters from gait speed. *Gait & Posture*. 2003;17(2):106–112. doi:10.1016/s0966-6362(02)00060-7
- [F1] Fukuchi CA, Fukuchi RK, Duarte M. Effects of walking speed on gait biomechanics in healthy participants: a systematic review and meta-analysis. *Systematic Reviews*. 2019;8:153. doi:10.1186/s13643-019-1063-z
- [F2] Fukuchi CA, Fukuchi RK, Duarte M. A public dataset of overground and treadmill walking kinematics and kinetics in healthy individuals. *PeerJ*. 2018;6:e4640. doi:10.7717/peerj.4640
- [A1] Andrews AW, Vallabhajosula S, Boise S, Bohannon RW. Normal gait speed varies by age and sex but not by geographical region: a systematic review. *Journal of Physiotherapy*. 2023;69:47–52. doi:10.1016/j.jphys.2022.11.005

**教科書（數值頁碼待核對）**

- [P1] Perry J, Burnfield JM. *Gait Analysis: Normal and Pathological Function*. 2nd ed. Thorofare, NJ: SLACK Incorporated; 2010.【待驗證：文中引用的 IC 膝角 0–5°、承重期約 15°、擺盪期約 60°、支撐末期大腿約 20° 表觀過伸、支撐期約 60% 為教科書常見引用值，請產品負責人對照原書頁碼】
- Kendall FP, McCreary EK, Provance PG, et al. *Muscles: Testing and Function with Posture and Pain*. 5th ed. Lippincott Williams & Wilkins; 2005.【待驗證：鉛垂線姿勢對位】
