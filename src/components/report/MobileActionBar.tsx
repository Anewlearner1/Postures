"use client";

/**
 * 這個檔案做什麼：
 *   手機版報告底部的固定按鈕列（UX §2.5：「下載報告」「再分析一次」，捲動到報告後半才出現）。
 *   電腦版不顯示（按鈕在右欄底部）；列印時也不顯示。
 */

import { useEffect, useState } from "react";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { NEXT_STEPS_COPY } from "@/data/report-copy";
import { DownloadReportButton } from "./DownloadReportButton";

export function MobileActionBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function update() {
      const scrolled = window.scrollY + window.innerHeight;
      setVisible(scrolled > document.documentElement.scrollHeight * 0.5);
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur transition-transform duration-200 print:hidden lg:hidden ${
        visible ? "translate-y-0" : "pointer-events-none translate-y-full"
      }`}
      inert={!visible}
      data-testid="mobile-action-bar"
    >
      <div className="mx-auto flex max-w-xl gap-3">
        <DownloadReportButton className="flex-1" showHelp={false} compact />
        <ButtonLink href="/upload" variant="secondary" className="flex-1 px-3">
          {NEXT_STEPS_COPY.again}
        </ButtonLink>
      </div>
    </div>
  );
}
