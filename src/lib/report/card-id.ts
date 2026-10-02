/**
 * 這個檔案做什麼：
 *   問題＋子型態 → 報告卡片代碼的對應（前端與後端共用；刻意不引用動作庫，讓前端程式保持輕量）。
 */

import type { CardId } from "@/data/problem-copy";
import type { ProblemCode, ProblemSubtype } from "@/lib/gait/types";

export function cardIdOf(finding: { problem: ProblemCode; subtype?: ProblemSubtype }): CardId {
  switch (finding.problem) {
    case "hip_extension_deficit":
      return "hip_extension_deficit";
    case "trunk_head_forward_lean":
      return "trunk_forward_lean";
    case "knee_flexion_abnormal":
      return finding.subtype === "knee_stance_flexion_high" ? "knee_stance_flexion_high" : "knee_swing_flexion_low";
  }
}
