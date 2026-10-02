/**
 * 錯誤／請重拍文案的檢查（M5 品質驗證）：
 *   - 每個代碼都有標題、說明與主要按鈕
 *   - 帶數字的說明（秒數、fps）不可以和「被擋下的原因」互相矛盾
 *     例如 5.9 秒被判「太短」（下限 6 秒），文案卻寫「只有 6 秒」。
 * 已知問題用 it.fails 記錄（見 docs/review/M5-qa.md F-07），修正後改成 it。
 */

import { describe, expect, it } from "vitest";
import { PREFLIGHT_LIMITS } from "@/lib/pose/preflight";
import { isRetakeCode, RETAKE_CODES, RETAKE_MESSAGES } from "./retake-messages";

describe("錯誤／請重拍文案", () => {
  it("每個代碼都有標題、說明與主要按鈕", () => {
    for (const code of RETAKE_CODES) {
      const message = RETAKE_MESSAGES[code];
      expect(message.title.length, code).toBeGreaterThan(0);
      expect(message.description.length, code).toBeGreaterThan(0);
      expect(message.primary, code).toBeDefined();
    }
  });

  it("不認得的代碼（含大小寫不同、原型鏈上的名稱）不算有效代碼", () => {
    expect(isRetakeCode("NO_PERSON")).toBe(false);
    expect(isRetakeCode("toString")).toBe(false);
    expect(isRetakeCode("__proto__")).toBe(false);
    expect(isRetakeCode("no_person")).toBe(true);
  });

  it("太短：明顯不足時顯示實際秒數", () => {
    expect(RETAKE_MESSAGES.too_short.describe?.({ durationSec: 4.2 })).toContain("只有 4 秒");
  });

  it.fails("F-07 太短：5.9 秒被擋下時，文案不可寫成「只有 6 秒」（下限就是 6 秒）", () => {
    const text = RETAKE_MESSAGES.too_short.describe?.({ durationSec: 5.9 }) ?? "";
    expect(text).not.toContain(`只有 ${PREFLIGHT_LIMITS.minDurationSec} 秒`);
  });

  it.fails("F-07 影格率太低：14.6 fps 被擋下時，文案不可寫成「每秒只有 15 個畫面」（下限就是 15）", () => {
    const text = RETAKE_MESSAGES.low_fps_reject.describe?.({ fps: 14.6 }) ?? "";
    expect(text).not.toContain(`只有 ${PREFLIGHT_LIMITS.minFps} 個畫面`);
  });
});
