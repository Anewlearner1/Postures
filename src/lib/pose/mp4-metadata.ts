/**
 * 這個檔案做什麼：
 *   直接讀 MP4／MOV 檔案的「目錄」（moov box），取得影片軌的影格數、長度、影格率與編碼格式。
 *   瀏覽器的 <video> 不會告訴我們影格率（fps），但逐格分析需要知道每一格的時間，
 *   所以在這裡自己讀。只讀檔案的目錄部分（通常幾十 KB），不解碼畫面，也不會上傳任何東西。
 *
 *   讀不懂的檔案（例如分段式 MP4）回傳 null，呼叫端改用播放取樣的方式估計影格率。
 */

/** 從檔案目錄讀到的影片軌資訊。 */
export interface ContainerVideoInfo {
  /** 編碼格式代碼，例如 avc1（H.264）、hvc1／hev1（HEVC）、vp09、av01。 */
  codec: string;
  /** 影片軌的影格數。 */
  frameCount: number;
  /** 影片軌長度（秒）。 */
  durationSec: number;
  /** 平均影格率 = 影格數 ÷ 長度。 */
  fps: number;
}

/** 可以「從某個位置讀幾個位元組」的來源；瀏覽器的 File／Blob 用 blobReader() 包起來。 */
export type ByteReader = (offset: number, length: number) => Promise<Uint8Array>;

export function blobReader(blob: Blob): ByteReader {
  return async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
}

/** moov 太大（> 32 MB）就不讀，避免手機記憶體不足。 */
const MAX_MOOV_BYTES = 32 * 1024 * 1024;

interface Box {
  type: string;
  /** box 內容（不含標頭）在來源中的起點。 */
  start: number;
  /** box 內容的結束位置（不含）。 */
  end: number;
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** 讀 64 位元無號整數（影片長度不會超過 2^53，可安全轉成 number）。 */
function readU64(dv: DataView, offset: number): number {
  return dv.getUint32(offset) * 2 ** 32 + dv.getUint32(offset + 4);
}

/** 列出記憶體中一段資料裡的子 box。 */
function childBoxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const dv = view(bytes);
  const boxes: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = dv.getUint32(offset);
    const type = fourcc(bytes, offset + 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = readU64(dv, offset + 8);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    boxes.push({ type, start: offset + header, end: offset + size });
    offset += size;
  }
  return boxes;
}

function findChild(bytes: Uint8Array, parent: Box, type: string): Box | undefined {
  return childBoxes(bytes, parent.start, parent.end).find((box) => box.type === type);
}

function findPath(bytes: Uint8Array, parent: Box, path: string[]): Box | undefined {
  let current: Box | undefined = parent;
  for (const type of path) {
    if (!current) return undefined;
    current = findChild(bytes, current, type);
  }
  return current;
}

/** 在檔案最上層找 moov box，只讀標頭，不讀整個檔案。 */
async function locateMoov(read: ByteReader, fileSize: number): Promise<{ start: number; size: number } | null> {
  let offset = 0;
  while (offset + 8 <= fileSize) {
    const header = await read(offset, 16);
    if (header.length < 8) return null;
    const dv = view(header);
    let size = dv.getUint32(0);
    const type = fourcc(header, 4);
    if (size === 1) {
      if (header.length < 16) return null;
      size = readU64(dv, 8);
    } else if (size === 0) {
      size = fileSize - offset;
    }
    if (size < 8) return null;
    if (type === "moov") return { start: offset, size };
    offset += size;
  }
  return null;
}

/** 解析 moov 內容（已讀進記憶體），找出影片軌。測試直接呼叫這個函式。 */
export function parseMoov(moov: Uint8Array): ContainerVideoInfo | null {
  const root: Box = { type: "moov", start: 8, end: moov.length };
  // 分段式 MP4 的樣本表是空的，無法從目錄得知影格數
  if (findChild(moov, root, "mvex")) return null;

  for (const trak of childBoxes(moov, root.start, root.end).filter((box) => box.type === "trak")) {
    const mdia = findChild(moov, trak, "mdia");
    if (!mdia) continue;
    const hdlr = findChild(moov, mdia, "hdlr");
    // hdlr 內容：version/flags(4) + pre_defined(4) + handler_type(4)
    if (!hdlr || hdlr.end - hdlr.start < 12 || fourcc(moov, hdlr.start + 8) !== "vide") continue;

    const mdhd = findChild(moov, mdia, "mdhd");
    const stbl = findPath(moov, mdia, ["minf", "stbl"]);
    if (!mdhd || !stbl) continue;
    const dv = view(moov);

    const version = moov[mdhd.start];
    const timescale = version === 1 ? dv.getUint32(mdhd.start + 20) : dv.getUint32(mdhd.start + 12);
    if (!timescale) continue;

    const stts = findChild(moov, stbl, "stts");
    if (!stts) continue;
    const entryCount = dv.getUint32(stts.start + 4);
    let frameCount = 0;
    let ticks = 0;
    for (let i = 0; i < entryCount; i += 1) {
      const entry = stts.start + 8 + i * 8;
      if (entry + 8 > stts.end) break;
      const count = dv.getUint32(entry);
      frameCount += count;
      ticks += count * dv.getUint32(entry + 4);
    }
    if (frameCount === 0 || ticks === 0) continue;

    const stsd = findChild(moov, stbl, "stsd");
    // stsd 內容：version/flags(4) + entry_count(4) + 第一筆 entry（size(4) + format(4) …）
    const codec = stsd && stsd.end - stsd.start >= 16 ? fourcc(moov, stsd.start + 12) : "unknown";

    const durationSec = ticks / timescale;
    return { codec, frameCount, durationSec, fps: frameCount / durationSec };
  }
  return null;
}

/** 讀取檔案的影片軌資訊；格式看不懂或沒有影片軌時回傳 null。 */
export async function readContainerVideoInfo(read: ByteReader, fileSize: number): Promise<ContainerVideoInfo | null> {
  try {
    const moov = await locateMoov(read, fileSize);
    if (!moov || moov.size > MAX_MOOV_BYTES) return null;
    return parseMoov(await read(moov.start, moov.size));
  } catch {
    return null;
  }
}

/** HEVC（高效率格式）的編碼代碼；部分瀏覽器無法播放（UX §5.6）。 */
export function isHevc(codec: string | undefined): boolean {
  return codec === "hvc1" || codec === "hev1";
}
