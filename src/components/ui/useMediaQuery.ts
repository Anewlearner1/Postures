"use client";

/**
 * 這個檔案做什麼：
 *   判斷目前畫面是否符合某個寬度條件（例如「電腦版：寬度 ≥ 1024 像素」），畫面縮放時自動更新。
 *   伺服器端產生頁面時一律當作手機版（手機優先）。
 */

import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** 電腦版版面（Tailwind 的 lg：寬度 ≥ 1024 像素）。 */
export const DESKTOP_QUERY = "(min-width: 1024px)";
