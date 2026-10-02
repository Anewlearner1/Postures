/**
 * 這個檔案做什麼：
 *   「示範報告」（/report/sample）的 AI 結果暫存，避免每位訪客打開示範頁都花一次 Claude 費用。
 *
 *   - 只暫存「示範用假資料」（src/data/sample-analysis.ts）產生的報告；內容和示範資料一模一樣的請求才會用到。
 *     真實使用者的分析結果**一律不暫存**（D18：後端不留存角度數字）。
 *   - 只暫存 Claude 寫成功的版本（source: "ai"），保留 1 小時；伺服器重開就清空。
 *   - 多人同時打開示範頁時，只會呼叫一次 Claude，其他人等同一份結果。
 */

import "server-only";
import { SAMPLE_ANALYSIS } from "@/data/sample-analysis";
import { parseReportRequest, type ReportRequest } from "./request";
import { toReportRequest } from "./to-request";
import type { ReportApiResponse } from "./types";

export const SAMPLE_CACHE_TTL_MS = 60 * 60 * 1000;

/** 物件鍵排序後轉成字串，用來比較兩份請求內容是否完全相同。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

let sampleKey: string | null = null;
function getSampleKey(): string {
  if (sampleKey === null) {
    const parsed = parseReportRequest(toReportRequest(SAMPLE_ANALYSIS));
    sampleKey = parsed.ok ? stableStringify(parsed.data) : "";
  }
  return sampleKey;
}

/** 這份（已通過驗證的）請求是不是示範報告的假資料。 */
export function isSampleRequest(request: ReportRequest): boolean {
  const key = getSampleKey();
  return key !== "" && stableStringify(request) === key;
}

let cached: { value: ReportApiResponse; expiresAt: number } | null = null;
let inFlight: Promise<ReportApiResponse> | null = null;

/** 取得示範報告：有未過期的 AI 版本就直接回傳，否則呼叫 generate 產生（同時間只產生一次）。 */
export async function getSampleReport(
  generate: () => Promise<ReportApiResponse>,
  now: () => number = Date.now,
): Promise<ReportApiResponse> {
  if (cached && cached.expiresAt > now()) return cached.value;
  if (!inFlight) {
    inFlight = generate()
      .then((value) => {
        if (value.source === "ai") cached = { value, expiresAt: now() + SAMPLE_CACHE_TTL_MS };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** 測試用：清空暫存。 */
export function clearSampleCache(): void {
  cached = null;
  inFlight = null;
}
