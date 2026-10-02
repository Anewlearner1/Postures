"use client";

/**
 * 這個檔案做什麼：
 *   「下載報告」按鈕（D21、D43）：呼叫瀏覽器的列印功能，使用者選「儲存為 PDF」即可存檔。
 *   列印時只會印出列印版（PrintReport.tsx），不含影片；報告在裝置上產生，不上傳。
 *   - LINE 等 App 內建瀏覽器通常不能列印：按鈕停用並提示改用 Safari／Chrome。
 *   - 按鈕旁的「怎麼存成 PDF？」說明電腦、iPhone、Android 的操作（可收合）。
 */

import { useSyncExternalStore } from "react";
import { buttonClass } from "@/components/ui/ButtonLink";
import { DOWNLOAD_COPY } from "@/data/analysis-copy";
import { detectInAppBrowser } from "@/lib/pose/browser-support";

const noSubscribe = () => () => undefined;

type PrintSupport = "ok" | "in_app" | "unsupported";

function readPrintSupport(): PrintSupport {
  if (detectInAppBrowser(navigator.userAgent)) return "in_app";
  return typeof window.print === "function" ? "ok" : "unsupported";
}

export function DownloadReportButton({
  className = "",
  showHelp = true,
  compact = false,
}: {
  className?: string;
  /** 顯示「怎麼存成 PDF？」說明。 */
  showHelp?: boolean;
  /** 底部固定列用：按鈕填滿寬度。 */
  compact?: boolean;
}) {
  const support = useSyncExternalStore<PrintSupport>(noSubscribe, readPrintSupport, () => "ok");

  return (
    <div className={className}>
      <button
        type="button"
        className={buttonClass("primary", compact ? "w-full px-3" : "w-full sm:w-auto")}
        disabled={support !== "ok"}
        onClick={() => window.print()}
      >
        {DOWNLOAD_COPY.button}
      </button>
      {support === "in_app" && <p className="mt-1 text-sm text-muted">{DOWNLOAD_COPY.inApp}</p>}
      {support === "unsupported" && <p className="mt-1 text-sm text-muted">{DOWNLOAD_COPY.unsupported}</p>}
      {showHelp && support === "ok" && (
        <details className="mt-1 text-sm text-muted">
          <summary className="min-h-11 py-2 font-semibold text-brand-700">{DOWNLOAD_COPY.howToTitle}</summary>
          <ul className="list-disc space-y-1 pl-5">
            {DOWNLOAD_COPY.howTo.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-1">{DOWNLOAD_COPY.privacy}</p>
        </details>
      )}
    </div>
  );
}
