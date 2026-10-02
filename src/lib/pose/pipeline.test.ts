/**
 * 這個檔案做什麼：測試「分析中」流程的狀態轉換與結果（用假的偵測器、假的演算法、假的報告 API）：
 *   成功 → 報告；演算法拒絕 → 請重拍代碼；模型載入失敗；分析中斷；使用者取消；
 *   以及進度百分比、步驟順序、剩餘時間估算。
 */

import { describe, expect, it, vi } from "vitest";
import { SAMPLE_ANALYSIS } from "@/data/sample-analysis";
import type { AnalysisOutcome, PoseFrame, PoseSequence } from "@/lib/gait/types";
import type { FetchedReport } from "@/lib/report/fetch-report";
import type { AnalyzeGaitFn } from "./gait-adapter";
import { PoseModelLoadError, type PoseDetectorLike } from "./pose-detector";
import {
  estimateSteps,
  initialProgress,
  reduceProgress,
  runAnalysisPipeline,
  stepStatus,
  type PipelineDeps,
  type PipelineEvent,
  type PipelineInput,
} from "./pipeline";
import type { AnalysisPlan } from "./preflight";

const plan: AnalysisPlan = { untilSec: 10, trimmed: false, sourceFps: 30, frameStep: 1, effectiveFps: 30, frameCount: 300 };
const input: PipelineInput = { plan, videoDurationSec: 12, populationCaveat: true };

function fakeSequence(): PoseSequence {
  const frames: PoseFrame[] = Array.from({ length: 3 }, (_, i) => ({ frameIndex: i, timeSec: i / 30, landmarks: null }));
  return { frames, fps: 30, videoWidth: 1920, videoHeight: 1080, durationSec: 10 };
}

const fakeReport = { source: "template", report: { summary: "x" } } as unknown as FetchedReport;

function makeDeps(overrides: Partial<PipelineDeps> & { outcome?: AnalysisOutcome } = {}) {
  const detector: PoseDetectorLike = { delegate: "CPU", detect: vi.fn(), close: vi.fn() };
  const analyze = vi.fn<AnalyzeGaitFn>(() => overrides.outcome ?? { status: "ok", result: SAMPLE_ANALYSIS });
  const deps: PipelineDeps = {
    createDetector: vi.fn(async ({ onModelProgress }) => {
      onModelProgress(0.5);
      onModelProgress(1);
      return detector;
    }),
    extract: vi.fn(async (_detector, { onProgress }) => {
      const sequence = fakeSequence();
      sequence.frames.forEach((frame, i) => onProgress({ done: i + 1, total: 3, frame }));
      return { sequence, stats: { totalMs: 100, framesPerSecond: 30, avgInferenceMs: 20, playedFrames: 3, seekedFrames: 0 } };
    }),
    loadAnalyzer: vi.fn(async () => analyze),
    fetchReport: vi.fn(async () => fakeReport),
    ...overrides,
  };
  return { deps, detector, analyze };
}

async function run(deps: PipelineDeps, signal = new AbortController().signal) {
  const events: PipelineEvent[] = [];
  const outcome = await runAnalysisPipeline(input, deps, (event) => events.push(event), signal);
  return { outcome, events };
}

describe("runAnalysisPipeline", () => {
  it("成功：依序經過四個步驟，產出報告", async () => {
    const { deps, detector, analyze } = makeDeps();
    const { outcome, events } = await run(deps);

    expect(outcome.kind).toBe("report");
    expect(events.filter((e) => e.type === "step").map((e) => (e as { step: string }).step)).toEqual([
      "read",
      "detect",
      "compute",
      "report",
    ]);
    expect(events).toContainEqual({ type: "frames", done: 3, total: 3 });
    expect(detector.close).toHaveBeenCalled();
    // 演算法收到實際分析的影格率與長度，以及 D35 的是／否值
    expect(analyze).toHaveBeenCalledWith(
      expect.any(Array),
      { fps: 30, width: 1920, height: 1080, durationSec: 10 },
      { populationCaveat: true },
    );
    // 報告上的影片長度用整段影片；步數由完整週期數估算
    expect(deps.fetchReport).toHaveBeenCalledWith(
      SAMPLE_ANALYSIS,
      { stepsAnalyzed: estimateSteps(SAMPLE_ANALYSIS), durationSec: 12 },
      expect.anything(),
    );
  });

  it("演算法拒絕 → 回傳拒絕代碼，不呼叫報告 API", async () => {
    const { deps } = makeDeps({ outcome: { status: "rejected", code: "no_gait_cycle" } });
    const { outcome } = await run(deps);
    expect(outcome).toMatchObject({ kind: "rejected", code: "no_gait_cycle" });
    expect(deps.fetchReport).not.toHaveBeenCalled();
  });

  it("模型載入失敗 → model_load_failed", async () => {
    const { deps } = makeDeps({
      createDetector: vi.fn(async () => {
        throw new PoseModelLoadError("model: http 404");
      }),
    });
    const { outcome } = await run(deps);
    expect(outcome).toMatchObject({ kind: "error", code: "model_load_failed" });
  });

  it("逐格偵測途中出錯 → analysis_interrupted，並關閉偵測器", async () => {
    const { deps, detector } = makeDeps({
      extract: vi.fn(async () => {
        throw new Error("seek timeout");
      }),
    });
    const { outcome } = await run(deps);
    expect(outcome).toMatchObject({ kind: "error", code: "analysis_interrupted", detail: "seek timeout" });
    expect(detector.close).toHaveBeenCalled();
  });

  it("影片本身讀不下去（例如後半段損毀）→ video_unreadable（M5 QA F-06）", async () => {
    const { deps } = makeDeps({
      extract: vi.fn(async () => {
        throw new Error("video error 3");
      }),
    });
    const { outcome } = await run(deps);
    expect(outcome).toMatchObject({ kind: "error", code: "video_unreadable" });
  });

  it("使用者取消 → cancelled，不再往下做", async () => {
    const controller = new AbortController();
    const { deps } = makeDeps({
      extract: vi.fn(async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }),
    });
    const { outcome } = await run(deps, controller.signal);
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(deps.loadAnalyzer).not.toHaveBeenCalled();
  });
});

describe("reduceProgress", () => {
  it("模型下載占 0–10%，逐格偵測占 10–92%", () => {
    let state = initialProgress();
    state = reduceProgress(state, { type: "step", step: "read" }, 0);
    state = reduceProgress(state, { type: "model-progress", fraction: 0.5 }, 0);
    expect(state.percent).toBe(5);
    state = reduceProgress(state, { type: "step", step: "detect" }, 1000);
    expect(state.percent).toBe(10);
    state = reduceProgress(state, { type: "frames", done: 150, total: 300 }, 11_000);
    expect(state.percent).toBe(51);
    expect(state.framesDone).toBe(150);
  });

  it("處理 15 格以上才開始估算剩餘時間", () => {
    let state = reduceProgress(initialProgress(), { type: "step", step: "detect" }, 0);
    state = reduceProgress(state, { type: "frames", done: 10, total: 300 }, 1000);
    expect(state.etaSec).toBeNull();
    // 30 格花了 3 秒 → 每格 0.1 秒，剩 270 格 ≈ 27 秒，加上計算與報告約 4 秒
    state = reduceProgress(state, { type: "frames", done: 30, total: 300 }, 3000);
    expect(state.etaSec).toBe(31);
  });

  it("步驟不會倒退，百分比不會變小", () => {
    let state = reduceProgress(initialProgress(), { type: "step", step: "compute" }, 0);
    const before = state.percent;
    state = reduceProgress(state, { type: "step", step: "detect" }, 0);
    expect(state.step).toBe("compute");
    expect(state.percent).toBe(before);
  });

  it("stepStatus 標示已完成、進行中、未開始", () => {
    expect(stepStatus("detect", "read")).toBe("done");
    expect(stepStatus("detect", "detect")).toBe("active");
    expect(stepStatus("detect", "report")).toBe("pending");
  });
});
