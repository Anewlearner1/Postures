/**
 * 這個檔案做什麼：
 *   拍攝教學的重點清單。每一條預設只顯示一行，點「為什麼？」才展開理由
 *   （UX 文件 §2.2 互動說明），確保 30 秒內能看完。
 *   `compact` 模式只列重點、不顯示「為什麼？」（上傳頁側欄使用）。
 */

import { GUIDE_TIPS } from "@/data/guide-tips";
import { ChevronRightIcon } from "@/components/ui/icons";

export function GuideTipList({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={compact ? "space-y-2" : "space-y-3"}>
      {GUIDE_TIPS.map((tip, index) => (
        <li key={tip.label} className={compact ? "flex gap-2 text-sm" : "rounded-xl border border-line p-4"}>
          {compact ? (
            <>
              <span className="font-semibold text-brand-700">{index + 1}.</span>
              <span>{tip.title}</span>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 rounded-md bg-brand-100 px-2 py-0.5 text-sm font-semibold text-brand-800">
                  {tip.label}
                </span>
                <p className="font-semibold">{tip.title}</p>
              </div>
              <details className="mt-1 pl-1">
                <summary className="inline-flex min-h-10 items-center gap-1 text-sm text-brand-700">
                  <ChevronRightIcon className="summary-arrow h-4 w-4" />
                  為什麼？
                </summary>
                <p className="text-sm text-muted">{tip.why}</p>
              </details>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
