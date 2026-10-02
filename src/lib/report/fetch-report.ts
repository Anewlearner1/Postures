/**
 * 這個檔案做什麼：
 *   給報告頁使用的函式：把瀏覽器裡的分析結果送到 POST /api/report，取得報告內容，
 *   再補上只存在瀏覽器裡的影片資訊（步數、影片長度、時間軸標記），組成報告頁要顯示的 ReportView。
 *
 *   - 送出的資料只有分析結果（toReportRequest 會濾掉內部數值與左右側資訊），不含影像。
 *   - 連不到伺服器、伺服器出錯或流量限制（429）時，改在瀏覽器裡用模板文字組報告（source: "local_template"），
 *     使用者照樣看得到報告。
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

export async function fetchReport(
  result: AnalysisResult,
  video: VideoInfo,
  options: { signal?: AbortSignal; endpoint?: string } = {},
): Promise<FetchedReport> {
  const request = toReportRequest(result);

  let response: Response;
  try {
    response = await fetch(options.endpoint ?? "/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return buildLocally(result, video);
  }

  // 429：伺服器忙碌或流量限制（rate-limit.ts）→ 在瀏覽器裡用模板組報告，使用者照樣看得到報告
  if (response.status === 429) return buildLocally(result, video);
  // 其他 4xx 代表送出的資料格式有問題（程式錯誤），直接回報，不用模板蓋過去
  if (response.status >= 400 && response.status < 500) throw new ReportRequestError(response.status);
  if (!response.ok) return buildLocally(result, video);

  const data = (await response.json()) as ReportApiResponse;
  return { source: data.source, report: toView(result, data.report, video) };
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
