/**
 * 這個檔案做什麼：
 *   「錯誤／請重拍」畫面的文案，依錯誤代碼查詢。
 *   文案來源：docs/spec/ux-flow-and-copy.md §5（錯誤與重拍文案）。
 *   代碼名稱對齊 docs/spec/gait-rules.md §7.1（拒絕代碼）。
 *
 * 說明：UX 文案中的 {秒數}、{影格率} 等變數，要等 M3 真的讀取影片後才知道，
 *       目前先用不含數字的通用說法。
 */

import type { RejectCode } from "@/lib/gait/types";
import type { UploadErrorCode } from "@/lib/upload/validate-video";
import { UPLOAD_LIMITS } from "@/data/site";

/** 環境層級的錯誤（UX §5.8、§5.9）。 */
export type EnvironmentErrorCode =
  | "browser_unsupported"
  | "analysis_interrupted"
  | "video_unreadable"
  | "model_load_failed";

/** 所有會顯示「錯誤／請重拍」畫面的代碼。 */
export type RetakeCode = RejectCode | UploadErrorCode | EnvironmentErrorCode;

/** 畫面上的按鈕：一般連結、複製網址、重新整理。 */
export type RetakeAction =
  | { kind: "link"; label: string; href: string }
  | { kind: "copy_url"; label: string }
  | { kind: "reload"; label: string };

export interface RetakeMessage {
  title: string;
  description: string;
  /** 「怎麼解決」條列；沒有就不顯示。 */
  solutions: string[];
  primary: RetakeAction;
  secondary?: RetakeAction;
}

const RESELECT: RetakeAction = { kind: "link", label: "重新選擇影片", href: "/upload" };
const SEE_GUIDE: RetakeAction = { kind: "link", label: "看拍攝教學", href: "/guide" };

export const RETAKE_MESSAGES: Record<RetakeCode, RetakeMessage> = {
  // ---- 內容層級：分析中發現，請重拍（UX §5.1–5.4、§5.9–5.11） ----
  no_person: {
    title: "我們在影片中找不到人",
    description: "分析時沒有偵測到人體，可能是畫面太暗、人太小，或選錯了影片。",
    solutions: [
      "確認選擇的是走路影片",
      "在光線充足的地方重拍，避免背光",
      "手機離走路路線約 3 公尺，讓人在畫面中夠大",
    ],
    primary: RESELECT,
    secondary: SEE_GUIDE,
  },
  body_incomplete: {
    title: "畫面中沒有拍到完整的身體",
    description:
      "影片中大部分時間只拍到上半身或下半身，我們需要看到從頭到腳的完整身體，才能計算角度。",
    solutions: [
      "手機往後移一點，或改成橫著拍",
      "手機放在約腰的高度，讓頭頂和腳底都在畫面內",
      "拍完先看一下，確認走過整個畫面時都沒有被切到",
    ],
    primary: RESELECT,
    secondary: SEE_GUIDE,
  },
  no_gait_cycle: {
    title: "影片中完整的步伐不夠",
    description:
      "我們至少需要看到一個完整的步伐（同一隻腳從踩地、往前擺，到再次踩地），但這段影片中沒有找到。常見原因是走的距離太短、在原地踏步，或大部分時間在轉身。",
    solutions: [
      "找一段至少 4–5 公尺的平地，從畫面一端走到另一端",
      "來回走 2 趟，用平常的速度",
      "確認走路的整段過程都在畫面內",
    ],
    primary: RESELECT,
    secondary: SEE_GUIDE,
  },
  too_short: {
    title: "影片太短了",
    description: "這段影片太短。我們需要 10–20 秒的影片，才能拍到足夠的步伐。",
    solutions: ["重拍一段 10–20 秒的影片，在平地上來回走 2 趟。"],
    primary: RESELECT,
    secondary: SEE_GUIDE,
  },
  multi_person: {
    title: "畫面中好像有不只一個人",
    description:
      "我們只能分析一個人。請在沒有其他人經過的地方重拍，也要注意鏡子裡的倒影。",
    solutions: [],
    primary: RESELECT,
    secondary: SEE_GUIDE,
  },
  not_side_view: {
    title: "這段影片好像不是從側面拍的",
    description:
      "我們需要從側面看你走路，才能量出膝蓋和髖部的角度。這段影片看起來是從正面或背面拍的，或是你朝著鏡頭走過來。",
    solutions: [
      "把手機放在走路路線的旁邊，鏡頭和路線垂直",
      "從畫面的一端走到另一端（橫著走過畫面），而不是朝著手機走",
    ],
    primary: RESELECT,
    secondary: SEE_GUIDE,
  },
  low_fps_reject: {
    title: "影片的畫面太少，無法分析",
    description:
      "這段影片每秒的畫面（fps）太少，會錯過走路時的重要動作，我們沒辦法準確分析。常見原因是用了縮時攝影、省電模式，或影片被壓縮過（例如透過通訊軟體傳送）。",
    solutions: [
      "用手機的一般「錄影」模式重拍，畫質設定為 1080p、30 fps",
      "如果影片是別人用 LINE 等通訊軟體傳給你的，請對方用「原始檔案」或雲端連結傳送",
    ],
    primary: RESELECT,
    secondary: SEE_GUIDE,
  },

  // ---- 檔案層級：選擇影片後、分析前（UX §5.6、§5.7） ----
  unsupported_format: {
    title: "這個影片格式無法開啟",
    description:
      "你的瀏覽器無法讀取這個影片。我們支援 MP4 和 MOV 格式，但部分手機用的高效率格式（HEVC），某些瀏覽器無法開啟。",
    solutions: [
      "iPhone：到「設定 → 相機 → 格式」，選「最相容」，再重拍一次",
      "或改用手機上的 Safari（iPhone）或 Chrome（Android）開啟本網站再上傳",
      "如果是其他格式（例如 AVI），請先用手機或電腦轉成 MP4",
    ],
    primary: RESELECT,
    secondary: SEE_GUIDE,
  },
  not_video: {
    title: "這不是影片檔",
    description: "你選擇的檔案不是影片。請選擇一段走路影片。",
    solutions: [],
    primary: RESELECT,
  },
  too_large: {
    title: "影片檔案太大了",
    description: `這段影片超過 ${UPLOAD_LIMITS.maxSizeMB} MB。檔案太大可能讓你的裝置跑不動。`,
    solutions: [
      "把影片剪短到 10–20 秒",
      "或把手機錄影畫質調成「1080p、30 fps」再重拍（4K 或 60 fps 的檔案會大很多，對分析沒有幫助）",
    ],
    primary: RESELECT,
  },

  // ---- 環境層級（UX §5.8、§5.9） ----
  browser_unsupported: {
    title: "你的瀏覽器無法執行分析",
    description: "分析需要較新的瀏覽器功能，目前這個瀏覽器不支援。",
    solutions: [
      "請改用最新版的 Chrome、Safari 或 Edge 開啟本網站",
      "複製網址後，貼到其他瀏覽器的網址列開啟",
    ],
    primary: { kind: "copy_url", label: "複製網址" },
  },
  analysis_interrupted: {
    title: "分析中斷了",
    description: "你的裝置可能記憶體不足，或分析時切換到其他 App，導致分析停止。",
    solutions: [
      "關閉其他 App 或分頁後再試一次",
      "分析時請保持這個畫面開著",
      "如果一直失敗，可以改用電腦分析（把影片傳到電腦）",
    ],
    primary: { kind: "link", label: "再試一次", href: "/analyze" },
    secondary: RESELECT,
  },
  video_unreadable: {
    title: "這段影片無法播放",
    description:
      "檔案可能損毀或還沒完整下載（例如存在雲端相簿）。請確認影片在手機上能正常播放，再試一次。",
    solutions: [],
    primary: RESELECT,
    secondary: SEE_GUIDE,
  },
  model_load_failed: {
    title: "無法載入分析工具",
    description:
      "第一次使用時，需要下載分析工具。請確認網路連線後重新整理。你的影片仍然不會上傳。",
    solutions: [],
    primary: { kind: "reload", label: "重新整理" },
    secondary: RESELECT,
  },
};

/** 所有錯誤代碼（給 /retake/[代碼] 頁面預先產生用）。 */
export const RETAKE_CODES = Object.keys(RETAKE_MESSAGES) as RetakeCode[];

/** 檢查一段文字是不是已知的錯誤代碼。 */
export function isRetakeCode(value: string): value is RetakeCode {
  return Object.hasOwn(RETAKE_MESSAGES, value);
}
