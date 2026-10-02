/**
 * 這個檔案做什麼：
 *   給報告頁使用的函式：把瀏覽器裡的分析結果送到 POST /api/report，取得報告內容，
 *   再補上只存在瀏覽器裡的影片資訊（步數、影片長度、時間軸標記），組成報告頁要顯示的 ReportView。
 *
 *   - 送出的資料只有分析結果（toReportRequest 會濾掉內部數值與左右側資訊），不含影像。
 *   - 連不到伺服器、伺服器出錯、流量限制（429）、等超過 35 秒，或回應不是報告格式時，
 *     改在瀏覽器裡用模板文字組報告（source: "local_template"），使用者照樣看得到報告（F-02、F-04）。
 *     只有 400（本程式送錯格式）會回報錯誤。
 */

import type { AnalysisResult } from "@/lib/gait/types";
import { cardIdOf } from "./card-id";
import { toReportRequest } from "./to-request";
import type { ReportApiResponse, ReportBody, ReportView, TimelineMarker } from "./types";

/** 秒數 → 「0:14」格式。 */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export interface VideoInfo {
  stepsAnalyzed: number;
  durationSec: number;
}

export interface FetchedReport {
  /** ai：Claude 撰寫；template：伺服器用模板；local_template：連不到伺服器，瀏覽器自己用模板。 */
  source: ReportApiResponse["source"] | "local_template";
  report: ReportView;
}

export class ReportRequestError extends Error {
  constructor(public readonly status: number) {
    super(`report request rejected (${status})`);
    this.name = "ReportRequestError";
  }
}

/** 依各問題出現的時間點，算出骨架回放時間軸上的標記位置（UX §4.6）。 */
export function timelineMarkersFor(result: AnalysisResult, body: ReportBody, durationSec: number): TimelineMarker[] {
  if (durationSec <= 0) return [];
  const markers: TimelineMarker[] = [];
  for (const card of body.problems) {
    const finding = result.findings.find((item) => cardIdOf(item) === card.id);
    for (const seconds of finding?.timestampsSec ?? []) {
      const positionPct = Math.min(100, Math.max(0, Math.round((seconds / durationSec) * 100)));
      markers.push({ markerNumber: card.markerNumber, label: card.plainName, positionPct });
    }
  }
  return markers.sort((a, b) => a.positionPct - b.positionPct);
}

function toView(result: AnalysisResult, body: ReportBody, video: VideoInfo): ReportView {
  return {
    ...body,
    stepsAnalyzed: video.stepsAnalyzed,
    durationSec: Math.round(video.durationSec),
    durationLabel: formatDuration(video.durationSec),
    timelineMarkers: timelineMarkersFor(result, body, video.durationSec),
  };
}

/** 等報告 API 最多幾毫秒（伺服器本身最多處理 30 秒，maxDuration = 30），逾時改用瀏覽器端模板（F-02）。 */
export const REPORT_TIMEOUT_MS = 35_000;

/** 結合「使用者取消」與「逾時」兩個訊號；回傳的 timedOut() 用來分辨是哪一個。 */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", onAbort);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

export async function fetchReport(
  result: AnalysisResult,
  video: VideoInfo,
  options: { signal?: AbortSignal; endpoint?: string; timeoutMs?: number } = {},
): Promise<FetchedReport> {
  const request = toReportRequest(result);
  const guard = withTimeout(options.signal, options.timeoutMs ?? REPORT_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(options.endpoint ?? "/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: guard.signal,
        cache: "no-store",
      });
    } catch (error) {
      // 使用者取消：照樣丟出；斷線或逾時：改用模板，不讓分析結果遺失
      if (options.signal?.aborted && !guard.timedOut()) throw error;
      return buildLocally(result, video);
    }

    // 400 代表本程式送出的資料格式有問題（程式錯誤），直接回報，不用模板蓋過去。
    // 其他錯誤（429 流量限制、403、413、5xx…）一律改用瀏覽器端模板，使用者照樣看得到報告（F-04）。
    if (response.status === 400) throw new ReportRequestError(response.status);
    if (!response.ok) return buildLocally(result, video);

    // 200 但內容不是報告 JSON（例如公共 Wi-Fi 登入頁、代理伺服器錯誤頁）也改用模板（F-04）
    let data: ReportApiResponse;
    try {
      data = (await response.json()) as ReportApiResponse;
    } catch (error) {
      if (options.signal?.aborted && !guard.timedOut()) throw error;
      return buildLocally(result, video);
    }
    if (!data || typeof data !== "object" || !data.report || !Array.isArray(data.report.problems)) {
      return buildLocally(result, video);
    }
    return { source: data.source, report: toView(result, data.report, video) };
  } finally {
    guard.dispose();
  }
}

/** 伺服器連不上時，在瀏覽器裡組模板報告（動作庫只在需要時才下載）。 */
async function buildLocally(result: AnalysisResult, video: VideoInfo): Promise<FetchedReport> {
  const [{ buildTemplateReport }, { parseReportRequest }] = await Promise.all([
    import("./template-report"),
    import("./request"),
  ]);
  const parsed = parseReportRequest(toReportRequest(result));
  if (!parsed.ok) throw new ReportRequestError(400);
  return { source: "local_template", report: toView(result, buildTemplateReport(parsed.data), video) };
}
