/**
 * Read-only view of an analysis from the static-posture version of this app.
 *
 * Those records are still the user's data, so switching the product over to
 * gait analysis archives them rather than deleting them. Nothing here writes;
 * no new records of this shape are ever created.
 */

import { Archive, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import type { PostureHistoryItem } from '../types/gait';

const ALIGNMENT_LABELS: Record<string, string> = {
  head: '頭部',
  shoulders: '肩膀',
  pelvis: '骨盆',
  knees: '膝蓋',
  ankles: '腳踝',
};

const METRIC_LABELS: Record<string, string> = {
  headTiltAngle: '頭部傾斜',
  shoulderLevelDiff: '肩膀高低差',
  pelvicTiltAngle: '骨盆傾斜',
  kneeAlignmentAngle: '膝蓋對齊',
  forwardHeadDistance: '頭部前傾',
};

const SCORE_LABELS: Record<string, string> = {
  symmetry: '對稱性',
  alignment: '排列性',
  balance: '平衡感',
  stability: '穩定性',
};

export function LegacyPostureReport({ item }: { item: PostureHistoryItem }) {
  const a = item.analysis;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      <div className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
        <Archive className="mt-0.5 shrink-0 text-zinc-400" size={18} />
        <div>
          <h3 className="text-xs font-bold text-zinc-700">舊版靜態體態分析記錄</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            這是本應用改版前的照片分析記錄,保留供你查閱,不再產生新的靜態分析。
            現行的動態步態分析採用骨架追蹤實際量測,數據可重現性較高。
          </p>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-4 md:rounded-3xl md:p-6 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">分析結果</h2>
            <p className="mt-0.5 text-[11px] text-zinc-400">{item.date}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                總體評分
              </span>
              <span
                className={`text-3xl font-black leading-none ${
                  (a.score ?? 0) >= 80
                    ? 'text-emerald-600'
                    : (a.score ?? 0) >= 60
                      ? 'text-amber-600'
                      : 'text-red-600'
                }`}
              >
                {a.score ?? '—'}
              </span>
            </div>
            {a.riskLevel && (
              <div
                className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                  a.riskLevel === '低'
                    ? 'bg-emerald-100 text-emerald-700'
                    : a.riskLevel === '中'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-700'
                }`}
              >
                風險 {a.riskLevel}
              </div>
            )}
          </div>
        </div>

        {a.scoreBreakdown && (
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(a.scoreBreakdown).map(([key, value]) => (
              <div key={key} className="space-y-1.5">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  <span>{SCORE_LABELS[key] ?? key}</span>
                  <span className="tabular-nums">{value}/25</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full bg-zinc-400"
                    style={{ width: `${((value as number) / 25) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {a.summary && (
          <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-4">
            <p className="text-sm italic leading-relaxed text-zinc-600">“{a.summary}”</p>
          </div>
        )}

        {a.metrics && (
          <div className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              關鍵指標數據
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(a.metrics).map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-xl border border-zinc-100 bg-white p-2.5 shadow-sm"
                >
                  <p className="text-[9px] font-bold uppercase text-zinc-400">
                    {METRIC_LABELS[key] ?? key}
                  </p>
                  <p className="text-sm font-bold text-zinc-800 tabular-nums">
                    {value}
                    {key.includes('Angle') ? '°' : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {a.alignment && (
          <div className="space-y-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              部位詳細分析
            </h3>
            {Object.entries(a.alignment).map(([key, value]) => (
              <div key={key} className="rounded-xl p-2.5 hover:bg-zinc-50">
                <p className="text-[10px] font-bold uppercase text-zinc-500">
                  {ALIGNMENT_LABELS[key] ?? key}
                </p>
                <p className="text-xs text-zinc-800">{value}</p>
              </div>
            ))}
          </div>
        )}

        {a.recommendations && a.recommendations.length > 0 && (
          <div className="space-y-2 border-t border-zinc-100 pt-4">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              當時的改善建議
            </h3>
            <ul className="space-y-2">
              {a.recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2.5 text-xs text-zinc-700">
                  <CheckCircle2 className="mt-0.5 shrink-0 text-zinc-300" size={14} />
                  {rec}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {(item.frontImage || item.sideImage) && (
        <div className="flex gap-3">
          {[item.frontImage, item.sideImage].filter(Boolean).map((src, i) => (
            <img
              key={i}
              src={src}
              alt={i === 0 ? '正面照片' : '側面照片'}
              className="h-40 w-auto rounded-xl border border-zinc-200"
              referrerPolicy="no-referrer"
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}
