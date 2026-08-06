/**
 * Orchestrates one full gait analysis run.
 *
 * Ordering matters here. Track B has to stay blind to track A, so it is given
 * the sampled frames only; reconciliation runs in plain TypeScript between the
 * two; and only then does the interpretation call get to see everything.
 */

import { extractPoseSequence, type ExtractProgress } from './poseTracker';
import { computeGaitMetrics, reconcileTracks } from './gaitMetrics';
import { interpretGait, observeGaitFrames } from './gemini';
import type { GaitAnalysis, PoseSequence } from '../types/gait';

export type AnalysisStage =
  | 'preparing'
  | 'tracking'
  | 'trackingFrontal'
  | 'measuring'
  | 'observing'
  | 'interpreting'
  | 'done';

export interface AnalysisProgress {
  stage: AnalysisStage;
  message: string;
  /** 0-100, for the progress bar. */
  percent: number;
}

/**
 * Each stage owns a slice of the bar so it advances monotonically. The
 * optional frontal-video pass borrows part of the primary tracking stage's
 * share rather than getting its own fixed budget, so the bar's pacing does
 * not jump depending on whether a second video was supplied.
 */
function buildStageRanges(hasFrontal: boolean): Record<AnalysisStage, [number, number]> {
  return {
    preparing: [0, 5],
    tracking: hasFrontal ? [5, 45] : [5, 60],
    trackingFrontal: hasFrontal ? [45, 60] : [60, 60],
    measuring: [60, 66],
    observing: [66, 82],
    interpreting: [82, 99],
    done: [100, 100],
  };
}

export interface GaitAnalysisResult {
  analysis: GaitAnalysis;
  keyFrames: string[];
}

export async function analyzeGaitVideo(
  file: File,
  heightCm: number,
  onProgress?: (p: AnalysisProgress) => void,
  frontalFile?: File,
): Promise<GaitAnalysisResult> {
  const stageRange = buildStageRanges(!!frontalFile);

  const report = (stage: AnalysisStage, message: string, fraction = 0) => {
    const [lo, hi] = stageRange[stage];
    onProgress?.({
      stage,
      message,
      percent: Math.round(lo + (hi - lo) * Math.min(1, Math.max(0, fraction))),
    });
  };

  report('preparing', '正在載入姿態偵測模型…');

  const sequence = await extractPoseSequence(file, {}, (p: ExtractProgress) => {
    if (p.phase === 'loading-model') {
      report('preparing', '正在載入姿態偵測模型…');
    } else if (p.phase === 'decoding') {
      report('preparing', '正在解碼側面影片…', 1);
    } else if (p.phase === 'detecting') {
      report(
        'tracking',
        `正在逐幀偵測關節點,側面影片(${p.processed} / ${p.total})…`,
        p.total ? p.processed / p.total : 0,
      );
    }
  });

  let frontalSequence: PoseSequence | undefined;
  if (frontalFile) {
    frontalSequence = await extractPoseSequence(frontalFile, {}, (p: ExtractProgress) => {
      if (p.phase === 'decoding') {
        report('trackingFrontal', '正在解碼正面影片…', 0);
      } else if (p.phase === 'detecting') {
        report(
          'trackingFrontal',
          `正在逐幀偵測關節點,正面影片(${p.processed} / ${p.total})…`,
          p.total ? p.processed / p.total : 0,
        );
      }
    });
  }

  report('measuring', '正在計算步態指標…');
  const metrics = computeGaitMetrics(sequence, heightCm, frontalSequence);

  report('observing', '正在進行第二軌獨立影像判讀…');
  const trackB = await observeGaitFrames(sequence.keyFrames);

  report('observing', '正在比對雙軌結果…', 1);
  const reconciliation = reconcileTracks(metrics, trackB);

  report('interpreting', '正在產生臨床解讀報告…');
  const interpretation = await interpretGait(
    metrics,
    trackB,
    reconciliation,
    heightCm,
    sequence.keyFrames,
  );

  report('done', '分析完成', 1);

  return {
    analysis: { metrics, trackB, reconciliation, interpretation, heightCm },
    keyFrames: sequence.keyFrames,
  };
}

/**
 * Strips an analysis down to something safe to write to Firestore.
 *
 * Firestore caps a document at 1 MB and the previous version of this app was
 * already pushing that limit by storing full base64 photos. Per-frame landmarks
 * and raw events are dropped, the joint curves are decimated, and only a few
 * thumbnails are kept.
 */
export function toStorableAnalysis(analysis: GaitAnalysis, keyFrames: string[]) {
  const { metrics } = analysis;

  const thinCurve = (c: { values: number[]; min: number; max: number; rom: number } | null) =>
    c ? { ...c, values: c.values.filter((_, i) => i % 2 === 0) } : null;

  const thinSide = (s: 'left' | 'right') => ({
    ...metrics.kinematics[s],
    hip: thinCurve(metrics.kinematics[s].hip),
    knee: thinCurve(metrics.kinematics[s].knee),
    ankle: thinCurve(metrics.kinematics[s].ankle),
  });

  return {
    analysis: {
      ...analysis,
      metrics: {
        ...metrics,
        // Per-frame detail is only useful during the session that produced it.
        events: [],
        cycles: [],
        kinematics: { left: thinSide('left'), right: thinSide('right') },
      },
    },
    keyFrames: keyFrames.filter((_, i) => i % 5 === 0).slice(0, 3),
  };
}
