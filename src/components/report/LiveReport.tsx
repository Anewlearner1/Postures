"use client";

/**
 * 這個檔案做什麼：
 *   示範報告（網址：/report/sample）。用 src/data/sample-analysis.ts 的示範分析結果（假資料）
 *   呼叫 fetchReport()（POST /api/report）取得報告內容，交給 ReportContent 畫出來，
 *   讓還沒拍影片的人也能先看看報告長什麼樣子。使用者自己的報告在 SessionReport.tsx。
 */

import { useEffect, useState } from "react";
import { ReportContent } from "@/components/report/ReportContent";
import { PageContainer } from "@/components/ui/PageContainer";
import { SAMPLE_REPORT_BANNER } from "@/data/analysis-copy";
import { SAMPLE_ANALYSIS, SAMPLE_VIDEO } from "@/data/sample-analysis";
import { fetchReport, type FetchedReport } from "@/lib/report/fetch-report";

const SOURCE_LABEL: Record<FetchedReport["source"], string> = {
  ai: "文字由 AI 依分析結果撰寫",
  template: "文字使用固定範本",
  local_template: "暫時連不到伺服器，文字使用固定範本",
};

type State = { status: "loading" } | { status: "ready"; data: FetchedReport } | { status: "error" };

export function LiveReport() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [generatedAt] = useState(() => new Date());

  useEffect(() => {
    const controller = new AbortController();
    fetchReport(SAMPLE_ANALYSIS, SAMPLE_VIDEO, { signal: controller.signal })
      .then((data) => setState({ status: "ready", data }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
  }, []);

  if (state.status === "loading") {
    return (
      <PageContainer width="wide">
        <p role="status" className="py-12 text-center text-muted">
          正在整理你的報告…
        </p>
      </PageContainer>
    );
  }

  if (state.status === "error") {
    return (
      <PageContainer width="wide">
        <p role="alert" className="py-12 text-center">
          報告暫時無法產生，請重新整理頁面再試一次。
        </p>
      </PageContainer>
    );
  }

  return (
    <ReportContent
      report={state.data.report}
      generatedAt={generatedAt}
      notice={{ tone: "demo", text: `${SAMPLE_REPORT_BANNER}（${SOURCE_LABEL[state.data.source]}）` }}
    />
  );
}
