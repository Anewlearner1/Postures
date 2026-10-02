/**
 * 這個檔案做什麼：
 *   P3 分析中（網址：/analyze）。在使用者的裝置上逐格偵測骨架、計算指標、產生報告。
 *   內容在 src/components/analyze/AnalysisRunner.tsx；沒有選影片時會自動回到 /upload。
 */

import type { Metadata } from "next";
import { AnalysisRunner } from "@/components/analyze/AnalysisRunner";
import { PageContainer } from "@/components/ui/PageContainer";

export const metadata: Metadata = { title: "分析中" };

export default function AnalyzePage() {
  return (
    <PageContainer>
      <AnalysisRunner />
    </PageContainer>
  );
}
