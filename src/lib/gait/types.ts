/**
 * 這個檔案做什麼：
 *   定義「步態分析」會用到的核心資料型別（只有型別，沒有任何計算邏輯）。
 *   名稱與代碼一律對齊 `docs/spec/gait-rules.md`（以下簡稱「規則文件」），
 *   之後寫演算法（M3）時，所有模組都以這裡的型別互相溝通。
 *
 * 閱讀提示（給沒有程式背景的人）：
 *   - `type X = "a" | "b"` 意思是「X 只能是 a 或 b 其中一個」。
 *   - `interface` 是一筆資料的欄位清單，`?` 表示該欄位可以沒有。
 *   - 角度單位一律是「度」，正負號依規則文件 §0.5（屈曲為正、伸展為負）。
 */

// ---------------------------------------------------------------------------
// 1. 骨架關鍵點（MediaPipe Pose 的輸出，規則文件 §0.1）
// ---------------------------------------------------------------------------

/** 單一關鍵點。x、y 以影像寬、高正規化到 0–1；z 越小越靠近鏡頭。 */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  /** 0–1，這個點「看得見且沒被遮住」的可能性；< 0.5 視為缺值（§1.2）。 */
  visibility: number;
}

/** 本產品會用到的 MediaPipe 關鍵點編號（§0.1）。 */
export const LANDMARK = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

/** 一個影格的偵測結果。偵測不到人時 landmarks 為 null。 */
export interface PoseFrame {
  /** 第幾個影格（從 0 開始）。 */
  frameIndex: number;
  /** 這個影格在影片中的時間（秒）。 */
  timeSec: number;
  /** 33 個關鍵點；偵測不到人時為 null。 */
  landmarks: Landmark[] | null;
}

/** 一整段影片的骨架序列與影片基本資訊。 */
export interface PoseSequence {
  frames: PoseFrame[];
  fps: number;
  /** 影像寬、高（像素）。算角度前要先換成像素座標（§0.2）。 */
  videoWidth: number;
  videoHeight: number;
  durationSec: number;
}

// ---------------------------------------------------------------------------
// 2. 步態事件與週期（規則文件 §2）
// ---------------------------------------------------------------------------

/** 左右側。內部會分側計算，但「不會」顯示給使用者或送給 AI（D26）。 */
export type Side = "left" | "right";

/** 行走方向：+1 往畫面右邊、−1 往畫面左邊（§0.3）。 */
export type WalkDirection = 1 | -1;

/** 一段直線行走（扣除轉身，§2.2）。 */
export interface WalkingPass {
  passIndex: number;
  direction: WalkDirection;
  startSec: number;
  endSec: number;
  /** 這一趟靠近鏡頭的那一側（§1.4）。 */
  nearSide: Side;
}

/** 步態事件種類：腳跟著地（HS）或腳尖離地（TO）（§2.3）。 */
export type GaitEventType = "heel_strike" | "toe_off";

export interface GaitEvent {
  type: GaitEventType;
  side: Side;
  passIndex: number;
  /** 事件發生時間（秒，可含次影格精度）。 */
  timeSec: number;
}

/** 一個完整步態週期：同側 HS → TO → 下一個 HS（§2.4）。 */
export interface GaitCycle {
  side: Side;
  passIndex: number;
  heelStrikeSec: number;
  toeOffSec: number;
  nextHeelStrikeSec: number;
  /** 是否通過 §2.4 的合理性檢查；不通過的週期不計算指標。 */
  valid: boolean;
  /** 是否落在每趟起點／終點 0.5 秒內（加減速週期，§2.2 第 6 點）。 */
  isAccelerationCycle: boolean;
}

// ---------------------------------------------------------------------------
// 3. 指標（規則文件 §3.2、§4.2、§5.2）
// ---------------------------------------------------------------------------

/**
 * 單一週期算出的指標（度）。算不出來的指標為 undefined。
 *   PHE    峰值髖伸展（軀幹—大腿角），正值＝伸展幾度（主要指標，D23）
 *   TE     大腿後擺角（大腿相對垂直），髖伸展的交叉檢查
 *   PKF_sw 擺盪期最大膝屈曲
 *   KIC    初始著地膝角
 *   KLR    承重期最大膝屈曲（輔助，不單獨判斷）
 *   TRK    軀幹前傾角（整週期平均）
 *   NCK    頸傾角（頭部前傾，只作觀察，D25；不送 AI）
 */
export interface GaitMetrics {
  PHE?: number;
  TE?: number;
  PKF_sw?: number;
  KIC?: number;
  KLR?: number;
  TRK?: number;
  NCK?: number;
}

/** 單一週期的指標結果。 */
export interface CycleMetrics {
  cycle: GaitCycle;
  metrics: GaitMetrics;
}

/** 某一側跨週期彙總後的結果（§2.6）：取中位數，並記錄有效週期數與離散程度。 */
export interface SideSummary {
  side: Side;
  validCycles: number;
  median: GaitMetrics;
  /** 各指標跨週期的標準差，用於 `high_variability` 可信度因子。 */
  stdDev: GaitMetrics;
}

// ---------------------------------------------------------------------------
// 4. 判斷結果：問題、嚴重度、可信度（規則文件 §3–§8）
// ---------------------------------------------------------------------------

/** 內部嚴重度分級。使用者看到的柔和版標籤見 UX 文件 §4.1（D20）。 */
export type Severity = "normal" | "mild" | "marked";

/** 第一版偵測的三個問題（SPEC D5）。 */
export type ProblemCode =
  | "hip_extension_deficit"
  | "knee_flexion_abnormal"
  | "trunk_head_forward_lean";

/** 問題的子型態（§4、§5）。膝過伸延到第二版（D24），這裡刻意不列。 */
export type ProblemSubtype =
  | "knee_swing_flexion_low"
  | "knee_stance_flexion_high"
  | "trunk_forward_lean";

/** 可能原因代碼（§3.4、§4.4、§5.4），用來對應動作庫。 */
export type CauseCode =
  | "hip_flexor_tightness"
  | "glute_weakness"
  | "weak_push_off"
  | "slow_short_stride"
  | "pain_guarding"
  | "quad_rectus_tightness"
  | "hamstring_tightness"
  | "quad_weakness"
  | "knee_pain_swelling"
  | "thoracic_stiffness"
  | "pec_tightness"
  | "back_scapular_endurance"
  | "pain_balance_osteoporosis";

/** 內部可信度三級（§6.3、§6.4）。 */
export type Confidence = "high" | "medium" | "low";

/** 顯示給使用者的可信度（D28）：高 → good；中 → good_with_tip；低 → low。 */
export type ConfidenceDisplay = "good" | "good_with_tip" | "low";

/** 降低可信度的原因代碼（§6.2）。文案見 UX 文件 §4.5。 */
export type ConfidenceReason =
  | "angle_off"
  | "occlusion"
  | "few_cycles"
  | "high_variability"
  | "subject_small"
  | "partial_out_of_frame"
  | "low_light"
  | "camera_motion"
  | "camera_tilt"
  | "lens_distortion"
  | "low_fps"
  | "lr_swap"
  | "irregular_pace";

/** 拒絕分析、請使用者重拍的代碼（§7.1）。文案見 UX 文件 §5。 */
export type RejectCode =
  | "no_person"
  | "multi_person"
  | "body_incomplete"
  | "no_gait_cycle"
  | "not_side_view"
  | "too_short"
  | "low_fps_reject";

/** 單一問題的判斷結果（對應規則文件 §8 輸出範例的 findings）。 */
export interface Finding {
  problem: ProblemCode;
  subtype?: ProblemSubtype;
  severity: Severity;
  /** 決定整體分級那一側的代表數值（不含左右側資訊，D26）。 */
  metrics: GaitMetrics;
  metricConfidence: Confidence;
  /** 是否在界線 ±1.5 度內（§3.3「接近臨界」）。 */
  nearThreshold: boolean;
  candidateCauses: CauseCode[];
  /** 問題出現的時間點（秒），給骨架回放時間軸使用。 */
  timestampsSec?: number[];
}

/** 觀察項目（目前只有頭部位置，D25）：不分級、不給練習。 */
export interface Observation {
  item: "head_forward";
  status: "observed" | "not_assessable";
}

/** 整體可信度。 */
export interface ConfidenceSummary {
  overall: Confidence;
  display: ConfidenceDisplay;
  /** 最多 2 個主要原因（§6.4）。 */
  reasons: ConfidenceReason[];
}

/**
 * 一次分析的完整結果（對應規則文件 §8「交給 LLM 的結構化結果」）。
 * AI 只能把它寫成白話，不能改動任何數值與分級。
 */
export interface AnalysisResult {
  rulesVersion: string;
  /** "beta" = 報告顯示「測試版標準」標籤（D22）。 */
  standardLabel: "beta" | "v1";
  confidence: ConfidenceSummary;
  walking: {
    passes: number;
    validCyclesTotal: number;
    /** 走得偏慢：只附註，不調整嚴重度（D27）。 */
    slowSpeed: boolean;
  };
  /** 使用者是否屬於提醒族群（孕婦、神經方面狀況、正在疼痛，D30）。 */
  populationCaveat: boolean;
  findings: Finding[];
  observations: Observation[];
}

/** 分析的最終結果：成功產出報告，或依底線規則請使用者重拍（D13）。 */
export type AnalysisOutcome =
  | { status: "ok"; result: AnalysisResult }
  | { status: "rejected"; code: RejectCode };
