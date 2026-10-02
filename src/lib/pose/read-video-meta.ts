/**
 * 這個檔案做什麼：
 *   在瀏覽器裡讀取使用者選的影片的基本資訊：長度、解析度、影格率、編碼格式（只能在瀏覽器中執行）。
 *   - 長度、解析度：用一個看不見的 <video> 讀 metadata（已套用手機直拍的旋轉）。
 *   - 影格率：先讀檔案目錄（mp4-metadata.ts）；讀不到時，靜音播放約半秒、量相鄰畫面的時間差來估計。
 *   影片只在這台裝置的記憶體中讀取，不會上傳。
 */

import { blobReader, isHevc, isTruncatedMp4, readContainerVideoInfo } from "./mp4-metadata";
import type { VideoMeta } from "./preflight";

export type ReadVideoMetaResult =
  | { ok: true; meta: VideoMeta }
  | { ok: false; code: "unsupported_format" | "video_unreadable" };

const METADATA_TIMEOUT_MS = 15_000;

/** 讀取影片資訊。失敗時回傳對應的錯誤代碼（UX §5.6、§5.9）。 */
export async function readVideoMeta(file: File): Promise<ReadVideoMetaResult> {
  // 後半段被截掉的檔案：先擋下，不要分析到一半才失敗（M5 QA F-06）
  if (await isTruncatedMp4(blobReader(file), file.size)) return { ok: false, code: "video_unreadable" };
  const container = await readContainerVideoInfo(blobReader(file), file.size);

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const url = URL.createObjectURL(file);

  try {
    // HEVC 而且瀏覽器明確表示不支援 → 直接回報格式不支援
    if (container && isHevc(container.codec)) {
      const support = video.canPlayType(`video/mp4; codecs="${container.codec}.1.6.L93.B0"`);
      if (support === "") return { ok: false, code: "unsupported_format" };
    }

    video.src = url;
    const loaded = await waitForMetadata(video);
    if (loaded !== "ok") return { ok: false, code: loaded };

    // 有些瀏覽器讀得到檔案目錄，但解不出畫面（例如沒有對應的解碼器），寬高會是 0
    if (!video.videoWidth || !video.videoHeight) return { ok: false, code: "unsupported_format" };

    let fps: number | null = container?.fps ?? null;
    let fpsSource: VideoMeta["fpsSource"] = fps ? "container" : "unknown";
    if (!fps) {
      fps = await estimateFps(video);
      fpsSource = fps ? "estimated" : "unknown";
    }

    const durationSec = Number.isFinite(video.duration) ? video.duration : (container?.durationSec ?? NaN);
    return {
      ok: true,
      meta: {
        durationSec,
        width: video.videoWidth,
        height: video.videoHeight,
        fps,
        fpsSource,
        ...(container ? { codec: container.codec } : {}),
      },
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * 等影片讀到 metadata，再多等一下第一格畫面（loadeddata），確定真的解得開。
 * iPhone 的 Safari 有時要等使用者操作才會載入畫面，所以第一格畫面沒來不算失敗。
 */
function waitForMetadata(video: HTMLVideoElement): Promise<"ok" | "unsupported_format" | "video_unreadable"> {
  return new Promise((resolve) => {
    let timer = window.setTimeout(() => finish("video_unreadable"), METADATA_TIMEOUT_MS);
    function finish(result: "ok" | "unsupported_format" | "video_unreadable") {
      window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("error", onError);
      resolve(result);
    }
    function onMetadata() {
      window.clearTimeout(timer);
      if (video.readyState >= 2) return finish("ok");
      timer = window.setTimeout(() => finish("ok"), FIRST_FRAME_GRACE_MS);
    }
    function onLoaded() {
      finish("ok");
    }
    function onError() {
      const code = video.error?.code;
      // 3 = 解碼失敗、4 = 不支援的格式；其他（網路、中止）視為檔案讀不到
      finish(code === 3 || code === 4 ? "unsupported_format" : "video_unreadable");
    }
    video.addEventListener("loadedmetadata", onMetadata);
    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("error", onError);
  });
}

const FIRST_FRAME_GRACE_MS = 3_000;

/** 靜音播放一小段，量相鄰畫面的時間差，取中位數估計影格率。量不到時回傳 null。 */
async function estimateFps(video: HTMLVideoElement): Promise<number | null> {
  if (typeof video.requestVideoFrameCallback !== "function") return null;
  const times: number[] = [];
  try {
    await video.play();
  } catch {
    return null;
  }
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 1200);
    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      times.push(metadata.mediaTime);
      if (times.length >= 16) {
        window.clearTimeout(timer);
        resolve();
      } else {
        video.requestVideoFrameCallback(onFrame);
      }
    };
    video.requestVideoFrameCallback(onFrame);
  });
  video.pause();
  const deltas = times
    .slice(1)
    .map((time, index) => time - times[index])
    .filter((delta) => delta > 0)
    .sort((a, b) => a - b);
  if (deltas.length < 3) return null;
  const median = deltas[Math.floor(deltas.length / 2)];
  return Math.round((1 / median) * 100) / 100;
}
