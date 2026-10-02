/**
 * 這個檔案做什麼：
 *   把每側的指標彙總轉成報告用的 findings（docs/spec/gait-rules.md §2.6、§3–§5、§8）：
 *   - 每側各自分級（含 D29、D23／D31），再依 D26 取較重的一側作為整體結果
 *   - D39：髖伸展偏小被歸因於軀幹前傾、且整體髖伸展因此不成立時，不輸出髖伸展 finding，
 *          改在軀幹 finding 加上 `hipAttributedToTrunk: true`
 *   - ΔPKF（兩側皆 ≥ 2 週期才用）參與「擺盪期屈曲不足」分級
 *   - near_threshold、candidate_causes（§3.4、§4.4、§5.4）、D38 時間點
 *   輸出的 findings 不含任何左右側資訊（D26）；左右側結果只放在 sideGrades（內部）。
 */

import type {
  CauseCode,
  Confidence,
  CycleDetail,
  Finding,
  GaitMetrics,
  Severity,
  Side,
  SideGrade,
  UserMetric,
} from "@/lib/gait/types";
import { median } from "@/lib/gait/math";
import {
  BOUNDARIES,
  applyCycleGuard,
  gradeDeltaPKF,
  gradeHipSide,
  gradeKIC,
  gradePKF,
  gradeTrunk,
  isNearThreshold,
  maxSeverity,
  nearThresholdBand,
  pickDecidingSide,
  severityRank,
  type SideMetricGrade,
} from "./grading";
import { HIP_EXTENSION, KNEE_STANCE, KNEE_SWING, MAX_TIMESTAMPS, TRUNK, TRUNK_PERSISTENT } from "./thresholds";

export interface SideInput {
  side: Side;
  median: GaitMetrics;
  counts: Partial<Record<keyof GaitMetrics, number>>;
  cycles: readonly CycleDetail[];
}

export interface FindingsInput {
  sides: Partial<Record<Side, SideInput>>;
  trunk: { TRK?: number; validCycles: number; cycles: readonly CycleDetail[] };
  /** 鏡頭歪斜可信度為「低」（§5.3：TRK 最多輕度）。 */
  cameraTiltLow: boolean;
  metricConfidence: Record<"hip" | "kneeSwing" | "kneeStance" | "trunk", Confidence>;
  populationCaveat: boolean;
  slowSpeed: boolean;
}

export interface FindingsOutput {
  findings: Finding[];
  sideGrades: Partial<Record<Side, SideGrade>>;
  dPKF?: number;
  /** D39：髖伸展偏小已歸因於軀幹前傾（髖伸展 finding 因此省略）。 */
  hipAttributedToTrunk: boolean;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

// §3.4、§4.4、§5.4 的原因代碼（第一版會給動作的原因，依可能性排序）
const HIP_CAUSES: CauseCode[] = ["hip_flexor_tightness", "glute_weakness", "weak_push_off", "slow_short_stride"];
const KNEE_SWING_CAUSES: CauseCode[] = ["quad_rectus_tightness", "weak_push_off", "slow_short_stride"];
const KNEE_STANCE_CAUSES: CauseCode[] = ["hamstring_tightness", "quad_weakness"];
const TRUNK_CAUSES: CauseCode[] = ["thoracic_stiffness", "pec_tightness", "back_scapular_endurance", "hip_flexor_tightness"];

/**
 * 候選原因：只有輕度／明顯才給。
 * - 走得偏慢（slow_speed）時，把 slow_short_stride 移到第一位（§2.7、§3.4）【實作選擇】
 * - 使用者勾選特殊族群（population_caveat，含正在疼痛）時，加上該問題「只提醒就醫」的原因【實作選擇】
 * - 膝蓋兩型同時異常時，加上 knee_pain_swelling（§4.3：加強就醫提醒）
 */
function causesFor(base: CauseCode[], severity: Severity, slowSpeed: boolean, referCause?: CauseCode): CauseCode[] {
  if (severity === "normal") return [];
  let causes = [...base];
  if (slowSpeed && causes.includes("slow_short_stride")) {
    causes = ["slow_short_stride", ...causes.filter((cause) => cause !== "slow_short_stride")];
  }
  if (referCause) causes.push(referCause);
  return causes;
}

/** D38：問題出現的時間點。優先取「該週期本身就超出正常範圍」的週期，沒有時取該側所有週期。 */
function timestampsFor(
  cycles: readonly CycleDetail[],
  key: "PHE" | "PKF_sw" | "KIC" | "TRK",
  abnormal: (value: number) => boolean,
): number[] {
  const withTime = cycles.filter((cycle) => cycle.metrics[key] !== undefined && cycle.timesSec[key] !== undefined);
  const hits = withTime.filter((cycle) => abnormal(cycle.metrics[key] as number));
  const chosen = (hits.length > 0 ? hits : withTime).map((cycle) => cycle.timesSec[key] as number);
  return [...new Set(chosen)].sort((a, b) => a - b).slice(0, MAX_TIMESTAMPS);
}

/** D44：給使用者看的代表角度與常見範圍（整數度；只在本機使用）。 */
export function userMetricFor(key: UserMetric["key"], value: number): UserMetric {
  // 四捨五入到整數，但不可讓數字跨過「常見範圍」界線（例如 TRK 6.9° 判正常，不可顯示成 7°）
  const inNormal = (v: number) =>
    key === "PHE" ? v >= HIP_EXTENSION.normalMin
      : key === "PKF_sw" ? v >= KNEE_SWING.normalMin
        : key === "KIC" ? v <= KNEE_STANCE.normalMax
          : v < TRUNK.mildMin;
  let valueDeg = Math.round(value);
  if (inNormal(valueDeg) !== inNormal(value)) {
    valueDeg = [Math.floor(value), Math.ceil(value)].find((v) => inNormal(v) === inNormal(value)) ?? valueDeg;
  }
  switch (key) {
    case "PHE":
      return { key, valueDeg, normalMinDeg: HIP_EXTENSION.normalMin };
    case "PKF_sw":
      return { key, valueDeg, normalMinDeg: KNEE_SWING.normalMin };
    case "KIC":
      return { key, valueDeg, normalMaxDeg: KNEE_STANCE.normalMax, normalMaxInclusive: true };
    case "TRK":
      return { key, valueDeg, normalMaxDeg: TRUNK.mildMin, normalMaxInclusive: false };
  }
}

function finding(
  base: Pick<Finding, "problem" | "subtype">,
  severity: Severity,
  metrics: GaitMetrics,
  metricConfidence: Confidence,
  nearThreshold: boolean,
  candidateCauses: CauseCode[],
  timestampsSec: number[],
): Finding {
  const out: Finding = { ...base, severity, metrics, metricConfidence, nearThreshold, candidateCauses };
  if (severity !== "normal" && timestampsSec.length > 0) out.timestampsSec = timestampsSec;
  const key = (["PHE", "PKF_sw", "KIC", "TRK"] as const).find((name) => metrics[name] !== undefined);
  if (key) out.userMetric = userMetricFor(key, metrics[key] as number);
  return out;
}

/**
 * 整段持續前傾（§5.3，M4）：軀幹輕度以上、有效週期 ≥ 2、≥ 80% 的週期本身 TRK ≥ 7°，
 * 且每個有有效週期的直線段 TRK 中位數 ≥ 7°。
 */
export function isTrunkLeanPersistent(severity: Severity, cycles: readonly CycleDetail[]): boolean {
  if (severity === "normal") return false;
  const withTrk = cycles.filter((cycle) => cycle.metrics.TRK !== undefined);
  if (withTrk.length < TRUNK_PERSISTENT.minCycles) return false;
  const leaning = withTrk.filter((cycle) => (cycle.metrics.TRK as number) >= TRUNK.mildMin).length;
  if (leaning / withTrk.length < TRUNK_PERSISTENT.minCycleFraction) return false;
  const byPass = new Map<number, number[]>();
  for (const cycle of withTrk) {
    const list = byPass.get(cycle.cycle.passIndex) ?? [];
    list.push(cycle.metrics.TRK as number);
    byPass.set(cycle.cycle.passIndex, list);
  }
  return [...byPass.values()].every((values) => median(values) >= TRUNK.mildMin);
}

export function buildFindings(input: FindingsInput): FindingsOutput {
  const sides = (["left", "right"] as const).map((side) => input.sides[side]).filter((s): s is SideInput => Boolean(s));
  const sideGrades: Partial<Record<Side, SideGrade>> = {};
  for (const s of sides) sideGrades[s.side] = { side: s.side, validCycles: s.cycles.length };
  const findings: Finding[] = [];
  const TRK = input.trunk.TRK;
  const sideCycles = (name: Side) => input.sides[name]?.cycles ?? [];
  const bandFor = (cycles: readonly CycleDetail[], key: "PHE" | "PKF_sw" | "KIC" | "TRK") =>
    nearThresholdBand(cycles.map((cycle) => cycle.metrics[key]).filter((v): v is number => v !== undefined));

  // ---- 髖伸展（§3.3；D23、D31、D29；D26） ----
  const hipGrades: SideMetricGrade[] = [];
  let anyAttributed = false;
  for (const s of sides) {
    const PHE = s.median.PHE;
    if (PHE === undefined) continue;
    const n = s.counts.PHE ?? 0;
    const graded = gradeHipSide(PHE, s.median.TE, TRK, n);
    anyAttributed ||= graded.attributedToTrunk;
    sideGrades[s.side]!.hip = { severity: graded.severity, PHE, TE: s.median.TE, attributedToTrunk: graded.attributedToTrunk };
    hipGrades.push({ side: s.side, severity: graded.severity, value: PHE, validCycles: n });
  }
  const hipDecider = pickDecidingSide(hipGrades, "lower");
  const hipSuppressed = hipDecider !== undefined && hipDecider.severity === "normal" && anyAttributed;
  if (hipDecider && !hipSuppressed) {
    const abnormalSides = sides.filter((s) => {
      const grade = sideGrades[s.side]?.hip;
      return grade && grade.severity !== "normal";
    });
    findings.push(
      finding(
        { problem: "hip_extension_deficit" },
        hipDecider.severity,
        { PHE: round1(hipDecider.value) },
        input.metricConfidence.hip,
        isNearThreshold(hipDecider.value, BOUNDARIES.PHE, bandFor(sideCycles(hipDecider.side), "PHE")),
        causesFor(HIP_CAUSES, hipDecider.severity, input.slowSpeed, input.populationCaveat ? "pain_guarding" : undefined),
        timestampsFor(
          abnormalSides.flatMap((s) => s.cycles),
          "PHE",
          (value) => value < HIP_EXTENSION.normalMin,
        ),
      ),
    );
  }

  // ---- 膝：擺盪期屈曲不足（§4.3；ΔPKF；D29；D26） ----
  const swingGrades: SideMetricGrade[] = [];
  for (const s of sides) {
    const PKF = s.median.PKF_sw;
    if (PKF === undefined) continue;
    const n = s.counts.PKF_sw ?? 0;
    const severity = applyCycleGuard(gradePKF(PKF), n);
    sideGrades[s.side]!.kneeSwing = { severity, PKF_sw: PKF };
    swingGrades.push({ side: s.side, severity, value: PKF, validCycles: n });
  }
  let dPKF: number | undefined;
  const swingDecider = pickDecidingSide(swingGrades, "lower");

  // ---- 膝：著地時屈曲過多（§4.3；D29；D26） ----
  const stanceGrades: SideMetricGrade[] = [];
  for (const s of sides) {
    const KIC = s.median.KIC;
    if (KIC === undefined) continue;
    const n = s.counts.KIC ?? 0;
    const severity = applyCycleGuard(gradeKIC(KIC), n);
    sideGrades[s.side]!.kneeStance = { severity, KIC };
    stanceGrades.push({ side: s.side, severity, value: KIC, validCycles: n });
  }
  const stanceDecider = pickDecidingSide(stanceGrades, "higher");

  let swingSeverity: Severity | undefined;
  let swingValue = NaN;
  let swingNear = false;
  let swingSides: Side[] = [];
  if (swingDecider) {
    swingSeverity = swingDecider.severity;
    swingValue = swingDecider.value;
    swingNear = isNearThreshold(swingDecider.value, BOUNDARIES.PKF_sw, bandFor(sideCycles(swingDecider.side), "PKF_sw"));
    swingSides = swingGrades.filter((grade) => grade.severity !== "normal").map((grade) => grade.side);
    const both = swingGrades.length === 2 && swingGrades.every((grade) => grade.validCycles >= KNEE_SWING.asymmetryMinCyclesPerSide);
    if (both) {
      dPKF = Math.abs(swingGrades[0].value - swingGrades[1].value);
      const dSeverity = gradeDeltaPKF(dPKF);
      if (severityRank(dSeverity) > severityRank(swingSeverity)) {
        const lower = swingGrades[0].value <= swingGrades[1].value ? swingGrades[0] : swingGrades[1];
        swingSeverity = maxSeverity(swingSeverity, dSeverity);
        swingValue = lower.value;
        swingNear = isNearThreshold(
          dPKF,
          BOUNDARIES.dPKF,
          Math.max(bandFor(sideCycles("left"), "PKF_sw"), bandFor(sideCycles("right"), "PKF_sw")),
        );
        swingSides = [lower.side];
      }
    }
  }
  const bothKneeAbnormal =
    swingSeverity !== undefined && swingSeverity !== "normal" && stanceDecider !== undefined && stanceDecider.severity !== "normal";
  const kneeRefer = input.populationCaveat || bothKneeAbnormal ? ("knee_pain_swelling" as const) : undefined;

  if (swingDecider && swingSeverity) {
    findings.push(
      finding(
        { problem: "knee_flexion_abnormal", subtype: "knee_swing_flexion_low" },
        swingSeverity,
        { PKF_sw: round1(swingValue) },
        input.metricConfidence.kneeSwing,
        swingNear,
        causesFor(KNEE_SWING_CAUSES, swingSeverity, input.slowSpeed, kneeRefer),
        timestampsFor(
          sides.filter((s) => swingSides.includes(s.side)).flatMap((s) => s.cycles),
          "PKF_sw",
          (value) => value < KNEE_SWING.normalMin,
        ),
      ),
    );
  }
  if (stanceDecider) {
    findings.push(
      finding(
        { problem: "knee_flexion_abnormal", subtype: "knee_stance_flexion_high" },
        stanceDecider.severity,
        { KIC: round1(stanceDecider.value) },
        input.metricConfidence.kneeStance,
        isNearThreshold(stanceDecider.value, BOUNDARIES.KIC, bandFor(sideCycles(stanceDecider.side), "KIC")),
        causesFor(KNEE_STANCE_CAUSES, stanceDecider.severity, input.slowSpeed, kneeRefer),
        timestampsFor(
          sides.filter((s) => sideGrades[s.side]?.kneeStance?.severity !== "normal").flatMap((s) => s.cycles),
          "KIC",
          (value) => value > KNEE_STANCE.normalMax,
        ),
      ),
    );
  }

  // ---- 軀幹前傾（§5.3；D29；D31／D39） ----
  if (TRK !== undefined) {
    const severity = gradeTrunk(TRK, input.trunk.validCycles, input.cameraTiltLow);
    const trunkFinding = finding(
      { problem: "trunk_head_forward_lean", subtype: "trunk_forward_lean" },
      severity,
      { TRK: round1(TRK) },
      input.metricConfidence.trunk,
      isNearThreshold(TRK, BOUNDARIES.TRK, bandFor(input.trunk.cycles, "TRK")),
      causesFor(TRUNK_CAUSES, severity, false, input.populationCaveat ? "pain_balance_osteoporosis" : undefined),
      timestampsFor(input.trunk.cycles, "TRK", (value) => value >= TRUNK.mildMin),
    );
    if (hipSuppressed) trunkFinding.hipAttributedToTrunk = true;
    trunkFinding.trunkLeanPersistent = isTrunkLeanPersistent(severity, input.trunk.cycles);
    findings.push(trunkFinding);
  }

  return { findings, sideGrades, dPKF, hipAttributedToTrunk: hipSuppressed };
}
