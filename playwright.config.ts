/**
 * 這個檔案做什麼：
 *   Playwright（端到端測試工具）的設定：在真的瀏覽器（Chromium）裡打開網站、點按鈕、選檔案，
 *   確認整個流程正常。執行：npm run test:e2e（第一次會先建置網站，約 1 分鐘）。
 *
 *   - 瀏覽器使用環境中已安裝的 Chromium（PLAYWRIGHT_BROWSERS_PATH），不需要另外下載。
 *   - 注意：Playwright 內建的 Chromium 不支援 H.264 影片，所以測試影片用 VP9 編碼的 MP4。
 *   - 想用真實走路影片跑完整流程：E2E_WALK_VIDEO=/影片路徑.mp4 npm run test:e2e
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
