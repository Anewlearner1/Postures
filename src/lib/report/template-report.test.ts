import { describe, expect, it } from "vitest";
import { HIP_ATTRIBUTED_TO_TRUNK_SENTENCE } from "@/data/problem-copy";
import { BANNED_WORDS } from "./content-filter";
import { getExercise } from "./exercises";
import { buildTemplateReport, formatTimestamp } from "./template-report";
import { allProblemsRequest, exampleRequest } from "./test-fixtures";

describe("模板報告（降級方案）", () => {
  it("gait-rules §8 範例：1 張卡片、看起來不錯、頭部觀察、可信度小提示", () => {
    const report = buildTemplateReport(exampleRequest());
    expect(report.problems.map((card) => card.id)).toEqual(["hip_extension_deficit"]);
    expect(report.problems[0].severity).toBe("mild");
    expect(report.goodItems).toEqual(["膝蓋彎曲", "身體姿勢"]);
    expect(report.summary).toContain("有 1 個地方可以再加強：後腳推蹬不足");
    expect(report.summary).toContain("另外，你的膝蓋彎曲、身體姿勢在常見範圍內");
    expect(report.confidence).toBe("good_with_tip");
    expect(report.confidenceTip).toContain("讓手機鏡頭正對著你走路的路線");
    expect(report.headObservation?.[0]).toContain("這次不做評估");
    expect(report.cyclesAnalyzed).toBe(5);
  });

  it("練習內容直接使用動作庫原文（名稱、步驟、份量）", () => {
    const [card] = buildTemplateReport(exampleRequest()).problems;
    const exercise = card.exercises[0];
    const source = getExercise(exercise.exerciseId!)!;
    expect(exercise.name).toBe(source.name_zh);
    expect(exercise.steps).toEqual(source.steps);
    expect(exercise.dosage).toBe(source.dosage.summary_zh);
  });

  it("「我們看到什麼」列出時間點，軀幹卡片帶平均前傾角（四捨五入）", () => {
    const report = buildTemplateReport(allProblemsRequest("marked"));
    const hip = report.problems.find((card) => card.id === "hip_extension_deficit")!;
    expect(hip.whatWeSaw).toContain("出現了 2 次（例如 0:03、0:08）");
    expect(hip.firstTimestamp).toBe("0:03");
    const trunk = report.problems.find((card) => card.id === "trunk_forward_lean")!;
    expect(trunk.whatWeSaw).toContain("平均約前傾 14 度");
    const stance = report.problems.find((card) => card.id === "knee_stance_flexion_high")!;
    expect(stance.note).toContain("建議先諮詢醫師或物理治療師");
  });

  it("重複的練習在後面的卡片改成「見某某卡片」", () => {
    const request = allProblemsRequest("marked");
    // 軀幹與髖都只給「髖屈肌緊繃」→ 兩張卡片都會選到單膝跪姿髖屈肌伸展
    request.findings = request.findings
      .filter((finding) => finding.problem !== "knee_flexion_abnormal")
      .map((finding) => ({ ...finding, candidate_causes: ["hip_flexor_tightness"] }));
    const report = buildTemplateReport(request);
    const all = report.problems.flatMap((card) => card.exercises);
    const references = all.filter((exercise) => exercise.steps.length === 0);
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) expect(reference.purpose).toMatch(/^見「.+」卡片。$/);
  });

  it("模板文字不含禁用詞或左右腳", () => {
    for (const request of [exampleRequest(), allProblemsRequest("marked"), allProblemsRequest("mild")]) {
      const report = buildTemplateReport(request);
      const texts = [report.summary, ...report.problems.map((card) => card.whatWeSaw)];
      for (const text of texts) {
        for (const word of BANNED_WORDS) expect(text).not.toContain(word);
        expect(text).not.toMatch(/[左右]/);
      }
    }
  });

  it("population_caveat：退階版、標示較溫和版本、頂端提醒", () => {
    const request = { ...allProblemsRequest("marked"), population_caveat: true };
    const report = buildTemplateReport(request);
    expect(report.populationCaveat).toBe(true);
    const first = report.problems[0].exercises[0];
    expect(first.gentle).toBe(true);
    expect(first.steps).toEqual(getExercise(first.exerciseId!)!.regression_steps);
    for (const card of report.problems) {
      for (const exercise of card.exercises.filter((item) => item.steps.length > 0)) {
        expect(exercise.steps).toEqual(getExercise(exercise.exerciseId!)!.regression_steps);
        expect(exercise.steps.length).toBeGreaterThanOrEqual(3);
      }
    }
    for (const card of report.problems) expect(card.exercisesIntro).toContain("開始前請先諮詢專業人員");
  });

  it("低可信度：總結語加「僅供參考」、黃色提示條取最多 2 個原因", () => {
    const request = allProblemsRequest("mild");
    request.confidence = { overall: "low", display: "low", reasons: ["few_cycles", "camera_tilt", "low_light"] };
    const report = buildTemplateReport(request);
    expect(report.summary.startsWith("由於影片拍攝條件的關係，以下結果僅供參考。")).toBe(true);
    expect(report.lowConfidence?.reason).toContain("只有 5 個");
    expect(report.lowConfidence?.reason).toContain("畫面看起來有點歪");
    expect(report.lowConfidence?.reason).not.toContain("暗");
  });

  it("全部正常：總結語與固定附註", () => {
    const request = exampleRequest();
    request.findings[0].severity = "normal";
    const report = buildTemplateReport(request);
    expect(report.problems).toHaveLength(0);
    expect(report.summary).toContain("3 個項目都在常見範圍內");
    expect(report.summary).toContain("不代表身體其他部位沒有狀況");
  });

  it("formatTimestamp", () => {
    expect(formatTimestamp(3.1)).toBe("0:03");
    expect(formatTimestamp(75.9)).toBe("1:15");
  });

  it("D39：髖伸展歸因於軀幹前傾時，軀幹卡片「這代表什麼」最後加固定句，且不出現後腳推蹬", () => {
    const request = allProblemsRequest("marked");
    request.findings = request.findings
      .filter((finding) => finding.problem !== "hip_extension_deficit")
      .map((finding) =>
        finding.problem === "trunk_head_forward_lean" ? { ...finding, hip_attributed_to_trunk: true } : finding,
      );
    const report = buildTemplateReport(request);
    const trunk = report.problems.find((card) => card.id === "trunk_forward_lean")!;
    expect(trunk.meaning.at(-1)).toBe(HIP_ATTRIBUTED_TO_TRUNK_SENTENCE);
    expect(report.problems.some((card) => card.id === "hip_extension_deficit")).toBe(false);
    expect(report.goodItems.join("")).not.toContain("後腳推蹬");
    expect(report.summary).not.toContain("後腳推蹬");
  });

  it("沒有 D39 旗標時，軀幹卡片不加歸因句", () => {
    const report = buildTemplateReport(allProblemsRequest("marked"));
    const trunk = report.problems.find((card) => card.id === "trunk_forward_lean")!;
    expect(trunk.meaning).not.toContain(HIP_ATTRIBUTED_TO_TRUNK_SENTENCE);
  });
});
