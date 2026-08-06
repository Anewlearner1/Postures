/**
 * Joint angle over one normalized gait cycle, left against right.
 *
 * This is the standard way clinical gait data is read: both limbs plotted on
 * 0-100% of the cycle so their shapes can be compared directly. Two series, so
 * a legend is always shown; the crosshair carries per-point values and a table
 * view holds the same numbers for anyone who cannot use hover.
 */

import { useMemo, useRef, useState } from 'react';
import type { CycleCurve } from '../../types/gait';
import { CHROME, SERIES, SERIES_LABEL } from './tokens';

const VB = { w: 340, h: 190 };
const PAD = { top: 12, right: 12, bottom: 26, left: 34 };

const PLOT = {
  x: PAD.left,
  y: PAD.top,
  w: VB.w - PAD.left - PAD.right,
  h: VB.h - PAD.top - PAD.bottom,
};

interface Props {
  title: string;
  unit?: string;
  left: CycleCurve | null;
  right: CycleCurve | null;
  /** Optional vertical reference line, e.g. mean toe-off as a % of the cycle. */
  referencePercent?: number | null;
  referenceLabel?: string;
}

function niceDomain(values: number[]): [number, number] {
  if (!values.length) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const pad = span * 0.12;
  const lo = Math.floor((min - pad) / 10) * 10;
  const hi = Math.ceil((max + pad) / 10) * 10;
  return [lo, hi === lo ? lo + 10 : hi];
}

export function CycleCurveChart({
  title,
  unit = '°',
  left,
  right,
  referencePercent,
  referenceLabel = '離地',
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const series = useMemo(
    () =>
      (
        [
          ['left', left],
          ['right', right],
        ] as const
      ).filter((entry): entry is ['left' | 'right', CycleCurve] => entry[1] !== null),
    [left, right],
  );

  const [lo, hi] = useMemo(
    () => niceDomain(series.flatMap(([, c]) => c.values)),
    [series],
  );

  if (!series.length) {
    return (
      <figure className="rounded-2xl border border-zinc-200 bg-white p-4">
        <figcaption className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
          {title}
        </figcaption>
        <p className="mt-6 mb-6 text-center text-xs text-zinc-400">
          本次未能取得完整步態週期,無法繪製此曲線
        </p>
      </figure>
    );
  }

  const toX = (p: number) => PLOT.x + (PLOT.w * p) / 100;
  const toY = (v: number) => PLOT.y + PLOT.h - (PLOT.h * (v - lo)) / (hi - lo);

  const ticks = [0, 1, 2, 3, 4].map((i) => lo + ((hi - lo) * i) / 4);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vbX = ((e.clientX - rect.left) / rect.width) * VB.w;
    const p = Math.round(((vbX - PLOT.x) / PLOT.w) * 100);
    setHover(p >= 0 && p <= 100 ? p : null);
  };

  return (
    <figure className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <figcaption className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
          {title}
        </figcaption>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="text-[10px] font-semibold text-zinc-400 hover:text-zinc-600 transition-colors shrink-0"
        >
          {showTable ? '顯示圖表' : '數值表格'}
        </button>
      </div>

      {/* Legend is always present for two series, so identity is never color-alone. */}
      <div className="mt-2 flex items-center gap-4">
        {series.map(([side, curve]) => (
          <span key={side} className="flex items-center gap-1.5 text-[10px] text-zinc-600">
            <span
              className="inline-block h-0.5 w-3 rounded-full"
              style={{ backgroundColor: SERIES[side] }}
            />
            {SERIES_LABEL[side]}
            <span className="text-zinc-400">ROM {curve.rom}{unit}</span>
          </span>
        ))}
      </div>

      {showTable ? (
        <div className="mt-3 max-h-56 overflow-y-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="sticky top-0 bg-white">
              <tr className="text-zinc-400 text-left">
                <th className="py-1 font-medium">週期 %</th>
                {series.map(([side]) => (
                  <th key={side} className="py-1 font-medium text-right">
                    {SERIES_LABEL[side]} ({unit})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 11 }, (_, i) => i * 10).map((p) => (
                <tr key={p} className="border-t border-zinc-100">
                  <td className="py-1 text-zinc-500">{p}%</td>
                  {series.map(([side, curve]) => (
                    <td key={side} className="py-1 text-right text-zinc-800">
                      {curve.values[p]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-2">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VB.w} ${VB.h}`}
            className="w-full h-auto"
            role="img"
            aria-label={`${title}:左右側關節角度隨步態週期變化`}
            onMouseMove={handleMove}
            onMouseLeave={() => setHover(null)}
          >
            {/* Recessive hairline grid, solid — never dashed. */}
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PLOT.x}
                  x2={PLOT.x + PLOT.w}
                  y1={toY(t)}
                  y2={toY(t)}
                  stroke={CHROME.gridline}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={PLOT.x - 6}
                  y={toY(t) + 3}
                  textAnchor="end"
                  fontSize={8}
                  fill={CHROME.muted}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {Math.round(t)}
                </text>
              </g>
            ))}

            {/* Zero line gets a touch more weight: it is anatomically meaningful. */}
            {lo < 0 && hi > 0 && (
              <line
                x1={PLOT.x}
                x2={PLOT.x + PLOT.w}
                y1={toY(0)}
                y2={toY(0)}
                stroke={CHROME.baseline}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}

            {referencePercent != null && referencePercent > 0 && referencePercent < 100 && (
              <>
                <line
                  x1={toX(referencePercent)}
                  x2={toX(referencePercent)}
                  y1={PLOT.y}
                  y2={PLOT.y + PLOT.h}
                  stroke={CHROME.baseline}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={toX(referencePercent) + 3}
                  y={PLOT.y + 8}
                  fontSize={7}
                  fill={CHROME.muted}
                >
                  {referenceLabel}
                </text>
              </>
            )}

            {series.map(([side, curve]) => (
              <path
                key={side}
                d={curve.values
                  .map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(v)}`)
                  .join(' ')}
                fill="none"
                stroke={SERIES[side]}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {hover !== null && (
              <>
                <line
                  x1={toX(hover)}
                  x2={toX(hover)}
                  y1={PLOT.y}
                  y2={PLOT.y + PLOT.h}
                  stroke={CHROME.muted}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                {series.map(([side, curve]) => (
                  <g key={side}>
                    {/* 2px surface ring keeps overlapping markers separable. */}
                    <circle
                      cx={toX(hover)}
                      cy={toY(curve.values[hover])}
                      r={4.5}
                      fill={CHROME.surface}
                    />
                    <circle
                      cx={toX(hover)}
                      cy={toY(curve.values[hover])}
                      r={3}
                      fill={SERIES[side]}
                    />
                  </g>
                ))}
              </>
            )}

            <line
              x1={PLOT.x}
              x2={PLOT.x + PLOT.w}
              y1={PLOT.y + PLOT.h}
              y2={PLOT.y + PLOT.h}
              stroke={CHROME.baseline}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {[0, 25, 50, 75, 100].map((p) => (
              <text
                key={p}
                x={toX(p)}
                y={VB.h - 8}
                textAnchor="middle"
                fontSize={8}
                fill={CHROME.muted}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {p}%
              </text>
            ))}
          </svg>

          {hover !== null && (
            <div
              className="pointer-events-none absolute top-1 rounded-lg bg-zinc-900 px-2 py-1.5 text-[10px] text-white shadow-lg"
              style={{
                left: `${(toX(hover) / VB.w) * 100}%`,
                transform: hover > 60 ? 'translateX(-105%)' : 'translateX(5%)',
              }}
            >
              <div className="font-bold tabular-nums">步態週期 {hover}%</div>
              {series.map(([side, curve]) => (
                <div key={side} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: SERIES[side] }}
                  />
                  <span className="text-zinc-300">{SERIES_LABEL[side]}</span>
                  <span className="tabular-nums">
                    {curve.values[hover]}
                    {unit}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
