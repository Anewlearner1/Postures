/**
 * 這個檔案做什麼：
 *   產生報告的整個流程（只在伺服器端執行）：
 *     1. 程式依動作庫規則選練習（select-exercises.ts）
 *     2. 用固定文案組出模板報告（template-report.ts）——這份一定會成功
 *     3. 有設定 ANTHROPIC_API_KEY 時，請 Claude 寫白話段落，檢查後合併（ai-merge.ts）
 *     4. 沒有金鑰、Claude 失敗、逾時、或輸出不合格 → 回傳模板報告（source: "template"）
 *
 *   紀錄（log）原則（D18）：不記錄請求內容、角度數字或 AI 文字；失敗時只記錄「錯誤類型」。
 */

import "server-only";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { AiOutputRejectedError, buildAiInput, mergeAiOutput } from "./ai-merge";
import { ClaudeWriterError, writeReportWithClaude } from "./claude-writer";
import type { ReportRequest } from "./request";
import { selectExercises } from "./select-exercises";
import { buildTemplateReport } from "./template-report";
import type { ReportApiResponse } from "./types";

/** 把錯誤轉成不含任何內容的類型名稱，只用於伺服器紀錄。 */
export function errorKind(error: unknown): string {
  if (error instanceof ClaudeWriterError) return error.kind;
  if (error instanceof AiOutputRejectedError) return `rejected_${error.kind}`;
  if (error instanceof APIConnectionTimeoutError) return "timeout";
  if (error instanceof APIUserAbortError) return "aborted";
  if (error instanceof APIConnectionError) return "connection";
  if (error instanceof AuthenticationError) return "auth";
  if (error instanceof RateLimitError) return "rate_limited";
  if (error instanceof APIError) return `api_status_${error.status ?? "unknown"}`;
  return "unexpected";
}

function logFallback(kind: string): void {
  // 只記錄錯誤類型（D18）。不要在這裡加入 request、error.message 或任何內容。
  console.warn(`[api/report] ai_fallback kind=${kind}`);
}

export interface GenerateOptions {
  /** 預設讀取 process.env.ANTHROPIC_API_KEY（只在伺服器端）。 */
  apiKey?: string;
  /** 預設讀取 process.env.CLAUDE_MODEL，沒有設定時用 claude-opus-5-5。 */
  model?: string;
  /**
   * 呼叫 Claude 前檢查費用額度（見 rate-limit.ts）：回傳 false 時不呼叫 Claude，直接用模板。
   * 沒有提供時不限制（例如測試）。
   */
  reserveAiCall?: () => boolean;
}

export async function generateReport(request: ReportRequest, options: GenerateOptions = {}): Promise<ReportApiResponse> {
  const selection = selectExercises(request);
  const template = buildTemplateReport(request, selection);

  const apiKey = (options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) {
    // 沒有金鑰：網站照常運作，直接用模板文字（不算錯誤，不記錄）
    return { source: "template", report: template };
  }

  if (options.reserveAiCall && !options.reserveAiCall()) {
    logFallback("ai_budget_exhausted");
    return { source: "template", report: template };
  }

  const model = (options.model ?? process.env.CLAUDE_MODEL ?? "").trim() || undefined;

  try {
    const output = await writeReportWithClaude(buildAiInput(request, selection, template), { apiKey, model });
    const merged = mergeAiOutput(template, output, selection);
    if (merged.rejected.length > 0) logFallback(`partial_${[...new Set(merged.rejected)].join("+")}`);
    return merged.usedAi ? { source: "ai", report: merged.report } : { source: "template", report: template };
  } catch (error) {
    logFallback(errorKind(error));
    return { source: "template", report: template };
  }
}
