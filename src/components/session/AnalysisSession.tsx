"use client";

/**
 * 這個檔案做什麼：
 *   在「上傳 → 分析中 → 報告」幾個頁面之間，暫時記住：
 *   - 使用者選的影片（File 與本機播放網址 blob:）、影片資訊與分析計畫
 *   - 「已年滿 18 歲」勾選、適用情況是否有勾（只記是／否，D35）
 *   - 分析完成後的骨架資料、分析結果與報告（報告頁與骨架回放用）
 *
 *   重要觀念：
 *   - 影片只存在瀏覽器的記憶體裡，不會上傳，也不會存到硬碟（SPEC D12）。
 *   - 用網站內的連結或按鈕換頁時，記憶會保留；按重新整理或關掉分頁就會消失。
 *   - 18 歲勾選只在這次瀏覽期間記住（UX 文件 §2.3【給工程】），不記錄、不上傳。
 *   - 適用情況勾了哪一項只留在上傳頁的畫面上；這裡只記「有沒有勾」（D35）。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AnalysisResult, PoseSequence } from "@/lib/gait/types";
import type { PipelinePerformance } from "@/lib/pose/pipeline";
import type { AnalysisPlan, VideoMeta } from "@/lib/pose/preflight";
import type { FetchedReport } from "@/lib/report/fetch-report";

/** 通過前置檢查、準備分析的影片。 */
export interface SelectedVideo {
  file: File;
  /** 本機播放網址（blob:），只在這個分頁有效。 */
  url: string;
  meta: VideoMeta;
  plan: AnalysisPlan;
}

/** 一次完成的分析（報告頁使用）。 */
export interface CompletedAnalysis {
  poses: PoseSequence;
  result: AnalysisResult;
  report: FetchedReport;
  performance: PipelinePerformance;
}

interface AnalysisSessionValue {
  video: SelectedVideo | null;
  /** 選擇新影片（會釋放舊影片的記憶體、清掉舊報告）；傳 null 代表清除。 */
  selectVideo: (video: { file: File; meta: VideoMeta; plan: AnalysisPlan } | null) => void;
  ageConfirmed: boolean;
  setAgeConfirmed: (confirmed: boolean) => void;
  populationCaveat: boolean;
  setPopulationCaveat: (value: boolean) => void;
  completed: CompletedAnalysis | null;
  setCompleted: (completed: CompletedAnalysis | null) => void;
}

const AnalysisSessionContext = createContext<AnalysisSessionValue | null>(null);

export function AnalysisSessionProvider({ children }: { children: ReactNode }) {
  const [video, setVideo] = useState<SelectedVideo | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [populationCaveat, setPopulationCaveat] = useState(false);
  const [completed, setCompleted] = useState<CompletedAnalysis | null>(null);

  const selectVideo = useCallback<AnalysisSessionValue["selectVideo"]>((next) => {
    setCompleted(null);
    setVideo(next ? { ...next, url: URL.createObjectURL(next.file) } : null);
  }, []);

  // 換影片或離開網站時，釋放舊影片佔用的記憶體
  useEffect(() => {
    if (!video) return;
    return () => URL.revokeObjectURL(video.url);
  }, [video]);

  const value = useMemo(
    () => ({
      video,
      selectVideo,
      ageConfirmed,
      setAgeConfirmed,
      populationCaveat,
      setPopulationCaveat,
      completed,
      setCompleted,
    }),
    [video, selectVideo, ageConfirmed, populationCaveat, completed],
  );
  return <AnalysisSessionContext.Provider value={value}>{children}</AnalysisSessionContext.Provider>;
}

/** 在頁面元件中取得目前的影片、勾選狀態與分析結果。 */
export function useAnalysisSession(): AnalysisSessionValue {
  const value = useContext(AnalysisSessionContext);
  if (!value) {
    throw new Error("useAnalysisSession 必須放在 AnalysisSessionProvider 裡面使用");
  }
  return value;
}
