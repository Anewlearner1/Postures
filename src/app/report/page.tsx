/**
 * 這個檔案做什麼：
 *   P4 報告頁（網址：/report）。頁面本身只設定標題，內容由 LiveReport 在瀏覽器中
 *   呼叫 POST /api/report 取得（目前使用示範分析結果），再由 ReportContent 畫出版面。
 *   版面說明見 src/components/report/ReportContent.tsx。
 */

import type { Metadata } from "next";
import { LiveReport } from "@/components/report/LiveReport";

export const metadata: Metadata = { title: "你的走路分析報告" };

export default function ReportPage() {
  return <LiveReport />;
}
