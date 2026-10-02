/**
 * 這個檔案做什麼：
 *   報告頁的「問題卡片」（UX 文件 §4.3.0）：白話名稱、專業名稱、嚴重度指示條、
 *   我們看到什麼、在影片中查看，以及可展開的「這代表什麼／可能原因／建議練習」。
 *   用瀏覽器內建的 <details> 做展開／收合，不需要額外程式。
 */

import type { ReactNode } from "react";
import { ChevronRightIcon } from "@/components/ui/icons";
import { SeverityMeter } from "@/components/ui/SeverityMeter";
import { CAUSES_INTRO, EXERCISE_SAFETY, POPULATION_CAVEAT_COPY } from "@/data/report-copy";
import type { ProblemCardView } from "@/lib/report/types";

export function ProblemCard({ problem, lowConfidence = false }: { problem: ProblemCardView; lowConfidence?: boolean }) {
  return (
    <article
      className={`rounded-2xl border-2 bg-white p-5 ${lowConfidence ? "border-dashed border-line" : "border-line"}`}
      aria-labelledby={`problem-${problem.id}`}
    >
      <header className="space-y-1">
        <h3 id={`problem-${problem.id}`} className="flex items-center gap-2 text-xl font-bold">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-sm text-white">
            {problem.markerNumber}
          </span>
          {problem.plainName}
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

      <section className="mt-4 border-t border-line pt-4">
        <h4 className="font-semibold">我們看到什麼</h4>
        <p className="mt-1">{problem.whatWeSaw}</p>
        {problem.firstTimestamp && (
          <a href="#replay" className="mt-2 inline-flex min-h-10 items-center gap-1 text-brand-700 underline underline-offset-4">
            在影片中查看（{problem.firstTimestamp}）
          </a>
        )}
      </section>

      <div className="mt-2 divide-y divide-line border-t border-line">
        <Collapsible title="這代表什麼">
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

      {problem.note && <p className="mt-3 rounded-lg bg-surface p-3 text-sm">{problem.note}</p>}
      <p className="mt-3 text-sm text-muted">練習時如果感到疼痛，請立刻停止。</p>
    </article>
  );
}

function Collapsible({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details>
      <summary className="flex min-h-12 items-center gap-2 font-semibold">
        <ChevronRightIcon className="summary-arrow h-4 w-4 shrink-0 text-brand-600" />
        {title}
      </summary>
      <div className="space-y-2 pb-4 pl-6">{children}</div>
    </details>
  );
}
