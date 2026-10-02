/**
 * 這個檔案做什麼：
 *   拒絕並請重拍的判斷（docs/spec/gait-rules.md §7.1、SPEC D13 底線）。任一成立就不出報告。
 *   判斷順序（M4 調整）：
 *     1. earlyReject：too_short → low_fps_reject → no_person → multi_person（有 poseCount 的直接證據）
 *     2. sideViewReject：not_side_view（需要先切直線段）
 *     3. qualityReject：multi_person（骨架跳動推測）→ body_incomplete
 *     4. cycleReject：no_gait_cycle（沒有有效週期、且每一趟走道偏轉角 > 30° 時改報 not_side_view，M5）
 *   not_side_view 放在「骨架跳動推測的 multi_person」與 body_incomplete 之前：正面／背面走時人常很小、
 *   關鍵點跳動大，鼻子也常看不到，若先判這兩項，使用者會收到錯誤的重拍理由（真人背影影片曾被判 multi_person）。
 *   量測值由 `src/lib/gait/quality.ts` 計算。
 */

import type { RejectCode } from "@/lib/gait/types";
import { REJECT } from "./thresholds";

export interface RejectMeasurements {
  durationSec: number;
  fps: number;
  /** 偵測到人的影格比例。 */
  detectedFraction: number;
  /** poseCount ≥ 2 的影格佔偵測影格的比例（沒有 poseCount 資料時為 undefined）。 */
  multiPoseFraction?: number;
  /** 骨架整體跳動（疑似換人）的次數。 */
  identityJumps: number;
  /** 全身完整影格比例。 */
  completeBodyFraction: number;
}

/** 影片層級、有直接證據的拒絕（不需要切段就能判斷）。 */
export function earlyReject(m: RejectMeasurements): RejectCode | undefined {
  if (!(m.durationSec >= REJECT.minDurationSec)) return "too_short";
  if (!(m.fps >= REJECT.minFps)) return "low_fps_reject";
  if (!(m.detectedFraction >= REJECT.minDetectedFraction)) return "no_person";
  if (m.multiPoseFraction !== undefined && m.multiPoseFraction >= REJECT.multiPersonFrameFraction) return "multi_person";
  return undefined;
}

/** 在拍攝角度確認是側面之後才判斷的拒絕：骨架跳動推測的 multi_person、body_incomplete。 */
export function qualityReject(m: RejectMeasurements): RejectCode | undefined {
  if (m.identityJumps >= REJECT.identityJumpCount) return "multi_person";
  if (!(m.completeBodyFraction >= REJECT.minCompleteBodyFraction)) return "body_incomplete";
  return undefined;
}

/**
 * 拍攝角度：所有直線段的髖寬比 > 0.5 → not_side_view；
 * 沒有直線段時（幾乎沒有水平位移），若身體寬度比 > 0.35（正面或背面朝鏡頭）也判 not_side_view，否則留給 no_gait_cycle。
 */
export function sideViewReject(passHipRatios: readonly number[], bodyWidthRatioNoPass: number): RejectCode | undefined {
  if (passHipRatios.length > 0) {
    return passHipRatios.every((ratio) => ratio > REJECT.notSideViewHipRatio) ? "not_side_view" : undefined;
  }
  return bodyWidthRatioNoPass > REJECT.noPassFrontalRatio ? "not_side_view" : undefined;
}

/** §7.1：通過 §2.4 檢查的完整週期 = 0 → no_gait_cycle（D13 底線）。 */
export function cycleReject(validCyclesTotal: number, passYawDeg: readonly number[] = []): RejectCode | undefined {
  if (validCyclesTotal > 0) return undefined;
  // M5（A-6）：有在走、卻沒有任何完整週期，而且走道明顯斜對鏡頭 → 真正的原因是拍攝角度
  if (passYawDeg.length > 0 && passYawDeg.every((yaw) => yaw > REJECT.noCycleNotSideViewYawDeg)) return "not_side_view";
  return "no_gait_cycle";
}
