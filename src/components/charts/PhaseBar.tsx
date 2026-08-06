/**
 * The stance/swing split of one gait cycle, per side.
 *
 * A timeline rather than a pie: the cycle is a sequence, and where toe-off falls
 * along it is the thing being read. The normative 60% marker is drawn so the
 * measured split can be compared against it without doing arithmetic.
 */

import type { SpatiotemporalSide } from '../../types/gait';
import { CHROME, SERIES, SERIES_LABEL } from './tokens';

interface Props {
  left: SpatiotemporalSide;
  right: SpatiotemporalSide;
}

const NORMAL_STANCE = 60;

export function PhaseBar({ left, right }: Props) {
  const rows = (
    [
      ['left', left],
      ['right', right],
    ] as const
  ).filter(([, s]) => s.stancePercent !== null);

  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-xs text-zinc-400">
        未能偵測到可靠的腳尖離地時機,無法計算站立期與擺盪期
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
          步態週期組成
        </h4>
        <span className="text-[10px] text-zinc-400 shrink-0">參考值 站立期 60%</span>
      </div>

      <div className="space-y-3">
        {rows.map(([side, data]) => {
          const stance = data.stancePercent!;
          return (
            <div key={side} className="space-y-1">
              <div className="flex items-baseline justify-between text-[10px]">
                <span className="flex items-center gap-1.5 font-medium text-zinc-700">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ backgroundColor: SERIES[side] }}
                  />
                  {SERIES_LABEL[side]}
                </span>
                <span className="text-zinc-500 tabular-nums">
                  站立期 {stance}% · 擺盪期 {data.swingPercent}%
                </span>
              </div>

              <div className="relative h-5">
                <div className="absolute inset-0 flex">
                  {/* The 2px gap between segments is surface, not a border. */}
                  <div
                    className="h-5 rounded-l-md"
                    style={{
                      width: `calc(${stance}% - 1px)`,
                      backgroundColor: SERIES[side],
                    }}
                  />
                  <div style={{ width: 2 }} />
                  <div
                    className="h-5 rounded-r-md"
                    style={{
                      width: `calc(${100 - stance}% - 1px)`,
                      backgroundColor: SERIES[side],
                      opacity: 0.28,
                    }}
                  />
                </div>
                <div
                  className="absolute top-0 h-5 w-px"
                  style={{ left: `${NORMAL_STANCE}%`, backgroundColor: CHROME.textPrimary }}
                  aria-hidden
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-zinc-400">
        實心為站立期(腳掌著地承重),淡色為擺盪期(腳離地前擺)。細直線為 60% 參考位置。
      </p>
    </div>
  );
}
