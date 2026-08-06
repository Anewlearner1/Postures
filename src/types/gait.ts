/**
 * Type definitions for the gait analysis pipeline.
 *
 * The pipeline runs two independent tracks over the same video:
 *   Track A — MediaPipe pose landmarks -> deterministic kinematics (this file's
 *             `GaitMetrics`). No AI involved, fully reproducible.
 *   Track B — Gemini looking at sampled frames on its own (`TrackBObservation`).
 *
 * `TrackReconciliation` compares the two numerically, in plain TypeScript, so
 * that a silent landmark-tracking failure surfaces as low confidence instead of
 * a plausible-looking but wrong report.
 */

export type Side = 'left' | 'right';

/** A single 3D point as returned by MediaPipe. y grows downward. */
export interface Point3 {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/** One sampled video frame after pose detection. */
export interface PoseFrame {
  /** Seconds from the start of the video. */
  t: number;
  /** Normalized image coordinates in [0, 1]. Carries global translation. */
  landmarks: Point3[];
  /** Metric coordinates in meters, origin at the hip midpoint. */
  world: Point3[];
  /** Mean visibility across the joints gait analysis actually depends on. */
  quality: number;
}

export interface PoseSequence {
  frames: PoseFrame[];
  /** Effective sampling rate after decimation, in frames per second. */
  fps: number;
  durationSec: number;
  videoWidth: number;
  videoHeight: number;
  /** Evenly spaced JPEG data URLs handed to track B and stored as thumbnails. */
  keyFrames: string[];
}

/** Which anatomical plane the camera was looking at. */
export type CameraView = 'sagittal' | 'frontal' | 'unknown';

/** One detected gait event. */
export interface GaitEvent {
  side: Side;
  type: 'heelStrike' | 'toeOff';
  t: number;
  frameIndex: number;
}

/** A complete stride for one side: heel strike to the next ipsilateral strike. */
export interface GaitCycle {
  side: Side;
  startT: number;
  endT: number;
  /** Toe-off time within the cycle, or null when it could not be resolved. */
  toeOffT: number | null;
  durationSec: number;
  stancePercent: number | null;
}

/** A joint angle curve resampled onto 0-100% of the gait cycle. */
export interface CycleCurve {
  /** 101 samples, index i == i% of the gait cycle. Degrees. */
  values: number[];
  min: number;
  max: number;
  rom: number;
}

export interface SideKinematics {
  hip: CycleCurve | null;
  knee: CycleCurve | null;
  ankle: CycleCurve | null;
  /** Peak knee flexion during swing (roughly 60-100% of cycle). Degrees. */
  peakKneeFlexionSwing: number | null;
  /** Knee flexion at initial contact. Degrees. */
  kneeFlexionAtContact: number | null;
  /** Shoulder flex/extend range used as an arm swing proxy. Degrees. */
  armSwingRom: number | null;
}

export interface SpatiotemporalSide {
  stepTimeSec: number | null;
  strideTimeSec: number | null;
  stancePercent: number | null;
  swingPercent: number | null;
  stepLengthM: number | null;
  strideLengthM: number | null;
}

export interface SymmetryEntry {
  label: string;
  left: number;
  right: number;
  /** |L-R| / (0.5*(L+R)) * 100. Lower is better. */
  index: number;
}

export interface GaitQuality {
  /** Mean landmark visibility over the joints that matter, 0-1. */
  landmarkVisibility: number;
  /** Number of complete strides detected per side. */
  cyclesLeft: number;
  cyclesRight: number;
  /** userHeight / stature implied by the world landmarks. Should be near 1. */
  scaleFactor: number;
  effectiveFps: number;
  view: CameraView;
  /** Human-readable problems found while processing. */
  warnings: string[];
  /** 0-1 overall confidence in the track A numbers. */
  score: number;
}

export interface DetectedPattern {
  key: string;
  label: string;
  /** What in the data triggered this. */
  evidence: string;
  severity: 'mild' | 'moderate' | 'marked';
}

export interface ScoreBreakdown {
  /** Left-right symmetry. 0-25 */
  symmetry: number;
  /** Cadence and stance/swing timing. 0-25 */
  rhythm: number;
  /** Joint range of motion versus normative values. 0-25 */
  kinematics: number;
  /** Trunk control and step-to-step consistency. 0-25 */
  stability: number;
}

/** Track A output. Every number here comes from arithmetic, not from a model. */
export interface GaitMetrics {
  cadenceStepsPerMin: number | null;
  gaitCycleTimeSec: number | null;
  doubleSupportPercent: number | null;
  walkingSpeedMps: number | null;
  stepWidthM: number | null;
  /** Coefficient of variation of stride time, as a percentage. */
  strideTimeCvPercent: number | null;

  left: SpatiotemporalSide;
  right: SpatiotemporalSide;

  kinematics: {
    left: SideKinematics;
    right: SideKinematics;
  };

  /** Mean forward trunk lean in degrees. Positive is leaning forward. */
  trunkLeanDeg: number | null;
  /** Peak-to-peak lateral trunk sway in degrees. */
  trunkSwayDeg: number | null;
  /** Peak contralateral pelvic drop during single support. Degrees. */
  pelvicDropDeg: number | null;

  symmetry: SymmetryEntry[];
  /** Mean of the symmetry indices above. */
  overallSymmetryIndex: number | null;

  events: GaitEvent[];
  cycles: GaitCycle[];

  quality: GaitQuality;
  patterns: DetectedPattern[];
  scoreBreakdown: ScoreBreakdown;
  score: number;
  riskLevel: RiskLevel;
}

export type RiskLevel = '低' | '中' | '高';

/** Track B output. Gemini's independent read of the sampled frames. */
export interface TrackBObservation {
  /** Gemini's own cadence estimate, steps per minute. */
  estimatedCadence: number | null;
  /** Gemini's own read of left-right asymmetry, 0-100 where 0 is symmetric. */
  estimatedAsymmetry: number | null;
  /** Which view Gemini thinks the camera was in. */
  observedView: CameraView;
  /** Gait abnormalities Gemini believes it can see. */
  observedAbnormalities: string[];
  /** Things the landmark pipeline structurally cannot see. */
  qualitativeNotes: {
    painIndicators: string;
    clothingOcclusion: string;
    footwear: string;
    environment: string;
    assistiveDevice: string;
  };
  /** Gemini's own 0-1 confidence that the frames were analyzable. */
  frameQuality: number;
}

export interface TrackAgreement {
  metric: string;
  trackA: number | null;
  trackB: number | null;
  /** Relative difference as a percentage, or null if either side is missing. */
  deltaPercent: number | null;
  agrees: boolean | null;
}

export interface TrackReconciliation {
  agreements: TrackAgreement[];
  /** 0-1. Combines track agreement with track A's own quality score. */
  confidence: number;
  level: 'high' | 'medium' | 'low';
  /** Why the confidence landed where it did. */
  notes: string[];
  /** True when the two tracks disagree badly enough to warrant a re-shoot. */
  recommendsReshoot: boolean;
}

export interface Exercise {
  name: string;
  description: string;
  duration: string;
  benefit: string;
  steps: string[];
  coachTip: string;
}

/** The final report Gemini writes, grounded in track A's numbers. */
export interface GaitInterpretation {
  summary: string;
  findings: {
    spatiotemporal: string;
    symmetry: string;
    kinematics: string;
    posturalControl: string;
  };
  clinicalConcerns: string[];
  recommendations: string[];
  exercises: Exercise[];
  /** Gemini's comment on how well the two tracks lined up. */
  consistencyComment: string;
}

/** Everything one analysis run produces. */
export interface GaitAnalysis {
  metrics: GaitMetrics;
  trackB: TrackBObservation | null;
  reconciliation: TrackReconciliation;
  interpretation: GaitInterpretation;
  heightCm: number;
}

// --- History records -------------------------------------------------------

/** Legacy static-posture analysis. Kept read-only; no longer produced. */
export interface LegacyPostureAnalysis {
  alignment?: Record<string, string>;
  metrics?: Record<string, number>;
  scoreBreakdown?: Record<string, number>;
  summary?: string;
  recommendations?: string[];
  exercises?: Exercise[];
  riskLevel?: RiskLevel;
  score?: number;
}

export interface GaitHistoryItem {
  id: string;
  type: 'gait';
  date: string;
  analysis: GaitAnalysis;
  keyFrames: string[];
  userId?: string;
}

export interface PostureHistoryItem {
  id: string;
  type: 'posture';
  date: string;
  analysis: LegacyPostureAnalysis;
  frontImage?: string;
  sideImage?: string;
  userId?: string;
}

export type HistoryItem = GaitHistoryItem | PostureHistoryItem;
