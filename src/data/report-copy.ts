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

/** 觀察：頭部位置（UX §4.3.4，D25：不分級、不給練習、不寫頭有沒有往前）。 */
export const HEAD_OBSERVATION_COPY = {
  observed: [
    "我們有記錄你走路時頭部和肩膀的相對位置。這一項目前還在建立可靠的判斷標準，所以這次不做評估，也不列入上面的建議。",
    "如果你的脖子或肩膀經常痠痛，可以諮詢物理治療師。",
  ],
  not_assessable: [
    "這次影片中，耳朵的位置不太清楚（例如被頭髮、帽子或衣領遮住），所以沒辦法記錄頭部位置。這不影響其他項目的結果。",
    "下次拍攝時，可以把頭髮撩到耳後、不戴帽子。",
  ],
} as const;

/** 適用情況提醒（`population_caveat`，D30／D35，UX §4.2）。不寫出使用者勾了哪一項。 */
export const POPULATION_CAVEAT_COPY = {
  title: "這份報告可能不完全適用於你",
  paragraphs: [
    "你在分析前勾選了可能會影響走路方式的情況。我們的判斷標準是為一般成人設計的，所以以下結果請當作參考就好。",
    "為了安全，我們只列出最多 3 個較溫和的練習。開始練習前，請先和醫師或物理治療師討論；練習時如果感到疼痛、頭暈或不舒服，請立刻停止。",
  ],
  /** 每張卡片「建議練習」區塊的第一行。 */
  exercisesIntro: "開始前請先諮詢專業人員。以下是較溫和的版本。",
  /** 分不到練習的卡片。 */
  noExercises: "這次先從前面卡片的練習開始就好。",
  /** 動作名稱旁的小標籤。 */
  gentleLabel: "較溫和版本",
} as const;

/**
 * 以下兩句是後端組報告時新增的固定文案，UX 文件沒有現成範本。【待 UX／產品負責人審閱】
 *   - lowConfidenceExercises：可信度較低時，「建議練習」區塊第一行（exercise-library.md §3 規則 4：提醒先重拍確認）。
 *   - referOnlyCause：判斷規則給出「只提醒就醫」的原因時（§3 規則 6），卡片加的注意事項。
 */
export const EXTRA_REPORT_NOTES = {
  lowConfidenceExercises: "這次結果僅供參考，建議先照拍攝教學重拍一次確認，再開始練習。",
  referOnlyCause: "這次的情況可能和疼痛或其他身體狀況有關，建議先諮詢醫師或物理治療師，再開始練習。",
  /** 同一個練習已列在前面的卡片時，後面的卡片只放這句。 */
  seeOtherCard: "見「{CARD}」卡片。",
} as const;

/** 問題卡片底部「查看數據」（D44、UX §4.3.0；只用本機結果，不送 API）。 */
export const METRICS_COPY = {
  title: "查看數據",
  intro: "你的數值（影片中的代表值）：",
  note: "這是從 2D 影片估算的角度，可能有幾度的誤差。",
  /** 各指標的白話名稱（不寫左右腳，D26）。【待審閱】 */
  labels: {
    PHE: "髖部最大後伸",
    PKF_sw: "腳往前擺時膝蓋最大彎曲",
    KIC: "腳跟著地時膝蓋彎曲",
    TRK: "身體前傾",
  },
  value: (deg: number) => `約 ${deg} 度`,
  /** 髖部後伸是 0 或負值（大腿沒有伸到身體後方）時，不顯示負數（M5 QA F-08）。【待審閱】 */
  noHipExtension: "幾乎沒有往後伸（大腿沒有伸到身體後方）",
  rangeAtLeast: (deg: number) => `約 ${deg} 度以上`,
  rangeAtMost: (deg: number) => `約 ${deg} 度以下`,
  rangeBelow: (deg: number) => `小於 ${deg} 度`,
} as const;

/**
 * 全部在常見範圍內時，取代問題卡片位置的鼓勵文案（D37：第一版不給維持型練習，UX §4.4 改為鼓勵文案）。
 * 【待審閱】UX 文件沒有現成範本。
 */
export const ALL_NORMAL_COPY = {
  title: "想保持好狀態？",
  paragraphs: [
    "繼續保持規律走路和平常的活動量，就是維持現在走路姿勢最好的方法。",
    "如果之後走路時開始覺得哪裡不舒服，或姿勢有明顯改變，可以再拍一次影片比較看看，或諮詢物理治療師。",
  ],
} as const;

/** 觀察：頭部位置的區塊標題（UX §4.3.4）。 */
export const HEAD_OBSERVATION_TITLE = "觀察：頭部位置";
