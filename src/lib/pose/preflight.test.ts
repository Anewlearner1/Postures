/**
 * 這個檔案做什麼：測試影片前置檢查（太短、影格率太低、讀不到畫面、太長只分析前 20 秒）與取樣計畫。
 */

import { describe, expect, it } from "vitest";
import { evaluateVideo, formatClock, frameSamples, PREFLIGHT_LIMITS, type VideoMeta } from "./preflight";

const base: VideoMeta = { durationSec: 14, width: 1920, height: 1080, fps: 30, fpsSource: "container", codec: "avc1" };

describe("evaluateVideo", () => {
  it("一般 14 秒、30 fps 影片：整段分析、每格都取", () => {
    const result = evaluateVideo(base);
    expect(result).toEqual({
      ok: true,
      plan: { untilSec: 14, trimmed: false, sourceFps: 30, frameStep: 1, effectiveFps: 30, frameCount: 420 },
    });
  });

  it("短於 6 秒擋下（too_short），並帶出秒數給文案使用", () => {
    expect(evaluateVideo({ ...base, durationSec: 4.2 })).toEqual({ ok: false, code: "too_short", durationSec: 4.2 });
  });

  it("剛好 6 秒不擋（6–10 秒照常分析，UX Q7）", () => {
    expect(evaluateVideo({ ...base, durationSec: 6 }).ok).toBe(true);
  });

  it("影格率低於 15 fps 擋下（low_fps_reject）", () => {
    expect(evaluateVideo({ ...base, fps: 12 })).toEqual({ ok: false, code: "low_fps_reject", fps: 12 });
  });

  it("寬高為 0（解不出畫面）視為格式不支援", () => {
    expect(evaluateVideo({ ...base, width: 0, height: 0 })).toEqual({ ok: false, code: "unsupported_format" });
  });

  it("長度讀不到視為無法讀取", () => {
    expect(evaluateVideo({ ...base, durationSec: Number.NaN })).toEqual({ ok: false, code: "video_unreadable" });
  });

  it("20–30 秒整段分析，不提示", () => {
    const result = evaluateVideo({ ...base, durationSec: 28 });
    expect(result.ok && result.plan).toMatchObject({ untilSec: 28, trimmed: false });
  });

  it("超過 30 秒：只分析前 20 秒（暫定作法）", () => {
    const result = evaluateVideo({ ...base, durationSec: 45 });
    expect(result.ok && result.plan).toMatchObject({ untilSec: PREFLIGHT_LIMITS.trimToSec, trimmed: true, frameCount: 600 });
  });

  it("60 fps 影片隔格取樣，取樣後 30 fps（≥ 25 fps，gait-rules §1.1）", () => {
    const result = evaluateVideo({ ...base, fps: 59.94, durationSec: 10 });
    expect(result.ok && result.plan).toMatchObject({ frameStep: 2, frameCount: 299 });
    expect(result.ok && result.plan.effectiveFps).toBeCloseTo(29.97, 2);
  });

  it("讀不到影格率時假設 30 fps，不擋下", () => {
    const result = evaluateVideo({ ...base, fps: null, fpsSource: "unknown" });
    expect(result.ok && result.plan).toMatchObject({ sourceFps: 30, frameCount: 420 });
  });
});

describe("frameSamples", () => {
  it("每格的時間戳是該格開始的時間，跳轉位置在格子中間偏前", () => {
    const result = evaluateVideo({ ...base, durationSec: 6, fps: 30 });
    if (!result.ok) throw new Error("expected ok");
    const samples = frameSamples(result.plan);
    expect(samples).toHaveLength(180);
    expect(samples[0]).toEqual({ index: 0, timeSec: 0, seekSec: 0.25 / 30 });
    expect(samples[30].timeSec).toBeCloseTo(1, 10);
    expect(samples[179].timeSec).toBeLessThan(6);
  });

  it("隔格取樣時，跳轉位置仍落在原始影格內", () => {
    const result = evaluateVideo({ ...base, durationSec: 6, fps: 60 });
    if (!result.ok) throw new Error("expected ok");
    const samples = frameSamples(result.plan);
    expect(samples[1].timeSec).toBeCloseTo(1 / 30, 10);
    expect(samples[1].seekSec - samples[1].timeSec).toBeLessThan(1 / 60);
  });
});

describe("formatClock", () => {
  it("秒數轉成 m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(3.9)).toBe("0:03");
    expect(formatClock(74)).toBe("1:14");
  });
});
