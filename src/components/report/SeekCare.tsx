/**
 * 這個檔案做什麼：
 *   「什麼時候該找專業人員？」區塊（UX 文件 §4.7、§6.3）。
 *   報告頁與完整免責聲明頁共用。文案在 src/data/report-copy.ts。
 */

import { ChevronRightIcon } from "@/components/ui/icons";
import { SEEK_CARE } from "@/data/report-copy";

export function SeekCareContent() {
  return (
    <div className="space-y-3">
      <div>
        <p className="font-semibold">{SEEK_CARE.urgentTitle}</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {SEEK_CARE.urgent.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="font-semibold">{SEEK_CARE.consultTitle}</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {SEEK_CARE.consult.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <p>{SEEK_CARE.closing}</p>
    </div>
  );
}

/** 報告頁用的可收合版本。defaultOpen：有「明顯」問題時預設展開（UX §4.7）。 */
export function SeekCareSection({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-2xl border border-line px-4">
      <summary className="flex min-h-12 items-center gap-2 py-2 text-lg font-bold">
        <ChevronRightIcon className="summary-arrow h-4 w-4 shrink-0 text-brand-600" />
        {SEEK_CARE.title}
      </summary>
      <div className="pb-4 pl-6">
        <SeekCareContent />
      </div>
    </details>
  );
}
