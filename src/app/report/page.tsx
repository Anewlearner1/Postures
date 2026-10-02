/**
 * 這個檔案做什麼：
 *   P4 報告頁（網址：/report）：顯示「這次分析」的真實結果與骨架回放。
 *   分析結果只存在瀏覽器記憶體（src/components/session/AnalysisSession.tsx），
 *   沒有結果（直接打開網址、重新整理後）會回到 /upload。示範報告在 /report/sample。
 *   內容在 src/components/report/SessionReport.tsx。
 */

import type { Metadata } from "next";
import { SessionReport } from "@/components/report/SessionReport";

export const metadata: Metadata = { title: "你的走路分析報告" };

export default function ReportPage() {
  return <SessionReport />;
}
