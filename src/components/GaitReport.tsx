/**
 * The gait report.
 *
 * Ordering is deliberate: measurement confidence sits directly under the score,
 * before any of the findings. A number the pipeline is not sure about should
 * never be read before the reader knows it is uncertain.
 */

import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Info,
  Play,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { GaitAnalysis, GaitMetrics } from '../types/gait';
import { CycleCurveChart } from './charts/CycleCurveChart';
import { PhaseBar } from './charts/PhaseBar';
import { ScoreMeters } from './charts/ScoreMeters';
import { SymmetryChart } from './charts/SymmetryChart';
import { STATUS, statusForScore } from './charts/tokens';

interface Props {
  analysis: GaitAnalysis;
  keyFrames: string[];
  onStartCoach: () => void;
}

const VIEW_LABEL: Record<string, string> = {
  sagittal: '側面',
  frontal: '正面',
  unknown: '無法判定',
};

const CONFIDENCE_STYLE = {
  high: { label: '高信心', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  medium: { label: '中等信心', bg: 'bg-amber-100', text: 'text-amber-700' },
  low: { label: '低信心', bg: 'bg-red-100', text: 'text-red-700' },
} as const;

const SEVERITY_LABEL = { mild: '輕度', moderate: '中度', marked: '明顯' } as const;

function StatTile({
  label,
  value,
  unit,
  reference,
}: {
  label: string;
  value: number | null;
  unit: string;
  reference?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-100 bg-white p-3 shadow-sm">
      <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-zinc-800">
        {value === null ? (
          <span className="text-zinc-300">—</span>
        ) : (
          <>
            {value}
            <span className="ml-0.5 text-xs font-medium text-zinc-400">{unit}</span>
          </>
        )}
      </p>
      {reference && <p className="text-[9px] text-zinc-400">{reference}</p>}
    </div>
  );
}

function meanOrNull(a: number | null, b: number | null): number | null {
  const vals = [a, b].filter((v): v is number => v !== null);
  if (!vals.length) return null;
  return Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 100) / 100;
}

function meanStance(m: GaitMetrics): number | null {
  return meanOrNull(m.left.stancePercent, m.right.stancePercent);
}

export function GaitReport({ analysis, keyFrames, onStartCoach }: Props) {
  const { metrics, trackB, reconciliation, interpretation } = analysis;
  const confidence = CONFIDENCE_STYLE[reconciliation.level];
  const scoreStatus = statusForScore(metrics.score);
  const stance = meanStance(metrics);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Score */}
      <div className="glass-panel rounded-2xl p-4 md:rounded-3xl md:p-6">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 md:text-xl">步態分析結果</h2>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              拍攝視角 {VIEW_LABEL[metrics.quality.view]}
              {metrics.quality.frontalSource === 'supplement' && ' + 正面視角(輔助影片)'}
              {' · '}完整週期 左 {metrics.quality.cyclesLeft} / 右 {metrics.quality.cyclesRight}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 md:gap-3">
            <div className="flex flex-col items-end">
              <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-400 md:text-[10px]">
                總體評分
              </span>
              <span
                className="text-2xl font-black leading-none md:text-3xl"
                style={{ color: STATUS[scoreStatus] }}
              >
                {metrics.score}
              </span>
            </div>
            <div
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider md:px-3 md:py-1 md:text-xs ${
                metrics.riskLevel === '低'
                  ? 'bg-emerald-100 text-emerald-700'
                  : metrics.riskLevel === '中'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-red-100 text-red-700'
              }`}
            >
              風險 {metrics.riskLevel}
            </div>
          </div>
        </div>

        <ScoreMeters breakdown={metrics.scoreBreakdown} />
      </div>

      {/* Measurement confidence — before any finding is read */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
            <Gauge size={14} />
            量測信心度
          </h3>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${confidence.bg} ${confidence.text}`}
          >
            {confidence.label} · {Math.round(reconciliation.confidence * 100)}%
          </span>
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-500">
          本系統以兩條互相獨立的路徑分析同一段影片:骨架追蹤演算法負責計算數值,AI
          影像判讀則獨立觀看影格。兩者結果一致時,數據可信度高;差異過大通常代表關節點追蹤出了問題。
        </p>

        <div className="grid gap-2 sm:grid-cols-3">
          {reconciliation.agreements.map((a) => (
            <div key={a.metric} className="rounded-xl bg-zinc-50 p-2.5">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-medium text-zinc-600">{a.metric}</span>
                {a.agrees === null ? (
                  <span className="text-[9px] text-zinc-400">無法比對</span>
                ) : (
                  <span
                    className={`flex items-center gap-1 text-[9px] font-bold ${
                      a.agrees ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {a.agrees ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                    {a.agrees ? '一致' : '不一致'}
                  </span>
                )}
              </div>
              {a.trackA !== null && (
                <p className="mt-0.5 text-[9px] text-zinc-400 tabular-nums">
                  演算法 {a.trackA}
                  {a.trackB !== null && ` · 影像判讀 ${a.trackB}`}
                  {a.deltaPercent !== null && ` · 差異 ${a.deltaPercent}%`}
                </p>
              )}
            </div>
          ))}
        </div>

        {reconciliation.notes.length > 0 && (
          <ul className="space-y-1">
            {reconciliation.notes.map((note, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-zinc-500">
                · {note}
              </li>
            ))}
          </ul>
        )}

        {reconciliation.recommendsReshoot && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-100 bg-amber-50 p-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={16} />
            <p className="text-[11px] font-medium leading-relaxed text-amber-700">
              本次量測信心度偏低,建議依拍攝指引重新錄製一次。下方數據仍可參考,但請留意可能存在偵測誤差。
            </p>
          </div>
        )}
      </div>

      {/* Quality warnings */}
      {metrics.quality.warnings.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            量測限制
          </h3>
          <ul className="space-y-1.5">
            {metrics.quality.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-500">
                <Info size={12} className="mt-0.5 shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Summary */}
      <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-4">
        <p className="text-sm italic leading-relaxed text-zinc-600">
          “{interpretation.summary}”
        </p>
      </div>

      {/* Spatiotemporal */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400">
          <Activity size={14} />
          時空參數
        </h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <StatTile
            label="步頻"
            value={metrics.cadenceStepsPerMin}
            unit="步/分"
            reference="參考 100–120"
          />
          <StatTile
            label="步行速度"
            value={metrics.walkingSpeedMps}
            unit="m/s"
            reference="參考 1.2–1.4"
          />
          <StatTile
            label="步態週期"
            value={metrics.gaitCycleTimeSec}
            unit="秒"
            reference="參考 1.0–1.2"
          />
          <StatTile
            label="平均步長"
            value={meanOrNull(metrics.left.stepLengthM, metrics.right.stepLengthM)}
            unit="m"
            reference="參考 0.6–0.8"
          />
          <StatTile
            label="雙支撐期"
            value={metrics.doubleSupportPercent}
            unit="%"
            reference="參考 ~20"
          />
          <StatTile
            label="週期變異度"
            value={metrics.strideTimeCvPercent}
            unit="%"
            reference="參考 < 3"
          />
          <StatTile
            label="軀幹前傾"
            value={metrics.trunkLeanDeg}
            unit="°"
            reference={metrics.trunkLeanDeg === null ? '需側面視角' : '參考 ~5'}
          />
          <StatTile
            label="步寬"
            value={metrics.stepWidthM}
            unit="m"
            reference={metrics.stepWidthM === null ? '需正面視角' : '參考 0.08–0.12'}
          />
          <StatTile
            label="骨盆下沉"
            value={metrics.pelvicDropDeg}
            unit="°"
            reference={metrics.pelvicDropDeg === null ? '需正面視角' : '參考 < 5'}
          />
          <StatTile
            label="軀幹側擺"
            value={metrics.trunkSwayDeg}
            unit="°"
            reference={metrics.trunkSwayDeg === null ? '需正面視角' : '參考峰對峰幅度'}
          />
        </div>
        <p className="text-[10px] leading-relaxed text-zinc-400">
          長度類指標由身高({analysis.heightCm} cm)推估校正,單鏡頭下絕對值誤差約
          10–15%,建議以左右對稱性與角度指標為主要判讀依據。
        </p>
      </section>

      {/* Symmetry */}
      <section className="space-y-3">
        <SymmetryChart
          entries={metrics.symmetry}
          overallIndex={metrics.overallSymmetryIndex}
        />
      </section>

      {/* Cycle composition */}
      <PhaseBar left={metrics.left} right={metrics.right} />

      {/* Joint curves */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400">
          <Activity size={14} />
          關節角度曲線
        </h3>
        <div className="grid gap-3 lg:grid-cols-3">
          <CycleCurveChart
            title="髖關節屈伸"
            left={metrics.kinematics.left.hip}
            right={metrics.kinematics.right.hip}
            referencePercent={stance}
          />
          <CycleCurveChart
            title="膝關節屈伸"
            left={metrics.kinematics.left.knee}
            right={metrics.kinematics.right.knee}
            referencePercent={stance}
          />
          <CycleCurveChart
            title="踝關節背屈"
            left={metrics.kinematics.left.ankle}
            right={metrics.kinematics.right.ankle}
            referencePercent={stance}
          />
        </div>
        <p className="text-[10px] text-zinc-400">
          橫軸為一個完整步態週期(0% 為腳跟著地,100% 為同側再次著地)。縱軸為關節角度,正值代表屈曲。
        </p>
      </section>

      {/* Detected patterns */}
      {metrics.patterns.length > 0 && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400">
            <Stethoscope size={14} />
            偵測到的步態樣式
          </h3>
          <div className="space-y-2">
            {metrics.patterns.map((p) => (
              <div
                key={p.key}
                className="rounded-xl border border-zinc-200 bg-white p-3 space-y-1"
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-xs font-bold text-zinc-800">{p.label}</h4>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${
                      p.severity === 'mild'
                        ? 'bg-zinc-100 text-zinc-600'
                        : p.severity === 'moderate'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {SEVERITY_LABEL[p.severity]}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-500">{p.evidence}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* AI findings */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400">
          <Stethoscope size={14} />
          臨床解讀
        </h3>
        <div className="space-y-2">
          {(
            [
              ['時空參數', interpretation.findings.spatiotemporal],
              ['左右對稱性', interpretation.findings.symmetry],
              ['關節運動學', interpretation.findings.kinematics],
              ['姿勢控制', interpretation.findings.posturalControl],
            ] as const
          ).map(([label, text]) => (
            <div key={label} className="rounded-xl border border-zinc-100 bg-white p-3">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                {label}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-zinc-700">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Qualitative observations from track B */}
      {trackB && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400">
            <ShieldCheck size={14} />
            影像質性觀察
          </h3>
          <p className="text-[10px] text-zinc-400">
            以下為骨架追蹤本質上看不到、由 AI 影像判讀補充的資訊。
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['疼痛徵象', trackB.qualitativeNotes.painIndicators],
                ['衣物遮蔽', trackB.qualitativeNotes.clothingOcclusion],
                ['鞋具', trackB.qualitativeNotes.footwear],
                ['環境條件', trackB.qualitativeNotes.environment],
                ['輔具使用', trackB.qualitativeNotes.assistiveDevice],
              ] as const
            ).map(([label, text]) => (
              <div key={label} className="rounded-xl bg-zinc-50 p-3">
                <h4 className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                  {label}
                </h4>
                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-600">{text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Concerns */}
      {interpretation.clinicalConcerns.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">
            值得留意
          </h3>
          <ul className="space-y-2">
            {interpretation.clinicalConcerns.map((c, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 text-xs leading-relaxed text-zinc-700"
              >
                <AlertCircle className="mt-0.5 shrink-0 text-amber-500" size={14} />
                {c}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Recommendations */}
      <section className="space-y-3 border-t border-zinc-100 pt-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">
            改善建議
          </h3>
          {interpretation.exercises.length > 0 && (
            <button
              onClick={onStartCoach}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-[10px] font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 sm:w-auto md:text-xs"
            >
              <Play size={12} fill="currentColor" />
              進入教練模式
            </button>
          )}
        </div>
        <ul className="space-y-2.5">
          {interpretation.recommendations.map((rec, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 text-xs leading-relaxed text-zinc-700 md:text-sm"
            >
              <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-500" size={15} />
              {rec}
            </li>
          ))}
        </ul>
        {interpretation.consistencyComment && (
          <p className="rounded-xl bg-zinc-50 p-3 text-[11px] leading-relaxed text-zinc-500">
            {interpretation.consistencyComment}
          </p>
        )}
      </section>

      {/* Key frames */}
      {keyFrames.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            關鍵影格
          </h3>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {keyFrames.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`步態關鍵影格 ${i + 1}`}
                className="h-24 w-auto shrink-0 rounded-lg border border-zinc-200"
                referrerPolicy="no-referrer"
              />
            ))}
          </div>
        </section>
      )}
    </motion.div>
  );
}
