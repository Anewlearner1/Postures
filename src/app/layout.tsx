/**
 * 這個檔案做什麼：
 *   全站的「外框」：每一頁都會套用這裡的 <html>、頁首、頁尾。
 *   - lang="zh-Hant"：告訴瀏覽器與螢幕閱讀器這是繁體中文網站。
 *   - 字型使用系統字型（設定在 globals.css），不從網路下載字型。
 */

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { AnalysisSessionProvider } from "@/components/session/AnalysisSession";
import { PRODUCT_NAME, SITE_DESCRIPTION } from "@/data/site";

export const metadata: Metadata = {
  title: {
    default: PRODUCT_NAME,
    template: `%s｜${PRODUCT_NAME}`,
  },
  description: SITE_DESCRIPTION,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#17796b",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant" className="h-full">
      <body className="flex min-h-full flex-col antialiased">
        <AnalysisSessionProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </AnalysisSessionProvider>
      </body>
    </html>
  );
}
