/**
 * 這個檔案做什麼：
 *   步態分析的入口 `analyzeGait`（純 TypeScript，不依賴瀏覽器）。
 *   輸入 MediaPipe 的逐格骨架（正規化座標）與影片資訊，輸出「請重拍（RejectCode）」或「分析結果」。
 *
 *   流程（docs/spec/gait-rules.md §1 開頭的流程圖）：
 *     前處理（像素座標、錯置修正、內插、濾波）→ 影片層級拒絕（§7.1）
 *     → 切直線段、判近側、roll 校正 → 拍攝角度拒絕 → 事件偵測 → 週期檢查與指標
 *     → 無有效週期拒絕 → 跨週期彙總 → 可信度 → 分級與 findings → 輸出
 *
 *   回傳的 `result` 可以直接用 `toReportRequest(result)` 轉成 POST /api/report 的請求；
 *   `details` 是內部完整結果（含左右側），不可送給 AI 或顯示給使用者（D26）。
 */

import {
  combineFactors,
  computeFactors,
  displayFor,
  fewCyclesLevel,
  metricConfidence,
  occlusionLevel,
  variabilityLevel,
} from "@/lib/rules/confidence";
import { buildFindings } from "@/lib/rules/findings";
import { cycleReject, earlyReject, qualityReject, sideViewReject } from "@/lib/rules/reject";
import { RULES_VERSION, SLOW_SPEED_LEG_PER_SEC, STANDARD_LABEL } from "@/lib/rules/thresholds";
import { aggregateAll, aggregateSides } from "./aggregate";
import { applyAccelerationRule, buildPassCycles } from "./cycles";
import { countPassSteps, detectPassEvents, toGaitEvents } from "./events";
import { finite } from "./math";
import { detectPasses, legLength, type Pass } from "./passes";
import { buildTrack, type Joint } from "./preprocess";
import {
  bodyWidthRatio,
  cadence,
  completeBodyFractionInPasses,
  confidenceMeasurements,
  cycleFrames,
  headObservationStatus,
  rejectMeasurements,
  speedMedian,
  visibilityStats,
} from "./quality";
import type {
  AnalysisMeta,
  AnalysisOptions,
  AnalysisOutcome,
  AnalysisResult,
  CycleDetail,
  GaitEvent,
  GaitMetrics,
  PassDetail,
  PoseFrame,
  SideSummary,
} from "./types";

/** 內部的 Pass 去掉格點索引，只留給 details 的欄位。 */
function toPassDetail(pass: Pass): PassDetail {
  return {
    passIndex: pass.passIndex,
    direction: pass.direction,
    startSec: pass.startSec,
    endSec: pass.endSec,
    nearSide: pass.nearSide,
    rollDeg: pass.rollDeg,
    nearSideAgreement: pass.nearSideAgreement,
    hipWidthRatio: pass.hipWidthRatio,
    legLengthVariation: pass.legLengthVariation,
    yawDeg: pass.yawDeg,
    usedAnkleFallback: pass.usedAnkleFallback,
  };
}

function maxOf(values: Array<number | undefined>): number | undefined {
  const list = finite(values);
  return list.length > 0 ? Math.max(...list) : undefined;
}

/**
 * 分析一段側拍走路影片的骨架序列。
 * @param frames  逐格的 MediaPipe 結果（可以有偵測不到人的影格；順序不拘）
 * @param meta    影片資訊（像素寬高用於 §0.2 座標轉換）
 * @param options populationCaveat：使用者勾選了特殊族群（D30、D35）
 */
export function analyzeGait(
  frames: readonly PoseFrame[],
  meta: AnalysisMeta,
  options: AnalysisOptions = {},
): AnalysisOutcome {
  const track = buildTrack(frames, meta);

  // ---- §7.1 影片層級拒絕 ----
  const rejectStats = rejectMeasurements(track, meta.durationSec);
  const early = earlyReject(rejectStats);
  const rejectDetails = {
    detectedFraction: rejectStats.detectedFraction,
    completeBodyFraction: rejectStats.completeBodyFraction,
    effectiveFps: track.fps,
  };
  if (early) return { status: "rejected", code: early, details: rejectDetails };

  // ---- §2.2 直線段、§1.4 近側、§1.5 roll ----
  const L = legLength(track);
  const passes = Number.isFinite(L) && L > 0 ? detectPasses(track, L) : [];
  const sideView = sideViewReject(
    finite(passes.map((pass) => pass.hipWidthRatio)),
    passes.length > 0 ? 0 : bodyWidthRatio(track),
  );
  if (sideView) return { status: "rejected", code: sideView, details: { ...rejectDetails, passes: passes.length } };
  const inPasses = completeBodyFractionInPasses(track, passes);
  if (inPasses !== undefined) {
    rejectStats.completeBodyFraction = inPasses;
    rejectDetails.completeBodyFraction = inPasses;
  }
  const quality = qualityReject(rejectStats);
  if (quality) return { status: "rejected", code: quality, details: { ...rejectDetails, passes: passes.length } };

  // ---- §2.3 事件、§2.4 週期、§2.5 指標 ----
  const events: GaitEvent[] = [];
  const cycles: CycleDetail[] = [];
  let accelerationCyclesKept = false;
  let stepsAnalyzed = 0;
  for (const pass of passes) {
    const passEvents = detectPassEvents(track, pass, L);
    stepsAnalyzed += countPassSteps(track, pass, L, passEvents);
    pass.usedAnkleFallback = passEvents.usedAnkleFallback;
    events.push(...toGaitEvents(pass, passEvents));
    const passCycles = buildPassCycles(track, pass, passEvents, L);
    if (applyAccelerationRule(passCycles)) accelerationCyclesKept = true;
    cycles.push(...passCycles);
  }
  const usedCycles = cycles.filter((cycle) => cycle.used);
  const noCycle = cycleReject(usedCycles.length, finite(passes.map((pass) => pass.yawDeg)));
  if (noCycle) {
    return { status: "rejected", code: noCycle, details: { ...rejectDetails, passes: passes.length, validCycles: 0 } };
  }

  // ---- §2.6 彙總 ----
  const sides = aggregateSides(cycles);
  const all = aggregateAll(cycles);
  const left = sides.left;
  const right = sides.right;
  const sideList = [left, right].filter((s) => s !== undefined);
  const sdMax = (key: keyof GaitMetrics) => maxOf(sideList.map((s) => s.stdDev[key]));
  const count = (key: keyof GaitMetrics) => [left?.counts[key] ?? 0, right?.counts[key] ?? 0] as const;

  // ---- §6.3、§6.4 可信度 ----
  const measurements = confidenceMeasurements({
    track,
    passes,
    usedCycles,
    L,
    cyclesLeft: left?.validCycles ?? 0,
    cyclesRight: right?.validCycles ?? 0,
    maxStdDev: maxOf([sdMax("PHE"), sdMax("PKF_sw"), all.stdDev.TRK]),
    accelerationCyclesKept,
  });
  const factors = computeFactors(measurements);
  const { overall, reasons } = combineFactors(factors);

  const frameList = cycleFrames(track, usedCycles, passes);
  const occlusionFor = (joints: readonly Joint[]) => {
    const stats = visibilityStats(track, frameList, joints);
    return occlusionLevel(stats.visibility, stats.interpolated, measurements.nearSideDisagreement);
  };
  const metricLevel = (key: keyof GaitMetrics, joints: readonly Joint[], sd: number | undefined, downgradeOne = false) =>
    metricConfidence(
      factors,
      overall,
      { occlusion: occlusionFor(joints), few_cycles: fewCyclesLevel(...count(key)), high_variability: variabilityLevel(sd) },
      downgradeOne,
    );

  // ---- §2.7 走速（D27：只附註） ----
  const speed = speedMedian(usedCycles);
  const slowSpeed = speed !== undefined && speed < SLOW_SPEED_LEG_PER_SEC;

  // ---- §3–§5 分級與 findings ----
  const built = buildFindings({
    sides: {
      ...(left ? { left: { side: "left", median: left.median, counts: left.counts, cycles: left.cycles } } : {}),
      ...(right ? { right: { side: "right", median: right.median, counts: right.counts, cycles: right.cycles } } : {}),
    },
    trunk: { TRK: all.median.TRK, validCycles: all.counts.TRK ?? 0, cycles: all.cycles },
    cameraTiltLow: factors.camera_tilt.level === "low",
    metricConfidence: {
      hip: metricLevel("PHE", ["shoulder", "hip", "knee"], sdMax("PHE")),
      // §4.5：光線不足（low_light）時 PKF_sw 可信度降一級
      kneeSwing: metricLevel("PKF_sw", ["hip", "knee", "ankle"], sdMax("PKF_sw"), factors.low_light.level !== "high"),
      kneeStance: metricLevel("KIC", ["hip", "knee", "ankle"], sdMax("KIC")),
      trunk: metricLevel("TRK", ["shoulder", "hip"], all.stdDev.TRK),
    },
    populationCaveat: options.populationCaveat === true,
    slowSpeed,
  });
  if (built.findings.length === 0) {
    return { status: "rejected", code: "no_gait_cycle", details: { ...rejectDetails, passes: passes.length, note: "no metrics" } };
  }

  const result: AnalysisResult = {
    rulesVersion: RULES_VERSION,
    standardLabel: STANDARD_LABEL,
    confidence: { overall, display: displayFor(overall), reasons },
    walking: { passes: passes.length, validCyclesTotal: usedCycles.length, slowSpeed, stepsAnalyzed },
    populationCaveat: options.populationCaveat === true,
    findings: built.findings,
    observations: [{ item: "head_forward", status: headObservationStatus(usedCycles) }],
  };

  const summaries: Partial<Record<"left" | "right", SideSummary>> = {};
  for (const s of sideList) summaries[s.side] = { side: s.side, validCycles: s.validCycles, median: s.median, stdDev: s.stdDev };

  return {
    status: "ok",
    result,
    details: {
      effectiveFps: track.fps,
      legLengthPx: L,
      passes: passes.map(toPassDetail),
      events,
      cycles,
      sides: summaries,
      sideGrades: built.sideGrades,
      dPKF: built.dPKF,
      NCK: all.median.NCK,
      speedLegPerSec: speed,
      cadenceStepsPerMin: cadence(usedCycles),
      lrSwapFraction: track.swapFraction,
      confidenceFactors: factors,
    },
  };
}
