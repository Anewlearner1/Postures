/**
 * 這個檔案做什麼：
 *   Next.js 的設定。目前用來替「全站」加上安全標頭（瀏覽器看到這些標頭，就會替網站多一層保護）。
 *   審查說明見 docs/review/M5-security.md。
 *
 *   最重要的是 Content-Security-Policy（CSP，內容安全政策）：
 *   - connect-src 'self'：網頁（包含背景執行緒）只能連回本網站，不能把任何資料送到其他網址。
 *     這是「影片只在你的裝置上分析」在瀏覽器層級的保證：就算之後不小心加入會回傳資料的套件，
 *     瀏覽器也會擋下來。
 *   - script-src 'wasm-unsafe-eval'：允許骨架偵測（MediaPipe）的 WebAssembly 執行。
 *   - media-src blob:、img-src blob: data:：允許播放使用者自己選的影片（只存在瀏覽器記憶體中的 blob: 網址）。
 *   - worker-src 'self'：背景執行緒只能載入本網站的程式。
 *   - frame-ancestors 'none'：不允許其他網站把本網站嵌在框架裡（防止點擊劫持）。
 *
 *   取捨：網頁是預先產生的靜態頁，Next.js 會在頁面中放入行內程式，所以 script-src 需要 'unsafe-inline'
 *   （改用 nonce 需要所有頁面改成每次請求即時產生，成本較高；見審查報告「保留事項」）。
 *   開發模式（npm run dev）另外需要 'unsafe-eval'（React 開發工具使用），正式版不需要。
 */

import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * 關閉用不到的瀏覽器功能（相機、麥克風、定位等）。
 * 保留：screen-wake-lock（分析時讓螢幕不要自動關閉）、fullscreen（影片全螢幕）、clipboard-write（複製網址）。
 */
const permissionsPolicy = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "hid=()",
  "midi=()",
  "accelerometer=()",
  "gyroscope=()",
  "magnetometer=()",
  "display-capture=()",
  "browsing-topics=()",
  "screen-wake-lock=(self)",
  "fullscreen=(self)",
  "clipboard-write=(self)",
].join(", ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: permissionsPolicy },
  // 舊瀏覽器不認得 CSP 的 frame-ancestors 時的備援
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // 只在 HTTPS 下生效（本機 http://localhost 會被瀏覽器忽略）；Vercel 預設也會加上
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

const nextConfig: NextConfig = {
  // 不在回應中透露「本網站使用 Next.js」
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
