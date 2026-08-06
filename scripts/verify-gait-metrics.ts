/**
 * Verification harness for the gait metrics layer.
 *
 * Builds a synthetic walker with known parameters, runs it through
 * computeGaitMetrics(), and checks that the numbers coming out match the ones
 * that went in. This is what makes track A worth trusting: a sign error in the
 * event detector or a mixed-up axis shows up here rather than as a plausible
 * but wrong clinical report.
 *
 * Run with:  npm run verify:metrics
 */

import {
  computeFrontalSupplement,
  computeGaitMetrics,
  reconcileTracks,
} from '../src/services/gaitMetrics';
import { LM } from '../src/services/landmarks';
import type { Point3, PoseFrame, PoseSequence } from '../src/types/gait';

// --- Synthetic walker ------------------------------------------------------

const HEIGHT_M = 1.7;
const THIGH = 0.42;
const SHANK = 0.42;
const HIP_HALF_DEPTH = 0.09;
const SHOULDER_HALF_DEPTH = 0.18;

/** Nose height chosen so the implied stature matches HEIGHT_M exactly. */
const ANKLE_Y_NEUTRAL = THIGH + SHANK;
const NOSE_Y = ANKLE_Y_NEUTRAL - 0.891 * HEIGHT_M;

interface WalkerOptions {
  durationSec: number;
  fps: number;
  /** Gait cycle period in seconds. */
  periodSec: number;
  /** Peak thigh swing angle in radians. */
  thighAmplitude: number;
  /** Peak knee flexion in radians. */
  kneeAmplitude: number;
  /** Scales the right leg's amplitudes, for building an asymmetric walker. */
  rightScale: number;
}

const pt = (x: number, y: number, z: number): Point3 => ({ x, y, z, visibility: 0.95 });

/**
 * Sagittal-view walker: the subject travels along the image x axis, and the two
 * sides are separated in depth (z), which is what a side-on camera sees.
 *
 * The knee curve here is a smooth stand-in rather than a physiological one —
 * the point is to exercise event detection, timing and symmetry, not to
 * reproduce a real knee trace.
 */
function buildWalker(opts: WalkerOptions): PoseSequence {
  const frames: PoseFrame[] = [];
  const omega = (2 * Math.PI) / opts.periodSec;
  const frameCount = Math.floor(opts.durationSec * opts.fps);

  for (let i = 0; i < frameCount; i++) {
    const t = i / opts.fps;
    const world: Point3[] = Array.from({ length: 33 }, () => pt(0, 0, 0));

    for (const side of ['left', 'right'] as const) {
      const phase = side === 'left' ? 0 : Math.PI;
      const scale = side === 'left' ? 1 : opts.rightScale;
      const depth = side === 'left' ? HIP_HALF_DEPTH : -HIP_HALF_DEPTH;

      const theta = opts.thighAmplitude * scale * Math.sin(omega * t + phase);
      const knee = opts.kneeAmplitude * scale * (0.5 - 0.5 * Math.cos(omega * t + phase));

      const hipJoint = pt(0, 0, depth);
      const kneeJoint = pt(
        hipJoint.x + THIGH * Math.sin(theta),
        hipJoint.y + THIGH * Math.cos(theta),
        depth,
      );
      const ankleJoint = pt(
        kneeJoint.x + SHANK * Math.sin(theta - knee),
        kneeJoint.y + SHANK * Math.cos(theta - knee),
        depth,
      );

      const idx =
        side === 'left'
          ? {
              hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle,
              heel: LM.leftHeel, toe: LM.leftFootIndex,
              shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist,
            }
          : {
              hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle,
              heel: LM.rightHeel, toe: LM.rightFootIndex,
              shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist,
            };

      world[idx.hip] = hipJoint;
      world[idx.knee] = kneeJoint;
      world[idx.ankle] = ankleJoint;
      world[idx.heel] = pt(ankleJoint.x - 0.06, ankleJoint.y + 0.02, depth);
      world[idx.toe] = pt(ankleJoint.x + 0.14, ankleJoint.y + 0.02, depth);

      // Arms swing opposite the ipsilateral leg, as they do in normal walking.
      const shoulderDepth = side === 'left' ? SHOULDER_HALF_DEPTH : -SHOULDER_HALF_DEPTH;
      const armX = -0.28 * scale * Math.sin(omega * t + phase);
      world[idx.shoulder] = pt(0, -0.5, shoulderDepth);
      world[idx.elbow] = pt(armX * 0.5, -0.15, shoulderDepth);
      world[idx.wrist] = pt(armX, 0.2, shoulderDepth);
    }

    world[LM.nose] = pt(0, NOSE_Y, 0);

    // Normalized coordinates only need to carry the global translation and a
    // rough projection; nothing downstream measures lengths from them.
    const progress = i / Math.max(1, frameCount - 1);
    const hipCenterX = 0.2 + 0.6 * progress;
    const landmarks = world.map((p) => pt(hipCenterX + p.x * 0.15, 0.55 + p.y * 0.15, p.z));

    frames.push({ t, landmarks, world, quality: 0.95 });
  }

  return {
    frames,
    fps: opts.fps,
    durationSec: opts.durationSec,
    videoWidth: 1280,
    videoHeight: 720,
    keyFrames: [],
  };
}

const FRONTAL_HIP_HALF_WIDTH = 0.09;
const FRONTAL_SHOULDER_HALF_WIDTH = 0.19;

interface FrontalWalkerOptions {
  durationSec: number;
  fps: number;
  periodSec: number;
  /** Target mediolateral ankle separation, in meters. */
  stepWidthM: number;
  /**
   * Peak pelvic obliquity magnitude, in degrees (0 = pelvis stays level).
   * computeFrontalSupplement reports max(|obliquity|), a single-sided peak,
   * not a peak-to-peak swing, so that is what this drives directly.
   */
  pelvicDropPeakDeg: number;
  /** Half-amplitude of shoulder-over-hip lateral sway, in meters. */
  trunkSwayHalfAmpM: number;
}

/**
 * Frontal-view walker: the camera faces the subject, who walks straight
 * toward or away from it. World x is mediolateral by construction (shoulders
 * and hips separate almost entirely along x, matching detectView()'s
 * definition of 'frontal'); world z (depth/travel direction) is irrelevant to
 * every quantity computeFrontalSupplement() reads, so it is left at zero.
 */
function buildFrontalWalker(opts: FrontalWalkerOptions): PoseSequence {
  const frames: PoseFrame[] = [];
  const omega = (2 * Math.PI) / opts.periodSec;
  const frameCount = Math.floor(opts.durationSec * opts.fps);

  // computeFrontalSupplement reads obliquity as
  // atan2(-(hipR.y - hipL.y), hipR.x - hipL.x); invert it here so the
  // requested peak angle is what comes out the other end.
  const hipDropAmpY =
    2 * FRONTAL_HIP_HALF_WIDTH * Math.tan(opts.pelvicDropPeakDeg * (Math.PI / 180));

  for (let i = 0; i < frameCount; i++) {
    const t = i / opts.fps;
    const world: Point3[] = Array.from({ length: 33 }, () => pt(0, 0, 0));
    const phase = omega * t;

    const hipDrop = hipDropAmpY * Math.sin(phase);
    world[LM.leftHip] = pt(-FRONTAL_HIP_HALF_WIDTH, 0, 0);
    world[LM.rightHip] = pt(FRONTAL_HIP_HALF_WIDTH, hipDrop, 0);

    const sway = opts.trunkSwayHalfAmpM * Math.sin(phase * 0.5);
    world[LM.leftShoulder] = pt(-FRONTAL_SHOULDER_HALF_WIDTH + sway, -0.5, 0);
    world[LM.rightShoulder] = pt(FRONTAL_SHOULDER_HALF_WIDTH + sway, -0.5, 0);

    world[LM.leftAnkle] = pt(-opts.stepWidthM / 2, ANKLE_Y_NEUTRAL, 0);
    world[LM.rightAnkle] = pt(opts.stepWidthM / 2, ANKLE_Y_NEUTRAL, 0);
    world[LM.leftKnee] = pt(-opts.stepWidthM / 4, ANKLE_Y_NEUTRAL / 2, 0);
    world[LM.rightKnee] = pt(opts.stepWidthM / 4, ANKLE_Y_NEUTRAL / 2, 0);
    world[LM.leftElbow] = pt(-FRONTAL_SHOULDER_HALF_WIDTH + sway, -0.2, 0);
    world[LM.rightElbow] = pt(FRONTAL_SHOULDER_HALF_WIDTH + sway, -0.2, 0);
    world[LM.leftWrist] = pt(-FRONTAL_SHOULDER_HALF_WIDTH + sway, 0.1, 0);
    world[LM.rightWrist] = pt(FRONTAL_SHOULDER_HALF_WIDTH + sway, 0.1, 0);
    world[LM.leftHeel] = world[LM.leftAnkle];
    world[LM.rightHeel] = world[LM.rightAnkle];
    world[LM.leftFootIndex] = world[LM.leftAnkle];
    world[LM.rightFootIndex] = world[LM.rightAnkle];
    world[LM.nose] = pt(0, NOSE_Y, 0);

    // The subject stays centered in frame; only depth (z) would carry the
    // approach/recession motion, which nothing under test reads.
    const landmarks = world.map((p) => pt(0.5 + p.x * 0.15, 0.55 + p.y * 0.15, p.z));

    frames.push({ t, landmarks, world, quality: 0.95 });
  }

  return {
    frames,
    fps: opts.fps,
    durationSec: opts.durationSec,
    videoWidth: 1280,
    videoHeight: 720,
    keyFrames: [],
  };
}

// --- Assertions ------------------------------------------------------------

let failures = 0;

function check(name: string, passed: boolean, detail: string) {
  const mark = passed ? 'PASS' : 'FAIL';
  if (!passed) failures++;
  console.log(`  [${mark}] ${name} — ${detail}`);
}

function near(actual: number | null, expected: number, tolerance: number): boolean {
  return actual !== null && Math.abs(actual - expected) <= tolerance;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// --- Case 1: symmetric walker ---------------------------------------------

const PERIOD = 1.1;
const EXPECTED_CADENCE = 120 / PERIOD; // two steps per gait cycle

console.log('\nCase 1 — symmetric sagittal walker (period 1.1 s, 8 s clip)');

const symmetric = buildWalker({
  durationSec: 8,
  fps: 30,
  periodSec: PERIOD,
  thighAmplitude: 0.35,
  kneeAmplitude: 0.5,
  rightScale: 1,
});

const m1 = computeGaitMetrics(symmetric, HEIGHT_M * 100);

check(
  '拍攝視角判定為側面',
  m1.quality.view === 'sagittal',
  `view = ${m1.quality.view}`,
);
check(
  '身高校正係數接近 1',
  near(m1.quality.scaleFactor, 1, 0.15),
  `scaleFactor = ${m1.quality.scaleFactor}`,
);
check(
  '偵測到足夠的完整步態週期',
  m1.quality.cyclesLeft >= 4 && m1.quality.cyclesRight >= 4,
  `left = ${m1.quality.cyclesLeft}, right = ${m1.quality.cyclesRight}`,
);
check(
  `步頻還原至 ${EXPECTED_CADENCE.toFixed(1)} steps/min`,
  near(m1.cadenceStepsPerMin, EXPECTED_CADENCE, EXPECTED_CADENCE * 0.1),
  `cadence = ${m1.cadenceStepsPerMin}`,
);
check(
  `步態週期還原至 ${PERIOD} s`,
  near(m1.gaitCycleTimeSec, PERIOD, PERIOD * 0.1),
  `gaitCycleTime = ${m1.gaitCycleTimeSec}`,
);
check(
  '對稱輸入的對稱性指數接近 0',
  m1.overallSymmetryIndex !== null && m1.overallSymmetryIndex < 8,
  `overallSymmetryIndex = ${m1.overallSymmetryIndex}%`,
);
check(
  '左右站立期佔比落在合理範圍',
  m1.left.stancePercent !== null &&
    m1.right.stancePercent !== null &&
    m1.left.stancePercent > 40 &&
    m1.left.stancePercent < 85,
  `left = ${m1.left.stancePercent}%, right = ${m1.right.stancePercent}%`,
);
check(
  '步長為正且落在合理範圍',
  m1.left.stepLengthM !== null && m1.left.stepLengthM > 0.2 && m1.left.stepLengthM < 1.0,
  `left stepLength = ${m1.left.stepLengthM} m, right = ${m1.right.stepLengthM} m`,
);
check(
  '膝關節角度曲線已產生且為 101 點',
  m1.kinematics.left.knee?.values.length === 101,
  `knee curve points = ${m1.kinematics.left.knee?.values.length ?? 0}, ROM = ${m1.kinematics.left.knee?.rom}°`,
);
check(
  '膝關節 ROM 還原至輸入振幅 (0.5 rad ≈ 28.6°)',
  near(m1.kinematics.left.knee?.rom ?? null, 28.6, 6),
  `knee ROM = ${m1.kinematics.left.knee?.rom}°`,
);
check(
  '步態週期變異度極低(輸入為完美週期)',
  m1.strideTimeCvPercent !== null && m1.strideTimeCvPercent < 5,
  `strideTimeCV = ${m1.strideTimeCvPercent}%`,
);
check(
  '對稱步態未觸發跛行樣式',
  !m1.patterns.some((p) => p.key === 'antalgic'),
  `patterns = [${m1.patterns.map((p) => p.key).join(', ') || 'none'}]`,
);

// --- Case 2: asymmetric walker --------------------------------------------

console.log('\nCase 2 — asymmetric walker (right leg at 60% amplitude)');

const asymmetric = buildWalker({
  durationSec: 8,
  fps: 30,
  periodSec: PERIOD,
  thighAmplitude: 0.35,
  kneeAmplitude: 0.5,
  rightScale: 0.6,
});

const m2 = computeGaitMetrics(asymmetric, HEIGHT_M * 100);

check(
  '不對稱輸入使對稱性指數明顯升高',
  m2.overallSymmetryIndex !== null &&
    m1.overallSymmetryIndex !== null &&
    m2.overallSymmetryIndex > m1.overallSymmetryIndex + 10,
  `symmetric = ${m1.overallSymmetryIndex}% → asymmetric = ${m2.overallSymmetryIndex}%`,
);
check(
  '右側膝關節 ROM 低於左側',
  (m2.kinematics.right.knee?.rom ?? 0) < (m2.kinematics.left.knee?.rom ?? 0),
  `left = ${m2.kinematics.left.knee?.rom}°, right = ${m2.kinematics.right.knee?.rom}°`,
);
check(
  '不對稱步態的評分低於對稱步態',
  m2.score < m1.score,
  `symmetric score = ${m1.score}, asymmetric score = ${m2.score}`,
);
check(
  '步頻不受單側振幅改變影響',
  near(m2.cadenceStepsPerMin, EXPECTED_CADENCE, EXPECTED_CADENCE * 0.12),
  `cadence = ${m2.cadenceStepsPerMin}`,
);

// --- Case 3: direction reversal (the two-pass shooting guide) --------------

console.log('\nCase 3 — two passes with a turn in the middle');

const forward = buildWalker({
  durationSec: 5,
  fps: 30,
  periodSec: PERIOD,
  thighAmplitude: 0.35,
  kneeAmplitude: 0.5,
  rightScale: 1,
});

// Second pass: same gait, travelling the other way across the image. Mirroring
// the world x axis is what a camera actually sees when the subject turns round.
const backward = buildWalker({
  durationSec: 5,
  fps: 30,
  periodSec: PERIOD,
  thighAmplitude: 0.35,
  kneeAmplitude: 0.5,
  rightScale: 1,
});

const reversed: PoseSequence = {
  ...forward,
  durationSec: 10,
  frames: [
    ...forward.frames,
    ...backward.frames.map((f, i) => ({
      ...f,
      t: 5 + f.t,
      world: f.world.map((p) => pt(-p.x, p.y, -p.z)),
      landmarks: f.landmarks.map((p) =>
        pt(0.8 - (p.x - 0.2), p.y, -p.z),
      ),
      quality: f.quality,
    })),
  ],
};

const m3 = computeGaitMetrics(reversed, HEIGHT_M * 100);

check(
  '來回兩趟仍還原出正確步頻',
  near(m3.cadenceStepsPerMin, EXPECTED_CADENCE, EXPECTED_CADENCE * 0.12),
  `cadence = ${m3.cadenceStepsPerMin}`,
);
check(
  '來回兩趟的步長仍為正值(方向已正確處理)',
  m3.left.stepLengthM !== null && m3.left.stepLengthM > 0.2,
  `left stepLength = ${m3.left.stepLengthM} m`,
);
check(
  '來回兩趟偵測到的週期數多於單趟',
  m3.quality.cyclesLeft > forward.frames.length / (PERIOD * 30) - 1,
  `cycles left = ${m3.quality.cyclesLeft}`,
);

// --- Case 4: reconciliation ------------------------------------------------

console.log('\nCase 4 — dual-track reconciliation');

const agreeing = reconcileTracks(m1, {
  estimatedCadence: m1.cadenceStepsPerMin,
  estimatedAsymmetry: 5,
  observedView: 'sagittal',
  observedAbnormalities: [],
  qualitativeNotes: {
    painIndicators: '未觀察到明顯疼痛徵象',
    clothingOcclusion: '無',
    footwear: '運動鞋',
    environment: '平整地面',
    assistiveDevice: '未使用輔具',
  },
  frameQuality: 0.9,
});

const disagreeing = reconcileTracks(m1, {
  estimatedCadence: (m1.cadenceStepsPerMin ?? 100) * 1.8,
  estimatedAsymmetry: 90,
  observedView: 'frontal',
  observedAbnormalities: ['嚴重跛行'],
  qualitativeNotes: {
    painIndicators: '未提供',
    clothingOcclusion: '寬鬆長褲遮蔽膝踝',
    footwear: '未提供',
    environment: '未提供',
    assistiveDevice: '未提供',
  },
  frameQuality: 0.3,
});

check(
  '兩軌一致時給出高信心度',
  agreeing.level === 'high' && !agreeing.recommendsReshoot,
  `confidence = ${agreeing.confidence}, level = ${agreeing.level}`,
);
check(
  '兩軌矛盾時降低信心度並建議重拍',
  disagreeing.confidence < agreeing.confidence && disagreeing.recommendsReshoot,
  `confidence = ${disagreeing.confidence}, level = ${disagreeing.level}, reshoot = ${disagreeing.recommendsReshoot}`,
);
check(
  '第二軌缺席時信心度下調而非中斷分析',
  reconcileTracks(m1, null).confidence < agreeing.confidence,
  `confidence without track B = ${reconcileTracks(m1, null).confidence}`,
);

// --- Case 5: frontal-view supplement ----------------------------------------

console.log('\nCase 5 — synthetic frontal-view walker');

const TARGET_STEP_WIDTH = 0.11;
const NORMAL_PELVIC_PEAK = 2; // degrees — level pelvis, well under the 5° threshold
const ABNORMAL_PELVIC_PEAK = 9; // degrees — clear Trendelenburg
const SWAY_HALF_AMP = 0.03; // meters

const frontalNormal = buildFrontalWalker({
  durationSec: 8,
  fps: 30,
  periodSec: PERIOD,
  stepWidthM: TARGET_STEP_WIDTH,
  pelvicDropPeakDeg: NORMAL_PELVIC_PEAK,
  trunkSwayHalfAmpM: SWAY_HALF_AMP,
});

const frontalAbnormal = buildFrontalWalker({
  durationSec: 8,
  fps: 30,
  periodSec: PERIOD,
  stepWidthM: TARGET_STEP_WIDTH,
  pelvicDropPeakDeg: ABNORMAL_PELVIC_PEAK,
  trunkSwayHalfAmpM: SWAY_HALF_AMP,
});

const supplementNormal = computeFrontalSupplement(frontalNormal.frames, HEIGHT_M * 100);
const supplementAbnormal = computeFrontalSupplement(frontalAbnormal.frames, HEIGHT_M * 100);

check(
  '正面步行者的拍攝視角判定為正面',
  supplementNormal.view === 'frontal',
  `view = ${supplementNormal.view}, frontalness = ${round2(supplementNormal.frontalness)}`,
);
check(
  `步寬還原至輸入值 ${TARGET_STEP_WIDTH} m`,
  near(supplementNormal.stepWidthM, TARGET_STEP_WIDTH, 0.01),
  `stepWidthM = ${supplementNormal.stepWidthM}`,
);
check(
  `骨盆下沉(正常案例)還原至輸入峰值 ${NORMAL_PELVIC_PEAK}°`,
  near(supplementNormal.pelvicDropDeg, NORMAL_PELVIC_PEAK, 1),
  `pelvicDropDeg = ${supplementNormal.pelvicDropDeg}`,
);
check(
  `骨盆下沉(異常案例)還原至輸入峰值 ${ABNORMAL_PELVIC_PEAK}°`,
  near(supplementAbnormal.pelvicDropDeg, ABNORMAL_PELVIC_PEAK, 1),
  `pelvicDropDeg = ${supplementAbnormal.pelvicDropDeg}`,
);
check(
  '較大的骨盆下沉輸入使輸出跟著變大',
  (supplementAbnormal.pelvicDropDeg ?? 0) > (supplementNormal.pelvicDropDeg ?? 0),
  `normal = ${supplementNormal.pelvicDropDeg}°, abnormal = ${supplementAbnormal.pelvicDropDeg}°`,
);
check(
  '軀幹側擺已產生非零數值',
  (supplementNormal.trunkSwayDeg ?? 0) > 0.5,
  `trunkSwayDeg = ${supplementNormal.trunkSwayDeg}`,
);

// --- Case 6: merging a supplementary frontal video --------------------------

console.log('\nCase 6 — sagittal + frontal video merge');

const sagittalOnly = computeGaitMetrics(symmetric, HEIGHT_M * 100);
const merged = computeGaitMetrics(symmetric, HEIGHT_M * 100, frontalAbnormal);

check(
  '只有側面影片時,正面限定指標為 null',
  sagittalOnly.stepWidthM === null &&
    sagittalOnly.pelvicDropDeg === null &&
    sagittalOnly.trunkSwayDeg === null &&
    sagittalOnly.quality.frontalSource === 'none',
  `stepWidth = ${sagittalOnly.stepWidthM}, pelvicDrop = ${sagittalOnly.pelvicDropDeg}, frontalSource = ${sagittalOnly.quality.frontalSource}`,
);
check(
  '併入正面影片後,正面限定指標被填入且標記為補充來源',
  merged.stepWidthM !== null &&
    merged.pelvicDropDeg !== null &&
    merged.trunkSwayDeg !== null &&
    merged.quality.frontalSource === 'supplement',
  `stepWidth = ${merged.stepWidthM}, pelvicDrop = ${merged.pelvicDropDeg}, trunkSway = ${merged.trunkSwayDeg}, frontalSource = ${merged.quality.frontalSource}`,
);
check(
  '併入的骨盆下沉數值觸發 Trendelenburg 樣式偵測',
  merged.patterns.some((p) => p.key === 'trendelenburg'),
  `patterns = [${merged.patterns.map((p) => p.key).join(', ')}]`,
);
check(
  '併入正面影片不影響側面影片本身算出的步頻與週期',
  sagittalOnly.cadenceStepsPerMin === merged.cadenceStepsPerMin &&
    sagittalOnly.gaitCycleTimeSec === merged.gaitCycleTimeSec &&
    sagittalOnly.kinematics.left.knee?.rom === merged.kinematics.left.knee?.rom,
  `cadence ${sagittalOnly.cadenceStepsPerMin} vs ${merged.cadenceStepsPerMin}, knee ROM ${sagittalOnly.kinematics.left.knee?.rom} vs ${merged.kinematics.left.knee?.rom}`,
);
check(
  '正面影片視角不佳時會加上警告而非靜默採用',
  computeFrontalSupplement(symmetric.frames, HEIGHT_M * 100).warnings.length > 0,
  `warnings = ${JSON.stringify(computeFrontalSupplement(symmetric.frames, HEIGHT_M * 100).warnings)}`,
);

// --- Result ----------------------------------------------------------------

console.log(
  failures === 0
    ? '\n所有檢查通過\n'
    : `\n${failures} 項檢查未通過\n`,
);
process.exit(failures === 0 ? 0 : 1);
