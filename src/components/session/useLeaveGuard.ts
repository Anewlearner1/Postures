"use client";

/**
 * 這個檔案做什麼：
 *   「離開頁面前確認」（UX 文件 §2.0【給工程】、§2.4、§4.8）。
 *   - 重新整理、關閉分頁：用瀏覽器內建的 beforeunload 視窗（文字由瀏覽器決定）。
 *   - 點了網站內的其他連結（例如頁首選單）：若有提供 linkMessage，跳出確認視窗，按「取消」就留在原頁。
 */

import { useEffect } from "react";

export function useLeaveGuard(active: boolean, linkMessage?: string): void {
  useEffect(() => {
    if (!active) return;

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // 舊版瀏覽器需要設定 returnValue 才會跳出確認視窗
      event.returnValue = "";
    }

    function onClick(event: MouseEvent) {
      if (!linkMessage || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // 同一頁內的錨點（例如 #replay）不算離開
      if (url.pathname === window.location.pathname && url.hash) return;
      if (!window.confirm(linkMessage)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    // capture 階段攔截，才能在 Next.js 的 <Link> 換頁之前處理
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active, linkMessage]);
}
