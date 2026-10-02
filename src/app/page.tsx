/**
 * 這個檔案做什麼：
 *   P0 首頁（網址：/）。3 秒內說清楚「這是什麼、免費、安全、非醫療」，
 *   並引導使用者去看拍攝教學或直接上傳。
 *   文案來源：docs/spec/ux-flow-and-copy.md §2.1。
 */

import { WalkingFigure } from "@/components/home/WalkingFigure";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { DisclaimerStrip } from "@/components/ui/DisclaimerStrip";
import { CheckIcon, ChevronRightIcon } from "@/components/ui/icons";
import { PageContainer } from "@/components/ui/PageContainer";
import { PRIVACY_COPY } from "@/data/site";

const HOW_IT_WORKS = ["照教學拍一段走路影片", "上傳，在你的裝置上分析", "看報告：發現什麼＋怎麼練"];

const WHAT_WE_CHECK = [
  { title: "後腳推蹬", body: "走路時，後腳有沒有往後推到位" },
  { title: "膝蓋彎曲", body: "膝蓋彎的幅度是否在常見範圍" },
  { title: "身體姿勢", body: "走路時身體有沒有往前傾（頭部位置另作觀察參考）" },
];

const FAQ = [
  {
    q: "準確嗎？",
    a: "這是用手機影片做的「估算」，不是實驗室等級的量測。拍攝方式會大幅影響結果，照著拍攝教學拍，結果會更可靠。如果影片品質不夠好，報告會標示「可信度較低」。",
  },
  {
    q: "影片會被看到嗎？",
    a: "不會。影片只在你的手機或電腦的瀏覽器裡分析，不會上傳到我們的伺服器。我們只會送出計算後的角度數字（不含影像）來產生白話報告。看完報告後，你可以自己決定要不要匿名捐贈資料幫助我們改善，不捐也完全不影響使用。",
  },
  {
    q: "適合什麼人用？",
    a: "想了解自己走路姿勢的一般成年人（年滿 18 歲）。如果你目前有疼痛、最近受過傷或開過刀、有神經或平衡方面的狀況，請先諮詢醫師或物理治療師。",
  },
  {
    q: "可以取代看醫生嗎？",
    a: "不行。這個網站提供的是走路姿勢的觀察和一般運動建議，不是醫療診斷，也不能取代專業評估。",
  },
];

export default function HomePage() {
  return (
    <PageContainer>
      {/* 首屏：手機單欄、電腦左右兩欄 */}
      <section className="grid items-center gap-8 md:grid-cols-2">
        <div className="space-y-5">
          <h1 className="text-3xl font-bold leading-tight text-ink sm:text-4xl">
            用一段走路影片，
            <br />
            看懂你的走路姿勢
          </h1>
          <p className="text-lg text-muted">手機側拍 10–20 秒，幾分鐘內得到白話報告和練習建議。</p>
          <ul className="space-y-2 text-base">
            <li className="flex items-start gap-2">
              <CheckIcon className="mt-1 h-5 w-5 shrink-0 text-brand-600" />
              免費・不用註冊
            </li>
            <li className="flex items-start gap-2">
              <CheckIcon className="mt-1 h-5 w-5 shrink-0 text-brand-600" />
              {PRIVACY_COPY.short}
            </li>
          </ul>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4">
            <ButtonLink href="/guide">先看怎麼拍（30 秒）</ButtonLink>
            <ButtonLink href="/upload" variant="ghost">
              我已經拍好了，直接上傳
              <ChevronRightIcon />
            </ButtonLink>
          </div>
          <DisclaimerStrip variant="general" />
        </div>
        <WalkingFigure className="aspect-[4/3] w-full" />
      </section>

      {/* 怎麼運作 */}
      <section className="mt-14">
        <h2 className="text-xl font-bold">怎麼運作？</h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          {HOW_IT_WORKS.map((step, index) => (
            <li key={step} className="flex items-center gap-3 rounded-xl border border-line p-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 font-bold text-white">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* 我們會看這 3 件事 */}
      <section className="mt-14">
        <h2 className="text-xl font-bold">我們會看這 3 件事</h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-3">
          {WHAT_WE_CHECK.map((item) => (
            <li key={item.title} className="rounded-xl bg-surface p-4">
              <p className="font-semibold">{item.title}</p>
              <p className="text-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 常見問題（頁首「常見問題」連到這裡） */}
      <section id="faq" className="mt-14 scroll-mt-20">
        <h2 className="text-xl font-bold">常見問題</h2>
        <div className="mt-4 divide-y divide-line rounded-xl border border-line">
          {FAQ.map((item) => (
            <details key={item.q} className="group px-4">
              <summary className="flex min-h-12 items-center gap-2 py-3 font-semibold">
                <ChevronRightIcon className="summary-arrow h-4 w-4 shrink-0 text-brand-600" />
                {item.q}
              </summary>
              <p className="pb-4 pl-6 text-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </PageContainer>
  );
}
