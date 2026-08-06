/**
 * The four score components, each out of 25.
 *
 * Meters rather than a chart: four bounded values against a fixed maximum, read
 * one at a time. Color here means good/bad, so it comes from the status palette
 * and is paired with a written label so it never carries meaning alone.
 */

import type { ScoreBreakdown } from '../../types/gait';
import { STATUS, STATUS_LABEL, statusForScore } from './tokens';

const LABELS: Record<keyof ScoreBreakdown, { title: string; hint: string }> = {
  symmetry: { title: '對稱性', hint: '左右兩側的一致程度' },
  rhythm: { title: '節律性', hint: '步頻與站立/擺盪期的時序' },
  kinematics: { title: '關節活動度', hint: '髖膝踝的活動範圍' },
  stability: { title: '穩定度', hint: '軀幹控制與步伐一致性' },
};

const ORDER: (keyof ScoreBreakdown)[] = ['symmetry', 'rhythm', 'kinematics', 'stability'];

export function ScoreMeters({ breakdown }: { breakdown: ScoreBreakdown }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4">
      {ORDER.map((key) => {
        const value = breakdown[key];
        const percent = (value / 25) * 100;
        const status = statusForScore(percent);
        return (
          <div key={key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">
                {LABELS[key].title}
              </span>
              <span className="text-[10px] font-bold text-zinc-500 tabular-nums">
                {value}/25
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-100">
              <div
                className="h-1.5 rounded-full transition-[width] duration-700 ease-out"
                style={{ width: `${percent}%`, backgroundColor: STATUS[status] }}
              />
            </div>
            <div className="flex items-center justify-between gap-1">
              <span className="text-[9px] text-zinc-400">{LABELS[key].hint}</span>
              <span className="text-[9px] font-semibold text-zinc-500 shrink-0">
                {STATUS_LABEL[status]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
