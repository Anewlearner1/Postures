/**
 * 這個檔案做什麼：
 *   validate-video.ts 的單元測試（範例測試）。執行方式：npm test
 *   每個 it(...) 是一個情境：給定一個檔案，預期檢查結果是什麼。
 */

import { describe, expect, it } from "vitest";
import { getExtension, validateVideoFile } from "./validate-video";

const MB = 1024 * 1024;

describe("getExtension", () => {
  it("回傳小寫副檔名", () => {
    expect(getExtension("Walk.MOV")).toBe("mov");
    expect(getExtension("my.walk.mp4")).toBe("mp4");
  });

  it("沒有副檔名時回傳空字串", () => {
    expect(getExtension("video")).toBe("");
  });
});

describe("validateVideoFile", () => {
  it("接受 MP4 與 MOV", () => {
    expect(validateVideoFile({ name: "a.mp4", type: "video/mp4", size: 30 * MB })).toEqual({ ok: true });
    expect(validateVideoFile({ name: "a.MOV", type: "video/quicktime", size: 30 * MB })).toEqual({ ok: true });
  });

  it("瀏覽器沒給檔案類型時，用副檔名判斷", () => {
    expect(validateVideoFile({ name: "a.mp4", type: "", size: MB })).toEqual({ ok: true });
  });

  it("其他影片格式 → 格式不支援", () => {
    expect(validateVideoFile({ name: "a.avi", type: "video/x-msvideo", size: MB })).toEqual({
      ok: false,
      code: "unsupported_format",
    });
  });

  it("不是影片 → 不是影片檔", () => {
    expect(validateVideoFile({ name: "photo.jpg", type: "image/jpeg", size: MB })).toEqual({
      ok: false,
      code: "not_video",
    });
  });

  it("超過大小上限 → 檔案太大", () => {
    expect(validateVideoFile({ name: "a.mp4", type: "video/mp4", size: 201 * MB }, 200)).toEqual({
      ok: false,
      code: "too_large",
    });
  });

  it("剛好等於上限仍可接受", () => {
    expect(validateVideoFile({ name: "a.mp4", type: "video/mp4", size: 200 * MB }, 200)).toEqual({ ok: true });
  });
});
