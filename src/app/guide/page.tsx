/**
 * 這個檔案做什麼：
 *   P1 拍攝教學（網址：/guide）。教使用者怎麼拍出能分析的走路影片。
 *   文案來源：docs/spec/ux-flow-and-copy.md §2.2、§3.1（文案資料在 src/data/guide-tips.ts）。
 *   示意圖（§3.2）尚待設計師繪製，先以灰色框佔位。
 */

import type { Metadata } from "next";
import { GuideTipList } from "@/components/guide/GuideTipList";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageContainer } from "@/components/ui/PageContainer";
import { COMMON_MISTAKES, GUIDE_HEADING, GUIDE_NOTES } from "@/data/guide-tips";

export const metadata: Metadata = { title: "拍攝教學" };

export default function GuidePage() {
  return (
    <PageContainer>
      <h1 className="text-2xl font-bold sm:text-3xl">{GUIDE_HEADING.title}</h1>
      <p className="mt-2 text-muted">{GUIDE_HEADING.subtitle}</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* 示意圖佔位（圖 1：整體擺設俯視圖） */}
        <div className="flex aspect-[4/3] items-center justify-center rounded-2xl border-2 border-dashed border-line bg-surface p-4 text-center text-sm text-muted lg:sticky lg:top-20 lg:self-start">
          示意圖佔位：整體擺設俯視圖
          <br />
          （手機與走路路線垂直、距離約 3 公尺）
        </div>
        <GuideTipList />
      </div>

      <section className="mt-12">
        <h2 className="text-xl font-bold">常見錯誤</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COMMON_MISTAKES.map((item) => (
            <li key={item.mistake} className="rounded-xl bg-surface p-4">
              <p className="font-semibold">
                <span className="mr-1 text-sev-marked">避免</span>
                {item.mistake}
              </p>
              <p className="text-muted">→ {item.fix}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-bold">小提醒</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          {GUIDE_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>

      <div className="mt-12 flex flex-col items-stretch gap-2 sm:items-start">
        <ButtonLink href="/upload">我拍好了，去上傳</ButtonLink>
        <p className="text-sm text-muted">拍完回到這個頁面就可以上傳。</p>
      </div>
    </PageContainer>
  );
}
