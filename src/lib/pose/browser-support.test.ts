/**
 * 這個檔案做什麼：測試 App 內建瀏覽器偵測（LINE、Facebook、Instagram）與瀏覽器功能檢查（UX §5.8）。
 */

import { describe, expect, it } from "vitest";
import { detectInAppBrowser, externalBrowserUrl, missingCapabilities } from "./browser-support";

const UA = {
  lineIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.9.0",
  lineAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 Line/14.10.0/IAB",
  facebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.0;FBBV/1]",
  instagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0 (iPhone15,2; iOS 17_5)",
  safari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
};

describe("detectInAppBrowser", () => {
  it("辨識 LINE（iPhone 與 Android）", () => {
    expect(detectInAppBrowser(UA.lineIos)).toBe("LINE");
    expect(detectInAppBrowser(UA.lineAndroid)).toBe("LINE");
  });

  it("辨識 Facebook 與 Instagram", () => {
    expect(detectInAppBrowser(UA.facebook)).toBe("Facebook");
    // Instagram 的 UA 有時也含 FBAN，以 Instagram 為準
    expect(detectInAppBrowser(`${UA.instagram} FBAN/FBIOS`)).toBe("Instagram");
  });

  it("一般 Safari、Chrome 不顯示提示", () => {
    expect(detectInAppBrowser(UA.safari)).toBeNull();
    expect(detectInAppBrowser(UA.chrome)).toBeNull();
  });
});

describe("missingCapabilities", () => {
  it("全部支援時回傳空陣列", () => {
    expect(missingCapabilities({ webAssembly: true, worker: true, createImageBitmap: true, video: true })).toEqual([]);
  });

  it("列出缺少的功能", () => {
    expect(missingCapabilities({ webAssembly: false, worker: true, createImageBitmap: false, video: true })).toEqual([
      "webAssembly",
      "createImageBitmap",
    ]);
  });
});

describe("externalBrowserUrl", () => {
  it("加上 LINE 認得的 openExternalBrowser=1", () => {
    expect(externalBrowserUrl("https://example.com/upload?x=1")).toBe("https://example.com/upload?x=1&openExternalBrowser=1");
  });

  it("網址格式不對時原樣回傳", () => {
    expect(externalBrowserUrl("not a url")).toBe("not a url");
  });
});
