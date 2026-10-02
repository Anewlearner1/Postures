/**
 * 這個檔案做什麼：測試 MP4／MOV 目錄解析（影格數、長度、影格率、編碼格式）。
 * 用程式組出最小的 MP4 box 結構，不需要真的影片檔。
 */

import { describe, expect, it } from "vitest";
import { isHevc, isTruncatedMp4, parseMoov, readContainerVideoInfo } from "./mp4-metadata";

function u32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

function box(type: string, ...payload: number[][]): number[] {
  const body = payload.flat();
  return [...u32(body.length + 8), ...ascii(type), ...body];
}

function videoTrak({
  handler = "vide",
  timescale = 600,
  stts = [[300, 20]] as [number, number][],
  codec = "avc1",
} = {}): number[] {
  const mdhd = box("mdhd", [0, 0, 0, 0], u32(0), u32(0), u32(timescale), u32(0), [0, 0, 0, 0]);
  const hdlr = box("hdlr", [0, 0, 0, 0], u32(0), ascii(handler), u32(0), u32(0), u32(0), [0]);
  const sttsBox = box("stts", [0, 0, 0, 0], u32(stts.length), ...stts.map(([count, delta]) => [...u32(count), ...u32(delta)]));
  const stsd = box("stsd", [0, 0, 0, 0], u32(1), box(codec, new Array(78).fill(0)));
  const stbl = box("stbl", stsd, sttsBox);
  const minf = box("minf", stbl);
  const mdia = box("mdia", mdhd, hdlr, minf);
  return box("trak", box("tkhd", new Array(84).fill(0)), mdia);
}

function file(...boxes: number[][]): Uint8Array {
  return new Uint8Array(boxes.flat());
}

const reader = (bytes: Uint8Array) => async (offset: number, length: number) => bytes.subarray(offset, offset + length);

describe("parseMoov", () => {
  it("讀出影片軌的影格數、長度、影格率與編碼", () => {
    const moov = new Uint8Array(box("moov", box("mvhd", new Array(100).fill(0)), videoTrak()));
    expect(parseMoov(moov)).toEqual({ codec: "avc1", frameCount: 300, durationSec: 10, fps: 30 });
  });

  it("跳過聲音軌，找到影片軌", () => {
    const moov = new Uint8Array(
      box("moov", videoTrak({ handler: "soun", codec: "mp4a" }), videoTrak({ codec: "hvc1", timescale: 90000, stts: [[600, 1500]] })),
    );
    expect(parseMoov(moov)).toMatchObject({ codec: "hvc1", frameCount: 600, durationSec: 10, fps: 60 });
  });

  it("可變影格率：用平均影格率", () => {
    const moov = new Uint8Array(box("moov", videoTrak({ stts: [[100, 20], [50, 40]] })));
    // 100×20 + 50×40 = 4000 ticks = 6.667 秒，共 150 格 → 22.5 fps
    const info = parseMoov(moov);
    expect(info?.frameCount).toBe(150);
    expect(info?.fps).toBeCloseTo(22.5, 5);
  });

  it("分段式 MP4（有 mvex）回傳 null", () => {
    const moov = new Uint8Array(box("moov", videoTrak(), box("mvex", [])));
    expect(parseMoov(moov)).toBeNull();
  });

  it("沒有影片軌時回傳 null", () => {
    const moov = new Uint8Array(box("moov", videoTrak({ handler: "soun" })));
    expect(parseMoov(moov)).toBeNull();
  });
});

describe("readContainerVideoInfo", () => {
  it("moov 在檔案後面（ftyp、mdat 之後）也找得到", async () => {
    const bytes = file(box("ftyp", ascii("isom"), u32(0)), box("mdat", new Array(5000).fill(1)), box("moov", videoTrak()));
    await expect(readContainerVideoInfo(reader(bytes), bytes.length)).resolves.toMatchObject({ fps: 30 });
  });

  it("不是 MP4 的檔案回傳 null，不會丟出錯誤", async () => {
    const bytes = new Uint8Array(ascii("RIFF....AVI LIST this is not an mp4 file at all"));
    await expect(readContainerVideoInfo(reader(bytes), bytes.length)).resolves.toBeNull();
  });

  it("截斷的檔案回傳 null", async () => {
    const full = file(box("ftyp", ascii("isom")), box("moov", videoTrak()));
    const truncated = full.subarray(0, full.length - 40);
    await expect(readContainerVideoInfo(reader(truncated), truncated.length)).resolves.toBeNull();
  });
});

describe("isHevc", () => {
  it("辨識 HEVC 編碼代碼", () => {
    expect(isHevc("hvc1")).toBe(true);
    expect(isHevc("hev1")).toBe(true);
    expect(isHevc("avc1")).toBe(false);
    expect(isHevc(undefined)).toBe(false);
  });
});

describe("isTruncatedMp4（M5 QA F-06）", () => {
  const full = file(box("ftyp", ascii("isom"), u32(0)), box("moov", videoTrak()), box("mdat", new Array(5000).fill(1)));

  it("完整的檔案：沒有被截掉", async () => {
    await expect(isTruncatedMp4(reader(full), full.length)).resolves.toBe(false);
  });

  it("後半段被截掉（影片資料不完整）", async () => {
    const cut = full.subarray(0, full.length - 2000);
    await expect(isTruncatedMp4(reader(cut), cut.length)).resolves.toBe(true);
  });

  it("目錄在檔尾、檔案被截掉時也看得出來", async () => {
    const moovLast = file(box("ftyp", ascii("isom")), box("mdat", new Array(5000).fill(1)), box("moov", videoTrak()));
    const cut = moovLast.subarray(0, 3000);
    await expect(isTruncatedMp4(reader(cut), cut.length)).resolves.toBe(true);
  });

  it("不是 MP4 的檔案不判斷（交給瀏覽器）", async () => {
    const bytes = new Uint8Array(ascii("RIFF....AVI LIST this is not an mp4 file at all"));
    await expect(isTruncatedMp4(reader(bytes), bytes.length)).resolves.toBe(false);
  });
});
