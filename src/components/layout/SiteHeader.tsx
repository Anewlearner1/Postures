"use client";

/**
 * 這個檔案做什麼：
 *   每一頁最上方的頁首（UX 文件 §2.0）。
 *   - 手機：左邊產品名稱，右邊「☰」選單按鈕，點開後列出各頁連結。
 *   - 電腦：直接橫向列出連結，最右邊是「開始分析」按鈕。
 *   開頭的 "use client" 表示這個元件需要在瀏覽器執行（因為選單要能開關）。
 */

import Link from "next/link";
import { useState } from "react";
import { PRODUCT_NAME } from "@/data/site";
import { buttonClass } from "@/components/ui/ButtonLink";
import { CloseIcon, MenuIcon } from "@/components/ui/icons";

/** 頁首連結。「撤回捐贈」要等資料捐贈功能（M6）上線後再加入。 */
const NAV_LINKS = [
  { href: "/guide", label: "拍攝教學" },
  { href: "/privacy", label: "隱私說明" },
  { href: "/#faq", label: "常見問題" },
  { href: "/disclaimer", label: "免責聲明" },
];

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="text-lg font-bold text-brand-800" onClick={closeMenu}>
          {PRODUCT_NAME}
        </Link>

        {/* 電腦版導覽 */}
        <nav className="hidden items-center gap-6 md:flex" aria-label="主要導覽">
          {NAV_LINKS.slice(0, 3).map((link) => (
            <Link key={link.href} href={link.href} className="text-sm text-muted hover:text-brand-700">
              {link.label}
            </Link>
          ))}
          <Link href="/upload" className={buttonClass("primary", "", "sm")}>
            開始分析
          </Link>
        </nav>

        {/* 手機版選單按鈕 */}
        <button
          type="button"
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-lg text-ink md:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? "關閉選單" : "開啟選單"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {/* 手機版展開的選單 */}
      {menuOpen && (
        <nav id="mobile-menu" className="border-t border-line bg-white px-4 pb-4 md:hidden" aria-label="主要導覽">
          <ul className="divide-y divide-line">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="flex min-h-12 items-center text-base" onClick={closeMenu}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/upload" className={buttonClass("primary", "mt-3 w-full")} onClick={closeMenu}>
            開始分析
          </Link>
        </nav>
      )}
    </header>
  );
}
