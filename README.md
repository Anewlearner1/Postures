<div align="center">
  <img width="1200" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

  <h1>🚀 AI Studio 應用程式：商用開發範本</h1>

  <p>
    <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-LTS-green?style=flat-square&logo=node.js" alt="Node.js"></a>
    <a href="https://ai.google.dev/"><img src="https://img.shields.io/badge/Model-Gemini%20Pro-blue?style=flat-square&logo=google-gemini" alt="Gemini"></a>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="License"></a>
  </p>

  <p><b>本專案是一個基於 Google AI Studio 打造的高效能 AI 應用，旨在提供穩定且易於擴展的生成式 AI 解決方案。</b></p>

  <a href="https://ai.studio/apps/2469975a-2ce5-4fb5-8a4d-34e8ece01753">🌐 點此在 AI Studio 中檢視應用程式</a>
</div>

---

## ✨ 核心功能 (Key Features)

* **⚡ 即時推論：** 完美整合 Gemini API，實現毫秒級的 AI 回應速度。
* **🛠️ 開發友善：** 預配置的 Node.js 環境，支援熱重載（Hot Reload）快速開發。
* **🛡️ 安全架構：** 嚴謹的環境變數隔離機制，確保 API Key 不外洩。
* **📱 響應式佈局：** 前端介面適配各類行動裝置與桌面瀏覽器。

---

## 🚶 步態分析 (Gait Analysis)

除了以正面／側面照片進行的「體態分析」之外，應用程式首頁上方可切換至「步態分析」分頁，
直接上傳一段手機（含 iPhone）拍攝的走路影片即可取得完整步態報告。

流程：

1. 點擊上傳區域，從相簿選擇或當場拍攝一段 5-10 秒的走路影片（MP4 / MOV）。
2. 瀏覽器會在本機以 `<video>` + `<canvas>` 擷取約 12 張連續影格（最長取影片中段 8 秒、約 2 fps），
   並縮至 640px、JPEG 壓縮，影片本身不會上傳。
3. 將這些影格連同時間戳一併送入 Gemini，取得步態週期、左右對稱性、軀幹／骨盆代償、
   異常步態型態（如跛行、垂足步態）、建議訓練與 0-100 總分。
4. 登入後記錄會同步至 Firestore 的 `gaitHistory` 集合；未登入則保留最近 3 筆於 localStorage。

拍攝建議：請他人於正面或側面固定手機拍攝，全身（含腳掌）入鏡、背景單純、走 3-5 步以上。

相關檔案：`src/components/GaitAnalyzer.tsx`、`src/services/video.ts`、`src/services/gait.ts`。

---

## 🛠️ 本地開發指南 (Getting Started)

要開始執行此專案，請確保你的電腦已安裝 **Node.js (v18+)**。

### 1. 複製專案與安裝套件
```bash
git clone [你的倉庫網址]
cd [你的專案資料夾]
npm install
