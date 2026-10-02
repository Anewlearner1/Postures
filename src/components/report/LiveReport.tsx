"use client";

/**
 * 這個檔案做什麼：
 *   在瀏覽器中呼叫 fetchReport() 取得報告（POST /api/report），取得後交給 ReportContent 畫出來。
 *   目前還沒有真正的影片分析（M3），所以先用 src/data/sample-analysis.ts 的示範分析結果。
 *   M3 完成後，把 SAMPLE_ANALYSIS／SAMPLE_VIDEO 換成這次分析的結果即可。
 */

import { useEffect, useState } from "react";
import { ReportContent } from "@/components/report/ReportContent";
import { PageContainer } from "@/components/ui/PageContainer";
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

  return <ReportContent report={state.data.report} sourceLabel={SOURCE_LABEL[state.data.source]} />;
}
