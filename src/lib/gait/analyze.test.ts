/**
 * 整條分析管線 `analyzeGait` 的整合測試（用合成資料）：
 *   指標準確度、每種問題的分級、D26／D29／D31／D39、轉身排除、每種拒絕代碼、
 *   可信度降級原因、走速附註、頭部觀察、D38 時間點，以及輸出可以通過 /api/report 的 zod 驗證。
 */
import { describe, expect, it } from "vitest";
import { parseReportRequest } from "@/lib/report/request";
import { toReportRequest } from "@/lib/report/to-request";
import { analyzeGait } from "./analyze";
import { generateStanding, generateWalk, type SyntheticOptions, type SyntheticResult } from "./testing/synthetic";
import type { AnalysisDetails, AnalysisResult, ConfidenceReason, Finding } from "./types";

interface Run {
  sim: SyntheticResult;
  result: AnalysisResult;
  details: AnalysisDetails;
}

function run(options: SyntheticOptions, analysisOptions = {}): Run {
  const sim = generateWalk({ passes: 4, noisePx: 2, ...options });
  const outcome = analyzeGait(sim.frames, sim.meta, analysisOptions);
  if (outcome.status !== "ok" || !outcome.details) throw new Error(`rejected: ${JSON.stringify(outcome)}`);
  return { sim, result: outcome.result, details: outcome.details };
}

function finding(result: AnalysisResult, key: "hip" | "swing" | "stance" | "trunk"): Finding | undefined {
  return result.findings.find((f) =>
    key === "hip"
      ? f.problem === "hip_extension_deficit"
      : key === "swing"
        ? f.subtype === "knee_swing_flexion_low"
        : key === "stance"
          ? f.subtype === "knee_stance_flexion_high"
          : f.subtype === "trunk_forward_lean",
  );
}

/** 轉成 API 請求並驗證；回傳請求 JSON 字串。 */
function expectValidRequest(result: AnalysisResult): string {
  const request = toReportRequest(result);
  const parsed = parseReportRequest(request);
  if (!parsed.ok) throw new Error(`invalid request: ${JSON.stringify(parsed.issues)}`);
  return JSON.stringify(request);
}

describe("正常步態", () => {
  const { sim, result, details } = run({});

  it("全部在常見範圍內、可信度高", () => {
    expect(result.findings.map((f) => f.severity)).toEqual(["normal", "normal", "normal", "normal"]);
    expect(result.confidence).toEqual({ overall: "high", display: "good", reasons: [] });
    expect(result.walking.passes).toBe(4);
    expect(result.walking.validCyclesTotal).toBeGreaterThanOrEqual(5);
    expect(result.walking.slowSpeed).toBe(false);
    expect(result.rulesVersion).toBe("gait-rules-v0.2");
    expect(result.standardLabel).toBe("beta");
    expect(result.observations).toEqual([{ item: "head_forward", status: "observed" }]);
    for (const f of result.findings) {
      expect(f.candidateCauses).toEqual([]);
      expect(f.timestampsSec).toBeUndefined();
    }
  });

  it("指標與真值相符（PHE ±1.5°、PKF_sw ±2.5°、TRK ±0.7°；KIC 為 HS ±1 幀平均，允許 +4°）", () => {
    const e = sim.truth.expected;
    expect(Math.abs(finding(result, "hip")!.metrics.PHE! - e.PHE)).toBeLessThan(1.5);
    expect(Math.abs(finding(result, "swing")!.metrics.PKF_sw! - e.PKF_sw)).toBeLessThan(2.5);
    expect(Math.abs(finding(result, "trunk")!.metrics.TRK! - e.TRK)).toBeLessThan(0.7);
    const kic = finding(result, "stance")!.metrics.KIC!;
    expect(kic - e.KIC).toBeGreaterThan(-1);
    expect(kic - e.KIC).toBeLessThan(4);
    // 內部：TE 與 NCK（D25 只存內部）
    expect(Math.abs(details.sides.left!.median.TE! - e.TE)).toBeLessThan(1.5);
    expect(details.NCK).toBeDefined();
  });

  it("走速與步頻：v̂ 約等於真值（±5%）", () => {
    expect(details.speedLegPerSec! / sim.truth.speedLegPerSec).toBeGreaterThan(0.95);
    expect(details.speedLegPerSec! / sim.truth.speedLegPerSec).toBeLessThan(1.05);
    expect(details.cadenceStepsPerMin).toBeCloseTo(120 / sim.truth.cycleSec, 0);
  });

  it("內部分左右側計算（D26），API 請求不含左右側與內部數值", () => {
    expect(details.sides.left?.validCycles).toBeGreaterThanOrEqual(2);
    expect(details.sides.right?.validCycles).toBeGreaterThanOrEqual(2);
    const json = expectValidRequest(result);
    expect(json).not.toMatch(/left|right|NCK|"TE"|KLR/);
  });

  it("同樣的輸入得到同樣的結果；影格順序不影響結果", () => {
    const again = analyzeGait(sim.frames, sim.meta);
    const reversed = analyzeGait([...sim.frames].reverse(), sim.meta);
    expect(again.status === "ok" && again.result).toEqual(result);
    expect(reversed.status === "ok" && reversed.result).toEqual(result);
  });
});

describe("每種問題的分級（正常／輕度／明顯）", () => {
  it.each([
    { name: "髖伸展正常（TE 18）", gait: { thighExtDeg: 18 }, key: "hip" as const, severity: "normal" },
    { name: "髖伸展輕度（TE 12）", gait: { thighExtDeg: 12 }, key: "hip" as const, severity: "mild" },
    { name: "髖伸展明顯（TE 7）", gait: { thighExtDeg: 7 }, key: "hip" as const, severity: "marked" },
    { name: "擺盪期膝屈曲輕度（PKF 48）", gait: { pkfDeg: 48 }, key: "swing" as const, severity: "mild" },
    { name: "擺盪期膝屈曲明顯（PKF 40）", gait: { pkfDeg: 40 }, key: "swing" as const, severity: "marked" },
    { name: "著地膝屈曲輕度（KIC 13）", gait: { kicDeg: 13 }, key: "stance" as const, severity: "mild" },
    { name: "著地膝屈曲明顯（KIC 24）", gait: { kicDeg: 24 }, key: "stance" as const, severity: "marked" },
    { name: "軀幹前傾輕度（9°）", gait: { trunkLeanDeg: 9 }, key: "trunk" as const, severity: "mild" },
    { name: "軀幹前傾明顯（15°）", gait: { trunkLeanDeg: 15 }, key: "trunk" as const, severity: "marked" },
  ])("$name → $severity", ({ gait, key, severity }) => {
    const { result } = run({ gait });
    const f = finding(result, key)!;
    expect(f.severity).toBe(severity);
    if (severity === "normal") {
      expect(f.candidateCauses).toEqual([]);
    } else {
      expect(f.candidateCauses.length).toBeGreaterThan(0);
      expect(f.timestampsSec!.length).toBeGreaterThan(0);
    }
    // 其他問題不受影響（軀幹前傾會連帶讓 PHE 變小，由 D31 處理，另測）
    if (key !== "trunk") {
      for (const other of result.findings) if (other !== f) expect(other.severity).toBe("normal");
    }
    expectValidRequest(result);
  });

  it("接近臨界：PHE 約 11.6°（界線 12 ± 1.5）→ 輕度且 near_threshold", () => {
    const { result } = run({ gait: { thighExtDeg: 13.8 } });
    expect(finding(result, "hip")).toMatchObject({ severity: "mild", nearThreshold: true });
  });

  it("D38：時間點落在影片範圍內、已排序、最多 10 個，且對應真值的事件時間", () => {
    const { sim, result } = run({ gait: { kicDeg: 24 } });
    const times = finding(result, "stance")!.timestampsSec!;
    expect(times.length).toBeLessThanOrEqual(10);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const time of times) {
      expect(time).toBeGreaterThanOrEqual(0);
      expect(time).toBeLessThanOrEqual(sim.meta.durationSec);
      // KIC 的時間點 = 腳跟著地，離真值 HS 不超過 0.12 秒
      const nearest = Math.min(...sim.truth.events.filter((e) => e.type === "heel_strike").map((e) => Math.abs(e.timeSec - time)));
      expect(nearest).toBeLessThan(0.12);
    }
  });
});

describe("D31／D39 軀幹前傾與髖伸展", () => {
  it("軀幹前傾 10°、大腿後擺正常（TE 17）→ 不報髖伸展，軀幹帶 hipAttributedToTrunk", () => {
    const { result, details } = run({ gait: { trunkLeanDeg: 10, thighExtDeg: 17 } });
    expect(finding(result, "hip")).toBeUndefined();
    expect(finding(result, "trunk")).toMatchObject({ severity: "mild", hipAttributedToTrunk: true });
    expect(details.sideGrades.left?.hip?.attributedToTrunk).toBe(true);
    const json = expectValidRequest(result);
    expect(json).toContain('"hip_attributed_to_trunk":true');
  });

  it("軀幹前傾、大腿後擺也不足（TE 8）→ 兩個都報、沒有旗標", () => {
    const { result } = run({ gait: { trunkLeanDeg: 10, thighExtDeg: 8 } });
    expect(finding(result, "hip")!.severity).toBe("marked");
    expect(finding(result, "trunk")!.severity).toBe("mild");
    expect(finding(result, "trunk")!.hipAttributedToTrunk).toBeUndefined();
    expectValidRequest(result);
  });
});

describe("D26 跨側彙總、ΔPKF、D29", () => {
  it("只有右腳擺盪期膝屈曲不足 → 整體取較重側，代表數值來自右腳", () => {
    const { result, details, sim } = run({ gaitRight: { pkfDeg: 42 } });
    const swing = finding(result, "swing")!;
    expect(swing.severity).toBe("marked");
    expect(Math.abs(swing.metrics.PKF_sw! - sim.truth.expectedBySide.right.PKF_sw)).toBeLessThan(2.5);
    expect(details.sideGrades.left?.kneeSwing?.severity).toBe("normal");
    expect(details.sideGrades.right?.kneeSwing?.severity).toBe("marked");
  });

  it("兩側都在正常範圍，但左右差 > 17°（ΔPKF）→ 明顯", () => {
    const { result, details } = run({ gait: { pkfDeg: 75 }, gaitRight: { pkfDeg: 54 } });
    expect(details.dPKF!).toBeGreaterThan(17);
    expect(details.sideGrades.right?.kneeSwing?.severity).toBe("normal");
    expect(finding(result, "swing")!.severity).toBe("marked");
  });

  it("D29：每側只有 1 個有效週期時，明顯降為輕度（並以 few_cycles 反映在可信度）", () => {
    const { result, details } = run({ passes: 2, walkwayM: 2.8, gait: { pkfDeg: 38 } });
    expect(details.sides.left?.validCycles ?? 0).toBeLessThanOrEqual(1);
    expect(details.sides.right?.validCycles ?? 0).toBeLessThanOrEqual(1);
    expect(finding(result, "swing")!.severity).toBe("mild");
    expect(result.confidence.overall).toBe("low");
    expect(result.confidence.reasons).toContain("few_cycles");
  });

  it("只走一趟：只有一側有結果，few_cycles 讓可信度變低", () => {
    const { result, details } = run({ passes: 1, standSec: 2 });
    expect(Object.keys(details.sides)).toEqual(["right"]);
    expect(result.confidence.display).toBe("low");
    expect(result.confidence.reasons).toContain("few_cycles");
  });
});

describe("轉身段排除（§2.2）", () => {
  it("沒有任何有效週期或事件落在轉身期間", () => {
    const { sim, details } = run({ passes: 3 });
    for (const turn of sim.truth.turns) {
      for (const c of details.cycles.filter((c) => c.used)) {
        expect(c.cycle.nextHeelStrikeSec <= turn.startSec || c.cycle.heelStrikeSec >= turn.endSec).toBe(true);
      }
      for (const event of details.events) expect(event.timeSec < turn.startSec || event.timeSec > turn.endSec).toBe(true);
    }
  });
});

describe("可信度降級原因（§6.3）", () => {
  it.each<{ name: string; options: SyntheticOptions; reason: ConfidenceReason; level: "medium" | "low" }>([
    { name: "手機歪 5°", options: { rollDeg: 5 }, reason: "camera_tilt", level: "medium" },
    { name: "手機歪 10°", options: { rollDeg: 10 }, reason: "camera_tilt", level: "low" },
    { name: "每趟 roll 不同（晃動）", options: { rollDeg: [0, 4, 0, 4] }, reason: "camera_motion", level: "medium" },
    { name: "左右錯置 8%", options: { swapFraction: 0.08 }, reason: "lr_swap", level: "medium" },
    { name: "左右錯置 20%", options: { swapFraction: 0.2 }, reason: "lr_swap", level: "low" },
    { name: "影格率 20 fps", options: { fps: 20 }, reason: "low_fps", level: "low" },
    { name: "影格率 25 fps", options: { fps: 25 }, reason: "low_fps", level: "medium" },
    { name: "近側下肢 visibility 0.7", options: { jointVisibility: { near: { knee: 0.7, ankle: 0.7, heel: 0.7, toe: 0.7 } } }, reason: "occlusion", level: "medium" },
    { name: "鏡頭偏離矢狀面 20°", options: { walkwayYawDeg: 20 }, reason: "angle_off", level: "low" },
    { name: "人太小（相機 7 m）", options: { cameraDistanceM: 7 }, reason: "subject_small", level: "medium" },
    { name: "關鍵點跳動大（雜訊 8 px）", options: { noisePx: 8 }, reason: "low_light", level: "low" },
    { name: "步頻不規則", options: { paceWobble: 0.12 }, reason: "irregular_pace", level: "low" },
    { name: "軀幹角度週期間差異大", options: { trunkWobbleDeg: 8 }, reason: "high_variability", level: "low" },
    { name: "只走 2 趟", options: { passes: 2 }, reason: "few_cycles", level: "medium" },
    { name: "走道太寬、腳走出畫面", options: { walkwayM: 5.2 }, reason: "partial_out_of_frame", level: "medium" },
  ])("$name → $reason = $level", ({ options, reason, level }) => {
    const { result, details } = run(options);
    expect(details.confidenceFactors[reason].level).toBe(level);
    expect(result.confidence.overall).not.toBe("high");
    expect(result.confidence.display).toBe(result.confidence.overall === "medium" ? "good_with_tip" : "low");
    expectValidRequest(result);
  });

  it("鏡頭歪斜會被校正：手機歪 6° 時 TRK 仍準確（±1°）", () => {
    const { sim, result } = run({ rollDeg: 6 });
    expect(Math.abs(finding(result, "trunk")!.metrics.TRK! - sim.truth.expected.TRK)).toBeLessThan(1);
  });

  it("手機歪 > 8° 時軀幹最多輕度（§5.3）", () => {
    const { result } = run({ rollDeg: 10, gait: { trunkLeanDeg: 15, thighExtDeg: 25 } });
    expect(finding(result, "trunk")!.severity).toBe("mild");
  });

  it("左右錯置被修正後，指標仍與真值相符", () => {
    const { sim, result } = run({ swapFraction: 0.08 });
    expect(Math.abs(finding(result, "swing")!.metrics.PKF_sw! - sim.truth.expected.PKF_sw)).toBeLessThan(2.5);
    expect(Math.abs(finding(result, "hip")!.metrics.PHE! - sim.truth.expected.PHE)).toBeLessThan(1.5);
  });

  it("缺幀與短暫遮擋：仍能分析，指標不受影響", () => {
    const { sim, result } = run({ droppedFrameFraction: 0.04, missingFrameFraction: 0.03, dropoutFraction: 0.08 });
    expect(result.walking.validCyclesTotal).toBeGreaterThanOrEqual(4);
    expect(Math.abs(finding(result, "hip")!.metrics.PHE! - sim.truth.expected.PHE)).toBeLessThan(2);
  });

  it("指標層級可信度不會高於整體", () => {
    const rank = { high: 2, medium: 1, low: 0 } as const;
    const { result } = run({ rollDeg: 5 });
    for (const f of result.findings) expect(rank[f.metricConfidence]).toBeLessThanOrEqual(rank[result.confidence.overall]);
  });
});

describe("M4 本機欄位：步數、整段前傾、查看數據", () => {
  it("步數 = 直線段內左右腳的初始著地合計：接近真值、不超過真值、約為有效週期的 3 倍以上", () => {
    const { sim, result, details } = run({ passes: 3 });
    const steps = result.walking.stepsAnalyzed!;
    const truthInPasses = sim.truth.events.filter(
      (e) => e.type === "heel_strike" && details.passes.some((p) => e.timeSec >= p.startSec && e.timeSec <= p.endSec),
    ).length;
    expect(steps).toBeLessThanOrEqual(truthInPasses);
    expect(steps).toBeGreaterThanOrEqual(truthInPasses * 0.8);
    // 近側 HS 都算在內
    expect(steps).toBeGreaterThanOrEqual(details.events.filter((e) => e.type === "heel_strike").length);
  });

  it("遠側看不清時，以近側 HS × 2 估計", () => {
    const { result, details } = run({ passes: 3, farVisibility: 0.3 });
    expect(result.walking.stepsAnalyzed).toBe(2 * details.events.filter((e) => e.type === "heel_strike").length);
  });

  it("整段持續前傾：全程前傾 10° → true；正常 → false；忽前忽後（中位數在界線附近）→ false", () => {
    expect(finding(run({ gait: { trunkLeanDeg: 10 } }).result, "trunk")!.trunkLeanPersistent).toBe(true);
    expect(finding(run({}).result, "trunk")!.trunkLeanPersistent).toBe(false);
    const wobble = finding(run({ gait: { trunkLeanDeg: 8 }, trunkWobbleDeg: 6 }).result, "trunk")!;
    expect(wobble.trunkLeanPersistent).toBe(false);
  });

  it("查看數據（D44）：每個 finding 有代表角度與常見範圍", () => {
    const { result } = run({ gait: { thighExtDeg: 7 } });
    expect(finding(result, "hip")!.userMetric).toMatchObject({ key: "PHE", normalMinDeg: 12 });
    expect(finding(result, "hip")!.userMetric!.valueDeg).toBe(Math.round(finding(result, "hip")!.metrics.PHE!));
    expect(finding(result, "swing")!.userMetric).toMatchObject({ key: "PKF_sw", normalMinDeg: 52 });
    expect(finding(result, "stance")!.userMetric).toMatchObject({ key: "KIC", normalMaxDeg: 12, normalMaxInclusive: true });
    expect(finding(result, "trunk")!.userMetric).toMatchObject({ key: "TRK", normalMaxDeg: 7, normalMaxInclusive: false });
  });

  it("本機欄位不會送到 API（請求仍通過嚴格驗證）", () => {
    const { result } = run({ gait: { trunkLeanDeg: 12 } });
    const json = expectValidRequest(result);
    expect(json).not.toMatch(/steps|Persistent|persistent|userMetric|valueDeg/);
  });
});

describe("走速、特殊族群、頭部觀察", () => {
  it("走得偏慢 → slow_speed，嚴重度不調整（D27），原因把「走得慢」排第一", () => {
    const { result } = run({ speedMps: 0.75, gait: { pkfDeg: 48 } });
    expect(result.walking.slowSpeed).toBe(true);
    const swing = finding(result, "swing")!;
    expect(swing.severity).toBe("mild");
    expect(swing.candidateCauses[0]).toBe("slow_short_stride");
  });

  it("populationCaveat 帶到輸出，異常項目加上只提醒就醫的原因", () => {
    const { result } = run({ gait: { thighExtDeg: 7 } }, { populationCaveat: true });
    expect(result.populationCaveat).toBe(true);
    expect(finding(result, "hip")!.candidateCauses).toContain("pain_guarding");
    expectValidRequest(result);
  });

  it("耳朵看不清時頭部觀察為 not_assessable（D25），不影響其他指標", () => {
    const { result } = run({ jointVisibility: { near: { ear: 0.2 }, far: { ear: 0.2 } } });
    expect(result.observations).toEqual([{ item: "head_forward", status: "not_assessable" }]);
    expect(result.confidence.overall).toBe("high");
  });
});

describe("拒絕並請重拍（§7.1）", () => {
  const reject = (sim: SyntheticResult) => {
    const outcome = analyzeGait(sim.frames, sim.meta);
    return outcome.status === "rejected" ? outcome.code : "ok";
  };

  it.each([
    { code: "too_short", options: { passes: 2, maxDurationSec: 5 } },
    { code: "low_fps_reject", options: { passes: 2, fps: 12 } },
    { code: "no_person", options: { passes: 2, missingFrameFraction: 0.6 } },
    { code: "multi_person", options: { passes: 2, identitySwitches: 3 } },
    { code: "multi_person", options: { passes: 2, poseCount: 2 } },
    { code: "body_incomplete", options: { passes: 2, focalPx: 2400 } },
    { code: "not_side_view", options: { passes: 2, walkwayYawDeg: 90, startDirection: -1 as const, cameraDistanceM: 6 } },
    { code: "not_side_view", options: { passes: 2, walkwayYawDeg: 60 } },
  ])("$code：$options", ({ code, options }) => {
    expect(reject(generateWalk(options))).toBe(code);
  });

  it.each([
    { name: "背影（朝遠方走）、鼻子看不到", startDirection: 1 as const, noseVisibility: 0.2, noisePx: 8 },
    { name: "正面（朝鏡頭走）", startDirection: -1 as const, noseVisibility: 0.95, noisePx: 8 },
    { name: "背影、雜訊很大", startDirection: 1 as const, noseVisibility: 0.2, noisePx: 12 },
  ])("M4 回歸：直拍 1080×1920、人很小的$name → not_side_view（不是 multi_person）", ({ startDirection, noseVisibility, noisePx }) => {
    const sim = generateWalk({
      width: 1080,
      height: 1920,
      walkwayYawDeg: 90,
      startDirection,
      cameraDistanceM: 8,
      walkwayM: 4,
      passes: 3,
      noisePx,
      noseVisibility,
    });
    expect(reject(sim)).toBe("not_side_view");
  });

  it("人小、雜訊大的側面影片不會被誤判成多人", () => {
    expect(reject(generateWalk({ passes: 3, noisePx: 12, cameraDistanceM: 7 }))).toBe("ok");
  });

  it.each([15, 60])("換人（骨架跳到另一個人）在 %s fps 也偵測得到", (fps) => {
    expect(reject(generateWalk({ passes: 3, fps, identitySwitches: 3, noisePx: 2 }))).toBe("multi_person");
  });

  it("no_gait_cycle：側面站著不動", () => {
    expect(reject(generateStanding({ noisePx: 2 }))).toBe("no_gait_cycle");
  });

  it("沒有任何影格", () => {
    expect(analyzeGait([], { fps: 30, width: 1920, height: 1080, durationSec: 10 })).toMatchObject({
      status: "rejected",
      code: "no_person",
    });
  });

  it("剛好 15 fps 不拒絕（可信度 low_fps = 低）", () => {
    const outcome = analyzeGait(generateWalk({ passes: 2, fps: 15 }).frames, generateWalk({ passes: 2, fps: 15 }).meta);
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.details?.confidenceFactors.low_fps.level).toBe("low");
  });
});
