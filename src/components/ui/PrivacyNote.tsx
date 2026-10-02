/**
 * 這個檔案做什麼：
 *   「影片只在你的裝置上分析」的隱私提示（UX 文件 §1.4：首頁、上傳頁、分析中頁都要出現）。
 *   文案集中在 src/data/site.ts。
 */

import { PRIVACY_COPY } from "@/data/site";
import { LockIcon } from "./icons";

export function PrivacyNote({ long = false, className = "" }: { long?: boolean; className?: string }) {
  return (
    <p className={`flex items-start gap-2 text-sm text-muted ${className}`}>
      <LockIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
      <span>{long ? PRIVACY_COPY.long : PRIVACY_COPY.short}</span>
    </p>
  );
}
