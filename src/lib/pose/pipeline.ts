/**
 * 這個檔案做什麼：
 *   「分析中」的完整流程與進度計算（UX 文件 §2.4 的四個步驟）：
 *     1. 讀取影片（含載入分析工具）
 *     2. 找出身體關節位置（n/N 畫面）
 *     3. 計算角度與步伐（呼叫演算法 analyzeGait）
 *     4. 撰寫你的報告（POST /api/report）
 *   每個步驟需要的功能都由外部傳入（deps），所以可以用假的實作測試整個流程與狀態轉換。
 *
 *   結果有四種：產出報告、請重拍（拒絕代碼）、錯誤（無法載入分析工具／分析中斷）、使用者取消。
 */

import type { AnalysisResult, PoseSequence, RejectCode } from "@/lib/gait/types";
import type { FetchedReport, VideoInfo } from "@/lib/report/fetch-report";
import type { ExtractProgress, ExtractStats } from "./extract-poses";
import type { AnalyzeGaitFn } from "./gait-adapter";
import type { PoseDelegate } from "./mediapipe-config";
import { PoseModelLoadError, type PoseDetectorLike } from "./pose-detector";
import type { AnalysisPlan } from "./preflight";

// ---------------------------------------------------------------------------
// 進度（純函式，給畫面顯示）
// ---------------------------------------------------------------------------

export type StepId = "read" | "detect" | "compute" | "report";

export const STEP_ORDER: StepId[] = ["read", "detect", "compute", "report"];

export type PipelineEvent =
  | { type: "step"; step: StepId }
  | { type: "model-progress"; fraction: number | null }
  | { type: "frames"; done: number; total: number };

export interface PipelineProgress {
  step: StepId;
  /** 0–100。 */
  percent: number;
  framesDone: number;
  framesTotal: number;
  /** 模型下載進度 0–1；不知道時為 null。 */
  modelFraction: number | null;
  /** 預估還要幾秒；還沒有足夠資訊時為 null。 */
  etaSec: number | null;
  /** 開始偵測骨架的時間（毫秒）。 */
  detectStartedAt: number | null;
}

/** 各步驟占整體進度的範圍（%）。偵測骨架最花時間。 */
const STEP_RANGE: Record<StepId, [number, number]> = {
  read: [0, 10],
  detect: [10, 92],
  compute: [92, 96],
  report: [96, 100],
};

/** 開始預估剩餘時間前，至少要處理幾格。 */
const MIN_FRAMES_FOR_ETA = 15;
/** 計算角度＋撰寫報告大約要幾秒（加在剩餘時間上）。 */
const TAIL_SECONDS = 4;

export function initialProgress(): PipelineProgress {
  return {
    step: "read",
    percent: 0,
    framesDone: 0,
    framesTotal: 0,
    modelFraction: null,
    etaSec: null,
    detectStartedAt: null,
  };
}

export function reduceProgress(state: PipelineProgress, event: PipelineEvent, nowMs: number): PipelineProgress {
  switch (event.type) {
    case "step": {
      // 步驟只能往前走
      if (STEP_ORDER.indexOf(event.step) < STEP_ORDER.indexOf(state.step)) return state;
      const percent = Math.max(state.percent, STEP_RANGE[event.step][0]);
      return {
        ...state,
        step: event.step,
        percent,
        detectStartedAt: event.step === "detect" ? nowMs : state.detectStartedAt,
        etaSec: event.step === "compute" || event.step === "report" ? null : state.etaSec,
      };
    }
    case "model-progress": {
      if (state.step !== "read") return state;
      const [from, to] = STEP_RANGE.read;
      const percent = event.fraction === null ? state.percent : from + (to - from) * Math.min(1, event.fraction);
      return { ...state, modelFraction: event.fraction, percent: Math.max(state.percent, Math.round(percent)) };
    }
    case "frames": {
      const [from, to] = STEP_RANGE.detect;
      const fraction = event.total > 0 ? event.done / event.total : 0;
      const percent = Math.max(state.percent, Math.round(from + (to - from) * fraction));
      let etaSec = state.etaSec;
      if (state.detectStartedAt !== null && event.done >= MIN_FRAMES_FOR_ETA) {
        const elapsedSec = (nowMs - state.detectStartedAt) / 1000;
        const perFrame = elapsedSec / event.done;
        etaSec = Math.max(1, Math.round(perFrame * (event.total - event.done) + TAIL_SECONDS));
      }
      return { ...state, step: "detect", percent, framesDone: event.done, framesTotal: event.total, etaSec };
    }
  }
}

/** 某個步驟目前的狀態（打勾、進行中、還沒開始）。 */
export function stepStatus(current: StepId, step: StepId): "done" | "active" | "pending" {
  const diff = STEP_ORDER.indexOf(step) - STEP_ORDER.indexOf(current);
  return diff < 0 ? "done" : diff === 0 ? "active" : "pending";
}

// ---------------------------------------------------------------------------
// 流程（依賴外部傳入，方便測試）
// ---------------------------------------------------------------------------

export interface PipelineInput {
  plan: AnalysisPlan;
  /** 整段影片的長度（報告上顯示的「影片長度」與時間軸用）。 */
  videoDurationSec: number;
  populationCaveat: boolean;
}

export interface PipelineDeps {
  createDetector(options: { signal: AbortSignal; onModelProgress: (fraction: number | null) => void }): Promise<PoseDetectorLike>;
  extract(
    detector: PoseDetectorLike,
    options: { signal: AbortSignal; onProgress: (progress: ExtractProgress) => void },
  ): Promise<{ sequence: PoseSequence; stats: ExtractStats }>;
  loadAnalyzer(): Promise<AnalyzeGaitFn>;
  fetchReport(result: AnalysisResult, video: VideoInfo, signal: AbortSignal): Promise<FetchedReport>;
}

export interface PipelinePerformance {
  delegate: PoseDelegate;
  modelLoadMs: number;
  extract: ExtractStats;
  analyzeMs: number;
}

export type PipelineOutcome =
  | {
      kind: "report";
      poses: PoseSequence;
      result: AnalysisResult;
      report: FetchedReport;
      performance: PipelinePerformance;
    }
  | { kind: "rejected"; code: RejectCode; performance?: PipelinePerformance }
  | { kind: "error"; code: "model_load_failed" | "analysis_interrupted"; detail: string }
  | { kind: "cancelled" };

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * 「分析了幾步」：演算法輸出目前只有完整步態週期數，一個週期含左右各一步，暫以週期數 × 2 估算。
 * （待演算法提供實際步數後替換。）
 */
export function estimateSteps(result: AnalysisResult): number {
  return result.walking.validCyclesTotal * 2;
}

export async function runAnalysisPipeline(
  input: PipelineInput,
  deps: PipelineDeps,
  emit: (event: PipelineEvent) => void,
  signal: AbortSignal,
): Promise<PipelineOutcome> {
  let detector: PoseDetectorLike | null = null;
  try {
    emit({ type: "step", step: "read" });
    const loadStarted = performance.now();
    detector = await deps.createDetector({
      signal,
      onModelProgress: (fraction) => emit({ type: "model-progress", fraction }),
    });
    const modelLoadMs = performance.now() - loadStarted;
    if (signal.aborted) return { kind: "cancelled" };

    emit({ type: "step", step: "detect" });
    emit({ type: "frames", done: 0, total: input.plan.frameCount });
    const { sequence, stats } = await deps.extract(detector, {
      signal,
      onProgress: ({ done, total }) => emit({ type: "frames", done, total }),
    });
    const delegate = detector.delegate;
    detector.close();
    detector = null;
    if (signal.aborted) return { kind: "cancelled" };

    emit({ type: "step", step: "compute" });
    const analyzeStarted = performance.now();
    const analyzeGait = await deps.loadAnalyzer();
    const outcome = analyzeGait(
      sequence.frames,
      { fps: sequence.fps, width: sequence.videoWidth, height: sequence.videoHeight, durationSec: sequence.durationSec },
      { populationCaveat: input.populationCaveat },
    );
    const analyzeMs = performance.now() - analyzeStarted;
    const perf: PipelinePerformance = { delegate, modelLoadMs, extract: stats, analyzeMs };
    if (outcome.status === "rejected") return { kind: "rejected", code: outcome.code, performance: perf };
    if (signal.aborted) return { kind: "cancelled" };

    emit({ type: "step", step: "report" });
    const report = await deps.fetchReport(
      outcome.result,
      { stepsAnalyzed: estimateSteps(outcome.result), durationSec: input.videoDurationSec },
      signal,
    );
    if (signal.aborted) return { kind: "cancelled" };

    return {
      kind: "report",
      poses: sequence,
      result: outcome.result,
      report,
      performance: perf,
    };
  } catch (error) {
    if (signal.aborted || isAbort(error)) return { kind: "cancelled" };
    if (error instanceof PoseModelLoadError) return { kind: "error", code: "model_load_failed", detail: error.message };
    return { kind: "error", code: "analysis_interrupted", detail: error instanceof Error ? error.message : String(error) };
  } finally {
    detector?.close();
  }
}
