/**
 * 這個檔案做什麼：
 *   報告頁的內容（版面原本在 src/app/report/page.tsx，搬到這裡讓前端取得報告後再畫出來）。
 *   區塊順序依 docs/spec/ux-flow-and-copy.md §2.5：
 *   短版免責聲明 →（適用情況提醒）→（低可信度提示）→ 總覽＋測試版標準 → 問題卡片 → 看起來不錯
 *   → 觀察：頭部位置 → 骨架回放 → 什麼時候該找專業人員 → 下一步 → 離開提醒。
 *   手機是單欄；電腦是「左欄骨架回放固定、右欄卡片捲動」。
 *
 *   UX §2.5 的手機／電腦差異：
 *   - 卡片：手機只展開第一張；電腦全部展開，且「這代表什麼」預設展開
 *   - 「什麼時候該找專業人員？」：電腦預設展開；手機在有「明顯」或適用情況提醒時展開
 *   - 下一步按鈕：手機捲到後半出現底部固定列；電腦在右欄底部
 *   適用情況提醒（population_caveat）時，就醫提醒整塊移到問題卡片前（UX §4.2）。
 *   全部在常見範圍內時，卡片位置改放鼓勵文案與 3 個項目小卡（D37、UX §4.4）。
 *   列印／儲存為 PDF 時只印 PrintReport（D43）。
 *
 *   同一個版面給兩種報告使用：
 *   - 使用者自己的報告（/report）：replay 傳入真正的骨架回放播放器
 *   - 示範報告（/report/sample）：沒有影片，回放區顯示佔位，頂端顯示「示範報告」說明（notice）
 */

"use client";

import type { ReactNode } from "react";
import { DownloadReportButton } from "@/components/report/DownloadReportButton";
import { MobileActionBar } from "@/components/report/MobileActionBar";
import { PrintReport, type Keyframe } from "@/components/report/PrintReport";
import { ProblemCard, type MetricRow } from "@/components/report/ProblemCard";
import { ReplayPlaceholder } from "@/components/report/ReplayPlaceholder";
import { SeekCareSection } from "@/components/report/SeekCare";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { DisclaimerStrip } from "@/components/ui/DisclaimerStrip";
import { AlertIcon, CheckIcon, InfoIcon } from "@/components/ui/icons";
import { PageContainer } from "@/components/ui/PageContainer";
import { SeverityMeter } from "@/components/ui/SeverityMeter";
import { DESKTOP_QUERY, useMediaQuery } from "@/components/ui/useMediaQuery";
import {
  ALL_NORMAL_COPY,
  CONFIDENCE_INFO,
  CONFIDENCE_LABEL,
  HEAD_OBSERVATION_TITLE,
  NEXT_STEPS_COPY,
  POPULATION_CAVEAT_COPY,
} from "@/data/report-copy";
import { STANDARD_LABEL } from "@/data/site";
import type { ReportView } from "@/lib/report/types";

export function ReportContent({
  report,
  notice,
  replay,
  onViewInVideo,
  generatedAt,
  keyframe,
  metricsByCard,
}: {
  report: ReportView;
  /** 報告產生時間（列印版顯示）。 */
  generatedAt: Date;
  /** 列印版的關鍵畫面（本機產生）；沒有時不放圖。 */
  keyframe?: Keyframe | null;
  /** 各卡片「查看數據」的內容（D44）；沒有時不顯示。 */
  metricsByCard?: Record<string, MetricRow[]>;
  /** 報告頂端的說明（例如示範報告、AI 白話說明暫時無法產生）。 */
  notice?: { text: string; tone: "demo" | "info" };
  /** 骨架回放區；沒有提供時顯示佔位版。 */
  replay?: ReactNode;
  /** 卡片的「在影片中查看」：傳入卡片 id。 */
  onViewInVideo?: (cardId: string) => void;
}) {
  const isLowConfidence = report.confidence === "low";
  const hasMarked = report.problems.some((problem) => problem.severity === "marked");
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const caveat = Boolean(report.populationCaveat);
  const allNormal = report.problems.length === 0;
  const seekCare = (
    <div className="lg:col-start-2">
      <SeekCareSection key={String(isDesktop)} defaultOpen={isDesktop || hasMarked || caveat} />
    </div>
  );

  return (
    <>
    <PrintReport
      report={report}
      generatedAt={generatedAt}
      keyframe={keyframe}
      metricsByCard={metricsByCard}
      demoNotice={notice?.tone === "demo" ? notice.text : undefined}
    />
    <PageContainer width="wide" className="space-y-6 pb-28 print:hidden lg:pb-12">
      {notice?.tone === "demo" && (
        <p className="rounded-lg border-2 border-dashed border-sev-mild px-3 py-2 text-sm font-semibold text-sev-mild-text">
          {notice.text}
        </p>
      )}
      {notice?.tone === "info" && (
        <p className="flex items-start gap-2 rounded-lg bg-surface px-3 py-2 text-sm text-muted">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
          {notice.text}
        </p>
      )}

      {/* 1. 短版免責聲明 */}
      <DisclaimerStrip />

      {/* 1-2. 適用情況提醒（population_caveat，D30／D35，UX §4.2）：藍灰色資訊框、不可關閉 */}
      {report.populationCaveat && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="flex items-center gap-2 font-bold">
            <InfoIcon className="h-5 w-5 shrink-0" />
            {POPULATION_CAVEAT_COPY.title}
          </p>
          {POPULATION_CAVEAT_COPY.paragraphs.map((paragraph) => (
            <p key={paragraph} className="mt-1">
              {paragraph}
            </p>
          ))}
        </div>
      )}

      {/* 2. 低可信度提示（只在可信度「較低」時出現，UX §4.5） */}
      {report.lowConfidence && (
        <div className="rounded-xl border border-sev-mild bg-amber-50 p-4">
          <p className="flex items-center gap-2 font-bold">
            <AlertIcon className="h-5 w-5 text-sev-mild-text" />
            這次結果的可信度較低，僅供參考
          </p>
          <p className="mt-1">{report.lowConfidence.reason}</p>
          <p className="mt-1 text-sm">怎麼改善：{report.lowConfidence.fix}</p>
          <ButtonLink href="/guide" variant="ghost">
            照教學重拍一次
          </ButtonLink>
        </div>
      )}

      {/* 3. 總覽 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl font-bold sm:text-3xl">你的走路分析報告</h1>
          {STANDARD_LABEL.show && (
            <details className="text-sm">
              <summary className="inline-flex items-center gap-1 rounded-full border border-muted px-3 py-0.5 text-muted">
                {STANDARD_LABEL.text}
                <InfoIcon className="h-4 w-4" />
              </summary>
              <p className="mt-2 max-w-md rounded-lg bg-surface p-3 text-muted">{STANDARD_LABEL.explanation}</p>
            </details>
          )}
        </div>
        <p className="text-lg">{report.summary}</p>
        <div className="text-sm text-muted">
          <span>
            分析了 {report.stepsAnalyzed} 步（{report.cyclesAnalyzed} 個完整步態週期）・影片長度 {report.durationSec}{" "}
            秒・
          </span>
          <details className="inline-block align-top">
            <summary className="inline-flex items-center gap-1">
              可信度：<strong className="text-ink">{CONFIDENCE_LABEL[report.confidence]}</strong>
              <InfoIcon className="h-4 w-4" />
            </summary>
            <div className="mt-2 max-w-md space-y-1 rounded-lg bg-surface p-3">
              {report.confidenceTip && <p>{report.confidenceTip}</p>}
              <p>{CONFIDENCE_INFO}</p>
            </div>
          </details>
        </div>
        {report.slowSpeed && (
          <p className="flex items-start gap-2 text-sm text-muted">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
            這次影片中你走得比較慢。走路速度會影響關節的動作幅度，部分結果可能和走得慢有關。如果這不是你平常的速度，可以用平常的速度再拍一次。
          </p>
        )}
      </section>

      {/* 手機：單欄由上到下；電腦：左欄骨架回放固定、右欄其他區塊 */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        {/* 適用情況提醒時：就醫提醒移到問題卡片前，預設展開（UX §4.2） */}
        {caveat && seekCare}

        {/* 4. 問題卡片（依嚴重度排序：明顯 → 輕度） */}
        {!allNormal && (
          <section className="space-y-4 lg:col-start-2" aria-label="問題卡片">
            {report.problems.map((problem, index) => (
              <ProblemCard
                key={`${problem.id}-${isDesktop}`}
                problem={problem}
                lowConfidence={isLowConfidence}
                expanded={isDesktop || index === 0}
                meaningOpen={isDesktop}
                metrics={metricsByCard?.[problem.id]}
                onViewInVideo={onViewInVideo ? () => onViewInVideo(problem.id) : undefined}
              />
            ))}
          </section>
        )}

        {/* 全部在常見範圍內：鼓勵文案＋項目小卡（D37：不給維持型練習，UX §4.4） */}
        {allNormal && (
          <section className="space-y-4 lg:col-start-2" aria-label="結果">
            <div className="rounded-2xl border-2 border-line p-5">
              <h2 className="text-xl font-bold">{ALL_NORMAL_COPY.title}</h2>
              {ALL_NORMAL_COPY.paragraphs.map((paragraph) => (
                <p key={paragraph} className="mt-2">
                  {paragraph}
                </p>
              ))}
            </div>
            <ul className="space-y-2" aria-label="看起來不錯的項目">
              {report.goodItems.map((item) => (
                <li key={item} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3">
                  <span className="font-semibold">{item}</span>
                  <SeverityMeter severity="normal" />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 5. 看起來不錯 */}
        {!allNormal && report.goodItems.length > 0 && (
          <details className="rounded-2xl border border-line px-4 lg:col-start-2">
            <summary className="flex min-h-12 items-center gap-2 py-2 font-bold">
              <CheckIcon className="h-5 w-5 text-sev-normal-text" />
              看起來不錯（{report.goodItems.length} 項）
            </summary>
            <ul className="space-y-2 pb-4">
              {report.goodItems.map((item) => (
                <li key={item} className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold">{item}</span>
                  <SeverityMeter severity="normal" />
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* 6. 觀察：頭部位置（不分級、不給練習，D25） */}
        {report.headObservation && (
          <section className="rounded-2xl bg-surface p-4 lg:col-start-2">
            <h2 className="font-bold">{HEAD_OBSERVATION_TITLE}</h2>
            <div className="mt-1 space-y-1 text-sm text-muted">
              {report.headObservation.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </section>
        )}

        {/* 7. 骨架回放（電腦版固定在左欄） */}
        <div className="lg:sticky lg:top-20 lg:col-start-1 lg:row-span-6 lg:row-start-1">
          {replay ?? <ReplayPlaceholder markers={report.timelineMarkers} durationLabel={report.durationLabel} />}
        </div>

        {/* 8. 什麼時候該找專業人員（適用情況提醒時已移到卡片前） */}
        {!caveat && seekCare}

        {/* 9. 下一步（資料捐贈邀請在 M6 才加入） */}
        <section className="space-y-3 lg:col-start-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <DownloadReportButton />
            <ButtonLink href="/upload" variant="secondary">
              {NEXT_STEPS_COPY.again}
            </ButtonLink>
          </div>
          {/* 10. 離開提醒 */}
          <p className="flex items-start gap-2 text-sm text-muted">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
            {NEXT_STEPS_COPY.leaveNotice}
          </p>
        </section>
      </div>
    </PageContainer>
    <MobileActionBar />
    </>
  );
}
