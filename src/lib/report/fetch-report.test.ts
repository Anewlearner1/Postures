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

  it("其他 4xx（資料格式錯誤）照樣回報錯誤", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"invalid_request"}', { status: 400 })));
    await expect(fetchReport(SAMPLE_ANALYSIS, VIDEO)).rejects.toBeInstanceOf(ReportRequestError);
  });
});
