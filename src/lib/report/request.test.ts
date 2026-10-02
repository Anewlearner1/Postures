import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/lib/gait/types";
import { SAMPLE_ANALYSIS } from "@/data/sample-analysis";
import { parseReportRequest } from "./request";
import { exampleRequest } from "./test-fixtures";
import { toReportRequest } from "./to-request";

/** 深拷貝範例後做修改，回傳 parse 結果。 */
function parseWith(mutate: (draft: Record<string, unknown> & ReturnType<typeof exampleRequest>) => void) {
  const draft = structuredClone(exampleRequest()) as Record<string, unknown> & ReturnType<typeof exampleRequest>;
  mutate(draft);
  return parseReportRequest(draft);
}

describe("POST /api/report 輸入驗證", () => {
  it("gait-rules.md §8 的輸出範例可以通過", () => {
    expect(parseReportRequest(exampleRequest()).ok).toBe(true);
  });

  it("拒絕多餘的最上層欄位（例如影像資料）", () => {
    const result = parseWith((draft) => {
      draft.video = "data:video/mp4;base64,AAAA";
    });
    expect(result.ok).toBe(false);
  });

  it("拒絕左右側欄位（D26）", () => {
    const result = parseWith((draft) => {
      (draft.findings[0] as Record<string, unknown>).side = "left";
    });
    expect(result.ok).toBe(false);
  });

  it("拒絕頭頸角度 NCK 與交叉檢查 TE（D25、只送代表指標）", () => {
    expect(parseWith((draft) => ((draft.findings[2].metrics as Record<string, number>).NCK = 40)).ok).toBe(false);
    expect(parseWith((draft) => ((draft.findings[0].metrics as Record<string, number>).TE = 10)).ok).toBe(false);
  });

  it("拒絕觀察項目帶數值或等級（D25）", () => {
    const result = parseWith((draft) => {
      (draft.observations[0] as Record<string, unknown>).severity = "mild";
    });
    expect(result.ok).toBe(false);
  });

  it("每個問題只能帶自己的指標", () => {
    const result = parseWith((draft) => {
      draft.findings[0].metrics = { TRK: 10 };
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path === "findings.0.metrics.TRK")).toBe(true);
  });

  it("拒絕不屬於該問題的原因代碼", () => {
    const result = parseWith((draft) => {
      draft.findings[0].candidate_causes = ["pec_tightness"];
    });
    expect(result.ok).toBe(false);
  });

  it("拒絕第一版不觸發的原因代碼（例如 deep_neck_flexor_weakness）", () => {
    const result = parseWith((draft) => {
      (draft.findings[2].candidate_causes as string[]) = ["deep_neck_flexor_weakness"];
    });
    expect(result.ok).toBe(false);
  });

  it("子型態必須和問題對得上，且同一問題不可重複", () => {
    expect(parseWith((draft) => (draft.findings[0].subtype = "trunk_forward_lean")).ok).toBe(false);
    expect(parseWith((draft) => delete draft.findings[1].subtype).ok).toBe(false);
    expect(parseWith((draft) => draft.findings.push(structuredClone(draft.findings[0]))).ok).toBe(false);
  });

  it("可信度顯示等級必須符合 D28 對應", () => {
    expect(parseWith((draft) => (draft.confidence.display = "good")).ok).toBe(false);
  });

  it("拒絕不合理的數值與型別", () => {
    expect(parseWith((draft) => (draft.findings[0].metrics.PHE = 9999)).ok).toBe(false);
    expect(parseWith((draft) => ((draft.walking as Record<string, unknown>).passes = "2")).ok).toBe(false);
    expect(parseWith((draft) => (draft.walking.valid_cycles_total = 0)).ok).toBe(false);
    expect(parseWith((draft) => (draft.findings[0].timestamps_sec = Array(21).fill(1))).ok).toBe(false);
    expect(parseWith((draft) => (draft.findings = [])).ok).toBe(false);
  });

  it("錯誤清單只有欄位路徑與錯誤類型，不回傳使用者送來的值", () => {
    const result = parseWith((draft) => {
      draft.rules_version = "SECRET VALUE <script>";
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(JSON.stringify(result.issues)).not.toContain("SECRET");
      expect(result.issues[0]).toEqual({ path: "rules_version", code: expect.any(String) });
    }
  });

  it("不是物件的輸入會被拒絕", () => {
    expect(parseReportRequest(null).ok).toBe(false);
    expect(parseReportRequest([]).ok).toBe(false);
    expect(parseReportRequest("hello").ok).toBe(false);
  });
});

describe("toReportRequest：前端分析結果 → API 請求", () => {
  it("示範分析結果轉換後可以通過驗證", () => {
    expect(parseReportRequest(toReportRequest(SAMPLE_ANALYSIS)).ok).toBe(true);
  });

  it("只保留每個問題的代表指標，濾掉 TE、NCK、KLR", () => {
    const result: AnalysisResult = structuredClone(SAMPLE_ANALYSIS);
    result.findings[0].metrics = { PHE: 7, TE: 10, NCK: 40, KLR: 15 };
    const request = toReportRequest(result);
    expect(request.findings[0].metrics).toEqual({ PHE: 7 });
    expect(JSON.stringify(request)).not.toMatch(/NCK|"TE"|KLR/);
    expect(parseReportRequest(request).ok).toBe(true);
  });
});
