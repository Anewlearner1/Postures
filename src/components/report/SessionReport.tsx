"use client";

/**
 * 這個檔案做什麼：
 *   使用者自己的報告（網址：/report）。顯示「分析中」頁完成後存在瀏覽器記憶體裡的結果：
 *   報告內容（POST /api/report 取得）＋骨架回放（使用者的影片，只用本機 blob: 網址播放）。
 *   - 沒有結果（直接打開網址、重新整理後）→ 回到 /upload
 *   - 重新整理或關閉分頁前跳出確認（報告只存在這個頁面，UX §4.8）
 */

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { ReportContent } from "@/components/report/ReportContent";
import { SkeletonReplay, type SkeletonReplayHandle } from "@/components/report/SkeletonReplay";
import { useAnalysisSession } from "@/components/session/AnalysisSession";
import { useLeaveGuard } from "@/components/session/useLeaveGuard";
import { AI_FALLBACK_NOTICE } from "@/data/analysis-copy";
import { buildReplayMarkers } from "@/lib/pose/replay-markers";

export function SessionReport() {
  const router = useRouter();
  const { video, completed } = useAnalysisSession();
  const replayRef = useRef<SkeletonReplayHandle>(null);
  const ready = Boolean(video && completed);

  useEffect(() => {
    if (!ready) router.replace("/upload");
  }, [ready, router]);

  // 只攔重新整理／關閉分頁；網站內換頁時報告仍留在記憶體中，回來還看得到
  useLeaveGuard(ready);

  const markers = useMemo(
    () => (completed ? buildReplayMarkers(completed.result, completed.report.report.problems) : []),
    [completed],
  );

  if (!video || !completed) return null;
  const { report, source } = completed.report;

  return (
    <ReportContent
      report={report}
      notice={source === "ai" ? undefined : { tone: "info", text: AI_FALLBACK_NOTICE }}
      onViewInVideo={(cardId) => replayRef.current?.focusCard(cardId)}
      replay={
        <SkeletonReplay
          ref={replayRef}
          videoUrl={video.url}
          poses={completed.poses}
          durationSec={video.meta.durationSec}
          sourceFps={video.plan.sourceFps}
          analyzedUntilSec={video.plan.untilSec}
          trimmed={video.plan.trimmed}
          markers={markers}
        />
      }
    />
  );
}
