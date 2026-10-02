/**
 * 這個檔案做什麼：
 *   報告頁的「假資料」，只用來展示版面（M2 專案骨架）。這不是任何人真實的分析結果。
 *   文案取自 docs/spec/ux-flow-and-copy.md §4 的範本；訓練動作是 UX 文件中的
 *   「格式示範」，實際內容以 docs/spec/exercise-library.md 為準（M4 才接上）。
 */

import type { ReportView } from "@/lib/report/types";

export const SAMPLE_REPORT: ReportView = {
  summary:
    "這次影片中，我們觀察到 2 個可以留意的地方，最值得先練習的是「後腳推蹬不足」。每張卡片下方都有說明和簡單的練習方法。另外，你的身體姿勢在常見範圍內，表現很好。",
  stepsAnalyzed: 8,
  cyclesAnalyzed: 5,
  durationSec: 14,
  durationLabel: "0:14",
  confidence: "good_with_tip",
  confidenceTip: "這次的結果可以參考。如果想讓結果更準確，下次拍攝時可以試試：把手機擺正，不要歪一邊。",
  slowSpeed: false,
  problems: [
    {
      id: "hip_extension_deficit",
      markerNumber: 1,
      plainName: "後腳推蹬不足",
      professionalName: "髖伸展不足",
      subtitle: "走路時，後腳沒有充分往後推",
      severity: "marked",
      whatWeSaw:
        "在你的腳往後推、準備離地的時候，大腿往後伸的幅度比一般人少一些。這個情況在影片中出現了 4 次（例如 0:03、0:08）。",
      firstTimestamp: "0:03",
      meaning: [
        "正常走路時，後腳會往後推一下，把身體送向前。如果後腳往後推的幅度不夠，步伐可能會變小，走路比較費力，有時候還會用腰部或膝蓋來代償。",
        "這很常見，特別是久坐的人。",
      ],
      causes: [
        "大腿前側、髖部前方的肌肉比較緊（例如長時間坐著）",
        "臀部肌肉的力量或使用習慣不足",
        "走路習慣步伐比較小，或走得比較慢",
      ],
      exercises: [
        {
          name: "跪姿髖部前側伸展",
          purpose: "放鬆髖部前方，讓後腳更容易往後推。",
          steps: [
            "單膝跪地（膝蓋下墊毛巾），另一腳在前踩地，膝蓋彎成約 90 度。",
            "身體保持挺直，輕輕把骨盆往前推，直到跪地那一側的大腿前方有拉伸感。",
            "維持呼吸，不要拱腰。",
          ],
          dosage: "每邊 30 秒 × 2–3 次，每週 3–5 天",
          tip: "拉伸感應該在大腿前側或髖部前方，如果是腰在痛，就減少往前推的幅度。",
        },
        {
          name: "臀橋",
          purpose: "加強臀部力量，幫助後腳往後推。",
          steps: [
            "躺在地上，雙膝彎曲，腳掌踩地，與髖同寬。",
            "用臀部出力把屁股抬起來，讓肩膀、髖部、膝蓋成一直線。",
            "在最高點停 2 秒，再慢慢放下。",
          ],
          dosage: "10–15 下 × 2–3 組，每週 3 天",
          tip: "感覺應該在臀部，不是腰部或大腿後側。",
        },
      ],
    },
    {
      id: "knee_swing_flexion_low",
      markerNumber: 2,
      plainName: "膝蓋彎得較少",
      professionalName: "擺盪期膝屈曲不足",
      subtitle: "走路時膝蓋彎得比較少，看起來比較「直」",
      severity: "mild",
      whatWeSaw:
        "在你的腳往前擺動的時候，膝蓋彎曲的角度比一般人小一些。這個情況在影片中出現了 3 次（例如 0:04、0:09）。",
      firstTimestamp: "0:04",
      meaning: [
        "腳往前擺時，膝蓋通常會自然彎起來，讓腳離地、不會絆到。如果膝蓋彎得比較少，腳離地的高度可能變小，走路看起來比較僵硬，也可能比較容易絆到東西。",
      ],
      causes: [
        "大腿前側肌肉比較緊",
        "膝蓋或小腿過去受過傷，身體習慣保護它",
        "走路速度較慢，或後腳推蹬不足（見「後腳推蹬不足」）",
      ],
      exercises: [
        {
          name: "俯臥勾腿",
          steps: ["趴著，慢慢把腳跟往屁股方向勾起。", "再慢慢放下。"],
          dosage: "10–15 下 × 2 組",
        },
        {
          name: "站姿大腿前側伸展",
          steps: ["扶牆站，一手抓住同側腳踝。", "把腳跟拉向屁股，膝蓋朝下。"],
          dosage: "每邊 30 秒 × 2 次",
        },
      ],
    },
  ],
  goodItems: ["身體姿勢"],
  headObservation: [
    // 依 UX 文件 4.3.4 節 `observed` 範本（D25：不寫頭有沒有往前，不分級）
    "我們有記錄你走路時頭部和肩膀的相對位置。這一項目前還在建立可靠的判斷標準，所以這次不做評估，也不列入上面的建議。",
    "如果你的脖子或肩膀經常痠痛，可以諮詢物理治療師。",
  ],
  timelineMarkers: [
    { markerNumber: 1, label: "後腳推蹬不足", positionPct: 21 },
    { markerNumber: 2, label: "膝蓋彎得較少", positionPct: 29 },
    { markerNumber: 1, label: "後腳推蹬不足", positionPct: 57 },
    { markerNumber: 2, label: "膝蓋彎得較少", positionPct: 64 },
  ],
};
