/**
 * 這個檔案做什麼：
 *   影片的「前置檢查」與「分析計畫」（只有判斷邏輯，不碰瀏覽器，方便測試）。
 *   選好影片、讀到長度／解析度／影格率之後，在分析前先決定：
 *   - 要不要擋下來（太短、影格率太低、讀不到畫面）——文案見 UX 文件 §5.4、§5.6、§5.11
 *   - 要分析哪一段、每秒取幾格
 *
 *   暫定作法（UX Q6「影片太長」尚未決定，前端工程師暫定，待產品負責人確認）：
 *   - 30 秒以內：整段分析。
 *   - 超過 30 秒：只分析前 20 秒，並在確認頁與報告提示。
 */

/** 前置檢查的門檻（gait-rules.md §1.1、§7.1；UX §5.4、§5.5）。 */
export const PREFLIGHT_LIMITS = {
  /** 短於 6 秒直接擋下（too_short）。 */
  minDurationSec: 6,
  /** 超過這個長度只分析前段（暫定，Q6）。 */
  longVideoSec: 30,
  /** 太長時分析的長度（秒）。 */
  trimToSec: 20,
  /** 影格率低於 15 fps 擋下（low_fps_reject）。 */
  minFps: 15,
  /** 影格率高於這個值時隔格取樣，取樣後仍 ≥ 25 fps（gait-rules §1.1）。 */
  maxProcessFps: 50,
  /** 讀不到影格率時的假設值。 */
  assumedFps: 30,
} as const;

/** 影片的基本資訊（只存在瀏覽器）。 */
export interface VideoMeta {
  durationSec: number;
  /** 畫面寬、高（像素，已套用手機直拍的旋轉）。 */
  width: number;
  height: number;
  /** 影格率；讀不到時為 null。 */
  fps: number | null;
  /** 影格率從哪裡來：檔案目錄、播放取樣估計，或讀不到。 */
  fpsSource: "container" | "estimated" | "unknown";
  /** 編碼格式代碼（例如 avc1、hvc1），讀不到時省略。 */
  codec?: string;
}

/** 分析計畫：要分析哪一段、取哪些影格。 */
export interface AnalysisPlan {
  /** 分析到第幾秒（不含）。 */
  untilSec: number;
  /** 是否因為影片太長而只分析前段。 */
  trimmed: boolean;
  /** 影片原始影格率。 */
  sourceFps: number;
  /** 每隔幾格取一格（1 = 每格都取）。 */
  frameStep: number;
  /** 實際分析的影格率 = 原始影格率 ÷ frameStep。 */
  effectiveFps: number;
  /** 要分析的影格數。 */
  frameCount: number;
}

/** 前置檢查會擋下的代碼（對應 src/data/retake-messages.ts）。 */
export type PreflightRejectCode = "too_short" | "low_fps_reject" | "unsupported_format" | "video_unreadable";

export type PreflightResult =
  | { ok: true; plan: AnalysisPlan }
  | { ok: false; code: PreflightRejectCode; durationSec?: number; fps?: number };

/** 依影片資訊決定能不能分析、要怎麼分析。 */
export function evaluateVideo(meta: VideoMeta): PreflightResult {
  if (!(meta.width > 0 && meta.height > 0)) return { ok: false, code: "unsupported_format" };
  if (!Number.isFinite(meta.durationSec) || meta.durationSec <= 0) return { ok: false, code: "video_unreadable" };

  if (meta.durationSec < PREFLIGHT_LIMITS.minDurationSec) {
    return { ok: false, code: "too_short", durationSec: meta.durationSec };
  }

  const sourceFps = meta.fps && Number.isFinite(meta.fps) && meta.fps > 0 ? meta.fps : PREFLIGHT_LIMITS.assumedFps;
  // 讀到的影格率太低才擋；讀不到時（null）用假設值，交給演算法判斷可信度
  if (meta.fps !== null && sourceFps < PREFLIGHT_LIMITS.minFps) {
    return { ok: false, code: "low_fps_reject", fps: sourceFps };
  }

  const trimmed = meta.durationSec > PREFLIGHT_LIMITS.longVideoSec;
  const untilSec = trimmed ? PREFLIGHT_LIMITS.trimToSec : meta.durationSec;
  const frameStep = sourceFps > PREFLIGHT_LIMITS.maxProcessFps ? Math.round(sourceFps / 30) : 1;
  const effectiveFps = sourceFps / frameStep;
  const frameCount = Math.max(1, Math.floor(untilSec * effectiveFps + 1e-6));

  return { ok: true, plan: { untilSec, trimmed, sourceFps, frameStep, effectiveFps, frameCount } };
}

/**
 * 每一個要分析的影格：timeSec 是該格開始的時間；seekSec 是實際跳過去的位置
 * （放在格子中間偏前，避免四捨五入跳到前一格）。
 */
export interface FrameSample {
  index: number;
  timeSec: number;
  seekSec: number;
}

export function frameSamples(plan: AnalysisPlan): FrameSample[] {
  const samples: FrameSample[] = [];
  const frameDuration = 1 / plan.sourceFps;
  for (let index = 0; index < plan.frameCount; index += 1) {
    const timeSec = index / plan.effectiveFps;
    samples.push({ index, timeSec, seekSec: timeSec + frameDuration * 0.25 });
  }
  return samples;
}

/** 秒數 → 「0:14」格式。 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds + 1e-6));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
