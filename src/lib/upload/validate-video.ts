/**
 * 這個檔案做什麼：
 *   使用者選好影片後，在「分析之前」先快速檢查檔案的格式與大小
 *   （docs/spec/ux-flow-and-copy.md §2.3【給工程】、§5.6、§5.7）。
 *   不通過就直接顯示錯誤，不進入分析。影片長度的檢查要讀取影片才知道，留到 M3。
 *
 *   這裡只看檔名、檔案類型與大小，不讀取影片內容，也不會上傳任何東西。
 */

import { UPLOAD_LIMITS } from "@/data/site";

/** 選檔時就能檢查出的錯誤代碼；對應的文案在 src/data/retake-messages.ts。 */
export type UploadErrorCode = "unsupported_format" | "not_video" | "too_large";

/** 檢查結果：通過，或是不通過並附上錯誤代碼。 */
export type VideoFileCheck = { ok: true } | { ok: false; code: UploadErrorCode };

/** 只需要檔案的這三個資訊（瀏覽器的 File 物件就有）。 */
export interface FileInfo {
  name: string;
  /** 瀏覽器判斷的檔案類型，例如 "video/mp4"；有些手機會給空字串。 */
  type: string;
  /** 檔案大小（位元組）。 */
  size: number;
}

/** 支援的格式：MP4、MOV。 */
const SUPPORTED_MIME_TYPES = ["video/mp4", "video/quicktime"];
const SUPPORTED_EXTENSIONS = ["mp4", "mov"];

/** 瀏覽器「不知道是什麼類型」時給的值。 */
const UNKNOWN_MIME_TYPES = ["", "application/octet-stream"];

/** 認得是影片、但目前不支援的副檔名（用來區分「格式不支援」與「不是影片」）。 */
const OTHER_VIDEO_EXTENSIONS = ["avi", "mkv", "webm", "wmv", "3gp", "flv", "mpg", "mpeg", "m4v", "hevc"];

/** 取得小寫副檔名，例如 "Walk.MOV" → "mov"；沒有副檔名時回傳空字串。 */
export function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/** 檢查使用者選的檔案能不能拿去分析。 */
export function validateVideoFile(
  file: FileInfo,
  maxSizeMB: number = UPLOAD_LIMITS.maxSizeMB,
): VideoFileCheck {
  const extension = getExtension(file.name);
  const mime = file.type.toLowerCase();

  const isSupported =
    SUPPORTED_MIME_TYPES.includes(mime) ||
    // 瀏覽器沒有判斷出類型時（部分 Android 手機），改用副檔名判斷
    (UNKNOWN_MIME_TYPES.includes(mime) && SUPPORTED_EXTENSIONS.includes(extension));
  const looksLikeVideo =
    mime.startsWith("video/") ||
    SUPPORTED_EXTENSIONS.includes(extension) ||
    OTHER_VIDEO_EXTENSIONS.includes(extension);

  if (!isSupported) {
    return { ok: false, code: looksLikeVideo ? "unsupported_format" : "not_video" };
  }

  if (file.size > maxSizeMB * 1024 * 1024) {
    return { ok: false, code: "too_large" };
  }

  return { ok: true };
}
