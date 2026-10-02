/**
 * 這個檔案做什麼：
 *   定義「報告頁要顯示的內容」的資料格式（只有型別，沒有邏輯）。
 *   M4 時，`src/lib/report/` 會把分析結果（AnalysisResult）加上文案與 AI 白話說明，
 *   組成這裡的 ReportView，報告頁只負責把它畫出來。
 *   報告頁透過 `fetch-report.ts` 呼叫 POST /api/report 取得報告內容（ReportBody），
 *   再補上只存在瀏覽器裡的影片資訊（步數、影片長度、時間軸標記），組成 ReportView。
 */

import type { ConfidenceDisplay, Severity } from "@/lib/gait/types";

/** 一個訓練動作（格式依 UX 文件 §4.3.0「建議練習」通用格式）。 */
export interface ExerciseView {
  name: string;
  /** 練什麼：一句話說明目的。 */
  purpose?: string;
  /** 怎麼做：步驟。 */
  steps: string[];
  /** 份量，例如「10–15 下 × 2–3 組，每週 3 天」。 */
  dosage?: string;
  /** 小提醒。 */
  tip?: string;
  /** 動作庫 id（例如 "glute-bridge"）。 */
  exerciseId?: string;
  /** 「為什麼建議這個動作」的白話連結句（AI 撰寫；降級時沒有）。 */
  why?: string;
  /** 顯示的是退階（較溫和）版本（population_caveat，UX §4.2）。 */
  gentle?: boolean;
  /** 這個練習同時對應的其他卡片白話名稱（exercise-library.md §3 規則 3）。 */
  alsoFor?: string[];
}

/** 一張問題卡片（UX 文件 §4.3）。 */
export interface ProblemCardView {
  id: string;
  /** 時間軸上的編號（①②③），讓卡片和骨架回放標記對得起來。 */
  markerNumber: number;
  plainName: string;
  professionalName: string;
  subtitle: string;
  severity: Severity;
  /** 「我們看到什麼」（M4 起由 AI 依數據撰寫，不提左右腳）。 */
  whatWeSaw: string;
  /** 「在影片中查看」的時間點，例如 "0:03"。 */
  firstTimestamp?: string;
  /** 「這代表什麼」，每個元素是一段。 */
  meaning: string[];
  /** 「可能原因」。 */
  causes: string[];
  /** 「建議練習」（只能從動作庫挑選，SPEC D7）。 */
  exercises: ExerciseView[];
  /** 卡片專屬的固定注意事項（例如膝蓋彎得較多的就醫提醒）。 */
  note?: string;
  /** 數值接近兩個等級的分界（UX §4.3.0「接近分界」標籤）。 */
  nearThreshold?: boolean;
  /** 「建議練習」區塊的第一行（例如適用情況提醒、低可信度時先重拍確認）。 */
  exercisesIntro?: string;
}

/** 骨架回放時間軸上的標記（UX 文件 §4.6）。 */
export interface TimelineMarker {
  markerNumber: number;
  label: string;
  /** 在時間軸上的位置（0–100，百分比）。 */
  positionPct: number;
}

/** 報告頁所需的全部內容。 */
export interface ReportView {
  /** 總結語（UX §4.2）。 */
  summary: string;
  stepsAnalyzed: number;
  cyclesAnalyzed: number;
  durationSec: number;
  confidence: ConfidenceDisplay;
  /** 可信度「中」時的一則小提示（D28）。 */
  confidenceTip?: string;
  /** 可信度「較低」時的原因與改善建議（UX §4.5）。 */
  lowConfidence?: { reason: string; fix: string };
  /** 走得偏慢附註（D27）。 */
  slowSpeed: boolean;
  problems: ProblemCardView[];
  /** 「看起來不錯」的項目白話名稱。 */
  goodItems: string[];
  /** 頭部位置觀察的段落；沒觀察到就不顯示（D25）。 */
  headObservation?: string[];
  timelineMarkers: TimelineMarker[];
  /** 影片長度標籤，例如 "0:14"。 */
  durationLabel: string;
  /** 使用者勾選了適用情況提醒（D30／D35）：報告頂端顯示提醒、練習用較溫和版本、最多 3 個。 */
  populationCaveat?: boolean;
}

/** 只存在瀏覽器裡、不送到伺服器的影片資訊（由前端補上）。 */
export type ReportVideoFields = "stepsAnalyzed" | "durationSec" | "durationLabel" | "timelineMarkers";

/** POST /api/report 回傳的報告內容：ReportView 去掉影片資訊。 */
export type ReportBody = Omit<ReportView, ReportVideoFields>;

/**
 * POST /api/report 的回應。
 *   source = "ai"：總結語、「我們看到什麼」、練習連結句由 Claude 撰寫（未通過檢查的段落已換回模板文字）。
 *   source = "template"：全部使用模板文字（沒有金鑰、Claude 失敗或逾時，降級方案）。
 */
export interface ReportApiResponse {
  source: "ai" | "template";
  report: ReportBody;
}
