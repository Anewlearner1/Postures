import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_ANALYSIS } from "@/data/sample-analysis";
import { fetchReport, ReportRequestError } from "./fetch-report";

const VIDEO = { stepsAnalyzed: 10, durationSec: 14 };

afterEach(() => vi.unstubAllGlobals());

describe("fetchReport", () => {
  it("送出的內容只有允許的欄位（不含影像、左右側、內部數值）", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchReport(SAMPLE_ANALYSIS, VIDEO);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(Object.keys(body).sort()).toEqual(
      ["confidence", "findings", "observations", "population_caveat", "rules_version", "standard_label", "walking"].sort(),
    );
    expect(JSON.stringify(body)).not.toMatch(/details|left|right|NCK|TE"|landmark|image|video/i);
  });

  it("伺服器流量限制（429）時，在瀏覽器裡用模板組報告", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"rate_limited"}', { status: 429 })));
    const result = await fetchReport(SAMPLE_ANALYSIS, VIDEO);
    expect(result.source).toBe("local_template");
    expect(result.report.problems.length).toBeGreaterThan(0);
  });

  it.each([403, 404, 413, 500, 502])("HTTP %i 時改用瀏覽器端模板（F-04）", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>error</html>", { status })));
    await expect(fetchReport(SAMPLE_ANALYSIS, VIDEO)).resolves.toMatchObject({ source: "local_template" });
  });

  it("200 但內容不是 JSON（例如公共 Wi-Fi 登入頁）時改用模板（F-04）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>login</html>", { status: 200 })));
    await expect(fetchReport(SAMPLE_ANALYSIS, VIDEO)).resolves.toMatchObject({ source: "local_template" });
  });

  it("200 的 JSON 不是報告格式時改用模板（F-04）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"hello":1}', { status: 200 })));
    await expect(fetchReport(SAMPLE_ANALYSIS, VIDEO)).resolves.toMatchObject({ source: "local_template" });
  });

  it("伺服器一直沒有回應：逾時後改用模板（F-02）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ),
    );
    await expect(fetchReport(SAMPLE_ANALYSIS, VIDEO, { timeoutMs: 20 })).resolves.toMatchObject({
      source: "local_template",
    });
  });

  it("使用者取消時照樣丟出取消錯誤（不產生報告）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ),
    );
    const controller = new AbortController();
    const pending = fetchReport(SAMPLE_ANALYSIS, VIDEO, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("400（本程式送錯格式）照樣回報錯誤", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"invalid_request"}', { status: 400 })));
    await expect(fetchReport(SAMPLE_ANALYSIS, VIDEO)).rejects.toBeInstanceOf(ReportRequestError);
  });
});
