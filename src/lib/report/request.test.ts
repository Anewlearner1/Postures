import { readFileSync } from "node:fs";
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

describe("gait-rules.md §8 的 JSON 範例", () => {
  const text = readFileSync(new URL("../../../docs/spec/gait-rules.md", import.meta.url), "utf8");
  const section = text.slice(text.indexOf("## 8. 閾值總表"), text.indexOf("## 9."));
  const blocks = [...section.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));

  it("完整輸出範例（含 timestamps_sec）可以通過驗證", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(parseReportRequest(blocks[0]).ok).toBe(true);
  });

  it("D39 範例（沒有髖伸展、軀幹帶旗標）可以通過驗證", () => {
    expect(parseReportRequest({ ...exampleRequest(), findings: blocks[1] }).ok).toBe(true);
  });
});

describe("D39 歸因旗標 hip_attributed_to_trunk", () => {
  /** 軀幹前傾輕度＋旗標、沒有髖伸展問題的請求。 */
  function attributed() {
    const draft = structuredClone(exampleRequest());
    draft.findings = draft.findings.filter((f) => f.problem !== "hip_extension_deficit");
    const trunk = draft.findings.find((f) => f.problem === "trunk_head_forward_lean")!;
    Object.assign(trunk, {
      severity: "mild",
      metrics: { TRK: 9.5 },
      candidate_causes: ["thoracic_stiffness", "pec_tightness"],
      timestamps_sec: [2.1, 5.3],
      hip_attributed_to_trunk: true,
    });
    return draft;
  }

  it("軀幹前傾（輕度以上）＋旗標、且沒有髖伸展問題 → 通過", () => {
    expect(parseReportRequest(attributed()).ok).toBe(true);
  });

  it("旗標只能放在軀幹前傾", () => {
    const draft = attributed();
    (draft.findings[0] as Record<string, unknown>).hip_attributed_to_trunk = true; // 膝擺盪期
    expect(parseReportRequest(draft).ok).toBe(false);
  });

  it("軀幹在常見範圍內時不可帶旗標", () => {
    const draft = attributed();
    const trunk = draft.findings.find((f) => f.problem === "trunk_head_forward_lean")!;
    trunk.severity = "normal";
    trunk.candidate_causes = [];
    expect(parseReportRequest(draft).ok).toBe(false);
  });

  it("帶旗標時不可同時有髖伸展問題", () => {
    const draft = attributed();
    draft.findings.unshift(structuredClone(exampleRequest().findings[0]));
    const result = parseReportRequest(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path.endsWith("hip_attributed_to_trunk"))).toBe(true);
  });

  it("旗標必須是布林值", () => {
    const draft = attributed() as unknown as { findings: Array<Record<string, unknown>> };
    draft.findings[draft.findings.length - 1].hip_attributed_to_trunk = "yes";
    expect(parseReportRequest(draft).ok).toBe(false);
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

  it("帶上 D38 時間點與 D39 旗標；旗標為 false／沒有時不帶", () => {
    const result: AnalysisResult = structuredClone(SAMPLE_ANALYSIS);
    result.findings = result.findings.filter((f) => f.problem !== "hip_extension_deficit");
    const trunk = result.findings.find((f) => f.problem === "trunk_head_forward_lean")!;
    Object.assign(trunk, { severity: "mild", metrics: { TRK: 9 }, candidateCauses: ["pec_tightness"], timestampsSec: [1.5], hipAttributedToTrunk: true });
    const request = toReportRequest(result);
    const trunkRequest = request.findings.find((f) => f.problem === "trunk_head_forward_lean")!;
    expect(trunkRequest.hip_attributed_to_trunk).toBe(true);
    expect(trunkRequest.timestamps_sec).toEqual([1.5]);
    expect(parseReportRequest(request).ok).toBe(true);

    trunk.hipAttributedToTrunk = false;
    expect("hip_attributed_to_trunk" in toReportRequest(result).findings.find((f) => f.problem === "trunk_head_forward_lean")!).toBe(false);
  });
});
