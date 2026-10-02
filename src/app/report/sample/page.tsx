/**
 * 這個檔案做什麼：
 *   示範報告頁（網址：/report/sample）。用示範用的分析結果（假資料）呼叫 POST /api/report，
 *   展示報告版面。內容在 src/components/report/LiveReport.tsx。
 */

import type { Metadata } from "next";
import { LiveReport } from "@/components/report/LiveReport";

export const metadata: Metadata = { title: "示範報告" };

export default function SampleReportPage() {
  return <LiveReport />;
}
