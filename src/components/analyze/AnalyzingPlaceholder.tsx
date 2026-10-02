"use client";

/**
 * 這個檔案做什麼：
 *   P3 分析中畫面的「佔位版」（UX 文件 §2.4）。
 *   目前還沒有真正的分析（M3 才接上 MediaPipe），所以進度條、步驟都是固定的示意畫面，
 *   並提供「查看示範報告」「查看錯誤頁範例」連結，讓整個流程可以點下去。
 */

import Link from "next/link";
import { useAnalysisSession } from "@/components/session/AnalysisSession";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { AlertIcon, CheckIcon } from "@/components/ui/icons";
import { PrivacyNote } from "@/components/ui/PrivacyNote";

/** 分析步驟（UX §2.4）。status 目前是寫死的示意值。 */
const STEPS: { label: string; status: "done" | "active" | "pending" }[] = [
  { label: "讀取影片", status: "done" },
  { label: "找出身體關節位置", status: "active" },
  { label: "計算角度與步伐", status: "pending" },
  { label: "撰寫你的報告", status: "pending" },
];

const DEMO_PROGRESS = 35;

export function AnalyzingPlaceholder() {
  const { video } = useAnalysisSession();

  return (
    <div>
      <h1 className="text-2xl font-bold sm:text-3xl">分析中</h1>

      <div className="mt-6 grid gap-8 md:grid-cols-2 md:items-start">
        {/* 左欄：影片縮圖＋骨架逐步疊上（M3 實作），先放佔位框 */}
        <div className="flex aspect-video items-center justify-center rounded-xl bg-ink/90 p-4 text-center text-sm text-white">
          {video ? `影片：${video.name}` : "尚未選擇影片"}
          <br />
          （骨架動畫佔位）
        </div>

        <div className="space-y-6">
          <div>
            <div
              className="h-3 w-full overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={DEMO_PROGRESS}
              aria-label="分析進度"
            >
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${DEMO_PROGRESS}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted">通常需要 30 秒到 2 分鐘，依你的裝置效能而定。</p>
          </div>

          <ol className="space-y-2">
            {STEPS.map((step) => (
              <li key={step.label} className="flex items-center gap-3">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                    step.status === "done"
                      ? "border-brand-600 bg-brand-600 text-white"
                      : step.status === "active"
                        ? "border-brand-600"
                        : "border-line"
                  }`}
                >
                  {step.status === "done" && <CheckIcon className="h-4 w-4" />}
                  {step.status === "active" && <span className="h-2 w-2 rounded-full bg-brand-600" />}
                </span>
                <span className={step.status === "pending" ? "text-muted" : "font-semibold"}>{step.label}</span>
              </li>
            ))}
          </ol>

          <p className="flex items-start gap-2 rounded-xl bg-surface p-4 text-sm">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-sev-mild" />
            <span>
              <strong>請保持這個畫面開著。</strong>
              切換到其他 App 或鎖定螢幕，分析可能會暫停。
            </span>
          </p>

          <PrivacyNote long />

          <ButtonLink href="/upload" variant="ghost">
            取消分析
          </ButtonLink>
        </div>
      </div>

      {/* 開發中說明：M3 完成後刪除這個區塊 */}
      <aside className="mt-10 rounded-xl border-2 border-dashed border-line p-4 text-sm">
        <p className="font-semibold">開發中示範</p>
        <p className="mt-1 text-muted">分析功能尚未完成（里程碑 3）。上面的進度是固定的示意畫面。</p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/report" className="text-brand-700 underline underline-offset-4">
            查看示範報告
          </Link>
          <Link href="/retake/no_gait_cycle" className="text-brand-700 underline underline-offset-4">
            查看「請重拍」頁範例
          </Link>
        </div>
      </aside>
    </div>
  );
}
