/**
 * 這個檔案做什麼：
 *   報告頁的「問題卡片」（UX 文件 §4.3.0）：白話名稱、專業名稱、嚴重度指示條、
 *   我們看到什麼、在影片中查看，以及可展開的「這代表什麼／可能原因／建議練習」。
 *   用瀏覽器內建的 <details> 做展開／收合，不需要額外程式。
 *   「在影片中查看」：有骨架回放時（onViewInVideo）會跳到影片中的問題時間點（UX §4.6）。
 *   卡片本身也可以收合（點標題）：手機只有第一張預設展開，電腦全部展開（UX §2.5）。
 *   「查看數據」（D44）：有本機角度數值時才顯示，收合在卡片底部。
 */

import type { ReactNode } from "react";
import { ChevronRightIcon } from "@/components/ui/icons";
import { SeverityMeter } from "@/components/ui/SeverityMeter";
import { CAUSES_INTRO, EXERCISE_SAFETY, METRICS_COPY, POPULATION_CAVEAT_COPY } from "@/data/report-copy";
import type { ProblemCardView } from "@/lib/report/types";

/** 「查看數據」的一列（D44：只用本機結果，不送 API）。 */
export interface MetricRow {
  label: string;
  /** 例如「約 7 度」。 */
  value: string;
  /** 常見範圍，例如「約 10–20 度」。 */
  range?: string;
}

export function ProblemCard({
  problem,
  lowConfidence = false,
  onViewInVideo,
  expanded = true,
  meaningOpen = false,
  metrics,
}: {
  problem: ProblemCardView;
  lowConfidence?: boolean;
  /** 點「在影片中查看」時呼叫（沒有提供時只捲到回放區）。 */
  onViewInVideo?: () => void;
  /** 卡片預設展開（UX §2.5：手機只展開第一張，電腦全部展開）。 */
  expanded?: boolean;
  /** 「這代表什麼」預設展開（電腦版）。 */
  meaningOpen?: boolean;
  /** 「查看數據」收合區的內容；沒有時不顯示。 */
  metrics?: MetricRow[];
}) {
  return (
    <article
      className={`rounded-2xl border-2 bg-white p-5 ${lowConfidence ? "border-dashed border-line" : "border-line"}`}
      aria-labelledby={`problem-${problem.id}`}
    >
      <details open={expanded} className="group/card">
        <summary className="cursor-pointer list-none">
          <header className="space-y-1">
            <h3 id={`problem-${problem.id}`} className="flex items-center gap-2 text-xl font-bold">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-sm text-white">
                {problem.markerNumber}
              </span>
              <span className="flex-1">{problem.plainName}</span>
              <ChevronRightIcon className="h-5 w-5 shrink-0 text-brand-600 transition-transform group-open/card:rotate-90" />
            </h3>
            <p className="text-sm text-muted">專業名稱：{problem.professionalName}</p>
            <p className="text-sm">{problem.subtitle}</p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <SeverityMeter severity={problem.severity} />
              {problem.nearThreshold && (
                <span
                  className="rounded-full border border-line px-2 py-0.5 text-sm text-muted"
                  title="這次的數值很接近兩個等級的分界，拍攝條件稍有不同，結果就可能差一級。"
                >
                  接近分界
                </span>
              )}
              {lowConfidence && <span className="text-sm font-semibold text-sev-mild">僅供參考</span>}
            </div>
          </header>
        </summary>

      <section className="mt-4 border-t border-line pt-4">
        <h4 className="font-semibold">我們看到什麼</h4>
        <p className="mt-1">{problem.whatWeSaw}</p>
        {problem.firstTimestamp && (
          <a
            href="#replay"
            onClick={(event) => {
              if (!onViewInVideo) return;
              event.preventDefault();
              onViewInVideo();
            }}
            className="mt-2 inline-flex min-h-10 items-center gap-1 text-brand-700 underline underline-offset-4"
          >
            在影片中查看（{problem.firstTimestamp}）
          </a>
        )}
      </section>

      <div className="mt-2 divide-y divide-line border-t border-line">
        <Collapsible title="這代表什麼" defaultOpen={meaningOpen}>
          {problem.meaning.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </Collapsible>
        <Collapsible title="可能原因">
          <p>{CAUSES_INTRO}</p>
          <ul className="list-disc pl-5">
            {problem.causes.map((cause) => (
              <li key={cause}>{cause}</li>
            ))}
          </ul>
        </Collapsible>
        <Collapsible title={`建議練習（${problem.exercises.length} 個）`}>
          {problem.exercisesIntro && <p className="font-semibold">{problem.exercisesIntro}</p>}
          {problem.exercises.map((exercise) => (
            <div key={exercise.name} className="rounded-xl bg-surface p-4">
              <p className="font-semibold">
                {exercise.name}
                {exercise.gentle && (
                  <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs font-normal text-muted">
                    {POPULATION_CAVEAT_COPY.gentleLabel}
                  </span>
                )}
              </p>
              {exercise.why && <p>{exercise.why}</p>}
              {exercise.purpose && <p>{exercise.steps.length > 0 ? `練什麼：${exercise.purpose}` : exercise.purpose}</p>}
              {exercise.steps.length > 0 && (
                <>
                  <p className="mt-1">怎麼做：</p>
                  <ol className="list-decimal pl-5">
                    {exercise.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </>
              )}
              {exercise.dosage && <p className="mt-1">份量：{exercise.dosage}</p>}
              {exercise.tip && <p className="mt-1 text-muted">小提醒：{exercise.tip}</p>}
              {exercise.alsoFor && exercise.alsoFor.length > 0 && (
                <p className="mt-1 text-sm text-muted">這個練習也對應：{exercise.alsoFor.map((name) => `「${name}」`).join("")}</p>
              )}
            </div>
          ))}
          <p className="text-sm text-muted">{EXERCISE_SAFETY}</p>
        </Collapsible>
      </div>

      {metrics && metrics.length > 0 && (
        <div className="border-t border-line">
          <Collapsible title={METRICS_COPY.title}>
            <dl className="space-y-1">
              {metrics.map((row) => (
                <div key={row.label} className="flex flex-wrap gap-x-2">
                  <dt className="text-muted">{row.label}：</dt>
                  <dd>
                    {row.value}
                    {row.range && <span className="text-muted">｜常見範圍：{row.range}</span>}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-muted">{METRICS_COPY.note}</p>
          </Collapsible>
        </div>
      )}

      {problem.note && <p className="mt-3 rounded-lg bg-surface p-3 text-sm">{problem.note}</p>}
      <p className="mt-3 text-sm text-muted">練習時如果感到疼痛，請立刻停止。</p>
      </details>
    </article>
  );
}

function Collapsible({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen}>
      <summary className="flex min-h-12 items-center gap-2 font-semibold">
        <ChevronRightIcon className="summary-arrow h-4 w-4 shrink-0 text-brand-600" />
        {title}
      </summary>
      <div className="space-y-2 pb-4 pl-6">{children}</div>
    </details>
  );
}
