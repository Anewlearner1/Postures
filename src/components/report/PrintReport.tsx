/**
 * 這個檔案做什麼：
 *   「下載報告」用的列印版（D21、D43）。平常不顯示（hidden），只在列印／儲存為 PDF 時出現（print:block），
 *   畫面上的互動版則在列印時隱藏。這樣列印版可以：
 *   - 把所有收合內容（這代表什麼、可能原因、練習全文）直接展開
 *   - 不含影片，只放一張在本機產生的關鍵畫面（可沒有）
 *   - 保留短版免責聲明、「測試版標準」標籤（UX §4.2）與產生日期
 *   全部在使用者的瀏覽器裡產生，不經伺服器。
 */

import { SeekCareContent } from "@/components/report/SeekCare";
import { SeverityMeter } from "@/components/ui/SeverityMeter";
import { DOWNLOAD_COPY } from "@/data/analysis-copy";
import {
  ALL_NORMAL_COPY,
  CAUSES_INTRO,
  CONFIDENCE_LABEL,
  EXERCISE_SAFETY,
  HEAD_OBSERVATION_TITLE,
  POPULATION_CAVEAT_COPY,
  SEEK_CARE,
} from "@/data/report-copy";
import { DISCLAIMER_COPY, PRODUCT_NAME, STANDARD_LABEL } from "@/data/site";
import type { ReportView } from "@/lib/report/types";
import type { MetricRow } from "./ProblemCard";

export interface Keyframe {
  src: string;
  caption: string | null;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "long", timeStyle: "short" }).format(date);
}

export function PrintReport({
  report,
  generatedAt,
  keyframe,
  metricsByCard,
  demoNotice,
}: {
  report: ReportView;
  /** 示範報告的說明（列印版也要標明是假資料）。 */
  demoNotice?: string;
  generatedAt: Date;
  keyframe?: Keyframe | null;
  metricsByCard?: Record<string, MetricRow[]>;
}) {
  const lowConfidence = report.confidence === "low";
  const seekCare = (
    <section className="break-inside-avoid">
      <h2 className="text-lg font-bold">{SEEK_CARE.title}</h2>
      <div className="mt-1 text-sm">
        <SeekCareContent />
      </div>
    </section>
  );

  return (
    <article className="hidden space-y-5 text-[11pt] leading-relaxed text-black print:block" data-testid="print-report">
      <header className="border-b border-black pb-2">
        <p className="text-sm">{PRODUCT_NAME}</p>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-bold">你的走路分析報告</h1>
          {STANDARD_LABEL.show && (
            <span className="rounded-full border border-black px-2 text-xs">{STANDARD_LABEL.text}</span>
          )}
        </div>
        <p className="text-sm">{DOWNLOAD_COPY.generatedAt(formatDate(generatedAt))}</p>
      </header>

      {demoNotice && <p className="rounded border-2 border-dashed border-black p-2 font-bold">{demoNotice}</p>}
      <p className="rounded border border-black p-2 text-sm">{DISCLAIMER_COPY.short}</p>
      {STANDARD_LABEL.show && <p className="text-xs">{STANDARD_LABEL.text}：{STANDARD_LABEL.explanation}</p>}

      {report.populationCaveat && (
        <section className="break-inside-avoid rounded border border-black p-2">
          <h2 className="font-bold">{POPULATION_CAVEAT_COPY.title}</h2>
          {POPULATION_CAVEAT_COPY.paragraphs.map((paragraph) => (
            <p key={paragraph} className="text-sm">
              {paragraph}
            </p>
          ))}
        </section>
      )}

      {report.lowConfidence && (
        <section className="break-inside-avoid rounded border border-black p-2">
          <h2 className="font-bold">這次結果的可信度較低，僅供參考</h2>
          <p className="text-sm">{report.lowConfidence.reason}</p>
          <p className="text-sm">怎麼改善：{report.lowConfidence.fix}</p>
        </section>
      )}

      <section className="space-y-1">
        <p>{report.summary}</p>
        <p className="text-sm">
          分析了 {report.stepsAnalyzed} 步（{report.cyclesAnalyzed} 個完整步態週期）・影片長度 {report.durationSec} 秒・可信度：
          {CONFIDENCE_LABEL[report.confidence]}
        </p>
        {report.confidenceTip && <p className="text-sm">{report.confidenceTip}</p>}
      </section>

      {keyframe && (
        <figure className="break-inside-avoid">
          {/* 本機產生的 data: 圖片，不需要 Next.js 圖片最佳化 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={keyframe.src} alt={DOWNLOAD_COPY.keyframeCaption} className="mx-auto max-h-[90mm] w-auto" />
          <figcaption className="mt-1 text-center text-xs">
            {DOWNLOAD_COPY.keyframeCaption}
            {keyframe.caption && `：${keyframe.caption}`}
          </figcaption>
        </figure>
      )}

      {report.populationCaveat && seekCare}

      {report.problems.length === 0 && (
        <section className="break-inside-avoid">
          <h2 className="text-lg font-bold">{ALL_NORMAL_COPY.title}</h2>
          {ALL_NORMAL_COPY.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      )}

      {report.problems.map((problem) => (
        <section key={problem.id} className="space-y-2 border-t border-black pt-3">
          <div className="break-inside-avoid">
            <h2 className="text-lg font-bold">
              {problem.markerNumber}. {problem.plainName}
              <span className="ml-2 text-sm font-normal">（專業名稱：{problem.professionalName}）</span>
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <SeverityMeter severity={problem.severity} />
              {problem.nearThreshold && <span className="text-sm">接近分界</span>}
              {lowConfidence && <span className="text-sm font-semibold">僅供參考</span>}
            </div>
            <h3 className="mt-2 font-semibold">我們看到什麼</h3>
            <p>{problem.whatWeSaw}</p>
          </div>
          <div className="break-inside-avoid">
            <h3 className="font-semibold">這代表什麼</h3>
            {problem.meaning.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          {problem.causes.length > 0 && (
            <div className="break-inside-avoid">
              <h3 className="font-semibold">可能原因</h3>
              <p className="text-sm">{CAUSES_INTRO}</p>
              <ul className="list-disc pl-5">
                {problem.causes.map((cause) => (
                  <li key={cause}>{cause}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="font-semibold">建議練習</h3>
            {problem.exercisesIntro && <p className="font-semibold">{problem.exercisesIntro}</p>}
            {problem.exercises.map((exercise) => (
              <div key={exercise.name} className="mt-2 break-inside-avoid rounded border border-gray-400 p-2">
                <p className="font-semibold">
                  {exercise.name}
                  {exercise.gentle && <span className="ml-2 text-xs font-normal">（{POPULATION_CAVEAT_COPY.gentleLabel}）</span>}
                </p>
                {exercise.why && <p>{exercise.why}</p>}
                {exercise.purpose && <p>{exercise.steps.length > 0 ? `練什麼：${exercise.purpose}` : exercise.purpose}</p>}
                {exercise.steps.length > 0 && (
                  <ol className="list-decimal pl-5">
                    {exercise.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
                {exercise.dosage && <p>份量：{exercise.dosage}</p>}
                {exercise.tip && <p>小提醒：{exercise.tip}</p>}
                {exercise.alsoFor && exercise.alsoFor.length > 0 && (
                  <p className="text-sm">這個練習也對應：{exercise.alsoFor.map((name) => `「${name}」`).join("")}</p>
                )}
              </div>
            ))}
            <p className="mt-1 text-sm">{EXERCISE_SAFETY}</p>
          </div>
          {metricsByCard?.[problem.id] && metricsByCard[problem.id].length > 0 && (
            <div className="break-inside-avoid text-sm">
              <h3 className="font-semibold">數據</h3>
              {metricsByCard[problem.id].map((row) => (
                <p key={row.label}>
                  {row.label}：{row.value}
                  {row.range && `｜常見範圍：${row.range}`}
                </p>
              ))}
            </div>
          )}
          {problem.note && <p className="text-sm">{problem.note}</p>}
        </section>
      ))}

      {report.goodItems.length > 0 && (
        <section className="break-inside-avoid border-t border-black pt-3">
          <h2 className="text-lg font-bold">看起來不錯（{report.goodItems.length} 項）</h2>
          <ul className="space-y-1">
            {report.goodItems.map((item) => (
              <li key={item} className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">{item}</span>
                <SeverityMeter severity="normal" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.headObservation && (
        <section className="break-inside-avoid">
          <h2 className="text-lg font-bold">{HEAD_OBSERVATION_TITLE}</h2>
          {report.headObservation.map((paragraph) => (
            <p key={paragraph} className="text-sm">
              {paragraph}
            </p>
          ))}
        </section>
      )}

      {!report.populationCaveat && seekCare}

      <footer className="border-t border-black pt-2 text-xs">
        <p>{DISCLAIMER_COPY.footer}</p>
        <p>
          {DOWNLOAD_COPY.printFooter}
          {DOWNLOAD_COPY.generatedAt(formatDate(generatedAt))}
        </p>
      </footer>
    </article>
  );
}
