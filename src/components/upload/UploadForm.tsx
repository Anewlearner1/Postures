"use client";

/**
 * 這個檔案做什麼：
 *   上傳頁的互動部分（UX 文件 §2.3）：
 *   狀態 A：還沒選影片 → 顯示選擇按鈕（電腦可拖放）
 *   選檔後：先檢查格式與大小，再讀取影片長度、解析度、影格率（前置檢查，UX §5.4–§5.7、§5.11），
 *          不通過就直接顯示錯誤畫面，不進入分析
 *   狀態 B：已選影片 → 預覽影片、快速檢查清單、必勾「我已年滿 18 歲」、適用情況（選填）、開始分析
 *
 *   影片只在瀏覽器裡預覽與讀取，不會上傳。
 */

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { GuideTipList } from "@/components/guide/GuideTipList";
import { RetakeView } from "@/components/retake/RetakeView";
import { useAnalysisSession } from "@/components/session/AnalysisSession";
import { ButtonLink, buttonClass } from "@/components/ui/ButtonLink";
import { AlertIcon, InfoIcon, VideoIcon } from "@/components/ui/icons";
import { PrivacyNote } from "@/components/ui/PrivacyNote";
import {
  CHECKING_VIDEO,
  longVideoNotice,
  POPULATION_CHECKS,
  PORTRAIT_NOTICE,
  PREVIOUS_REPORT_COPY,
} from "@/data/analysis-copy";
import type { RetakeCode, RetakeVars } from "@/data/retake-messages";
import { UPLOAD_LIMITS } from "@/data/site";
import { missingCapabilities, readBrowserCapabilities } from "@/lib/pose/browser-support";
import { evaluateVideo } from "@/lib/pose/preflight";
import { readVideoMeta } from "@/lib/pose/read-video-meta";
import { validateVideoFile } from "@/lib/upload/validate-video";

const QUICK_CHECKS = ["從頭到腳都在畫面裡", "是從側面拍的", "有來回走（不是原地踏步）"];

const noSubscribe = () => () => undefined;
/** 瀏覽器缺少分析需要的功能（UX §5.8）。伺服器端產生頁面時一律當作支援。 */
function useBrowserUnsupported(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => missingCapabilities(readBrowserCapabilities()).length > 0,
    () => false,
  );
}

export function UploadForm() {
  const router = useRouter();
  const { video, selectVideo, ageConfirmed, setAgeConfirmed, setPopulationCaveat, completed } = useAnalysisSession();
  // 進到上傳頁時已經有完成的報告：先保留（按返回鍵或頁首「開始分析」不會讓報告消失，M5 QA F-03），
  // 等使用者選了新影片才取代
  const keepPreviousReport = useRef(completed !== null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  // 這一頁選好的影片才顯示「狀態 B」（從其他頁回到上傳頁時，一律從頭開始）
  const [selectedHere, setSelectedHere] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<{ code: RetakeCode; vars?: RetakeVars } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [populationChecks, setPopulationChecks] = useState<boolean[]>(() => POPULATION_CHECKS.items.map(() => false));
  const checkToken = useRef(0);

  const browserUnsupported = useBrowserUnsupported();

  // 進到上傳頁：清掉上一次沒完成的影片（有完成的報告則保留）
  useEffect(() => {
    if (!keepPreviousReport.current) selectVideo(null);
    setPopulationCaveat(false);
  }, [selectVideo, setPopulationCaveat]);

  async function handleFile(selected: File | undefined) {
    if (!selected) return;
    const check = validateVideoFile(selected);
    if (!check.ok) {
      setError({ code: check.code });
      return;
    }
    const token = ++checkToken.current;
    setError(null);
    setChecking(true);
    const read = await readVideoMeta(selected);
    if (token !== checkToken.current) return;
    setChecking(false);
    if (!read.ok) {
      setError({ code: read.code });
      return;
    }
    const verdict = evaluateVideo(read.meta);
    if (!verdict.ok) {
      setError({ code: verdict.code, vars: { durationSec: verdict.durationSec, fps: verdict.fps } });
      return;
    }
    selectVideo({ file: selected, meta: read.meta, plan: verdict.plan });
    setSelectedHere(true);
  }

  function reset() {
    checkToken.current += 1;
    selectVideo(null);
    setSelectedHere(false);
    setChecking(false);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function togglePopulation(index: number, checked: boolean) {
    const next = populationChecks.map((value, i) => (i === index ? checked : value));
    setPopulationChecks(next);
    // 只記「有沒有勾」（D35），勾了哪一項只留在這個畫面上
    setPopulationCaveat(next.some(Boolean));
  }

  function startAnalysis() {
    if (!video || !ageConfirmed) return;
    router.push("/analyze");
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    void handleFile(event.dataTransfer.files[0]);
  }

  // 瀏覽器無法執行分析（UX §5.8）
  if (browserUnsupported) {
    return <RetakeView code="browser_unsupported" />;
  }

  // 錯誤畫面（格式不支援、不是影片、檔案太大、太短、影格率太低）
  if (error) {
    return <RetakeView code={error.code} vars={error.vars} onReselect={reset} />;
  }

  if (checking) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center" role="status">
        <span className="h-10 w-10 animate-spin rounded-full border-4 border-line border-t-brand-600" aria-hidden />
        <p className="text-lg">{CHECKING_VIDEO}</p>
        <PrivacyNote />
      </div>
    );
  }

  // 狀態 B：已選擇影片，確認中
  if (video && selectedHere) {
    const { file, meta, plan } = video;
    return (
      <div>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold sm:text-3xl">確認影片</h1>
          <button type="button" onClick={reset} className={buttonClass("ghost")}>
            重新選擇
          </button>
        </div>

        <div className="mt-6 grid gap-8 md:grid-cols-2 md:items-start">
          <div>
            <video
              src={video.url}
              controls
              playsInline
              muted
              preload="metadata"
              className="max-h-[70vh] w-full rounded-xl bg-black"
              style={{ aspectRatio: `${meta.width} / ${meta.height}` }}
            />
            <p className="mt-2 break-all text-sm text-muted" data-testid="video-summary">
              {file.name}・{Math.round(meta.durationSec)} 秒・{(file.size / 1024 / 1024).toFixed(1)} MB
            </p>
            {meta.height > meta.width && (
              <p
                className="mt-3 flex items-start gap-2 rounded-xl border border-sev-mild bg-amber-50 p-3 text-sm"
                role="note"
                data-testid="portrait-notice"
              >
                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-sev-mild-text" />
                {PORTRAIT_NOTICE}
              </p>
            )}
            {plan.trimmed && (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-sev-mild bg-amber-50 p-3 text-sm" role="note">
                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-sev-mild-text" />
                {longVideoNotice(meta.durationSec)}
              </p>
            )}
          </div>

          <div className="space-y-6">
            <fieldset>
              <legend className="font-semibold">開始前，快速確認一下：</legend>
              <div className="mt-2 space-y-1">
                {QUICK_CHECKS.map((label) => (
                  <label key={label} className="flex min-h-11 items-center gap-3">
                    <input type="checkbox" className="h-5 w-5 accent-brand-600" />
                    {label}
                  </label>
                ))}
              </div>
              <p className="text-sm text-muted">以上不勾也可以，只是提醒。</p>
            </fieldset>

            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-brand-600 bg-brand-50 px-4 py-2 font-semibold">
              <input
                type="checkbox"
                className="h-5 w-5 accent-brand-600"
                checked={ageConfirmed}
                onChange={(event) => setAgeConfirmed(event.target.checked)}
              />
              我已年滿 18 歲（必勾）
            </label>

            {/* 適用情況（D30／D35）：選填，不擋使用 */}
            <fieldset className="rounded-xl bg-surface p-4 text-sm">
              <legend className="sr-only">{POPULATION_CHECKS.title}</legend>
              <p className="flex items-center gap-2 font-semibold" aria-hidden>
                <InfoIcon className="h-4 w-4 shrink-0" />
                {POPULATION_CHECKS.title}
              </p>
              <div className="mt-2 space-y-1">
                {POPULATION_CHECKS.items.map((label, index) => (
                  <label key={label} className="flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-brand-600"
                      checked={populationChecks[index]}
                      onChange={(event) => togglePopulation(index, event.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-muted">{POPULATION_CHECKS.explanation}</p>
              <p className="mt-1 text-muted">{POPULATION_CHECKS.privacy}</p>
            </fieldset>

            <div className="space-y-2">
              <button
                type="button"
                className={buttonClass("primary", "w-full")}
                disabled={!ageConfirmed}
                onClick={startAnalysis}
              >
                開始分析
              </button>
              {!ageConfirmed && (
                <p className="text-sm text-muted">本服務目前只提供年滿 18 歲的使用者使用。</p>
              )}
              <PrivacyNote />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 狀態 A：尚未選擇影片
  return (
    <div>
      <h1 className="text-2xl font-bold sm:text-3xl">選擇一段走路影片</h1>

      {completed && (
        <div className="mt-4 flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>{PREVIOUS_REPORT_COPY.title}</strong>
              {PREVIOUS_REPORT_COPY.body}
            </span>
          </p>
          <ButtonLink href="/report" variant="secondary" className="shrink-0">
            {PREVIOUS_REPORT_COPY.back}
          </ButtonLink>
        </div>
      )}

      <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          {/* 不加 capture 屬性：手機會開啟相簿，而不是直接打開相機（第一版不做錄影）。
              放在大框前面，鍵盤 Tab 到這裡時，大框用 peer-focus 顯示焦點框（M5 QA F-10） */}
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="video/*"
            className="peer sr-only"
            data-testid="video-input"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          {/* 整個框都可以點；電腦也可以把檔案拖進來 */}
          <label
            htmlFor={inputId}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-colors peer-focus:outline-3 peer-focus:outline-offset-2 peer-focus:outline-brand-600 md:py-16 ${
              dragging ? "border-brand-600 bg-brand-50" : "border-line bg-surface hover:border-brand-600"
            }`}
          >
            <VideoIcon className="h-12 w-12 text-brand-600" />
            <span className="hidden text-muted md:block">
              {dragging ? "放開即可選擇這段影片" : "把影片拖到這裡，或"}
            </span>
            <span className={buttonClass("primary")}>
              <span className="md:hidden">選擇影片</span>
              <span className="hidden md:inline">選擇檔案</span>
            </span>
            <span className="text-sm text-muted">
              支援 {UPLOAD_LIMITS.formatLabel}・長度 {UPLOAD_LIMITS.recommendedSeconds} 秒・最大 {UPLOAD_LIMITS.maxSizeMB} MB
            </span>
          </label>
          <PrivacyNote />
          <p className="text-sm">
            還沒拍？
            <ButtonLink href="/guide" variant="ghost">
              看拍攝教學
            </ButtonLink>
          </p>
        </div>

        {/* 電腦版：右側常駐精簡拍攝重點 */}
        <aside className="hidden rounded-2xl border border-line p-5 md:block">
          <h2 className="mb-3 font-semibold">拍攝重點</h2>
          <GuideTipList compact />
        </aside>
      </div>
    </div>
  );
}
