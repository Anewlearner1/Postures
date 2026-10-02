import { describe, expect, it } from "vitest";
import { getExercise, isActiveExercise } from "./exercises";
import type { ReportRequest } from "./request";
import { MAX_EXERCISES, MAX_EXERCISES_POPULATION_CAVEAT, selectExercises } from "./select-exercises";
import { allProblemsRequest, exampleRequest } from "./test-fixtures";

const categoryOf = (id: string) => getExercise(id)?.category;

function withFinding(patch: Partial<ReportRequest["findings"][number]>, base = exampleRequest()): ReportRequest {
  return { ...base, findings: [{ ...base.findings[0], ...patch }, ...base.findings.slice(1)] };
}

describe("動作挑選規則（exercise-library.md §3）", () => {
  it("正常的問題不給動作、不產生卡片（規則 1）", () => {
    const selection = selectExercises(withFinding({ severity: "normal" }));
    expect(selection.cards).toHaveLength(0);
    expect(selection.uniqueExerciseIds).toHaveLength(0);
    expect(selection.normalFindings).toHaveLength(3);
  });

  it("輕度：2 個 = 1 步態提示 + 1 伸展或肌力（規則 2）", () => {
    const [card] = selectExercises(exampleRequest()).cards;
    expect(card.exerciseIds).toHaveLength(2);
    expect(categoryOf(card.exerciseIds[0])).toBe("motor_control");
    expect(["stretch", "strength"]).toContain(categoryOf(card.exerciseIds[1]));
    // 第一個候選原因是髖屈肌緊繃 → 選它對應的伸展
    expect(card.exerciseIds).toEqual(["push-off-walking-cue", "half-kneeling-hip-flexor-stretch"]);
  });

  it("明顯：3 個 = 1 步態提示 + 1 伸展 + 1 肌力（規則 2）", () => {
    const [card] = selectExercises(withFinding({ severity: "marked" })).cards;
    expect(card.exerciseIds.map(categoryOf)).toEqual(["motor_control", "stretch", "strength"]);
  });

  it("候選原因缺少某類型時，從同問題其他原因補（規則 2）", () => {
    // 只有 glute_weakness（只有肌力動作）→ 步態提示與伸展要從其他原因補
    const [card] = selectExercises(withFinding({ severity: "marked", candidate_causes: ["glute_weakness"] })).cards;
    expect(card.exerciseIds.map(categoryOf)).toEqual(["motor_control", "stretch", "strength"]);
    expect(card.exerciseIds[2]).toBe("glute-bridge");
  });

  it("只用第一版啟用的動作（D24、D25）", () => {
    const selection = selectExercises(allProblemsRequest("marked"));
    for (const card of selection.cards) {
      for (const id of card.exerciseIds) expect(isActiveExercise(id), id).toBe(true);
    }
    const all = selection.cards.flatMap((card) => card.exerciseIds);
    expect(all).not.toContain("chin-tuck");
    expect(all).not.toContain("soft-knee-single-leg-balance");
  });

  it("整份報告最多 6 個不同動作，重複的動作只算一次（規則 3）", () => {
    const selection = selectExercises(allProblemsRequest("marked"));
    expect(selection.uniqueExerciseIds.length).toBeLessThanOrEqual(MAX_EXERCISES);
    const all = selection.cards.flatMap((card) => card.exerciseIds);
    expect(new Set(all).size).toBe(selection.uniqueExerciseIds.length);
    // 輪流分配：每張卡片至少分到 1 個
    for (const card of selection.cards) expect(card.exerciseIds.length).toBeGreaterThan(0);
  });

  it("卡片依嚴重度排序，同等級依「軀幹 → 髖 → 膝」", () => {
    const request = allProblemsRequest("marked");
    request.findings[0].severity = "mild"; // 髖改成輕度 → 排到最後
    const order = selectExercises(request).cards.map((card) => card.cardId);
    expect(order).toEqual([
      "trunk_forward_lean",
      "knee_swing_flexion_low",
      "knee_stance_flexion_high",
      "hip_extension_deficit",
    ]);
  });

  it("低可信度：每張卡片最多 1 個，優先步態提示或伸展（規則 4）", () => {
    const request = allProblemsRequest("marked");
    request.confidence = { overall: "low", display: "low", reasons: ["camera_tilt"] };
    const selection = selectExercises(request);
    for (const card of selection.cards) {
      expect(card.exerciseIds.length).toBeLessThanOrEqual(1);
      for (const id of card.exerciseIds) expect(["motor_control", "stretch"]).toContain(categoryOf(id));
    }
  });

  it("population_caveat：整份報告最多 3 個（規則 6）", () => {
    const request = { ...allProblemsRequest("marked"), population_caveat: true };
    const selection = selectExercises(request);
    expect(selection.uniqueExerciseIds.length).toBeLessThanOrEqual(MAX_EXERCISES_POPULATION_CAVEAT);
    expect(selection.uniqueExerciseIds).toHaveLength(3);
    // 依優先順序輪流分配：前 3 張卡片各拿 1 個，第 4 張分不到
    expect(selection.cards.map((card) => card.exerciseIds.length)).toEqual([1, 1, 1, 0]);
  });

  it("只有「只提醒就醫」的原因時，不給動作（規則 6）", () => {
    const [card] = selectExercises(withFinding({ severity: "marked", candidate_causes: ["pain_guarding"] })).cards;
    expect(card.exerciseIds).toHaveLength(0);
    expect(card.referOnlyCauses).toEqual(["pain_guarding"]);
  });

  it("就醫原因與一般原因並存時，一般原因照常給動作、並記下就醫原因", () => {
    const [card] = selectExercises(
      withFinding({ severity: "mild", candidate_causes: ["pain_guarding", "hip_flexor_tightness"] }),
    ).cards;
    expect(card.exerciseIds).toHaveLength(2);
    expect(card.referOnlyCauses).toEqual(["pain_guarding"]);
  });

  it("頭部前傾觀察不產生任何動作（規則 7）", () => {
    const request = withFinding({ severity: "normal" });
    request.observations = [{ item: "head_forward", status: "observed" }];
    expect(selectExercises(request).uniqueExerciseIds).toHaveLength(0);
  });

  describe("D40：補位只用同一子型態的動作", () => {
    function kneeRequest(subtype: "knee_swing_flexion_low" | "knee_stance_flexion_high", severity: "mild" | "marked", causes: string[]) {
      const base = exampleRequest();
      return {
        ...base,
        findings: [
          {
            problem: "knee_flexion_abnormal" as const,
            subtype,
            severity,
            metrics: subtype === "knee_stance_flexion_high" ? { KIC: 22 } : { PKF_sw: 40 },
            metric_confidence: "high" as const,
            near_threshold: false,
            candidate_causes: causes as ReportRequest["findings"][number]["candidate_causes"],
          },
        ],
      };
    }
    const SWING_ONLY = ["swing-knee-lift-walking-cue", "standing-quad-stretch", "calf-raise"];

    it("膝蓋彎得較多（明顯）：不補擺盪期的步態提示，寧可少給（只有伸展＋肌力）", () => {
      const [card] = selectExercises(kneeRequest("knee_stance_flexion_high", "marked", ["hamstring_tightness", "quad_weakness"])).cards;
      expect(card.exerciseIds).toEqual(["supine-hamstring-towel-stretch", "sit-to-stand"]);
      for (const id of SWING_ONLY) expect(card.exerciseIds).not.toContain(id);
    });

    it("膝蓋彎得較多（輕度）：沒有對題的步態提示時只給 1 個", () => {
      const [card] = selectExercises(kneeRequest("knee_stance_flexion_high", "mild", ["quad_weakness"])).cards;
      expect(card.exerciseIds).toEqual(["sit-to-stand"]);
    });

    it("膝蓋彎得較多但候選原因屬於擺盪期：忽略不對題的原因，改用同型態的原因", () => {
      const [card] = selectExercises(kneeRequest("knee_stance_flexion_high", "marked", ["weak_push_off", "slow_short_stride"])).cards;
      expect(card.exerciseIds.length).toBeGreaterThan(0);
      for (const id of card.exerciseIds) expect(["supine-hamstring-towel-stretch", "sit-to-stand"]).toContain(id);
    });

    it("膝蓋彎得較少：不補著地期的動作（膕旁肌伸展、坐站）", () => {
      const [card] = selectExercises(kneeRequest("knee_swing_flexion_low", "marked", ["slow_short_stride"])).cards;
      expect(card.exerciseIds).toEqual(["swing-knee-lift-walking-cue", "standing-quad-stretch", "calf-raise"]);
      expect(card.exerciseIds).not.toContain("supine-hamstring-towel-stretch");
      expect(card.exerciseIds).not.toContain("sit-to-stand");
    });

    it("四張卡片都明顯時，膝蓋彎得較多的卡片不含擺盪期動作", () => {
      const selection = selectExercises(allProblemsRequest("marked"));
      const stance = selection.cards.find((card) => card.cardId === "knee_stance_flexion_high")!;
      for (const id of SWING_ONLY) expect(stance.exerciseIds).not.toContain(id);
    });
  });
});
