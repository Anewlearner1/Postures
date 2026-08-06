/**
 * Track A, stage 2: pose landmarks -> gait metrics.
 *
 * Every function in this file is pure. No AI, no network, no DOM. Given the
 * same landmark sequence it returns the same numbers, which is the whole point
 * of splitting this away from the model: these values can be reasoned about and
 * tested, and the language model downstream only gets to interpret them.
 *
 * Conventions inherited from MediaPipe:
 *   - `world` coordinates are meters, origin at the hip midpoint, camera
 *     aligned: +x is image-right, +y is image-DOWN, +z is toward the camera.
 *   - `landmarks` are normalized image coordinates in [0, 1] and are the only
 *     thing that still carries the subject's global translation across frame.
 */

import { LM } from './landmarks';
import type {
  CameraView,
  CycleCurve,
  DetectedPattern,
  GaitCycle,
  GaitEvent,
  GaitMetrics,
  GaitQuality,
  PoseFrame,
  PoseSequence,
  Point3,
  RiskLevel,
  ScoreBreakdown,
  Side,
  SideKinematics,
  SpatiotemporalSide,
  SymmetryEntry,
  TrackAgreement,
  TrackBObservation,
  TrackReconciliation,
} from '../types/gait';

// --- Normative reference values -------------------------------------------
// Adult comfortable-speed overground walking. Used only for scoring and for
// flagging patterns, never to alter a measured value.

const NORM = {
  cadence: 110,          // steps/min
  cadenceTolerance: 40,
  stancePercent: 60,
  kneeRom: 60,           // degrees
  hipRom: 40,
  ankleRom: 25,
  peakKneeFlexionSwing: 60,
  trunkLean: 5,
  strideTimeCv: 3,       // percent
} as const;

/**
 * Nose-to-ankle vertical span as a fraction of stature.
 * Nose height ~0.930 x stature, lateral malleolus ~0.039 x stature.
 */
const NOSE_TO_ANKLE_RATIO = 0.891;

// --- Small numeric helpers -------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

function round(v: number | null, digits = 1): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Symmetry index: 0 means identical sides, higher is more asymmetric. */
function symmetryIndex(left: number, right: number): number {
  const denom = 0.5 * (Math.abs(left) + Math.abs(right));
  if (denom < 1e-6) return 0;
  return (Math.abs(left - right) / denom) * 100;
}

/** Angle at vertex `b` formed by a-b-c, in degrees. */
function angleAt(a: Point3, b: Point3, c: Point3): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const n1 = Math.hypot(v1.x, v1.y, v1.z);
  const n2 = Math.hypot(v2.x, v2.y, v2.z);
  if (n1 < 1e-9 || n2 < 1e-9) return NaN;
  const cos = clamp((v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (n1 * n2), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

const midpoint = (a: Point3, b: Point3): Point3 => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: (a.z + b.z) / 2,
  visibility: Math.min(a.visibility, b.visibility),
});

/** Centered moving average over an index-aligned series. */
function smooth(values: number[], window: number): number[] {
  if (window < 3) return [...values];
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      if (Number.isFinite(values[j])) {
        sum += values[j];
        n++;
      }
    }
    return n ? sum / n : values[i];
  });
}

/**
 * Local maxima with a minimum spacing and a prominence floor.
 *
 * Greedy by descending amplitude, so when two candidates sit closer than
 * `minDistance` the stronger one wins. Both constraints matter: spacing rejects
 * the double-bump around contact, prominence rejects tracker jitter.
 */
function findPeaks(signal: number[], minDistance: number, prominenceRatio = 0.15): number[] {
  const n = signal.length;
  if (n < 3) return [];

  const finite = signal.filter(Number.isFinite);
  if (!finite.length) return [];
  const range = Math.max(...finite) - Math.min(...finite);
  const minProminence = range * prominenceRatio;

  const candidates: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (!Number.isFinite(signal[i])) continue;
    if (signal[i] >= signal[i - 1] && signal[i] >= signal[i + 1]) {
      const lo = Math.max(0, i - Math.round(minDistance));
      const hi = Math.min(n - 1, i + Math.round(minDistance));
      let localMin = Infinity;
      for (let j = lo; j <= hi; j++) {
        if (Number.isFinite(signal[j])) localMin = Math.min(localMin, signal[j]);
      }
      if (signal[i] - localMin >= minProminence) candidates.push(i);
    }
  }

  candidates.sort((a, b) => signal[b] - signal[a]);
  const accepted: number[] = [];
  for (const c of candidates) {
    if (accepted.every((a) => Math.abs(a - c) >= minDistance)) accepted.push(c);
  }
  return accepted.sort((a, b) => a - b);
}

const findValleys = (signal: number[], minDistance: number, prominenceRatio = 0.15) =>
  findPeaks(signal.map((v) => -v), minDistance, prominenceRatio);

/** Linear interpolation of a (t, value) series at an arbitrary time. */
function sampleAt(ts: number[], vals: number[], t: number): number | null {
  if (!ts.length) return null;
  if (t <= ts[0]) return Number.isFinite(vals[0]) ? vals[0] : null;
  if (t >= ts[ts.length - 1]) {
    const last = vals[vals.length - 1];
    return Number.isFinite(last) ? last : null;
  }
  let lo = 0;
  let hi = ts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  const a = vals[lo];
  const b = vals[hi];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const span = ts[hi] - ts[lo];
  if (span < 1e-9) return a;
  return a + ((b - a) * (t - ts[lo])) / span;
}

// --- Walking bouts ---------------------------------------------------------

interface Bout {
  start: number;
  end: number;
  /** +1 when the subject moves toward image-right, -1 toward image-left. */
  sign: 1 | -1;
}

/**
 * Splits the clip into stretches of consistent travel direction.
 *
 * The shooting guide asks for two passes, so the subject turns around mid-clip.
 * A turn violates every assumption the event detector makes, so those frames
 * are dropped rather than analyzed.
 */
function findBouts(frames: PoseFrame[], fps: number): Bout[] {
  const hipX = frames.map((f) =>
    midpoint(f.landmarks[LM.leftHip], f.landmarks[LM.rightHip]).x,
  );
  const sm = smooth(hipX, Math.max(3, Math.round(fps * 0.4)));

  const vel = sm.map((_, i) => {
    const a = sm[Math.max(0, i - 1)];
    const b = sm[Math.min(sm.length - 1, i + 1)];
    return b - a;
  });

  const magnitudes = vel.map(Math.abs).sort((a, b) => a - b);
  const p75 = magnitudes[Math.floor(magnitudes.length * 0.75)] ?? 0;
  const eps = Math.max(p75 * 0.25, 1e-4);

  const signs = vel.map((v) => (v > eps ? 1 : v < -eps ? -1 : 0));

  const bouts: Bout[] = [];
  let start = 0;
  for (let i = 1; i <= signs.length; i++) {
    if (i === signs.length || signs[i] !== signs[start]) {
      const sign = signs[start];
      const durationSec = frames[i - 1].t - frames[start].t;
      if (sign !== 0 && durationSec >= 1.2) {
        bouts.push({ start, end: i - 1, sign: sign as 1 | -1 });
      }
      start = i;
    }
  }

  if (!bouts.length && frames.length > 2) {
    // Walking in place, or a camera that pans with the subject. Zeni still
    // works on the pelvis-relative signal; only the direction is a guess.
    const drift = hipX[hipX.length - 1] - hipX[0];
    bouts.push({ start: 0, end: frames.length - 1, sign: drift >= 0 ? 1 : -1 });
  }

  return bouts;
}

// --- Camera view -----------------------------------------------------------

/**
 * Sagittal versus frontal, from how the shoulders separate.
 *
 * In a side view the shoulders are separated almost entirely in depth; face on,
 * almost entirely across the image. The ratio between the two is scale free,
 * so it needs no calibration.
 */
function detectView(frames: PoseFrame[]): { view: CameraView; frontalness: number } {
  const dx: number[] = [];
  const dz: number[] = [];
  for (const f of frames) {
    const ls = f.world[LM.leftShoulder];
    const rs = f.world[LM.rightShoulder];
    const lh = f.world[LM.leftHip];
    const rh = f.world[LM.rightHip];
    dx.push((Math.abs(ls.x - rs.x) + Math.abs(lh.x - rh.x)) / 2);
    dz.push((Math.abs(ls.z - rs.z) + Math.abs(lh.z - rh.z)) / 2);
  }
  const mx = median(dx) ?? 0;
  const mz = median(dz) ?? 0;
  const total = mx + mz;
  const frontalness = total < 1e-6 ? 0.5 : mx / total;

  let view: CameraView = 'unknown';
  if (frontalness > 0.62) view = 'frontal';
  else if (frontalness < 0.42) view = 'sagittal';
  return { view, frontalness };
}

// --- Scale calibration -----------------------------------------------------

/**
 * MediaPipe's world landmarks are already metric, but for an average build.
 * Rescaling against the user's real stature removes most of that bias, and a
 * factor far from 1 is a strong hint that the landmarks themselves are wrong.
 */
function computeScaleFactor(frames: PoseFrame[], heightCm: number): number {
  const statures: number[] = [];
  for (const f of frames) {
    const ankleMid = midpoint(f.world[LM.leftAnkle], f.world[LM.rightAnkle]);
    const nose = f.world[LM.nose];
    const span = ankleMid.y - nose.y; // +y points down, so ankle sits below nose
    if (span > 0.5) statures.push(span / NOSE_TO_ANKLE_RATIO);
  }
  const implied = median(statures);
  if (!implied || implied < 0.5) return 1;
  return heightCm / 100 / implied;
}

// --- Gait events -----------------------------------------------------------

/**
 * Zeni et al. (2008) coordinate method.
 *
 * Heel strike is where the heel reaches its furthest point ahead of the pelvis;
 * toe off is where the toe reaches its furthest point behind it. Because the
 * world frame is already pelvis-centered, the subject's travel across the image
 * cancels out and no camera calibration is required.
 */
function detectEvents(
  frames: PoseFrame[],
  fps: number,
  bouts: Bout[],
): GaitEvent[] {
  const events: GaitEvent[] = [];
  const minStrideFrames = Math.max(3, Math.round(fps * 0.6));

  const sides: { side: Side; heel: number; toe: number }[] = [
    { side: 'left', heel: LM.leftHeel, toe: LM.leftFootIndex },
    { side: 'right', heel: LM.rightHeel, toe: LM.rightFootIndex },
  ];

  for (const bout of bouts) {
    const slice = frames.slice(bout.start, bout.end + 1);
    if (slice.length < minStrideFrames * 2) continue;

    for (const { side, heel, toe } of sides) {
      const heelFwd = smooth(
        slice.map((f) => f.world[heel].x * bout.sign),
        Math.max(3, Math.round(fps * 0.12)),
      );
      const toeFwd = smooth(
        slice.map((f) => f.world[toe].x * bout.sign),
        Math.max(3, Math.round(fps * 0.12)),
      );

      for (const i of findPeaks(heelFwd, minStrideFrames)) {
        events.push({
          side,
          type: 'heelStrike',
          t: slice[i].t,
          frameIndex: bout.start + i,
        });
      }
      for (const i of findValleys(toeFwd, minStrideFrames)) {
        events.push({
          side,
          type: 'toeOff',
          t: slice[i].t,
          frameIndex: bout.start + i,
        });
      }
    }
  }

  return events.sort((a, b) => a.t - b.t);
}

function buildCycles(events: GaitEvent[], bouts: Bout[]): GaitCycle[] {
  const cycles: GaitCycle[] = [];

  const withinSameBout = (a: GaitEvent, b: GaitEvent) =>
    bouts.some(
      (bt) =>
        a.frameIndex >= bt.start &&
        a.frameIndex <= bt.end &&
        b.frameIndex >= bt.start &&
        b.frameIndex <= bt.end,
    );

  for (const side of ['left', 'right'] as Side[]) {
    const strikes = events.filter((e) => e.side === side && e.type === 'heelStrike');
    const toeOffs = events.filter((e) => e.side === side && e.type === 'toeOff');

    for (let i = 0; i < strikes.length - 1; i++) {
      const a = strikes[i];
      const b = strikes[i + 1];
      const duration = b.t - a.t;
      // Reject anything outside plausible stride durations; those come from a
      // missed event or from frames spanning a turn.
      if (duration < 0.6 || duration > 2.0) continue;
      if (!withinSameBout(a, b)) continue;

      const toeOff = toeOffs.find((e) => e.t > a.t && e.t < b.t);
      const stancePercent = toeOff ? ((toeOff.t - a.t) / duration) * 100 : null;

      cycles.push({
        side,
        startT: a.t,
        endT: b.t,
        toeOffT: toeOff?.t ?? null,
        durationSec: duration,
        // A stance phase outside 40-85% means the toe-off was misdetected.
        stancePercent:
          stancePercent !== null && stancePercent > 40 && stancePercent < 85
            ? stancePercent
            : null,
      });
    }
  }

  return cycles.sort((a, b) => a.startT - b.startT);
}

// --- Joint angle series ----------------------------------------------------

interface AngleSeries {
  t: number[];
  hip: { left: number[]; right: number[] };
  knee: { left: number[]; right: number[] };
  ankle: { left: number[]; right: number[] };
  arm: { left: number[]; right: number[] };
  trunkLean: number[];
  trunkSway: number[];
  pelvicObliquity: number[];
}

function computeAngleSeries(frames: PoseFrame[], boutSignAt: (i: number) => number): AngleSeries {
  const series: AngleSeries = {
    t: [],
    hip: { left: [], right: [] },
    knee: { left: [], right: [] },
    ankle: { left: [], right: [] },
    arm: { left: [], right: [] },
    trunkLean: [],
    trunkSway: [],
    pelvicObliquity: [],
  };

  frames.forEach((f, i) => {
    const w = f.world;
    const sign = boutSignAt(i) || 1;
    const shoulderMid = midpoint(w[LM.leftShoulder], w[LM.rightShoulder]);
    const hipMid = midpoint(w[LM.leftHip], w[LM.rightHip]);

    series.t.push(f.t);

    const joints = {
      left: {
        hip: w[LM.leftHip], knee: w[LM.leftKnee], ankle: w[LM.leftAnkle],
        toe: w[LM.leftFootIndex], shoulder: w[LM.leftShoulder], wrist: w[LM.leftWrist],
      },
      right: {
        hip: w[LM.rightHip], knee: w[LM.rightKnee], ankle: w[LM.rightAnkle],
        toe: w[LM.rightFootIndex], shoulder: w[LM.rightShoulder], wrist: w[LM.rightWrist],
      },
    };

    for (const side of ['left', 'right'] as Side[]) {
      const j = joints[side];
      // Flexion is the deviation from a fully extended segment chain, so each
      // of these is 180 (or 90 at the ankle) minus the interior angle.
      series.knee[side].push(180 - angleAt(j.hip, j.knee, j.ankle));
      series.hip[side].push(180 - angleAt(shoulderMid, j.hip, j.knee));
      series.ankle[side].push(90 - angleAt(j.knee, j.ankle, j.toe));

      // Arm swing as shoulder flex/extend: 0 is hanging straight down,
      // positive is swinging forward along the direction of travel.
      const fwd = (j.wrist.x - j.shoulder.x) * sign;
      const down = j.wrist.y - j.shoulder.y;
      series.arm[side].push((Math.atan2(fwd, down) * 180) / Math.PI);
    }

    const up = -(shoulderMid.y - hipMid.y);
    const acrossImage = shoulderMid.x - hipMid.x;
    // In a sagittal view the image-horizontal axis is anterior-posterior; face
    // on it is mediolateral. The same measurement means different things, so
    // both are recorded and only the meaningful one is reported later.
    series.trunkLean.push((Math.atan2(acrossImage * sign, up) * 180) / Math.PI);
    series.trunkSway.push((Math.atan2(acrossImage, up) * 180) / Math.PI);

    const hipL = w[LM.leftHip];
    const hipR = w[LM.rightHip];
    series.pelvicObliquity.push(
      (Math.atan2(-(hipR.y - hipL.y), hipR.x - hipL.x) * 180) / Math.PI,
    );
  });

  return series;
}

/** Resamples one cycle's worth of an angle series onto 0-100% in 101 steps. */
function resampleCycle(
  ts: number[],
  vals: number[],
  startT: number,
  endT: number,
): number[] | null {
  const out: number[] = [];
  for (let p = 0; p <= 100; p++) {
    const v = sampleAt(ts, vals, startT + ((endT - startT) * p) / 100);
    if (v === null || !Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}

/** Averages the per-cycle curves for one joint into a single mean curve. */
function averageCurves(curves: number[][]): CycleCurve | null {
  if (!curves.length) return null;
  const values: number[] = [];
  for (let p = 0; p <= 100; p++) {
    values.push(curves.reduce((sum, c) => sum + c[p], 0) / curves.length);
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    values: values.map((v) => Math.round(v * 10) / 10),
    min: round(min)!,
    max: round(max)!,
    rom: round(max - min)!,
  };
}

function buildSideKinematics(
  side: Side,
  cycles: GaitCycle[],
  series: AngleSeries,
): SideKinematics {
  const own = cycles.filter((c) => c.side === side);

  const collect = (vals: number[]) => {
    const curves: number[][] = [];
    for (const c of own) {
      const r = resampleCycle(series.t, vals, c.startT, c.endT);
      if (r) curves.push(r);
    }
    return averageCurves(curves);
  };

  const hip = collect(series.hip[side]);
  const knee = collect(series.knee[side]);
  const ankle = collect(series.ankle[side]);
  const arm = collect(series.arm[side]);

  // Swing runs from roughly toe-off to the next contact. 55% is used rather
  // than a per-cycle toe-off so the window stays defined when toe-off was
  // never resolved.
  const peakKneeFlexionSwing = knee
    ? round(Math.max(...knee.values.slice(55)))
    : null;

  return {
    hip,
    knee,
    ankle,
    peakKneeFlexionSwing,
    kneeFlexionAtContact: knee ? round(knee.values[0]) : null,
    armSwingRom: arm ? arm.rom : null,
  };
}

// --- Spatiotemporal --------------------------------------------------------

interface StepMeasurement {
  side: Side;
  timeSec: number;
  lengthM: number | null;
}

/**
 * A step runs from the contralateral heel strike to the ipsilateral one, and
 * its length is the fore-aft gap between the feet at the instant of contact.
 * Measuring in the pelvis-centered frame keeps this independent of how far the
 * subject has travelled across the image.
 */
function measureSteps(
  events: GaitEvent[],
  frames: PoseFrame[],
  boutSignAt: (i: number) => number,
  scale: number,
): StepMeasurement[] {
  const strikes = events.filter((e) => e.type === 'heelStrike');
  const steps: StepMeasurement[] = [];

  for (let i = 1; i < strikes.length; i++) {
    const prev = strikes[i - 1];
    const cur = strikes[i];
    if (prev.side === cur.side) continue;

    const timeSec = cur.t - prev.t;
    if (timeSec < 0.25 || timeSec > 1.2) continue;

    const frame = frames[cur.frameIndex];
    let lengthM: number | null = null;
    if (frame) {
      const sign = boutSignAt(cur.frameIndex) || 1;
      const leading = cur.side === 'left' ? LM.leftHeel : LM.rightHeel;
      const trailing = cur.side === 'left' ? LM.rightHeel : LM.leftHeel;
      const gap =
        (frame.world[leading].x - frame.world[trailing].x) * sign * scale;
      if (gap > 0.15 && gap < 1.4) lengthM = gap;
    }

    steps.push({ side: cur.side, timeSec, lengthM });
  }

  return steps;
}

/** Fraction of analyzed time with both feet on the ground. */
function computeDoubleSupport(
  frames: PoseFrame[],
  events: GaitEvent[],
  bouts: Bout[],
): number | null {
  const inBout = (i: number) => bouts.some((b) => i >= b.start && i <= b.end);

  const stanceAt = (side: Side, t: number): boolean | null => {
    const own = events.filter((e) => e.side === side && e.t <= t);
    if (!own.length) return null;
    return own[own.length - 1].type === 'heelStrike';
  };

  let both = 0;
  let counted = 0;
  frames.forEach((f, i) => {
    if (!inBout(i)) return;
    const l = stanceAt('left', f.t);
    const r = stanceAt('right', f.t);
    if (l === null || r === null) return;
    counted++;
    if (l && r) both++;
  });

  return counted > 0 ? (both / counted) * 100 : null;
}

// --- Pattern detection -----------------------------------------------------

function detectPatterns(m: {
  cadence: number | null;
  left: SpatiotemporalSide;
  right: SpatiotemporalSide;
  kinematics: { left: SideKinematics; right: SideKinematics };
  pelvicDropDeg: number | null;
  strideTimeCvPercent: number | null;
  symmetry: SymmetryEntry[];
  view: CameraView;
}): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const grade = (v: number, mild: number, moderate: number) =>
    v >= moderate * 1.6 ? 'marked' : v >= moderate ? 'moderate' : ('mild' as const);

  // Antalgic gait: the painful side spends less time bearing weight.
  const sl = m.left.stancePercent;
  const sr = m.right.stancePercent;
  if (sl !== null && sr !== null) {
    const diff = Math.abs(sl - sr);
    if (diff >= 3) {
      const shortSide = sl < sr ? '左' : '右';
      patterns.push({
        key: 'antalgic',
        label: '疼痛跛行傾向 (Antalgic gait)',
        evidence: `${shortSide}側站立期 ${round(Math.min(sl, sr))}% 明顯短於對側 ${round(Math.max(sl, sr))}%,差距 ${round(diff)} 個百分點。`,
        severity: grade(diff, 3, 6),
      });
    }
  }

  for (const side of ['left', 'right'] as Side[]) {
    const k = m.kinematics[side];
    const label = side === 'left' ? '左' : '右';

    if (k.peakKneeFlexionSwing !== null && k.peakKneeFlexionSwing < 50) {
      patterns.push({
        key: `stiff-knee-${side}`,
        label: `${label}側擺盪期膝屈曲不足 (Stiff-knee gait)`,
        evidence: `擺盪期最大膝屈曲僅 ${k.peakKneeFlexionSwing}°,低於參考值 ${NORM.peakKneeFlexionSwing}°。可能伴隨代償性髖上提或環行步。`,
        severity: grade(50 - k.peakKneeFlexionSwing, 5, 12),
      });
    }

    if (k.ankle && k.ankle.rom < 15) {
      patterns.push({
        key: `ankle-rom-${side}`,
        label: `${label}側踝關節活動度受限`,
        evidence: `踝關節 ROM 僅 ${k.ankle.rom}°,低於參考值 ${NORM.ankleRom}°。踝背屈不足常見於垂足或小腿後側緊繃。`,
        severity: grade(15 - k.ankle.rom, 3, 7),
      });
    }

    if (k.knee && k.knee.values.slice(0, 55).some((v) => v < -5)) {
      const minStance = Math.min(...k.knee.values.slice(0, 55));
      patterns.push({
        key: `recurvatum-${side}`,
        label: `${label}側膝過度伸直 (Genu recurvatum)`,
        evidence: `站立期膝角度最低達 ${round(minStance)}°,呈現過度伸直。`,
        severity: grade(Math.abs(minStance), 5, 10),
      });
    }
  }

  const meanStepLength = mean(
    [m.left.stepLengthM, m.right.stepLengthM].filter((v): v is number => v !== null),
  );
  if (meanStepLength !== null && meanStepLength < 0.45 && (m.cadence ?? 0) > 105) {
    patterns.push({
      key: 'shuffling',
      label: '小碎步傾向 (Shuffling gait)',
      evidence: `平均步長僅 ${round(meanStepLength, 2)} m 而步頻達 ${round(m.cadence)} steps/min,呈現以高步頻代償短步長的模式。`,
      severity: grade(0.45 - meanStepLength, 0.05, 0.12),
    });
  }

  if (m.pelvicDropDeg !== null && m.pelvicDropDeg > 5) {
    patterns.push({
      key: 'trendelenburg',
      label: 'Trendelenburg 徵象',
      evidence: `單腳站立期對側骨盆下沉達 ${round(m.pelvicDropDeg)}°,超過 5° 閾值,提示髖外展肌群無力。`,
      severity: grade(m.pelvicDropDeg, 5, 8),
    });
  }

  if (m.strideTimeCvPercent !== null && m.strideTimeCvPercent > 5) {
    patterns.push({
      key: 'variability',
      label: '步態節律不穩定',
      evidence: `步態週期變異係數 ${round(m.strideTimeCvPercent)}%,高於 ${NORM.strideTimeCv}% 參考值,反映節律控制不一致。`,
      severity: grade(m.strideTimeCvPercent, 5, 9),
    });
  }

  const armEntry = m.symmetry.find((s) => s.label === '手臂擺動幅度');
  if (armEntry && armEntry.index > 30) {
    patterns.push({
      key: 'arm-swing',
      label: '手臂擺動不對稱',
      evidence: `左右手臂擺動幅度 ${round(armEntry.left)}° / ${round(armEntry.right)}°,對稱性指數 ${round(armEntry.index)}%。`,
      severity: grade(armEntry.index, 30, 50),
    });
  }

  return patterns;
}

// --- Scoring ---------------------------------------------------------------

function computeScore(input: {
  overallSymmetryIndex: number | null;
  cadence: number | null;
  stancePercents: number[];
  strideTimeCvPercent: number | null;
  kinematics: { left: SideKinematics; right: SideKinematics };
  trunkLeanDeg: number | null;
}): { breakdown: ScoreBreakdown; score: number } {
  // Each component degrades from 25 toward 0 as the measurement moves away from
  // its normative value. Components that could not be measured fall back to a
  // neutral 60% of full marks rather than a free pass or an automatic penalty.
  const NEUTRAL = 0.6;

  const symmetry =
    input.overallSymmetryIndex === null
      ? 25 * NEUTRAL
      : 25 * clamp(1 - input.overallSymmetryIndex / 20, 0, 1);

  const rhythmTerms: number[] = [];
  if (input.cadence !== null) {
    rhythmTerms.push(
      1 - clamp(Math.abs(input.cadence - NORM.cadence) / NORM.cadenceTolerance, 0, 1),
    );
  }
  if (input.stancePercents.length) {
    const dev = mean(input.stancePercents.map((s) => Math.abs(s - NORM.stancePercent)))!;
    rhythmTerms.push(1 - clamp(dev / 15, 0, 1));
  }
  if (input.strideTimeCvPercent !== null) {
    rhythmTerms.push(1 - clamp(input.strideTimeCvPercent / 8, 0, 1));
  }
  const rhythm = 25 * (mean(rhythmTerms) ?? NEUTRAL);

  const romTerms: number[] = [];
  for (const side of ['left', 'right'] as Side[]) {
    const k = input.kinematics[side];
    const check = (curve: CycleCurve | null, norm: number) => {
      if (!curve) return;
      romTerms.push(1 - clamp(Math.abs(curve.rom - norm) / norm, 0, 1));
    };
    check(k.knee, NORM.kneeRom);
    check(k.hip, NORM.hipRom);
    check(k.ankle, NORM.ankleRom);
  }
  const kinematics = 25 * (mean(romTerms) ?? NEUTRAL);

  const stabilityTerms: number[] = [];
  if (input.trunkLeanDeg !== null) {
    stabilityTerms.push(
      1 - clamp(Math.abs(input.trunkLeanDeg - NORM.trunkLean) / 20, 0, 1),
    );
  }
  if (input.strideTimeCvPercent !== null) {
    stabilityTerms.push(1 - clamp(input.strideTimeCvPercent / 8, 0, 1));
  }
  const stability = 25 * (mean(stabilityTerms) ?? NEUTRAL);

  const breakdown: ScoreBreakdown = {
    symmetry: Math.round(symmetry),
    rhythm: Math.round(rhythm),
    kinematics: Math.round(kinematics),
    stability: Math.round(stability),
  };

  return {
    breakdown,
    score: Math.round(
      breakdown.symmetry + breakdown.rhythm + breakdown.kinematics + breakdown.stability,
    ),
  };
}

const riskFromScore = (score: number): RiskLevel =>
  score >= 80 ? '低' : score >= 60 ? '中' : '高';

// --- Entry point -----------------------------------------------------------

export function computeGaitMetrics(seq: PoseSequence, heightCm: number): GaitMetrics {
  const frames = seq.frames;
  const warnings: string[] = [];

  if (frames.length < 30) {
    throw new Error('可用畫面不足,請拍攝至少 5 秒、人體完整入鏡的連續行走影片。');
  }

  const { view, frontalness } = detectView(frames);
  if (view === 'unknown') {
    warnings.push(
      `拍攝角度介於側面與正面之間(正面度 ${round(frontalness * 100)}%),部分指標的準確度會下降。建議正對側面重新拍攝。`,
    );
  } else if (view === 'frontal') {
    warnings.push(
      '偵測為正面視角。時空參數(步頻、步長、站立期)需要側面視角才能可靠計算,本次結果以正面可測項目為主。',
    );
  }

  const scale = computeScaleFactor(frames, heightCm);
  if (Math.abs(scale - 1) > 0.4) {
    warnings.push(
      `身高校正係數 ${round(scale, 2)} 偏離正常範圍,姿態偵測可能不準確,長度類指標僅供參考。`,
    );
  }

  const bouts = findBouts(frames, seq.fps);
  const boutSignAt = (i: number) => bouts.find((b) => i >= b.start && i <= b.end)?.sign ?? 0;

  const events = detectEvents(frames, seq.fps, bouts);
  const cycles = buildCycles(events, bouts);
  const series = computeAngleSeries(frames, boutSignAt);

  const cyclesLeft = cycles.filter((c) => c.side === 'left').length;
  const cyclesRight = cycles.filter((c) => c.side === 'right').length;
  if (Math.min(cyclesLeft, cyclesRight) < 2) {
    warnings.push(
      `僅偵測到左 ${cyclesLeft} / 右 ${cyclesRight} 個完整步態週期,建議拍攝更長的連續行走以提高可靠度。`,
    );
  }

  // --- spatiotemporal ---
  const steps = measureSteps(events, frames, boutSignAt, scale);
  const stepTimes = steps.map((s) => s.timeSec);
  const cadence = stepTimes.length ? 60 / mean(stepTimes)! : null;

  const strideDurations = cycles.map((c) => c.durationSec);
  const gaitCycleTimeSec = mean(strideDurations);
  const strideSd = stdev(strideDurations);
  const strideTimeCvPercent =
    strideSd !== null && gaitCycleTimeSec ? (strideSd / gaitCycleTimeSec) * 100 : null;

  const perSide = (side: Side): SpatiotemporalSide => {
    const own = steps.filter((s) => s.side === side);
    const ownCycles = cycles.filter((c) => c.side === side);
    const stance = mean(
      ownCycles.map((c) => c.stancePercent).filter((v): v is number => v !== null),
    );
    const stepLengthM = mean(
      own.map((s) => s.lengthM).filter((v): v is number => v !== null),
    );
    return {
      stepTimeSec: round(mean(own.map((s) => s.timeSec)), 3),
      strideTimeSec: round(mean(ownCycles.map((c) => c.durationSec)), 3),
      stancePercent: round(stance),
      swingPercent: stance === null ? null : round(100 - stance),
      stepLengthM: round(stepLengthM, 3),
      strideLengthM: null, // filled in below once both sides are known
    };
  };

  const left = perSide('left');
  const right = perSide('right');

  if (left.stepLengthM !== null && right.stepLengthM !== null) {
    const stride = round(left.stepLengthM + right.stepLengthM, 3);
    left.strideLengthM = stride;
    right.strideLengthM = stride;
  }

  const strideLength = left.strideLengthM;
  const walkingSpeedMps =
    strideLength !== null && gaitCycleTimeSec ? strideLength / gaitCycleTimeSec : null;

  const doubleSupportPercent = computeDoubleSupport(frames, events, bouts);

  // --- kinematics ---
  const kinematics = {
    left: buildSideKinematics('left', cycles, series),
    right: buildSideKinematics('right', cycles, series),
  };

  // --- trunk and pelvis ---
  // Only the interpretation that matches the camera view is reported; the
  // other axis is not observable from a single 2D viewpoint.
  const trunkLeanDeg =
    view === 'sagittal' ? round(mean(series.trunkLean)) : null;
  const trunkSwayDeg =
    view === 'frontal'
      ? round(Math.max(...series.trunkSway) - Math.min(...series.trunkSway))
      : null;

  let pelvicDropDeg: number | null = null;
  if (view === 'frontal' && series.pelvicObliquity.length) {
    const obliquity = smooth(series.pelvicObliquity, 5).map(Math.abs);
    pelvicDropDeg = round(Math.max(...obliquity));
  } else if (view !== 'frontal') {
    warnings.push(
      '骨盆下沉 (Trendelenburg) 與步寬需要正面視角才能量測,本次未納入評估。',
    );
  }

  let stepWidthM: number | null = null;
  if (view === 'frontal') {
    const widths = events
      .filter((e) => e.type === 'heelStrike')
      .map((e) => frames[e.frameIndex])
      .filter(Boolean)
      .map((f) => Math.abs(f.world[LM.leftAnkle].x - f.world[LM.rightAnkle].x) * scale)
      .filter((w) => w > 0.02 && w < 0.5);
    stepWidthM = round(mean(widths), 3);
  }

  // --- symmetry ---
  const symmetry: SymmetryEntry[] = [];
  const addSymmetry = (label: string, l: number | null, r: number | null) => {
    if (l === null || r === null) return;
    symmetry.push({ label, left: l, right: r, index: round(symmetryIndex(l, r))! });
  };
  addSymmetry('步長', left.stepLengthM, right.stepLengthM);
  addSymmetry('步態時間', left.stepTimeSec, right.stepTimeSec);
  addSymmetry('站立期佔比', left.stancePercent, right.stancePercent);
  addSymmetry('髖關節活動度', kinematics.left.hip?.rom ?? null, kinematics.right.hip?.rom ?? null);
  addSymmetry('膝關節活動度', kinematics.left.knee?.rom ?? null, kinematics.right.knee?.rom ?? null);
  addSymmetry('踝關節活動度', kinematics.left.ankle?.rom ?? null, kinematics.right.ankle?.rom ?? null);
  addSymmetry('手臂擺動幅度', kinematics.left.armSwingRom, kinematics.right.armSwingRom);

  const overallSymmetryIndex = round(mean(symmetry.map((s) => s.index)));

  // --- quality ---
  const landmarkVisibility = mean(frames.map((f) => f.quality)) ?? 0;
  if (landmarkVisibility < 0.7) {
    warnings.push(
      `關節點平均可見度僅 ${round(landmarkVisibility * 100)}%,建議在光線充足處穿著貼身衣物重新拍攝。`,
    );
  }

  const qualityScore = clamp(
    0.3 * clamp((landmarkVisibility - 0.5) / 0.4, 0, 1) +
      0.3 * clamp(Math.min(cyclesLeft, cyclesRight) / 3, 0, 1) +
      0.15 * clamp(1 - Math.abs(scale - 1) / 0.4, 0, 1) +
      0.15 * clamp(seq.fps / 24, 0, 1) +
      0.1 * (view === 'sagittal' ? 1 : view === 'frontal' ? 0.6 : 0.3),
    0,
    1,
  );

  const quality: GaitQuality = {
    landmarkVisibility: round(landmarkVisibility, 3)!,
    cyclesLeft,
    cyclesRight,
    scaleFactor: round(scale, 3)!,
    effectiveFps: round(seq.fps)!,
    view,
    warnings,
    score: round(qualityScore, 3)!,
  };

  const stancePercents = [left.stancePercent, right.stancePercent].filter(
    (v): v is number => v !== null,
  );

  const patterns = detectPatterns({
    cadence,
    left,
    right,
    kinematics,
    pelvicDropDeg,
    strideTimeCvPercent,
    symmetry,
    view,
  });

  const { breakdown, score } = computeScore({
    overallSymmetryIndex,
    cadence,
    stancePercents,
    strideTimeCvPercent,
    kinematics,
    trunkLeanDeg,
  });

  return {
    cadenceStepsPerMin: round(cadence),
    gaitCycleTimeSec: round(gaitCycleTimeSec, 3),
    doubleSupportPercent: round(doubleSupportPercent),
    walkingSpeedMps: round(walkingSpeedMps, 2),
    stepWidthM,
    strideTimeCvPercent: round(strideTimeCvPercent),
    left,
    right,
    kinematics,
    trunkLeanDeg,
    trunkSwayDeg,
    pelvicDropDeg,
    symmetry,
    overallSymmetryIndex,
    events,
    cycles,
    quality,
    patterns,
    scoreBreakdown: breakdown,
    score,
    riskLevel: riskFromScore(score),
  };
}

// --- Cross-track reconciliation --------------------------------------------

/**
 * Compares the deterministic track against Gemini's independent read.
 *
 * This is deliberately plain arithmetic rather than another model call. The
 * whole reason the second track exists is to catch a silent landmark failure,
 * and asking the same model to grade its own agreement would defeat that.
 */
export function reconcileTracks(
  metrics: GaitMetrics,
  trackB: TrackBObservation | null,
): TrackReconciliation {
  const notes: string[] = [];
  const agreements: TrackAgreement[] = [];

  if (!trackB) {
    return {
      agreements,
      confidence: round(metrics.quality.score * 0.7, 3)!,
      level: metrics.quality.score >= 0.75 ? 'medium' : 'low',
      notes: ['第二軌獨立觀察未能完成,本次僅有演算法軌結果,信心度已相應下調。'],
      recommendsReshoot: metrics.quality.score < 0.5,
    };
  }

  // Cadence is the one quantity both tracks estimate on the same scale.
  const aCadence = metrics.cadenceStepsPerMin;
  const bCadence = trackB.estimatedCadence;
  let cadenceDelta: number | null = null;
  let cadenceAgrees: boolean | null = null;
  if (aCadence !== null && bCadence !== null && aCadence > 0) {
    cadenceDelta = round((Math.abs(aCadence - bCadence) / aCadence) * 100);
    cadenceAgrees = cadenceDelta! <= 15;
    notes.push(
      cadenceAgrees
        ? `兩軌步頻估計一致(演算法 ${aCadence} vs 影像判讀 ${bCadence} steps/min,差異 ${cadenceDelta}%)。`
        : `兩軌步頻估計不一致(演算法 ${aCadence} vs 影像判讀 ${bCadence} steps/min,差異 ${cadenceDelta}%),可能有關節點追蹤失誤。`,
    );
  }
  agreements.push({
    metric: '步頻',
    trackA: aCadence,
    trackB: bCadence,
    deltaPercent: cadenceDelta,
    agrees: cadenceAgrees,
  });

  // Asymmetry is scored on different scales by the two tracks, so they are
  // compared as coarse buckets rather than as numbers.
  const aSi = metrics.overallSymmetryIndex;
  const bAsym = trackB.estimatedAsymmetry;
  let symmetryAgrees: boolean | null = null;
  if (aSi !== null && bAsym !== null) {
    const bucketA = aSi < 8 ? 0 : aSi < 18 ? 1 : 2;
    const bucketB = bAsym < 25 ? 0 : bAsym < 55 ? 1 : 2;
    symmetryAgrees = Math.abs(bucketA - bucketB) <= 1;
    if (!symmetryAgrees) {
      notes.push(
        `兩軌對左右對稱性的判讀落差較大(演算法對稱性指數 ${aSi}%,影像判讀不對稱程度 ${bAsym}/100)。`,
      );
    }
  }
  agreements.push({
    metric: '左右對稱性',
    trackA: aSi,
    trackB: bAsym,
    deltaPercent: null,
    agrees: symmetryAgrees,
  });

  const viewAgrees =
    metrics.quality.view === 'unknown' || trackB.observedView === 'unknown'
      ? null
      : metrics.quality.view === trackB.observedView;
  if (viewAgrees === false) {
    notes.push(
      `兩軌對拍攝角度的判斷不同(演算法判定 ${metrics.quality.view},影像判讀 ${trackB.observedView}),部分指標可能套用了錯誤的平面假設。`,
    );
  }
  agreements.push({
    metric: '拍攝視角',
    trackA: null,
    trackB: null,
    deltaPercent: null,
    agrees: viewAgrees,
  });

  const decided = agreements.filter((a) => a.agrees !== null);
  const agreementRate = decided.length
    ? decided.filter((a) => a.agrees).length / decided.length
    : 0.5;

  const confidence = clamp(
    0.5 * metrics.quality.score + 0.3 * agreementRate + 0.2 * clamp(trackB.frameQuality, 0, 1),
    0,
    1,
  );

  const recommendsReshoot =
    confidence < 0.45 || (cadenceDelta !== null && cadenceDelta > 25);

  if (recommendsReshoot) {
    notes.push('建議依拍攝指引重新錄製一次,以取得更可靠的分析結果。');
  }

  return {
    agreements,
    confidence: round(confidence, 3)!,
    level: confidence >= 0.75 ? 'high' : confidence >= 0.5 ? 'medium' : 'low',
    notes,
    recommendsReshoot,
  };
}
