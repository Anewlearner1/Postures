/**
 * 這個檔案做什麼：
 *   問題卡片的「固定文案」：白話名稱、專業名稱、副標、「我們看到什麼」範本、「這代表什麼」。
 *   文案來源：docs/spec/ux-flow-and-copy.md §4.3.1–§4.3.3、§4.4。
 *   AI 無法使用時（降級方案），報告就用這裡的文字。
 *
 *   卡片代碼（cardId）：
 *     hip_extension_deficit     後腳推蹬不足
 *     knee_swing_flexion_low    膝蓋彎得較少
 *     knee_stance_flexion_high  膝蓋彎得較多
 *     trunk_forward_lean        身體往前傾
 */

export type CardId =
  | "hip_extension_deficit"
  | "knee_swing_flexion_low"
  | "knee_stance_flexion_high"
  | "trunk_forward_lean";

export interface ProblemCopy {
  plainName: string;
  professionalName: string;
  subtitle: string;
  /** 「我們看到什麼」的第一句（UX 範本）。 */
  sawSentence: string;
  /** 有時間點時，是否在後面列出例子（例如 0:03、0:08）。 */
  listTimestamps: boolean;
  meaning: string[];
  /** 「看起來不錯」區塊用的短名稱（UX §4.4）。 */
  goodItemName: string;
  /** 判斷規則沒有給候選原因時，「可能原因」改用的固定清單（UX 範本）。 */
  defaultCauses: string[];
  /** 卡片專屬的固定注意事項。 */
  note?: string;
}

export const PROBLEM_COPY: Record<CardId, ProblemCopy> = {
  hip_extension_deficit: {
    plainName: "後腳推蹬不足",
    professionalName: "髖伸展不足",
    subtitle: "走路時，後腳沒有充分往後推",
    sawSentence: "在你的腳往後推、準備離地的時候，大腿往後伸的幅度比一般人少一些。",
    listTimestamps: true,
    meaning: [
      "正常走路時，後腳會往後推一下，把身體送向前。如果後腳往後推的幅度不夠，步伐可能會變小，走路比較費力，有時候還會用腰部或膝蓋來代償。",
      "這很常見，特別是久坐的人。",
    ],
    goodItemName: "後腳推蹬",
    defaultCauses: [
      "大腿前側、髖部前方的肌肉比較緊（例如長時間坐著）",
      "臀部肌肉的力量或使用習慣不足",
      "走路習慣步伐比較小，或走得比較慢",
    ],
  },
  knee_swing_flexion_low: {
    plainName: "膝蓋彎得較少",
    professionalName: "擺盪期膝屈曲不足",
    subtitle: "走路時膝蓋彎得比較少，看起來比較「直」",
    sawSentence: "在你的腳往前擺動的時候，膝蓋彎曲的角度比一般人小一些。",
    listTimestamps: true,
    meaning: [
      "腳往前擺時，膝蓋通常會自然彎起來，讓腳離地、不會絆到。如果膝蓋彎得比較少，腳離地的高度可能變小，走路看起來比較僵硬，也可能比較容易絆到東西。",
    ],
    goodItemName: "膝蓋彎曲",
    defaultCauses: [
      "大腿前側肌肉比較緊",
      "膝蓋或小腿過去受過傷，身體習慣保護它",
      "走路速度較慢，或後腳推蹬不足（見「後腳推蹬不足」）",
    ],
  },
  knee_stance_flexion_high: {
    plainName: "膝蓋彎得較多",
    professionalName: "著地／支撐期膝屈曲過多",
    subtitle: "腳踩在地上時，膝蓋沒有伸直到常見的程度",
    sawSentence: "在你的腳踩在地上、身體往前移動的時候，膝蓋一直保持比較彎的角度，沒有伸直到常見的程度。",
    listTimestamps: false,
    meaning: [
      "腳踩在地上時，膝蓋通常會接近伸直，讓骨骼來支撐體重。如果膝蓋一直比較彎，大腿前側的肌肉要一直出力撐住，比較容易累，也可能增加膝蓋前方的負擔。",
    ],
    goodItemName: "膝蓋彎曲",
    defaultCauses: [
      "大腿後側或小腿肌肉比較緊",
      "大腿前側肌肉的力量不足",
      "膝蓋不舒服時，身體自然會保持微彎來保護",
    ],
    note: "如果你的膝蓋有疼痛、腫脹，或無法完全伸直，建議先諮詢醫師或物理治療師。",
  },
  trunk_forward_lean: {
    plainName: "身體往前傾",
    professionalName: "軀幹前傾",
    subtitle: "走路時，上半身的位置比較靠前",
    sawSentence: "走路時，你的上半身比一般人更往前傾一些，整段影片大多數時間都是這樣",
    listTimestamps: false,
    meaning: [
      "走路時，身體通常會保持大致直立。如果上半身一直往前傾，背部和大腿後側的肌肉要多出力來撐住，時間久了可能比較容易痠痛或疲勞。",
      "走得比較快時，身體稍微往前傾是正常的。",
    ],
    goodItemName: "身體姿勢",
    defaultCauses: [
      "走路時習慣看地面或看手機",
      "長時間坐著的習慣",
      "髖部前方比較緊，身體用往前傾來代償",
      "背部肌肉的耐力不足",
    ],
  },
};

/** 同等級問題的排序（UX Q10 尚待產品負責人決定；先用 UX 建議的「軀幹 → 髖 → 膝」）。 */
export const CARD_ORDER: CardId[] = [
  "trunk_forward_lean",
  "hip_extension_deficit",
  "knee_swing_flexion_low",
  "knee_stance_flexion_high",
];

/** 「接近分界」時加在「我們看到什麼」最後的一句（UX §4.3.0）。 */
export const NEAR_THRESHOLD_SENTENCE = "這次的數值剛好在分界附近，結果可能因為拍攝條件而有一點差異，參考就好。";

/** 「看起來不錯」項目接近分界時加的註記（UX §4.3.0）。 */
export const NEAR_THRESHOLD_GOOD_SUFFIX = "（接近分界，可以多留意）";

/** 總結語範本（UX §4.2、§4.4）。{…} 由程式填入。 */
export const SUMMARY_COPY = {
  hasMarked:
    "這次影片中，我們觀察到 {N} 個可以留意的地方，最值得先練習的是「{TOP}」。每張卡片下方都有說明和簡單的練習方法。",
  onlyMild: "這次影片中，你的走路姿勢大致不錯，有 {N} 個地方可以再加強：{LIST}。這些都可以透過日常練習改善。",
  goodItems: "另外，你的{GOOD}在常見範圍內，表現很好。",
  lowConfidencePrefix: "由於影片拍攝條件的關係，以下結果僅供參考。",
  allNormal: "這次影片中，{N} 個項目都在常見範圍內，表現很好！",
  allNormalDetail: "你走路時後腳推蹬、膝蓋彎曲和身體姿勢，都和一般成年人的常見範圍差不多。",
  allNormalLowConfidence:
    "由於拍攝條件的關係，這次結果僅供參考。目前沒有看到明顯需要留意的地方，但建議照拍攝教學重拍一次，確認結果。",
  allNormalNote:
    "這次分析只看了走路時的 3 個項目，不代表身體其他部位沒有狀況。如果你有疼痛或不適，即使這裡的結果都在常見範圍內，也建議諮詢專業人員。",
} as const;
