/**
 * 這個檔案做什麼：
 *   每一頁內容的外框：限制最大寬度、左右留白 16 像素（手機）。
 *   各頁面都包在這裡面，版面寬度才會一致。
 */

import type { ReactNode } from "react";

export function PageContainer({
  children,
  width = "default",
  className = "",
}: {
  children: ReactNode;
  /** narrow：文字頁（教學、隱私）；default：一般頁；wide：報告頁。 */
  width?: "narrow" | "default" | "wide";
  className?: string;
}) {
  const max = width === "narrow" ? "max-w-3xl" : width === "wide" ? "max-w-6xl" : "max-w-5xl";
  return <div className={`mx-auto w-full ${max} px-4 py-8 sm:px-6 sm:py-12 ${className}`}>{children}</div>;
}
