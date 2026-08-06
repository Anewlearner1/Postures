/**
 * Capture setup: height, the shooting guides, and the video(s) themselves.
 *
 * The guides are not decoration. Every metric downstream assumes a fixed
 * camera and a specific framing, and the most common way an analysis fails is
 * that the clip never satisfied those assumptions. Height is required because
 * there is no other way to put a scale on a single uncalibrated camera.
 *
 * The side-view video is mandatory and drives cadence, step length, joint
 * angle curves and symmetry. The frontal video is optional: without it, step
 * width, pelvic drop (Trendelenburg) and trunk sway simply stay unmeasured —
 * everything else in the report is unaffected.
 */

import { useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Film,
  Info,
  Ruler,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { AnalysisProgress } from '../services/analyzeGait';

interface Props {
  heightCm: number | null;
  onHeightChange: (v: number | null) => void;
  onAnalyze: (file: File, frontalFile?: File) => void;
  isAnalyzing: boolean;
  progress: AnalysisProgress | null;
  error: string | null;
}

const SIDE_GUIDE = [
  '手機橫放,固定在腰部高度(可靠牆或請人代持不動)',
  '鏡頭距離行走路線 3–4 公尺,拍攝你的「側面」',
  '在鏡頭前來回走 2 趟,以平常速度自然行走',
  '確認頭到腳全程完整入鏡,不要走出畫面',
  '穿貼身衣物與平常的鞋子,避免寬鬆長褲或長裙',
  '選擇光線充足、地面平整的環境',
];

const FRONTAL_GUIDE = [
  '面對或背對鏡頭站好,鏡頭同樣固定在腰部高度',
  '距離鏡頭 3–4 公尺,直線走向或走離鏡頭,來回 2 趟',
  '雙肩盡量與鏡頭正對,手臂自然擺動、不要遮擋身體',
];

const MAX_SIZE_MB = 200;

type Slot = 'side' | 'frontal';

function validateVideo(file: File): string | null {
  if (!file.type.startsWith('video/')) return '請選擇影片檔案(MP4 或 MOV)。';
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return `影片檔案超過 ${MAX_SIZE_MB} MB,請改用較短或較低解析度的影片。`;
  }
  return null;
}

interface DropZoneProps {
  file: File | null;
  onPick: (file: File) => void;
  onClear?: () => void;
  disabled: boolean;
  placeholder: string;
}

function VideoDropZone({ file, onPick, onClear, disabled, placeholder }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      className={`relative rounded-2xl border-2 border-dashed p-5 text-center transition-all ${
        disabled
          ? 'cursor-not-allowed border-zinc-200 bg-zinc-50'
          : file
            ? 'cursor-pointer border-emerald-500 bg-white'
            : 'cursor-pointer border-zinc-300 bg-zinc-100/50 hover:border-zinc-400'
      }`}
    >
      {file ? (
        <div className="space-y-1">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <Check size={18} />
          </div>
          <p className="pt-1 text-sm font-medium text-zinc-800 break-all">{file.name}</p>
          <p className="text-xs text-zinc-400 tabular-nums">
            {(file.size / 1024 / 1024).toFixed(1)} MB
            {!disabled && ' · 點擊可更換'}
          </p>
          {onClear && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              className="absolute right-2 top-2 rounded-full p-1.5 text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-red-500"
              aria-label="移除這段影片"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
            <Film className="text-zinc-400" size={18} />
          </div>
          <p className="pt-1 text-sm font-medium text-zinc-600">{placeholder}</p>
          <p className="text-xs text-zinc-400">支援 MP4 / MOV,上限 {MAX_SIZE_MB} MB</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = '';
          if (picked) onPick(picked);
        }}
        className="hidden"
      />
    </div>
  );
}

export function GaitUploader({
  heightCm,
  onHeightChange,
  onAnalyze,
  isAnalyzing,
  progress,
  error,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [frontalFile, setFrontalFile] = useState<File | null>(null);
  const [showFrontal, setShowFrontal] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handlePick = (slot: Slot) => (picked: File) => {
    const problem = validateVideo(picked);
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError(null);
    if (slot === 'side') setFile(picked);
    else setFrontalFile(picked);
  };

  const heightValid = heightCm !== null && heightCm >= 100 && heightCm <= 230;
  const canAnalyze = !!file && heightValid && !isAnalyzing;

  return (
    <div className="space-y-5">
      {/* Height */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 md:p-5 space-y-3">
        <label
          htmlFor="height"
          className="flex items-center gap-2 text-sm font-medium text-zinc-700"
        >
          <Ruler size={16} />
          身高
          <span className="text-red-500">*</span>
        </label>
        <div className="flex items-center gap-3">
          <input
            id="height"
            type="number"
            inputMode="numeric"
            min={100}
            max={230}
            value={heightCm ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onHeightChange(v === '' ? null : Number(v));
            }}
            placeholder="170"
            className="w-28 rounded-xl border border-zinc-200 px-3 py-2 text-sm tabular-nums outline-none focus:border-zinc-900 transition-colors"
          />
          <span className="text-sm text-zinc-500">公分</span>
        </div>
        <p className="flex items-start gap-2 text-[11px] text-zinc-400">
          <Info size={13} className="mt-0.5 shrink-0" />
          單一鏡頭無法自行判斷實際尺度。步長、步幅與步行速度都需要用身高換算,沒有身高就只能得到比例值。
        </p>
        {heightCm !== null && !heightValid && (
          <p className="text-[11px] text-red-500">請輸入 100 至 230 公分之間的身高。</p>
        )}
      </div>

      {/* Side-view video (required) */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 md:p-5 space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-700">
          <Video size={16} />
          側面走路影片
          <span className="text-red-500">*</span>
        </h3>
        <ul className="space-y-2">
          {SIDE_GUIDE.map((line, i) => (
            <li key={i} className="flex items-start gap-2.5 text-xs text-zinc-600">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[9px] font-bold text-zinc-500">
                {i + 1}
              </span>
              {line}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-zinc-400">
          建議長度 8–15 秒。步頻、步長、關節活動度與左右對稱性都由這段影片算出。
        </p>
        <VideoDropZone
          file={file}
          onPick={handlePick('side')}
          disabled={isAnalyzing}
          placeholder="點擊選擇側面走路影片"
        />
      </div>

      {/* Frontal-view video (optional) */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 md:p-5 space-y-3">
        <button
          type="button"
          onClick={() => setShowFrontal((v) => !v)}
          disabled={isAnalyzing}
          className="flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed"
        >
          <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <Video size={16} />
            正面視角影片
            <span className="text-[10px] font-normal text-zinc-400">(選填)</span>
          </h3>
          <span className="text-xs font-semibold text-emerald-600">
            {showFrontal ? '收合' : frontalFile ? '已加入' : '新增'}
          </span>
        </button>

        {!showFrontal && (
          <p className="text-[11px] text-zinc-400">
            另外上傳一段面對鏡頭走路的影片,可解鎖步寬、骨盆下沉(Trendelenburg)與軀幹側擺這三項指標。不加也能完成分析。
          </p>
        )}

        {showFrontal && (
          <>
            <ul className="space-y-2">
              {FRONTAL_GUIDE.map((line, i) => (
                <li key={i} className="flex items-start gap-2.5 text-xs text-zinc-600">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[9px] font-bold text-zinc-500">
                    {i + 1}
                  </span>
                  {line}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-zinc-400">
              只用來計算步寬、骨盆下沉與軀幹側擺,不影響步頻、步長等其餘指標。
            </p>
            <VideoDropZone
              file={frontalFile}
              onPick={handlePick('frontal')}
              onClear={() => setFrontalFile(null)}
              disabled={isAnalyzing}
              placeholder="點擊選擇正面走路影片"
            />
          </>
        )}
      </div>

      <button
        onClick={() => file && onAnalyze(file, frontalFile ?? undefined)}
        disabled={!canAnalyze}
        className={`flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition-all md:text-base ${
          canAnalyze
            ? 'bg-zinc-900 text-white shadow-lg shadow-zinc-200 hover:bg-zinc-800 active:scale-[0.98]'
            : 'cursor-not-allowed bg-zinc-200 text-zinc-400'
        }`}
      >
        <Upload size={18} />
        {isAnalyzing ? '分析中…' : '開始步態分析'}
      </button>

      {isAnalyzing && progress && (
        <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-zinc-700">{progress.message}</span>
            <span className="text-xs font-bold text-zinc-500 tabular-nums">
              {progress.percent}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
            <motion.div
              className="h-1.5 rounded-full bg-zinc-900"
              animate={{ width: `${progress.percent}%` }}
              transition={{ ease: 'easeOut', duration: 0.4 }}
            />
          </div>
          <p className="text-[11px] text-zinc-400">
            關節點偵測在你的裝置上執行,請保持此分頁開啟。
          </p>
        </div>
      )}

      {(error || localError) && (
        <div className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 p-4 text-red-600">
          <AlertCircle className="mt-0.5 shrink-0" size={18} />
          <p className="text-sm font-medium">{error || localError}</p>
        </div>
      )}
    </div>
  );
}
