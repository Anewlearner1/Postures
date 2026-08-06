/**
 * Left against right for each measured quantity, with the symmetry index beside
 * it.
 *
 * Paired bars rather than a single "asymmetry" bar: the reader needs to see
 * which side is the larger one, which a lone index throws away. Bars share a
 * per-row scale because the rows are different quantities in different units —
 * a shared scale across rows would compare seconds against degrees.
 */

import type { SymmetryEntry } from '../../types/gait';
import { SERIES, SERIES_LABEL, STATUS, STATUS_LABEL, statusForSymmetry } from './tokens';

interface Props {
  entries: SymmetryEntry[];
  overallIndex: number | null;
}

const UNIT_BY_LABEL: Record<string, string> = {
  步長: ' m',
  步態時間: ' s',
  站立期佔比: '%',
  髖關節活動度: '°',
  膝關節活動度: '°',
  踝關節活動度: '°',
  手臂擺動幅度: '°',
};

function formatValue(label: string, value: number): string {
  const unit = UNIT_BY_LABEL[label] ?? '';
  const digits = unit === ' m' || unit === ' s' ? 2 : 1;
  return `${value.toFixed(digits)}${unit}`;
}

export function SymmetryChart({ entries, overallIndex }: Props) {
  if (!entries.length) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-xs text-zinc-400">
        本次未能取得足以比較左右兩側的完整週期
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
            左右對稱性
          </h4>
          <p className="mt-1 text-[10px] text-zinc-400">
            對稱性指數 = |左−右| ÷ 平均 × 100%,數值越低越對稱
          </p>
        </div>
        {overallIndex !== null && (
          <div className="text-right shrink-0">
            <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">
              整體
            </div>
            <div
              className="text-2xl font-black leading-none"
              style={{ color: STATUS[statusForSymmetry(overallIndex)] }}
            >
              {overallIndex}%
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        {(['left', 'right'] as const).map((side) => (
          <span key={side} className="flex items-center gap-1.5 text-[10px] text-zinc-600">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: SERIES[side] }}
            />
            {SERIES_LABEL[side]}
          </span>
        ))}
      </div>

      <div className="space-y-3">
        {entries.map((entry) => {
          const max = Math.max(Math.abs(entry.left), Math.abs(entry.right)) || 1;
          const status = statusForSymmetry(entry.index);
          return (
            <div key={entry.label} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-medium text-zinc-700">{entry.label}</span>
                <span className="flex items-baseline gap-1.5 text-[10px]">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: STATUS[status] }}
                    aria-hidden
                  />
                  <span className="text-zinc-400">{STATUS_LABEL[status]}</span>
                  <span className="font-bold text-zinc-700 tabular-nums">
                    SI {entry.index}%
                  </span>
                </span>
              </div>

              {(['left', 'right'] as const).map((side) => {
                const value = side === 'left' ? entry.left : entry.right;
                const width = (Math.abs(value) / max) * 100;
                return (
                  <div key={side} className="flex items-center gap-2">
                    <span className="w-6 shrink-0 text-[9px] text-zinc-400">
                      {SERIES_LABEL[side]}
                    </span>
                    {/* Track is the surface; the 2px vertical gap between the two
                        bars comes from the row spacing, not from a border. */}
                    <div className="h-2 flex-1 rounded-full bg-zinc-100">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${Math.max(width, 2)}%`,
                          backgroundColor: SERIES[side],
                        }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-[10px] text-zinc-600 tabular-nums">
                      {formatValue(entry.label, value)}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
