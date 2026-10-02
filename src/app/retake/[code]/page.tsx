/**
 * 這個檔案做什麼：
 *   P6 錯誤／請重拍頁（網址：/retake/錯誤代碼，例如 /retake/no_person）。
 *   依網址中的錯誤代碼顯示對應文案（docs/spec/ux-flow-and-copy.md §5）。
 *   所有代碼的頁面會在建置時預先產生；不認得的代碼會顯示「找不到頁面」。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RetakeView } from "@/components/retake/RetakeView";
import { PageContainer } from "@/components/ui/PageContainer";
import { isRetakeCode, RETAKE_CODES, RETAKE_MESSAGES } from "@/data/retake-messages";

/** 只接受下面列出的代碼，其他網址一律 404。 */
export const dynamicParams = false;

export function generateStaticParams() {
  return RETAKE_CODES.map((code) => ({ code }));
}

export async function generateMetadata({ params }: PageProps<"/retake/[code]">): Promise<Metadata> {
  const { code } = await params;
  return { title: isRetakeCode(code) ? RETAKE_MESSAGES[code].title : "請重拍" };
}

export default async function RetakePage({ params }: PageProps<"/retake/[code]">) {
  const { code } = await params;
  if (!isRetakeCode(code)) notFound();

  return (
    <PageContainer>
      <RetakeView code={code} />
    </PageContainer>
  );
}
