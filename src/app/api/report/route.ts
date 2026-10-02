/**
 * 這個檔案做什麼：
 *   POST /api/report —— 把瀏覽器算好的分析結果（JSON，不含影像、不含左右側）寫成白話報告。
 *
 *   流程：檢查格式（Content-Type、來源、流量限制、大小上限、zod 嚴格驗證）→ 產生報告（有金鑰時請 Claude 寫白話，
 *   否則、失敗或超過 AI 費用額度時用模板文字）→ 回傳 JSON。
 *   示範報告（假資料）的 AI 版本會暫存 1 小時（sample-cache.ts）；真實分析結果一律不暫存。
 *
 *   回應：
 *     200 { source: "ai" | "template", report: {...} }
 *     400 { error: "invalid_json" } 或 { error: "invalid_request", issues: [{ path, code }] }
 *     403 { error: "forbidden" }（從其他網站的網頁送來的請求）
 *     413 { error: "payload_too_large" }
 *     415 { error: "unsupported_media_type" }
 *     429 { error: "rate_limited" }＋Retry-After 標頭（流量限制，見 src/lib/report/rate-limit.ts）
 *     500 { error: "internal_error" }
 *   其他 HTTP 方法（例如 GET）由 Next.js 自動回 405。
 *
 *   隱私（D18）：請求內容只在記憶體中處理，不寫入任何紀錄或儲存；錯誤紀錄只寫錯誤類型。
 *   流量限制用的 IP 只在記憶體中計數（最多一分鐘），不寫入紀錄。
 */

import { generateReport } from "@/lib/report/generate-report";
import { clientKey, reportRateLimiter as rateLimiter } from "@/lib/report/rate-limit";
import { MAX_REQUEST_BYTES, parseReportRequest } from "@/lib/report/request";
import { getSampleReport, isSampleRequest } from "@/lib/report/sample-cache";

/** 伺服器處理時間上限（秒）：Claude 逾時（20 秒）後仍有時間回傳模板報告。 */
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** 讀取請求內容，超過上限就停止讀取並回傳 null。 */
async function readBodyWithLimit(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return json({ error: "unsupported_media_type" }, 415);
  }

  // 瀏覽器會自動標示請求是不是從其他網站的網頁送出（網頁程式無法偽造）；本 API 只給本網站使用
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return json({ error: "forbidden" }, 403);
  }

  const limit = rateLimiter.checkRequest(clientKey(request.headers));
  if (!limit.ok) {
    return json({ error: "rate_limited" }, 429, { "Retry-After": String(limit.retryAfterSec) });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  let text: string | null;
  try {
    text = await readBodyWithLimit(request, MAX_REQUEST_BYTES);
  } catch {
    // 連線中斷等讀取失敗
    return json({ error: "invalid_json" }, 400);
  }
  if (text === null) return json({ error: "payload_too_large" }, 413);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const parsed = parseReportRequest(raw);
  if (!parsed.ok) return json({ error: "invalid_request", issues: parsed.issues }, 400);

  try {
    const generate = () => generateReport(parsed.data, { reserveAiCall: () => rateLimiter.reserveAiCall() });
    const body = isSampleRequest(parsed.data) ? await getSampleReport(generate) : await generate();
    return json(body, 200);
  } catch {
    // 只記錄錯誤類型（D18）
    console.error("[api/report] internal_error");
    return json({ error: "internal_error" }, 500);
  }
}
