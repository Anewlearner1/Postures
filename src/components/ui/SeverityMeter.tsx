/**
 * 這個檔案做什麼：
 *   嚴重度的「3 格指示條＋文字」（UX 文件 §4.1）。
 *   一定同時顯示文字和指示條，不只靠顏色；不用紅色。
 */

import { SEVERITY_COPY, SEVERITY_INFO } from "@/data/report-copy";
import type { Severity } from "@/lib/gait/types";

const COLOR: Record<Severity, string> = {
  normal: "bg-sev-normal",
  mild: "bg-sev-mild",
  marked: "bg-sev-marked",
};

const TEXT_COLOR: Record<Severity, string> = {
  normal: "text-sev-normal",
  mild: "text-sev-mild",
  marked: "text-sev-marked",
};

export function SeverityMeter({ severity }: { severity: Severity }) {
  const { label, filled } = SEVERITY_COPY[severity];
  return (
    <div className="flex flex-wrap items-center gap-2" title={SEVERITY_INFO}>
      <span className="flex gap-1" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-3 w-5 rounded-sm ${i <= filled ? COLOR[severity] : "border border-line bg-white"}`}
          />
        ))}
      </span>
      <span className={`text-sm font-semibold ${TEXT_COLOR[severity]}`}>{label}</span>
    </div>
  );
}
