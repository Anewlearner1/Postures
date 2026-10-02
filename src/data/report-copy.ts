/**
 * 這個檔案做什麼：
 *   報告頁的「固定文案」（不由 AI 撰寫的部分）。
 *   文案來源：docs/spec/ux-flow-and-copy.md §4.1、§4.2、§4.3.0、§4.6、§4.8、§6.3。
 */

import type { ConfidenceDisplay, Severity } from "@/lib/gait/types";

/** 嚴重度：使用者看到的柔和版標籤（D20、UX §4.1）。filled = 指示條亮幾格。 */
export const SEVERITY_COPY: Record<
  Severity,
  { label: string; filled: 1 | 2 | 3; description: string }
> = {
  normal: { label: "在常見範圍內", filled: 1, description: "這個項目看起來不錯。" },
  mild: {
    label: "輕度：可以留意",
    filled: 2,
    description: "和常見範圍有一點差距，可以透過練習改善。",
  },
  marked: {
    label: "明顯：建議優先練習",
    filled: 3,
    description: "和常見範圍差距較大，建議優先練習；如果同時有疼痛，請諮詢專業人員。",
  },
};

/** 指示條旁 ⓘ 的說明（UX §4.1）。 */
export const SEVERITY_INFO =
  "這個分級是和一般成年人走路的常見範圍比較的結果，不代表疾病或受傷。";

/** 可信度：使用者只看到兩級（D28、UX §4.2）。 */
export const CONFIDENCE_LABEL: Record<ConfidenceDisplay, string> = {
  good: "良好",
  good_with_tip: "良好",
  low: "較低",
};

export const CONFIDENCE_INFO =
  "可信度取決於拍攝角度、步數、光線等。可信度較低時，結果僅供參考，建議照拍攝教學重拍一次。";

/** 每個練習區塊結尾的固定文案（UX §4.3.0）。 */
export const EXERCISE_SAFETY =
  "練習時如果感到疼痛、麻木或頭暈，請立刻停止。如果你有舊傷、正在接受治療或剛開完刀，請先詢問醫師或物理治療師再開始練習。";

/** 「可能原因」開頭的固定句（UX §4.3.1）。 */
export const CAUSES_INTRO = "以下是常見的原因，不一定適用在你身上：";

/** 骨架回放區（UX §4.6）。 */
export const REPLAY_COPY = {
  title: "骨架回放",
  subtitle: "看看分析時找到的關節位置，以及問題出現的時間點。",
  privacy: "這段影片只在你的裝置上播放，沒有上傳。關閉或重新整理頁面後就會消失。",
} as const;

/** 什麼時候該找專業人員（UX §6.3，報告頁與完整免責聲明共用）。 */
export const SEEK_CARE = {
  title: "什麼時候該找專業人員？",
  urgentTitle: "如果有以下情況，請盡快就醫：",
  urgent: [
    "突然出現單側手腳無力或麻木、臉部歪斜、說話不清楚——請立即撥打 119",
    "最近跌倒過，或走路時經常差點跌倒、感覺不穩",
    "走路時腳、膝蓋、髖部或背部疼痛，持續超過 1–2 週，或越來越痛",
    "腳或腿有麻木、刺痛、無力的感覺（可能和神經有關）",
    "關節紅、腫、熱、痛，或受傷後無法用腳支撐體重",
    "走路的樣子在短時間內明顯改變，或常感到頭暈、失去平衡",
  ],
  consultTitle: "以下情況，建議先諮詢醫師或物理治療師再開始練習：",
  consult: [
    "曾經受過下肢或背部的傷，或開過刀",
    "正在懷孕或產後",
    "有心臟、血壓、骨質疏鬆、神經方面等慢性狀況",
  ],
  closing: "這份報告可以作為你和專業人員討論時的參考。",
} as const;

/** 下一步與離開提醒（UX §4.8）。 */
export const NEXT_STEPS_COPY = {
  download: "下載報告",
  again: "再分析一次",
  leaveNotice:
    "這份報告只存在這個頁面，關閉或重新整理後就會消失。如果想保留，請先下載報告。",
} as const;
