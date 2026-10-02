"use client";

/**
 * 這個檔案做什麼：
 *   在「上傳 → 分析中 → 報告」幾個頁面之間，暫時記住使用者選的影片與「已年滿 18 歲」勾選。
 *
 *   重要觀念：
 *   - 影片只存在瀏覽器的記憶體裡，不會上傳，也不會存到硬碟（SPEC D12）。
 *   - 用網站內的連結或按鈕換頁時，記憶會保留；按重新整理或關掉分頁就會消失。
 *   - 18 歲勾選只在這次瀏覽期間記住（UX 文件 §2.3【給工程】），不記錄、不上傳。
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface AnalysisSessionValue {
  /** 使用者選好、且通過格式／大小檢查的影片。 */
  video: File | null;
  setVideo: (file: File | null) => void;
  ageConfirmed: boolean;
  setAgeConfirmed: (confirmed: boolean) => void;
}

const AnalysisSessionContext = createContext<AnalysisSessionValue | null>(null);

export function AnalysisSessionProvider({ children }: { children: ReactNode }) {
  const [video, setVideo] = useState<File | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const value = useMemo(() => ({ video, setVideo, ageConfirmed, setAgeConfirmed }), [video, ageConfirmed]);
  return <AnalysisSessionContext.Provider value={value}>{children}</AnalysisSessionContext.Provider>;
}

/** 在頁面元件中取得目前的影片與勾選狀態。 */
export function useAnalysisSession(): AnalysisSessionValue {
  const value = useContext(AnalysisSessionContext);
  if (!value) {
    throw new Error("useAnalysisSession 必須放在 AnalysisSessionProvider 裡面使用");
  }
  return value;
}
