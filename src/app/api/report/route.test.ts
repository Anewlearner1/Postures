/** POST /api/report 的 HTTP 層測試（不會呼叫 Claude：沒有設定金鑰）。 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { POST } = await import("./route");
const { exampleRequest } = await import("@/lib/report/test-fixtures");
const { MAX_REQUEST_BYTES } = await import("@/lib/report/request");

function post(body: string, headers: Record<string, string> = { "Content-Type": "application/json" }) {
  return POST(new Request("http://localhost/api/report", { method: "POST", headers, body }));
}

beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", ""));
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
});
