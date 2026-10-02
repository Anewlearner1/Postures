import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { SAMPLE_ANALYSIS } = await import("@/data/sample-analysis");
const { parseReportRequest } = await import("./request");
const { toReportRequest } = await import("./to-request");
const { exampleRequest } = await import("./test-fixtures");
const { clearSampleCache, getSampleReport, isSampleRequest, SAMPLE_CACHE_TTL_MS } = await import("./sample-cache");

function sampleRequest() {
  const parsed = parseReportRequest(JSON.parse(JSON.stringify(toReportRequest(SAMPLE_ANALYSIS))));
  if (!parsed.ok) throw new Error("sample request invalid");
  return parsed.data;
}

const aiResult = { source: "ai", report: { summary: "AI" } } as never;
const templateResult = { source: "template", report: { summary: "T" } } as never;

beforeEach(() => clearSampleCache());

describe("示範報告暫存", () => {
  it("只認得示範用假資料；真實分析結果（任何一個值不同）不算", () => {
    expect(isSampleRequest(sampleRequest())).toBe(true);
    expect(isSampleRequest(exampleRequest())).toBe(false);
    const changed = sampleRequest();
    changed.findings[0].timestamps_sec = [3.2];
    expect(isSampleRequest(changed)).toBe(false);
  });

  it("AI 版本暫存 1 小時，期間不再呼叫 Claude", async () => {
    let now = 0;
    const generate = vi.fn(async () => aiResult);
    await getSampleReport(generate, () => now);
    now += SAMPLE_CACHE_TTL_MS - 1;
    await getSampleReport(generate, () => now);
    expect(generate).toHaveBeenCalledTimes(1);
    now += 2;
    await getSampleReport(generate, () => now);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("模板版本不暫存（之後設定金鑰就能馬上看到 AI 版本）", async () => {
    const generate = vi.fn(async () => templateResult);
    await getSampleReport(generate);
    await getSampleReport(generate);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("同時多個請求只產生一次", async () => {
    const generate = vi.fn(async () => aiResult);
    await Promise.all([getSampleReport(generate), getSampleReport(generate), getSampleReport(generate)]);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
