/**
 * 這個檔案做什麼：
 *   報告頁的「骨架回放」區塊佔位（UX 文件 §4.6）。
 *   M4 會換成真正的影片＋骨架疊圖播放器；目前只畫出版面：影片框、控制列、
 *   時間軸上的問題標記（用編號區分，不只靠顏色）與圖例。
 */

import { REPLAY_COPY } from "@/data/report-copy";
import type { TimelineMarker } from "@/lib/report/types";

export function ReplayPlaceholder({
  markers,
  durationLabel,
}: {
  markers: TimelineMarker[];
  durationLabel: string;
}) {
  // 圖例只列出有出現的問題（同一個編號只列一次）
  const legend = markers.filter(
    (marker, index) => markers.findIndex((m) => m.markerNumber === marker.markerNumber) === index,
  );

  return (
    <section id="replay" className="scroll-mt-20 rounded-2xl border border-line p-4">
      <h2 className="text-lg font-bold">{REPLAY_COPY.title}</h2>
      <p className="text-sm text-muted">{REPLAY_COPY.subtitle}</p>

      <div className="mt-3 flex aspect-video items-center justify-center rounded-xl bg-ink/90 p-4 text-center text-sm text-white">
        影片＋骨架疊圖（佔位，M4 實作）
      </div>

      {/* 控制列（示意，尚不能操作） */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted" aria-hidden>
        <span className="rounded-md border border-line px-2 py-1">播放</span>
        <span>0:00 / {durationLabel}</span>
        <span className="rounded-md border border-line px-2 py-1">0.5x</span>
        <span className="rounded-md border border-line px-2 py-1">骨架 開</span>
      </div>

      {/* 時間軸與標記 */}
      <div className="relative mt-5 h-2 rounded-full bg-line">
        {markers.map((marker, index) => (
          <span
            key={`${marker.markerNumber}-${index}`}
            className="absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-xs font-bold text-white"
            style={{ left: `${marker.positionPct}%` }}
            title={marker.label}
          >
            {marker.markerNumber}
          </span>
        ))}
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {legend.map((marker) => (
          <li key={marker.markerNumber}>
            <span className="font-bold">{marker.markerNumber}</span> {marker.label}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-muted">{REPLAY_COPY.privacy}</p>
    </section>
  );
}
