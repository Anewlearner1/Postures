/**
 * 這個檔案做什麼：
 *   P3 分析中（網址：/analyze）。目前是進度畫面的佔位版，
 *   內容在 src/components/analyze/AnalyzingPlaceholder.tsx。
 */

import type { Metadata } from "next";
import { AnalyzingPlaceholder } from "@/components/analyze/AnalyzingPlaceholder";
import { PageContainer } from "@/components/ui/PageContainer";

export const metadata: Metadata = { title: "分析中" };

export default function AnalyzePage() {
  return (
    <PageContainer>
      <AnalyzingPlaceholder />
    </PageContainer>
  );
}
