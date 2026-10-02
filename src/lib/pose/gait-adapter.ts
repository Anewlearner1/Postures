/**
 * 這個檔案做什麼：
 *   前端與「步態分析核心」（src/lib/gait/、src/lib/rules/，由演算法工程師負責）之間的接口。
 *   前端只透過這裡呼叫 analyzeGait()，演算法的檔案由對方維護，前端不修改。
 *
 *   入口（src/lib/gait/analyze.ts）：
 *     analyzeGait(frames, { fps, width, height, durationSec }, { populationCaveat }) => AnalysisOutcome
 *
 *   用動態載入（import()）：演算法的程式只在真的要分析時才下載，首頁、上傳頁不會變慢。
 */

import type { AnalysisMeta, AnalysisOptions, AnalysisOutcome, PoseFrame } from "@/lib/gait/types";

/** 傳給演算法的影片資訊。fps 是「實際分析的」影格率（隔格取樣後）；durationSec 是實際分析的長度。 */
export type GaitMeta = AnalysisMeta;

/** D35：populationCaveat = 使用者勾選了任一適用情況（孕婦、神經方面狀況、正在疼痛）。只送是／否。 */
export type GaitOptions = AnalysisOptions;

export type AnalyzeGaitFn = (frames: readonly PoseFrame[], meta: GaitMeta, options?: GaitOptions) => AnalysisOutcome;

/** 載入步態分析函式。 */
export async function loadAnalyzeGait(): Promise<AnalyzeGaitFn> {
  const { analyzeGait } = await import("@/lib/gait/analyze");
  return analyzeGait;
}
