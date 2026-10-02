/** POST /api/report 的 HTTP 層測試（不會呼叫 Claude：沒有設定金鑰）。 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { POST } = await import("./route");
const { exampleRequest } = await import("@/lib/report/test-fixtures");
const { MAX_REQUEST_BYTES } = await import("@/lib/report/request");
const { REPORT_RATE_LIMITS, reportRateLimiter } = await import("@/lib/report/rate-limit");

function post(body: string, headers: Record<string, string> = { "Content-Type": "application/json" }) {
  return POST(new Request("http://localhost/api/report", { method: "POST", headers, body }));
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  reportRateLimiter.reset();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/report", () => {
  it("沒有金鑰時回傳模板版報告（200）", async () => {
    const response = await post(JSON.stringify(exampleRequest()));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = await response.json();
    expect(data.source).toBe("template");
    expect(data.report.problems[0].plainName).toBe("後腳推蹬不足");
  });

  it("格式不合法回 400，並列出欄位路徑", async () => {
    const response = await post(JSON.stringify({ ...exampleRequest(), left_side: {} }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("invalid_request");
    expect(data.issues.length).toBeGreaterThan(0);
  });

  it("不是 JSON 回 400", async () => {
    const response = await post("{not json");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_json");
  });

  it("Content-Type 不是 JSON 回 415", async () => {
    const response = await post(JSON.stringify(exampleRequest()), { "Content-Type": "text/plain" });
    expect(response.status).toBe(415);
  });

  it("請求太大回 413", async () => {
    const big = JSON.stringify({ ...exampleRequest(), padding: "x".repeat(MAX_REQUEST_BYTES) });
    const response = await post(big);
    expect(response.status).toBe(413);
  });

  it("其他網站的網頁送來的請求回 403", async () => {
    const response = await post(JSON.stringify(exampleRequest()), {
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "cross-site",
    });
    expect(response.status).toBe(403);
  });

  it("同一個 IP 每分鐘超過上限回 429，並附 Retry-After；其他 IP 不受影響", async () => {
    const headers = { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.10" };
    const body = JSON.stringify(exampleRequest());
    for (let i = 0; i < REPORT_RATE_LIMITS.perIpPerMinute; i++) {
      expect((await post(body, headers)).status).toBe(200);
    }
    const blocked = await post(body, headers);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toBe("rate_limited");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

    const other = await post(body, { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.11" });
    expect(other.status).toBe(200);
  });

  it("錯誤回應不會回傳使用者送來的值", async () => {
    const response = await post(JSON.stringify({ ...exampleRequest(), rules_version: "<script>alert(1)</script>" }));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("<script>");
  });
});
