"use client";

/**
 * 這個檔案做什麼：
 *   上傳頁的互動部分（UX 文件 §2.3）：
 *   狀態 A：還沒選影片 → 顯示選擇按鈕（電腦可拖放）
 *   狀態 B：已選影片 → 預覽影片、快速檢查清單、必勾「我已年滿 18 歲」、適用提醒、開始分析
 *   選檔後先檢查格式與大小，不通過就直接顯示錯誤畫面，不進入分析。
 *
 *   影片只在瀏覽器裡預覽，不會上傳。
 */

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { GuideTipList } from "@/components/guide/GuideTipList";
import { RetakeView } from "@/components/retake/RetakeView";
import { useAnalysisSession } from "@/components/session/AnalysisSession";
import { ButtonLink, buttonClass } from "@/components/ui/ButtonLink";
import { InfoIcon, VideoIcon } from "@/components/ui/icons";
import { PrivacyNote } from "@/components/ui/PrivacyNote";
import { UPLOAD_LIMITS } from "@/data/site";
import { validateVideoFile, type UploadErrorCode } from "@/lib/upload/validate-video";

const QUICK_CHECKS = ["從頭到腳都在畫面裡", "是從側面拍的", "有來回走（不是原地踏步）"];

export function UploadForm() {
  const router = useRouter();
  const { setVideo, ageConfirmed, setAgeConfirmed } = useAnalysisSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [error, setError] = useState<UploadErrorCode | null>(null);
  const [dragging, setDragging] = useState(false);

  // 離開這一頁時，釋放預覽影片佔用的記憶體
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleFile(selected: File | undefined) {
    if (!selected) return;
    const check = validateVideoFile(selected);
    if (!check.ok) {
      setError(check.code);
      return;
    }
    setError(null);
    setFile(selected);
    setDurationSec(null);
    setPreviewUrl(URL.createObjectURL(selected));
  }

  function reset() {
    setFile(null);
    setPreviewUrl(null);
    setDurationSec(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function startAnalysis() {
    if (!file || !ageConfirmed) return;
    setVideo(file);
    router.push("/analyze");
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    handleFile(event.dataTransfer.files[0]);
  }

  // 錯誤畫面（格式不支援、不是影片、檔案太大）
  if (error) {
    return <RetakeView code={error} onReselect={reset} />;
  }

  // 狀態 B：已選擇影片，確認中
  if (file && previewUrl) {
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
              src={previewUrl}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full rounded-xl bg-black"
              onLoadedMetadata={(event) => setDurationSec(event.currentTarget.duration)}
            />
            <p className="mt-2 break-all text-sm text-muted">
              {file.name}
              {durationSec !== null && Number.isFinite(durationSec) && `・${Math.round(durationSec)} 秒`}
              ・{(file.size / 1024 / 1024).toFixed(1)} MB
            </p>
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

            <div className="rounded-xl bg-surface p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <InfoIcon className="h-4 w-4 shrink-0" />
                以下情況，分析結果可能不適用：
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>懷孕中</li>
                <li>有中風、帕金森氏症、周邊神經病變等神經方面的狀況</li>
                <li>走路時正在疼痛，或最近受過傷、開過刀</li>
              </ul>
              <p className="mt-2 text-muted">
                這些情況會改變走路方式，我們的判斷標準不是為此設計的。如有以上情況，建議先諮詢醫師或物理治療師；你仍可以繼續分析，但請把結果當作參考。
              </p>
            </div>

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

      <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          {/* 整個框都可以點；電腦也可以把檔案拖進來 */}
          <label
            htmlFor={inputId}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-colors md:py-16 ${
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
          {/* 不加 capture 屬性：手機會開啟相簿，而不是直接打開相機（第一版不做錄影） */}
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
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
