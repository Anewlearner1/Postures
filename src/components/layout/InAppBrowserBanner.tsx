"use client";

/**
 * 這個檔案做什麼：
 *   在 LINE、Facebook、Instagram 等 App 內建瀏覽器開啟網站時，頁面頂部顯示提示條，
 *   建議改用 Safari／Chrome 開啟（UX 文件 §5.8；進站時就偵測，不等到分析失敗）。
 *   可以「複製網址」（加上 LINE 認得的 openExternalBrowser=1）或按「我知道了」關閉（本次瀏覽不再顯示）。
 */

import { useState, useSyncExternalStore } from "react";
import { buttonClass } from "@/components/ui/ButtonLink";
import { AlertIcon } from "@/components/ui/icons";
import { IN_APP_BANNER } from "@/data/analysis-copy";
import { detectInAppBrowser, externalBrowserUrl, type InAppBrowser } from "@/lib/pose/browser-support";

const DISMISS_KEY = "postures:in-app-banner-dismissed";

const noSubscribe = () => () => undefined;

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // 無法使用 sessionStorage 時，每次都顯示
    return false;
  }
}

export function InAppBrowserBanner() {
  // 只能在瀏覽器裡讀 User-Agent；伺服器端產生頁面時一律不顯示
  const app = useSyncExternalStore<InAppBrowser | null>(
    noSubscribe,
    () => detectInAppBrowser(navigator.userAgent),
    () => null,
  );
  const dismissedEarlier = useSyncExternalStore(noSubscribe, readDismissed, () => false);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!app || dismissed || dismissedEarlier) return null;

  function dismiss() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // 忽略
    }
  }

  return (
    <div role="region" aria-label="瀏覽器提示" className="border-b border-sev-mild bg-amber-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-3 text-sm sm:px-6 md:flex-row md:items-center">
        <p className="flex flex-1 items-start gap-2">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-sev-mild" />
          <span>
            <strong>{IN_APP_BANNER.title}</strong>
            {IN_APP_BANNER.body(app)}
          </span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonClass("secondary", "", "sm")}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(externalBrowserUrl(window.location.href));
                setCopied(true);
              } catch {
                // 部分 App 不允許寫入剪貼簿
              }
            }}
          >
            {copied ? IN_APP_BANNER.copied : IN_APP_BANNER.copy}
          </button>
          <button type="button" className={buttonClass("ghost")} onClick={dismiss}>
            {IN_APP_BANNER.dismiss}
          </button>
        </div>
      </div>
    </div>
  );
}
