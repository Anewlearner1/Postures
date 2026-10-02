/**
 * 這個檔案做什麼：
 *   每一頁最下方的頁尾（UX 文件 §2.0）：免責聲明短句＋完整免責聲明、隱私權說明連結。
 *   「撤回資料捐贈」「聯絡我們」要等對應功能與聯絡方式確定後再加入。
 */

import Link from "next/link";
import { DISCLAIMER_COPY, PRODUCT_NAME } from "@/data/site";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-surface">
      <div className="mx-auto w-full max-w-6xl space-y-3 px-4 py-8 text-sm text-muted sm:px-6">
        <p>{DISCLAIMER_COPY.footer}</p>
        <nav aria-label="頁尾連結" className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/disclaimer" className="underline underline-offset-4 hover:text-brand-700">
            完整免責聲明
          </Link>
          <Link href="/privacy" className="underline underline-offset-4 hover:text-brand-700">
            隱私權說明
          </Link>
          <Link href="/guide" className="underline underline-offset-4 hover:text-brand-700">
            拍攝教學
          </Link>
        </nav>
        <p className="text-xs">© {PRODUCT_NAME}</p>
      </div>
    </footer>
  );
}
