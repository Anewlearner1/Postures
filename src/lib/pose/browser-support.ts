/**
 * 這個檔案做什麼：
 *   判斷「這個瀏覽器能不能跑骨架分析」，以及「是不是在 LINE／Facebook／Instagram 等 App 內建瀏覽器裡」
 *   （UX 文件 §5.8）。只有判斷邏輯，傳入要檢查的環境資訊，方便測試。
 */

/** App 內建瀏覽器的名稱（顯示在提示條上）。 */
export type InAppBrowser = "LINE" | "Facebook" | "Instagram" | "Messenger" | "WeChat";

/** 用 User-Agent 判斷是否在 App 內建瀏覽器裡（UX §5.8【給工程】）。 */
export function detectInAppBrowser(userAgent: string): InAppBrowser | null {
  if (/\bLine\//i.test(userAgent)) return "LINE";
  if (/Instagram/i.test(userAgent)) return "Instagram";
  if (/FBAN\/Messenger|FB_IAB\/MESSENGER/i.test(userAgent)) return "Messenger";
  if (/FBAN|FBAV|FB_IAB/i.test(userAgent)) return "Facebook";
  if (/MicroMessenger/i.test(userAgent)) return "WeChat";
  return null;
}

/** 分析需要的瀏覽器功能。 */
export interface BrowserCapabilities {
  webAssembly: boolean;
  worker: boolean;
  createImageBitmap: boolean;
  /** 能播放影片（有 HTMLVideoElement）。 */
  video: boolean;
}

/** 從目前的瀏覽器讀取功能（只能在瀏覽器中呼叫）。 */
export function readBrowserCapabilities(scope: typeof globalThis = globalThis): BrowserCapabilities {
  return {
    webAssembly: typeof scope.WebAssembly === "object" && typeof scope.WebAssembly.instantiate === "function",
    worker: typeof scope.Worker === "function",
    createImageBitmap: typeof scope.createImageBitmap === "function",
    video: typeof scope.HTMLVideoElement === "function",
  };
}

/** 缺少的功能清單；空陣列代表可以分析。 */
export function missingCapabilities(capabilities: BrowserCapabilities): (keyof BrowserCapabilities)[] {
  return (Object.keys(capabilities) as (keyof BrowserCapabilities)[]).filter((key) => !capabilities[key]);
}

/**
 * LINE 支援在網址加上 openExternalBrowser=1，讓連結直接用外部瀏覽器開啟（UX §5.8）。
 * 「複製網址」時給使用者這個版本。
 */
export function externalBrowserUrl(href: string): string {
  try {
    const url = new URL(href);
    url.searchParams.set("openExternalBrowser", "1");
    return url.toString();
  } catch {
    return href;
  }
}
