"use client";

/**
 * 這個檔案做什麼：
 *   P3「分析中」畫面（UX 文件 §2.4），真正在使用者的裝置上執行分析：
 *     讀取影片＋載入分析工具 → 逐格找出關節位置（n/N 畫面）→ 計算角度與步伐 → 撰寫報告
 *   完成後：
 *     - 成功 → 把結果記在瀏覽器記憶體（AnalysisSession），換到 /report
 *     - 需要重拍（偵測不到人、步伐不夠…）→ /retake/代碼
 *     - 無法載入分析工具／分析中斷 → /retake/model_load_failed、/retake/analysis_interrupted
 *   沒有影片（例如直接打開這個網址、或重新整理後）→ 回到 /upload。
 *
 *   其他：分析中離開要確認（beforeunload）；切到背景時暫停、回來後繼續；手機上盡量保持螢幕不關閉。
 */

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState } from "react";
import { useAnalysisSession } from "@/components/session/AnalysisSession";
import { useLeaveGuard } from "@/components/session/useLeaveGuard";
import { buttonClass } from "@/components/ui/ButtonLink";
import { AlertIcon, CheckIcon, LockIcon } from "@/components/ui/icons";
import { ANALYZE_COPY, WAITING_FACTS } from "@/data/analysis-copy";
import { extractPoses } from "@/lib/pose/extract-poses";
import { loadAnalyzeGait } from "@/lib/pose/gait-adapter";
import { MEDIAPIPE_ASSETS } from "@/lib/pose/mediapipe-config";
import {
  initialProgress,
  reduceProgress,
  runAnalysisPipeline,
  STEP_ORDER,
  stepStatus,
  type PipelineEvent,
  type PipelineProgress,
} from "@/lib/pose/pipeline";
import { createPoseDetector } from "@/lib/pose/pose-detector";
import { containRect, drawSkeleton, nearSideScore } from "@/lib/pose/skeleton";
import { fetchReport } from "@/lib/report/fetch-report";

/** 切到背景時暫停，回到前景才繼續（UX §2.4【給工程】）。 */
function createVisibilityGate(signal: AbortSignal, onResume: () => void) {
  return () => {
    if (!document.hidden) return undefined;
    return new Promise<void>((resolve) => {
      function done() {
        document.removeEventListener("visibilitychange", onChange);
        signal.removeEventListener("abort", done);
        resolve();
      }
      function onChange() {
        if (document.hidden) return;
        onResume();
        done();
      }
      document.addEventListener("visibilitychange", onChange);
      signal.addEventListener("abort", done);
    });
  };
}

/** 手機上請求「螢幕保持開啟」（不支援就算了）。 */
function requestWakeLock(): () => void {
  let sentinel: WakeLockSentinel | null = null;
  let released = false;
  navigator.wakeLock
    ?.request("screen")
    .then((lock) => {
      if (released) void lock.release();
      else sentinel = lock;
    })
    .catch(() => undefined);
  return () => {
    released = true;
    void sentinel?.release().catch(() => undefined);
  };
}

function etaText(progress: PipelineProgress, stepStartedAt: number, now: number): string {
  if (progress.step === "compute" || progress.step === "report") {
    return now - stepStartedAt > 8000 ? ANALYZE_COPY.etaOverrun : ANALYZE_COPY.etaSeconds(3);
  }
  if (progress.etaSec === null) return ANALYZE_COPY.etaInitial;
  if (progress.etaSec > 60) return ANALYZE_COPY.etaMinutes(Math.ceil(progress.etaSec / 60));
  return ANALYZE_COPY.etaSeconds(progress.etaSec);
}

export function AnalysisRunner() {
  const router = useRouter();
  const { video, populationCaveat, setCompleted } = useAnalysisSession();
  const [progress, dispatch] = useReducer(
    (state: PipelineProgress, action: { event: PipelineEvent; now: number }) =>
      reduceProgress(state, action.event, action.now),
    undefined,
    initialProgress,
  );
  const [running, setRunning] = useState(true);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [welcomeBack, setWelcomeBack] = useState(false);
  const [factIndex, setFactIndex] = useState(0);
  const [now, setNow] = useState(0);
  const [stepStartedAt, setStepStartedAt] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useLeaveGuard(running && Boolean(video), ANALYZE_COPY.leaveConfirm);

  // 沒有影片（直接開網址、重新整理）→ 回上傳頁
  useEffect(() => {
    if (!video) router.replace("/upload");
  }, [video, router]);

  // 小知識每 6 秒換一則；同時更新「現在時間」給剩餘時間文字用
  useEffect(() => {
    const factTimer = window.setInterval(() => setFactIndex((index) => (index + 1) % WAITING_FACTS.length), 6000);
    const clockTimer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => {
      window.clearInterval(factTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  useEffect(() => {
    if (!welcomeBack) return;
    const timer = window.setTimeout(() => setWelcomeBack(false), 4000);
    return () => window.clearTimeout(timer);
  }, [welcomeBack]);

  // 執行分析
  useEffect(() => {
    const element = videoRef.current;
    if (!video || !element) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    let disposed = false;
    const releaseWakeLock = requestWakeLock();
    const waitUntilVisible = createVisibilityGate(controller.signal, () => setWelcomeBack(true));

    function drawPreview(source: HTMLCanvasElement) {
      const canvas = previewRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    }

    function drawPreviewSkeleton(landmarks: Parameters<typeof drawSkeleton>[1] | null) {
      const canvas = previewRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx || !landmarks) return;
      const score = nearSideScore(landmarks);
      drawSkeleton(ctx, landmarks, {
        rect: containRect(canvas.width, canvas.height, canvas.width, canvas.height),
        nearSide: score === null ? null : score >= 0 ? "right" : "left",
        scale: canvas.width / 480,
      });
    }

    const emit = (event: PipelineEvent) => {
      const at = performance.now();
      if (event.type === "step") setStepStartedAt(at);
      dispatch({ event, now: at });
    };

    void runAnalysisPipeline(
      { plan: video.plan, videoDurationSec: video.meta.durationSec, populationCaveat },
      {
        createDetector: (options) => createPoseDetector(options),
        extract: (detector, options) =>
          extractPoses({
            video: element,
            plan: video.plan,
            detector,
            signal: options.signal,
            onProgress: (update) => {
              options.onProgress(update);
              drawPreviewSkeleton(update.frame.landmarks);
            },
            onPreviewFrame: drawPreview,
            waitUntilVisible,
          }),
        loadAnalyzer: loadAnalyzeGait,
        fetchReport: (result, info, signal) => fetchReport(result, info, { signal }),
      },
      emit,
      controller.signal,
    ).then((outcome) => {
      if (disposed) return;
      setRunning(false);
      if (outcome.kind === "report") {
        console.info("[pose] performance", outcome.performance);
        setCompleted({
          poses: outcome.poses,
          result: outcome.result,
          report: outcome.report,
          performance: outcome.performance,
          completedAt: new Date(),
        });
        router.replace("/report");
      } else if (outcome.kind === "rejected") {
        console.info("[pose] rejected", outcome.code, outcome.performance);
        router.replace(`/retake/${outcome.code}`);
      } else if (outcome.kind === "error") {
        console.warn("[pose] analysis failed:", outcome.detail);
        router.replace(`/retake/${outcome.code}`);
      }
    });

    return () => {
      disposed = true;
      controller.abort();
      releaseWakeLock();
    };
  }, [video, populationCaveat, router, setCompleted]);

  function cancelAnalysis() {
    setRunning(false);
    controllerRef.current?.abort();
    router.push("/upload");
  }

  if (!video) return null;

  const previewWidth = 480;
  const previewHeight = Math.round((previewWidth * video.meta.height) / video.meta.width);
  const framesLabel =
    progress.framesTotal > 0 ? `（${progress.framesDone}/${progress.framesTotal} 畫面）` : "";

  return (
    <div>
      <h1 className="text-2xl font-bold sm:text-3xl">{ANALYZE_COPY.title}</h1>

      {welcomeBack && (
        <p role="status" className="mt-4 rounded-xl bg-brand-50 px-4 py-2 font-semibold text-brand-800">
          {ANALYZE_COPY.welcomeBack}
        </p>
      )}

      <div className="mt-6 grid gap-8 md:grid-cols-2 md:items-start">
        {/* 左欄：目前處理到的畫面＋骨架 */}
        <div className="relative flex justify-center overflow-hidden rounded-xl bg-ink">
          <canvas
            ref={previewRef}
            width={previewWidth}
            height={previewHeight}
            className="max-h-[50vh] w-auto max-w-full md:max-h-[70vh]"
            style={{ aspectRatio: `${video.meta.width} / ${video.meta.height}` }}
            aria-label="分析中的影片畫面與骨架"
          />
          {/* 逐格讀取用的影片（不顯示；只在這台裝置上讀取） */}
          <video
            ref={videoRef}
            src={video.url}
            muted
            playsInline
            preload="auto"
            className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
            aria-hidden
          />
        </div>

        <div className="space-y-6">
          <div>
            <div
              className="h-3 w-full overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
              aria-label="分析進度"
            >
              <div
                className="h-full rounded-full bg-brand-600 transition-[width] duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="mt-2 flex justify-between gap-4 text-sm text-muted">
              <span>{etaText(progress, stepStartedAt, now)}</span>
              <span className="font-semibold text-ink" data-testid="progress-percent">
                {progress.percent}%
              </span>
            </p>
          </div>

          <ol className="space-y-2" aria-label="分析步驟">
            {STEP_ORDER.map((step) => {
              const status = stepStatus(progress.step, step);
              return (
                <li key={step} className="flex items-start gap-3" data-status={status}>
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                      status === "done"
                        ? "border-brand-600 bg-brand-600 text-white"
                        : status === "active"
                          ? "border-brand-600"
                          : "border-line"
                    }`}
                  >
                    {status === "done" && <CheckIcon className="h-4 w-4" />}
                    {status === "active" && <span className="h-2 w-2 animate-pulse rounded-full bg-brand-600" />}
                  </span>
                  <span>
                    <span className={status === "pending" ? "text-muted" : "font-semibold"}>
                      {ANALYZE_COPY.steps[step]}
                      {step === "detect" && status !== "pending" && framesLabel}
                    </span>
                    {step === "read" && status === "active" && (
                      <span className="block text-sm text-muted">
                        {ANALYZE_COPY.loadingModel(MEDIAPIPE_ASSETS.downloadSizeMB)}
                        {progress.modelFraction !== null && `・${Math.round(progress.modelFraction * 100)}%`}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>

          <p className="flex items-start gap-2 rounded-xl bg-surface p-4 text-sm">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-sev-mild" />
            <span className="md:hidden">
              <strong>{ANALYZE_COPY.keepOpenMobile}</strong>
              {ANALYZE_COPY.keepOpenMobileDetail}
            </span>
            <span className="hidden md:inline">{ANALYZE_COPY.keepOpenDesktop}</span>
          </p>

          <p className="flex items-start gap-2 text-sm text-muted">
            <LockIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <span>
              <strong className="text-ink">{ANALYZE_COPY.privacyTitle}</strong>
              {ANALYZE_COPY.privacyBody}
            </span>
          </p>

          <section className="rounded-xl border border-line p-4 text-sm" aria-live="polite">
            <h2 className="font-semibold">你知道嗎？</h2>
            <p className="mt-1 text-muted">{WAITING_FACTS[factIndex]}</p>
          </section>

          {confirmingCancel ? (
            <div role="alertdialog" aria-labelledby="cancel-title" className="rounded-xl border border-line p-4">
              <p id="cancel-title" className="font-bold">
                {ANALYZE_COPY.cancelConfirmTitle}
              </p>
              <p className="text-sm text-muted">{ANALYZE_COPY.cancelConfirmBody}</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button type="button" className={buttonClass("primary")} onClick={() => setConfirmingCancel(false)}>
                  {ANALYZE_COPY.cancelConfirmKeep}
                </button>
                <button type="button" className={buttonClass("secondary")} onClick={cancelAnalysis}>
                  {ANALYZE_COPY.cancelConfirmStop}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={buttonClass("ghost")} onClick={() => setConfirmingCancel(true)}>
              {ANALYZE_COPY.cancel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
