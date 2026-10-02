"use client";

/**
 * 這個檔案做什麼：
 *   攔截瀏覽器的「返回」鍵（Android 實體返回鍵很容易按到；M5 QA F-05）。
 *   瀏覽器不允許取消返回，所以做法是：頁面啟用時先多放一筆「同一個網址」的歷史紀錄（守門紀錄），
 *   使用者按返回時只會退到原本那一筆、畫面不變，這時呼叫 onBack 讓頁面決定：
 *   - 使用者確定要離開 → 呼叫 leave()，再退一步回到真正的上一頁
 *   - 使用者要留下 → 呼叫 stay()，重新放回守門紀錄
 *   頁面要用程式換頁前（例如分析完成），先 await release() 把守門紀錄拿掉，避免返回時又回到這一頁。
 *
 *   Next.js 會把自己的歷史資料併入 pushState 的紀錄（見 Next.js 文件：原生 history.pushState 會和路由同步），
 *   所以守門紀錄只是同一頁，不會造成換頁。
 */

import { useCallback, useEffect, useRef } from "react";

const GUARD_KEY = "posturesBackGuard";

function onGuardEntry(): boolean {
  return Boolean((window.history.state as Record<string, unknown> | null)?.[GUARD_KEY]);
}

function pushGuard() {
  if (!onGuardEntry()) window.history.pushState({ [GUARD_KEY]: true }, "", window.location.href);
}

export interface BackGuardControls {
  /** 使用者按了返回、選擇留下：重新放回守門紀錄。 */
  stay: () => void;
  /** 使用者按了返回、確定離開：再退一步回到真正的上一頁。 */
  leave: () => void;
}

export function useBackGuard(active: boolean, onBack: (controls: BackGuardControls) => void) {
  const releasing = useRef<(() => void) | null>(null);
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!active) return;
    pushGuard();
    function onPopState() {
      if (releasing.current) {
        const done = releasing.current;
        releasing.current = null;
        done();
        return;
      }
      if (onGuardEntry()) return;
      onBackRef.current({
        stay: pushGuard,
        leave: () => window.history.back(),
      });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [active]);

  /** 拿掉守門紀錄（程式換頁前呼叫）。沒有守門紀錄時立刻完成。 */
  const release = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (!onGuardEntry()) return resolve();
        const timer = window.setTimeout(() => {
          releasing.current = null;
          resolve();
        }, 1000);
        releasing.current = () => {
          window.clearTimeout(timer);
          resolve();
        };
        window.history.back();
      }),
    [],
  );

  return { release };
}
