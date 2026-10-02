/**
 * 這個檔案做什麼：
 *   短版免責聲明細條（UX 文件 §6.1）：灰底小字，附「更多」連到完整免責聲明。
 *   用在首頁與報告頁頂端。首頁還沒有報告，所以改用頁尾那一句通用說法（variant="general"）。
 */

import Link from "next/link";
import { DISCLAIMER_COPY } from "@/data/site";
import { InfoIcon } from "./icons";

export function DisclaimerStrip({
  className = "",
  variant = "report",
}: {
  className?: string;
  /** report：報告頁用的短版；general：首頁等尚無報告時的通用說法。 */
  variant?: "report" | "general";
}) {
  return (
    <div className={`flex items-start gap-2 rounded-lg bg-surface px-3 py-2 text-sm text-muted ${className}`}>
      <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        {variant === "report" ? DISCLAIMER_COPY.short : DISCLAIMER_COPY.footer}
        <Link href="/disclaimer" className="ml-1 whitespace-nowrap text-brand-700 underline underline-offset-4">
          更多
        </Link>
      </p>
    </div>
  );
}
