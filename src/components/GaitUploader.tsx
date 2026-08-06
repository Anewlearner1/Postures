/**
 * Capture setup: height, the shooting guide, and the video itself.
 *
 * The guide is not decoration. Every metric downstream assumes a fixed camera,
 * a full-body framing and a sagittal view, and the most common way an analysis
 * fails is that the clip never satisfied those assumptions. Height is required
 * because there is no other way to put a scale on a single uncalibrated camera.
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
} from 'lucide-react';
import { motion } from 'motion/react';
import type { AnalysisProgress } from '../services/analyzeGait';

interface Props {
  heightCm: number | null;
  onHeightChange: (v: number | null) => void;
  onAnalyze: (file: File) => void;
  isAnalyzing: boolean;
  progress: AnalysisProgress | null;
  error: string | null;
}

const GUIDE = [
  '手機橫放,固定在腰部高度(可靠牆或請人代持不動)',
  '鏡頭距離行走路線 3–4 公尺,拍攝你的「側面」',
  '在鏡頭前來回走 2 趟,以平常速度自然行走',
  '確認頭到腳全程完整入鏡,不要走出畫面',
  '穿貼身衣物與平常的鞋子,避免寬鬆長褲或長裙',
  '選擇光線充足、地面平整的環境',
];

const MAX_SIZE_MB = 200;

export function GaitUploader({
  heightCm,
  onHeightChange,
  onAnalyze,
  isAnalyzing,
  progress,
  error,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    if (!picked.type.startsWith('video/')) {
      setLocalError('請選擇影片檔案(MP4 或 MOV)。');
      return;
    }
    if (picked.size > MAX_SIZE_MB * 1024 * 1024) {
      setLocalError(`影片檔案超過 ${MAX_SIZE_MB} MB,請改用較短或較低解析度的影片。`);
      return;
    }
    setLocalError(null);
    setFile(picked);
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

      {/* Shooting guide */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 md:p-5 space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-700">
          <Video size={16} />
          拍攝方式
        </h3>
        <ul className="space-y-2">
          {GUIDE.map((line, i) => (
            <li key={i} className="flex items-start gap-2.5 text-xs text-zinc-600">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[9px] font-bold text-zinc-500">
                {i + 1}
              </span>
              {line}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-zinc-400">
          建議長度 8–15 秒。影片全程只在你的裝置上處理,不會上傳到雲端。
        </p>
      </div>

      {/* File */}
      <div
        onClick={() => !isAnalyzing && inputRef.current?.click()}
        className={`rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
          isAnalyzing
            ? 'cursor-not-allowed border-zinc-200 bg-zinc-50'
            : file
              ? 'cursor-pointer border-emerald-500 bg-white'
              : 'cursor-pointer border-zinc-300 bg-zinc-100/50 hover:border-zinc-400'
        }`}
      >
        {file ? (
          <div className="space-y-1">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <Check size={22} />
            </div>
            <p className="pt-2 text-sm font-medium text-zinc-800 break-all">{file.name}</p>
            <p className="text-xs text-zinc-400 tabular-nums">
              {(file.size / 1024 / 1024).toFixed(1)} MB
              {!isAnalyzing && ' · 點擊可更換'}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm">
              <Film className="text-zinc-400" size={22} />
            </div>
            <p className="pt-2 text-sm font-medium text-zinc-600">點擊選擇走路影片</p>
            <p className="text-xs text-zinc-400">支援 MP4 / MOV,上限 {MAX_SIZE_MB} MB</p>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        onChange={handleFile}
        className="hidden"
      />

      <button
        onClick={() => file && onAnalyze(file)}
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
