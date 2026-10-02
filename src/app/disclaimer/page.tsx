/**
 * 這個檔案做什麼：
 *   P7 完整免責聲明（網址：/disclaimer）。
 *   文案取自 docs/spec/ux-flow-and-copy.md §6.2（草稿，【需法律審閱】）與 §6.3 就醫提醒。
 */

import type { Metadata } from "next";
import { SeekCareContent } from "@/components/report/SeekCare";
import { PageContainer } from "@/components/ui/PageContainer";
import { PRODUCT_NAME } from "@/data/site";

export const metadata: Metadata = { title: "免責聲明" };

const SECTIONS: { title: string; paragraphs?: string[]; bullets?: string[] }[] = [
  {
    title: "1. 本服務是什麼",
    paragraphs: [
      `${PRODUCT_NAME}（以下稱「本服務」）透過分析你上傳的走路影片，估算走路時的關節角度與姿勢，並提供一般性的說明與運動建議。本服務的目的是幫助你了解自己的走路習慣，屬於健康促進與運動參考資訊。`,
    ],
  },
  {
    title: "2. 本服務不是什麼",
    paragraphs: [
      "本服務不是醫療器材，不提供醫療診斷、治療或醫療建議，也不能取代醫師、物理治療師或其他醫事人員的專業評估。報告中的任何內容，都不代表你有或沒有任何疾病或傷害。",
    ],
  },
  {
    title: "3. 結果的限制",
    bullets: [
      "本服務使用一般手機拍攝的 2D 影片估算角度，準確度會受到拍攝角度、距離、光線、服裝、遮擋等因素影響，可能和實際情況有差異。",
      "分析只涵蓋走路時的少數項目（後腳推蹬、膝蓋彎曲、身體與頭部姿勢），不代表全面的身體評估。",
      "「常見範圍」是根據一般成年人的資料訂定，不一定適用於每個人。不同年齡、身高、走路速度、鞋子，都可能影響結果。",
      "目前的判斷標準是根據研究文獻推估的「測試版標準」，尚在以實際量測資料校正中，日後可能調整。",
      "報告中的白話說明由人工智慧（AI）協助撰寫，雖然經過設計與檢查，仍可能有不精確之處。",
    ],
  },
  {
    title: "4. 訓練動作的安全",
    bullets: [
      "報告中的訓練動作是一般性的建議，不是針對你個人狀況的處方。",
      "開始任何運動前，如果你有舊傷、慢性疾病、正在懷孕、剛開過刀，或正在接受任何治療，請先詢問醫師或物理治療師。",
      "練習時如果感到疼痛、麻木、頭暈、胸悶或呼吸困難，請立刻停止，必要時就醫。",
      "請在安全的環境中練習，必要時請旁人陪同或扶著穩固的物體。",
    ],
  },
  {
    title: "5. 拍攝時的安全",
    paragraphs: [
      "拍攝走路影片時，請選擇平坦、沒有障礙物的地方。如果你走路不穩或容易跌倒，請有人陪同，不要勉強拍攝。",
    ],
  },
  {
    title: "6. 適用對象",
    paragraphs: [
      "本服務僅提供年滿 18 歲的使用者使用。懷孕中、有神經方面的狀況（例如中風、帕金森氏症），或走路時正在疼痛者，走路方式可能和一般人不同，本服務的判斷標準並非為這些情況設計，結果可能不適用，請先諮詢醫師或物理治療師。",
    ],
  },
  {
    title: "7. 責任限制",
    paragraphs: [
      "你根據本服務內容所做的任何決定與行動，請自行判斷並承擔風險。在法律允許的範圍內，本服務提供者不對因使用或無法使用本服務所生的任何損害負責。",
    ],
  },
];

export default function DisclaimerPage() {
  return (
    <PageContainer width="narrow" className="space-y-6">
      <h1 className="text-2xl font-bold sm:text-3xl">免責聲明</h1>
      <p className="rounded-lg border-2 border-dashed border-line px-3 py-2 text-sm text-muted">
        草稿：以下文字尚待法律審閱，正式上線前可能修改。
      </p>

      {SECTIONS.map((section) => (
        <section key={section.title} className="space-y-2">
          <h2 className="text-lg font-bold">{section.title}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.bullets && (
            <ul className="list-disc space-y-1 pl-5">
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section id="seek-care" className="space-y-2 rounded-2xl bg-surface p-4">
        <h2 className="text-lg font-bold">什麼時候該找專業人員？</h2>
        <SeekCareContent />
      </section>
    </PageContainer>
  );
}
