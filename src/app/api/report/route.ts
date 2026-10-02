/**
 * 這個檔案做什麼：
 *   POST /api/report —— 把瀏覽器算好的分析結果（JSON，不含影像、不含左右側）寫成白話報告。
 *
 *   流程：檢查格式（Content-Type、大小上限、zod 嚴格驗證）→ 產生報告（有金鑰時請 Claude 寫白話，
 *   否則或失敗時用模板文字）→ 回傳 JSON。
 *
 *   回應：
 *     200 { source: "ai" | "template", report: {...} }
 *     400 { error: "invalid_json" } 或 { error: "invalid_request", issues: [{ path, code }] }
 *     413 { error: "payload_too_large" }
 *     415 { error: "unsupported_media_type" }
 *     500 { error: "internal_error" }
 *   其他 HTTP 方法（例如 GET）由 Next.js 自動回 405。
 *
 *   隱私（D18）：請求內容只在記憶體中處理，不寫入任何紀錄或儲存；錯誤紀錄只寫錯誤類型。
 */

import { generateReport } from "@/lib/report/generate-report";
import { MAX_REQUEST_BYTES, parseReportRequest } from "@/lib/report/request";

/** 伺服器處理時間上限（秒）：Claude 逾時（20 秒）後仍有時間回傳模板報告。 */
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
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

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  const text = await readBodyWithLimit(request, MAX_REQUEST_BYTES);
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
    return json(await generateReport(parsed.data), 200);
  } catch {
    // 只記錄錯誤類型（D18）
    console.error("[api/report] internal_error");
    return json({ error: "internal_error" }, 500);
  }
}
