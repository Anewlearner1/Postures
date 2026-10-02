/**
 * 這個檔案做什麼：
 *   上傳確認、分析中、App 內建瀏覽器提示、骨架回放操作說明的固定文案。
 *   文案來源：docs/spec/ux-flow-and-copy.md §2.3、§2.4、§4.6、§5.5、§5.8。
 *   標【待審閱】的句子是前端實作時新增、UX 文件沒有現成範本的，待 UX／產品負責人確認。
 */

import { PREFLIGHT_LIMITS } from "@/lib/pose/preflight";

/** 上傳頁：適用情況（D30／D35，UX §2.3）。選填、可複選，任一有勾 → population_caveat。 */
export const POPULATION_CHECKS = {
  title: "有以下情況嗎？（選填，可複選）",
  items: [
    "懷孕中",
    "有中風、帕金森氏症、周邊神經病變等神經方面的狀況",
    "走路時正在疼痛，或最近受過傷、開過刀",
  ],
  explanation:
    "這些情況會改變走路方式，我們的判斷標準不是為此設計的，結果可能不適用。有勾選的話，報告會改用較溫和的練習、減少練習數量，並提醒你先諮詢醫師或物理治療師。",
  privacy: "這些答案只留在你的裝置上，不會被保存。",
} as const;

/**
 * 確認頁：偵測到直式影片（M5 QA F-14）。改寫自 UX §3.1 常見錯誤「直著拍 → 走沒兩步就出畫面了，請橫著拍」。【待審閱】
 */
export const PORTRAIT_NOTICE =
  "這段影片是直著拍的。直式畫面比較窄，走沒兩步就容易出畫面；下次請橫著拿手機拍，結果會比較準。這次仍然可以繼續分析。";

/** 上傳頁：上一次的報告還在記憶體裡時（M5 QA F-03）。【待審閱】 */
export const PREVIOUS_REPORT_COPY = {
  title: "你上一次的報告還在。",
  body: "選擇新的影片後，上一次的報告就會被取代；重新整理或關閉頁面也會消失。",
  back: "回到報告",
} as const;

/** 上傳頁：讀取影片資訊時。【待審閱】 */
export const CHECKING_VIDEO = "正在讀取影片…";

/**
 * 影片太長（UX §5.5，Q6 尚未決定）。前端暫定作法：超過 30 秒只分析前 20 秒，並顯示這段提示。【待審閱】
 */
export function longVideoNotice(durationSec: number): string {
  return `這段影片有 ${Math.round(durationSec)} 秒。為了讓分析更快，我們只分析前 ${PREFLIGHT_LIMITS.trimToSec} 秒，請確認前 ${PREFLIGHT_LIMITS.trimToSec} 秒內有來回走路的畫面。`;
}

/** 報告頁回放區：只分析了前段時的提示。【待審閱】 */
export function trimmedReplayNotice(untilSec: number): string {
  return `這次只分析了前 ${Math.round(untilSec)} 秒，之後的畫面沒有骨架。`;
}

/** 分析中（UX §2.4）。 */
export const ANALYZE_COPY = {
  title: "分析中",
  steps: {
    read: "讀取影片",
    detect: "找出身體關節位置",
    compute: "計算角度與步伐",
    report: "撰寫你的報告",
  },
  /** 讀取影片步驟的小字（第一次要下載分析工具）。【待審閱】 */
  loadingModel: (sizeMB: number) => `正在準備分析工具（第一次使用需下載約 ${sizeMB} MB）`,
  etaInitial: "通常需要 30 秒到 2 分鐘，依你的裝置效能而定。",
  etaSeconds: (seconds: number) => `大約還要 ${seconds} 秒`,
  etaMinutes: (minutes: number) => `大約還要 ${minutes} 分鐘`,
  etaOverrun: "比預期久一點，還在努力中…",
  keepOpenMobile: "請保持這個畫面開著。",
  keepOpenMobileDetail: "切換到其他 App 或鎖定螢幕，分析可能會暫停。",
  keepOpenDesktop: "分析期間請不要關閉這個分頁。",
  privacyTitle: "影片不會上傳。",
  privacyBody: "分析在你的裝置上進行。完成後，只有計算出來的角度數字（不含任何影像）會送出，用來寫成白話報告。",
  cancel: "取消分析",
  cancelConfirmTitle: "要取消分析嗎？",
  cancelConfirmBody: "目前的進度不會保留。",
  cancelConfirmKeep: "繼續分析",
  cancelConfirmStop: "取消",
  welcomeBack: "歡迎回來，分析繼續中",
  /** 分析中按了頁面上的其他連結時的確認視窗（瀏覽器內建視窗）。 */
  leaveConfirm: "要取消分析嗎？目前的進度不會保留。",
  /** 準備開始（還沒進入第一步）時。【待審閱】 */
  preparing: "準備中…",
} as const;

/** 等待中的小知識（UX §2.4，每 6 秒換一則）。【需產品負責人確認數值正確性】 */
export const WAITING_FACTS = [
  "走路時，一隻腳從著地到下一次同一隻腳著地，稱為一個「步態週期」。",
  "走路時大約 6 成的時間是腳踩在地上，4 成的時間腳在空中擺動。",
  "後腳往後推的動作，主要靠臀部和大腿後側的肌肉。",
  "走路時看手機，常常會讓頭和身體往前傾。",
] as const;

/** 報告頁離開確認（UX §4.8；瀏覽器內建視窗，部分瀏覽器不顯示自訂文字）。 */
export const REPORT_LEAVE_CONFIRM = "離開後報告會消失，確定要離開嗎？";

/** App 內建瀏覽器提示條（UX §5.8）。 */
export const IN_APP_BANNER = {
  title: "建議用瀏覽器開啟。",
  body: (app: string) =>
    `你目前在 ${app} 裡開啟這個網站，分析可能無法正常執行。請點右上角「⋯」或「分享」，選擇「以預設瀏覽器開啟」或「在 Safari 中開啟」。`,
  copy: "複製網址",
  copied: "已複製",
  dismiss: "我知道了",
} as const;

/** 骨架回放（UX §4.6）。 */
export const REPLAY_CONTROLS = {
  play: "播放",
  pause: "暫停",
  prevFrame: "上一格",
  nextFrame: "下一格",
  skeleton: "骨架",
  speed: "播放速度",
  fullscreen: "全螢幕",
  exitFullscreen: "離開全螢幕",
  timeline: "時間軸",
  /** 軀幹整段持續前傾時的長條標示（UX §4.6）。 */
  wholeVideo: "整段影片",
  help: {
    title: "怎麼看骨架回放？",
    items: [
      "點時間軸上的 ◆ 標記，可以直接跳到問題出現的地方。",
      "用「逐格」按鈕可以一格一格看，找到腳往後推或膝蓋最彎的瞬間。",
      "比較淡的線是離鏡頭較遠的那隻腳，因為常被擋住，位置可能比較不準。",
      "骨架偶爾跳動或偏移是正常的，我們在計算時會自動排除這些不穩定的畫面。",
    ],
  },
  /** 示範報告沒有使用者影片時。【待審閱】 */
  sampleNotice: "示範報告沒有影片。分析你自己的影片後，這裡會播放你的影片並疊上骨架。",
} as const;

/** 示範報告頁頂端說明。 */
export const SAMPLE_REPORT_BANNER =
  "這是示範報告（假資料），只用來展示版面，不是任何人的真實分析結果。";

/** AI 報告產生失敗、改用模板文字時，報告頂部的小提示（UX §5.9）。 */
export const AI_FALLBACK_NOTICE = "白話說明目前暫時無法產生，以下為標準版說明。分析結果不受影響。";

/**
 * 下載報告（D21、D43：列印樣式表＋瀏覽器「儲存為 PDF」，不經伺服器）。【待審閱】
 * 各平台按鈕名稱可能因瀏覽器版本略有不同。
 */
export const DOWNLOAD_COPY = {
  button: "下載報告",
  howToTitle: "怎麼存成 PDF？",
  howTo: [
    "電腦：在列印視窗的「目的地」選「儲存為 PDF」，再按「儲存」。",
    "iPhone（Safari、Chrome）：在「列印選項」畫面點上方的「分享」圖示，選「儲存到檔案」。",
    "Android（Chrome）：在上方的印表機選單選「儲存為 PDF」，再按下載圖示。",
  ],
  privacy: "報告在你的裝置上產生，不會上傳；下載的報告不含影片。",
  inApp: "App 內建瀏覽器（例如 LINE）可能無法下載，請先用 Safari 或 Chrome 開啟本網站。",
  unsupported: "這個瀏覽器無法下載報告，請改用 Chrome、Safari 或 Edge。",
  generatedAt: (date: string) => `產生日期：${date}`,
  keyframeCaption: "影片中的關鍵畫面（白線是分析時找到的關節位置）",
  printFooter: "本報告由瀏覽器在使用者的裝置上產生，不含影片。",
} as const;
