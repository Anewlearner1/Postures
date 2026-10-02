/**
 * findings 組裝的單元測試：D26 跨側彙總、ΔPKF、D29、D31／D39、D38 時間點、原因代碼。
 */
import { describe, expect, it } from "vitest";
import type { CycleDetail, GaitMetrics, Side } from "@/lib/gait/types";
import { buildFindings, type FindingsInput, type SideInput } from "./findings";

let clock = 1;
function cycle(side: Side, metrics: GaitMetrics): CycleDetail {
  const t = clock;
  clock += 1.1;
  return {
    cycle: { side, passIndex: 0, heelStrikeSec: t, toeOffSec: t + 0.6, nextHeelStrikeSec: t + 1.05, valid: true, isAccelerationCycle: false },
    metrics,
    used: true,
    timesSec: { PHE: t + 0.5, PKF_sw: t + 0.75, KIC: t, TRK: t + 0.5 },
  };
}

const NORMAL: GaitMetrics = { PHE: 16, TE: 18, PKF_sw: 60, KIC: 5, TRK: 2, NCK: 12 };

function side(name: Side, values: GaitMetrics[]): SideInput {
  const cycles = values.map((metrics) => cycle(name, metrics));
  const med = (key: keyof GaitMetrics) => {
    const list = values.map((v) => v[key]).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
    return list.length ? list[Math.floor((list.length - 1) / 2)] : undefined;
  };
  const median: GaitMetrics = {};
  const counts: SideInput["counts"] = {};
  for (const key of ["PHE", "TE", "PKF_sw", "KIC", "TRK"] as const) {
    const value = med(key);
    if (value !== undefined) median[key] = value;
    counts[key] = values.filter((v) => v[key] !== undefined).length;
  }
  return { side: name, median, counts, cycles };
}

function input(left: GaitMetrics[], right: GaitMetrics[], extra: Partial<FindingsInput> = {}): FindingsInput {
  const sides: FindingsInput["sides"] = {};
  if (left.length) sides.left = side("left", left);
  if (right.length) sides.right = side("right", right);
  const all = [...(sides.left?.cycles ?? []), ...(sides.right?.cycles ?? [])];
  const trks = all.map((c) => c.metrics.TRK).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
  return {
    sides,
    trunk: { TRK: trks[Math.floor((trks.length - 1) / 2)], validCycles: trks.length, cycles: all },
    cameraTiltLow: false,
    metricConfidence: { hip: "high", kneeSwing: "high", kneeStance: "high", trunk: "high" },
    populationCaveat: false,
    slowSpeed: false,
    ...extra,
  };
}

const find = (out: ReturnType<typeof buildFindings>, problem: string, subtype?: string) =>
  out.findings.find((f) => f.problem === problem && (subtype === undefined || f.subtype === subtype));

describe("D26 跨側彙總", () => {
  it("整體取較重的一側，代表數值來自該側，findings 不含左右側", () => {
    const out = buildFindings(input([NORMAL, NORMAL, NORMAL], [{ ...NORMAL, PHE: 7, TE: 9 }, { ...NORMAL, PHE: 7.5, TE: 9 }]));
    const hip = find(out, "hip_extension_deficit")!;
    expect(hip.severity).toBe("marked");
    expect(hip.metrics).toEqual({ PHE: 7 });
    expect(out.sideGrades.left?.hip?.severity).toBe("normal");
    expect(out.sideGrades.right?.hip?.severity).toBe("marked");
    expect(JSON.stringify(out.findings)).not.toMatch(/left|right/);
  });

  it("只有一側有結果時以該側為準", () => {
    const out = buildFindings(input([{ ...NORMAL, KIC: 22 }, { ...NORMAL, KIC: 23 }], []));
    expect(find(out, "knee_flexion_abnormal", "knee_stance_flexion_high")!.severity).toBe("marked");
  });

  it("D29：該側只有 1 個週期時最多輕度", () => {
    const out = buildFindings(input([NORMAL, NORMAL], [{ ...NORMAL, PKF_sw: 35 }]));
    expect(find(out, "knee_flexion_abnormal", "knee_swing_flexion_low")!.severity).toBe("mild");
  });
});

describe("ΔPKF（§4.3，內部輔助）", () => {
  it("兩側都正常但左右差 > 17 → 明顯，代表數值取較小側", () => {
    const out = buildFindings(
      input([{ ...NORMAL, PKF_sw: 72 }, { ...NORMAL, PKF_sw: 72 }], [{ ...NORMAL, PKF_sw: 53 }, { ...NORMAL, PKF_sw: 53 }]),
    );
    const swing = find(out, "knee_flexion_abnormal", "knee_swing_flexion_low")!;
    expect(out.dPKF).toBeCloseTo(19);
    expect(swing.severity).toBe("marked");
    expect(swing.metrics.PKF_sw).toBe(53);
  });
  it("任一側少於 2 個週期時不使用 ΔPKF", () => {
    const out = buildFindings(input([{ ...NORMAL, PKF_sw: 72 }, { ...NORMAL, PKF_sw: 72 }], [{ ...NORMAL, PKF_sw: 53 }]));
    expect(out.dPKF).toBeUndefined();
    expect(find(out, "knee_flexion_abnormal", "knee_swing_flexion_low")!.severity).toBe("normal");
  });
});

describe("D31／D39 髖伸展歸因於軀幹前傾", () => {
  it("PHE 偏小、TE 正常、軀幹前傾 → 省略髖伸展 finding，軀幹 finding 帶旗標", () => {
    const leaning = { ...NORMAL, PHE: 8, TE: 18, TRK: 10 };
    const out = buildFindings(input([leaning, leaning], [leaning, leaning]));
    expect(find(out, "hip_extension_deficit")).toBeUndefined();
    const trunk = find(out, "trunk_head_forward_lean")!;
    expect(trunk.severity).toBe("mild");
    expect(trunk.hipAttributedToTrunk).toBe(true);
    expect(out.hipAttributedToTrunk).toBe(true);
    expect(out.sideGrades.left?.hip?.attributedToTrunk).toBe(true);
  });
  it("另一側本身就髖伸展不足（TE 也小）→ 照常輸出髖伸展、不帶旗標", () => {
    const leaning = { ...NORMAL, PHE: 8, TE: 18, TRK: 10 };
    const both = { ...NORMAL, PHE: 0, TE: 9, TRK: 10 };
    const out = buildFindings(input([leaning, leaning], [both, both]));
    expect(find(out, "hip_extension_deficit")!.severity).toBe("marked");
    expect(find(out, "trunk_head_forward_lean")!.hipAttributedToTrunk).toBeUndefined();
  });
  it("軀幹沒有前傾時不歸因", () => {
    const out = buildFindings(input([{ ...NORMAL, PHE: 10, TE: 13 }], [{ ...NORMAL, PHE: 10, TE: 13 }]));
    expect(find(out, "hip_extension_deficit")!.severity).toBe("mild");
    expect(out.hipAttributedToTrunk).toBe(false);
  });
});

describe("D38 時間點與候選原因", () => {
  it("正常的 finding 沒有時間點與原因", () => {
    const out = buildFindings(input([NORMAL, NORMAL], [NORMAL, NORMAL]));
    for (const f of out.findings) {
      expect(f.severity).toBe("normal");
      expect(f.timestampsSec).toBeUndefined();
      expect(f.candidateCauses).toEqual([]);
    }
  });
  it("時間點只取異常側中、本身超出正常範圍的週期，依時間排序", () => {
    clock = 1;
    const out = buildFindings(
      input([NORMAL, NORMAL], [{ ...NORMAL, KIC: 25 }, { ...NORMAL, KIC: 8 }, { ...NORMAL, KIC: 22 }]),
    );
    const stance = find(out, "knee_flexion_abnormal", "knee_stance_flexion_high")!;
    expect(stance.severity).toBe("marked");
    // 右側第 1、3 個週期（時間 3.2、5.4）超出正常範圍
    expect(stance.timestampsSec).toEqual([3.2, 5.4]);
  });
  it("走得偏慢時 slow_short_stride 排第一；特殊族群加上只提醒就醫的原因", () => {
    const low = { ...NORMAL, PHE: 6, TE: 7 };
    const out = buildFindings(input([low, low], [low, low], { slowSpeed: true, populationCaveat: true }));
    const hip = find(out, "hip_extension_deficit")!;
    expect(hip.candidateCauses[0]).toBe("slow_short_stride");
    expect(hip.candidateCauses).toContain("pain_guarding");
  });
  it("膝蓋兩型同時異常時加上 knee_pain_swelling（§4.3 加強就醫提醒）", () => {
    const knee = { ...NORMAL, PKF_sw: 40, KIC: 24 };
    const out = buildFindings(input([knee, knee], [knee, knee]));
    expect(find(out, "knee_flexion_abnormal", "knee_swing_flexion_low")!.candidateCauses).toContain("knee_pain_swelling");
    expect(find(out, "knee_flexion_abnormal", "knee_stance_flexion_high")!.candidateCauses).toEqual([
      "hamstring_tightness",
      "quad_weakness",
      "knee_pain_swelling",
    ]);
  });
  it("軀幹前傾的原因（§5.4），不含頭部原因（D25）", () => {
    const lean = { ...NORMAL, PHE: 3, TE: 6, TRK: 14 };
    const trunk = find(buildFindings(input([lean, lean], [lean, lean])), "trunk_head_forward_lean")!;
    expect(trunk.severity).toBe("marked");
    expect(trunk.candidateCauses).toEqual(["thoracic_stiffness", "pec_tightness", "back_scapular_endurance", "hip_flexor_tightness"]);
  });
  it("鏡頭歪斜可信度低時軀幹最多輕度（§5.3）", () => {
    const lean = { ...NORMAL, TRK: 14 };
    expect(find(buildFindings(input([lean, lean], [lean, lean], { cameraTiltLow: true })), "trunk_head_forward_lean")!.severity).toBe("mild");
  });
});
