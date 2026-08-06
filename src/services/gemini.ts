/**
 * The AI half of the pipeline.
 *
 * Two distinct jobs, deliberately kept apart:
 *
 *   observeGaitFrames() is track B. It sees only sampled video frames and knows
 *   nothing about what the landmark pipeline measured. That independence is the
 *   entire value of the second track — the moment it is told track A's numbers
 *   it stops being a check and starts being an echo.
 *
 *   interpretGait() writes the final report. It receives track A's measurements
 *   as ground truth and is explicitly forbidden from inventing or adjusting
 *   numbers. Its job is clinical reasoning over data it did not produce.
 */

import { GoogleGenAI } from '@google/genai';
import type {
  CameraView,
  Exercise,
  GaitInterpretation,
  GaitMetrics,
  TrackBObservation,
  TrackReconciliation,
} from '../types/gait';

const MODEL = 'gemini-3.1-pro-preview';

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
  }
  return aiInstance;
}

function imagePart(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
  return {
    inlineData: {
      mimeType: match ? match[1] : 'image/jpeg',
      data: dataUrl.split(',')[1],
    },
  };
}

/** Models occasionally wrap JSON in a fence despite the response MIME type. */
function parseJson<T>(text: string | undefined, what: string): T {
  if (!text) throw new Error(`AI 未能產出${what}。`);
  const clean = text.replace(/```json\n?|```/g, '').trim();
  try {
    return JSON.parse(clean) as T;
  } catch {
    throw new Error(`AI 回應格式無法解析(${what})。`);
  }
}

function toError(e: unknown, context: string): Error {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes('API_KEY_INVALID')) {
    return new Error('API 金鑰無效,請檢查您的設定。');
  }
  return new Error(`${context}:${message}`);
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' && v.trim() ? v.trim() : fallback;

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];

// --- Track B: independent observation --------------------------------------

const TRACK_B_PROMPT = `
你是一位資深的物理治療師,專長為步態評估。

以下是從一段走路影片中,依時間順序**均勻取樣**出來的連續影格。請你僅根據這些影像做出獨立判斷。

請完成兩件事:

【第一部分:獨立量化估計】
純粹用你的視覺判斷,估計以下數值。這是一次獨立觀測,請不要因為不確定就給保守的「安全值」,盡你所能給出真實估計;若影像品質確實不足以判斷,才回傳 null。
1. estimatedCadence:步頻,每分鐘步數。可從影格間下肢交替的節奏推估。
2. estimatedAsymmetry:左右不對稱程度,0 到 100 的整數。0 表示完全對稱,100 表示極度不對稱。
3. observedView:拍攝視角,只能是 "sagittal"(側面)、"frontal"(正面或背面)、"unknown" 三者之一。

【第二部分:質性觀察】
描述那些「只看關節點座標看不出來、但臨床上很重要」的資訊:
- painIndicators:是否有疼痛徵象(表情緊繃、上肢護衛動作、明顯遲疑)。沒有就寫「未觀察到明顯疼痛徵象」。
- clothingOcclusion:衣物是否遮蔽關節輪廓(寬鬆長褲、長裙、外套下擺),影響判讀的程度。
- footwear:鞋子類型與是否可能影響步態(高跟、拖鞋、赤足、矯正鞋具)。
- environment:地面是否平整、有無斜坡或障礙、空間是否足夠自然行走、光線狀況。
- assistiveDevice:是否使用拐杖、助行器、護具或他人攙扶。沒有就寫「未使用輔具」。

【第三部分:影像品質】
frameQuality:0 到 1 的小數,表示這些影格整體上有多適合做步態分析(全身是否入鏡、是否清晰、動作是否連續)。

請以繁體中文,回傳以下結構的 JSON,不要有任何額外文字:
{
  "estimatedCadence": 數值或 null,
  "estimatedAsymmetry": 數值或 null,
  "observedView": "sagittal" | "frontal" | "unknown",
  "observedAbnormalities": ["你認為看得出來的異常步態樣式,若無則回傳空陣列"],
  "qualitativeNotes": {
    "painIndicators": "字串",
    "clothingOcclusion": "字串",
    "footwear": "字串",
    "environment": "字串",
    "assistiveDevice": "字串"
  },
  "frameQuality": 0 到 1 的小數
}
`.trim();

const VALID_VIEWS: CameraView[] = ['sagittal', 'frontal', 'unknown'];

/**
 * Track B. Runs on sampled frames alone, with no knowledge of track A.
 *
 * Returns null instead of throwing: losing the cross-check should downgrade
 * confidence, not fail the whole analysis.
 */
export async function observeGaitFrames(
  keyFrames: string[],
): Promise<TrackBObservation | null> {
  if (!keyFrames.length) return null;

  try {
    const response = await getAI().models.generateContent({
      model: MODEL,
      contents: [
        {
          parts: [{ text: TRACK_B_PROMPT }, ...keyFrames.map(imagePart)],
        },
      ],
      config: { responseMimeType: 'application/json' },
    });

    const raw = parseJson<Record<string, unknown>>(response.text, '影像獨立觀察');
    const notes = (raw.qualitativeNotes ?? {}) as Record<string, unknown>;
    const view = str(raw.observedView) as CameraView;

    return {
      estimatedCadence: num(raw.estimatedCadence),
      estimatedAsymmetry: num(raw.estimatedAsymmetry),
      observedView: VALID_VIEWS.includes(view) ? view : 'unknown',
      observedAbnormalities: strList(raw.observedAbnormalities),
      qualitativeNotes: {
        painIndicators: str(notes.painIndicators, '未提供'),
        clothingOcclusion: str(notes.clothingOcclusion, '未提供'),
        footwear: str(notes.footwear, '未提供'),
        environment: str(notes.environment, '未提供'),
        assistiveDevice: str(notes.assistiveDevice, '未提供'),
      },
      frameQuality: num(raw.frameQuality) ?? 0.5,
    };
  } catch (e) {
    // A failed cross-check is recoverable; reconcileTracks() handles the null.
    console.warn('Track B observation failed:', e);
    return null;
  }
}

// --- Final interpretation --------------------------------------------------

/**
 * Trims track A's output for the prompt.
 *
 * The full report holds 101-point curves per joint per side. Eleven points
 * still show the shape of each curve while keeping the prompt small enough that
 * the numbers stay legible to the model.
 */
function summarizeMetrics(m: GaitMetrics) {
  const curve = (c: { values: number[]; min: number; max: number; rom: number } | null) =>
    c
      ? {
          rom: c.rom,
          min: c.min,
          max: c.max,
          curveEvery10Percent: c.values.filter((_, i) => i % 10 === 0),
        }
      : null;

  const side = (s: 'left' | 'right') => ({
    spatiotemporal: m[s],
    hip: curve(m.kinematics[s].hip),
    knee: curve(m.kinematics[s].knee),
    ankle: curve(m.kinematics[s].ankle),
    peakKneeFlexionSwing: m.kinematics[s].peakKneeFlexionSwing,
    kneeFlexionAtContact: m.kinematics[s].kneeFlexionAtContact,
    armSwingRom: m.kinematics[s].armSwingRom,
  });

  return {
    overall: {
      cadenceStepsPerMin: m.cadenceStepsPerMin,
      gaitCycleTimeSec: m.gaitCycleTimeSec,
      walkingSpeedMps: m.walkingSpeedMps,
      doubleSupportPercent: m.doubleSupportPercent,
      stepWidthM: m.stepWidthM,
      strideTimeCvPercent: m.strideTimeCvPercent,
      trunkLeanDeg: m.trunkLeanDeg,
      trunkSwayDeg: m.trunkSwayDeg,
      pelvicDropDeg: m.pelvicDropDeg,
      overallSymmetryIndex: m.overallSymmetryIndex,
      score: m.score,
      scoreBreakdown: m.scoreBreakdown,
      riskLevel: m.riskLevel,
    },
    left: side('left'),
    right: side('right'),
    symmetry: m.symmetry,
    detectedPatterns: m.patterns,
    measurementQuality: {
      view: m.quality.view,
      landmarkVisibility: m.quality.landmarkVisibility,
      completeCycles: { left: m.quality.cyclesLeft, right: m.quality.cyclesRight },
      scaleFactor: m.quality.scaleFactor,
      effectiveFps: m.quality.effectiveFps,
      warnings: m.quality.warnings,
      qualityScore: m.quality.score,
    },
  };
}

function buildInterpretationPrompt(
  metrics: GaitMetrics,
  trackB: TrackBObservation | null,
  reconciliation: TrackReconciliation,
  heightCm: number,
): string {
  return `
你是一位資深的復健科醫師,同時具備臨床生物力學背景。請為以下這份步態分析撰寫專業報告。

═══ 極重要的前提 ═══
下方【演算法量測數據】是由 MediaPipe 骨架追蹤搭配 Zeni 步態事件偵測演算法實際計算出來的客觀數值,不是估計值。

你的任務是**解讀這些數據**,不是重新估計它們。請嚴格遵守:
1. 絕對不要修改、重算或推翻任何數值。引用時請照原數值引用。
2. 數據中為 null 的項目代表「本次拍攝條件下無法量測」,請不要編造替代數值,必要時說明為何缺漏。
3. 你的臨床推論必須明確對應到具體數據。避免「看起來還不錯」這類沒有數據支撐的描述。

═══ 受試者 ═══
身高:${heightCm} cm

═══ 演算法量測數據(客觀,以此為準)═══
${JSON.stringify(summarizeMetrics(metrics), null, 2)}

═══ 獨立影像觀察(第二軌,僅供參考)═══
這是另一位觀察者僅憑影片畫面做出的獨立判斷,他並不知道上方的量測數據。
其中的數值估計僅供交叉驗證,不可用來取代量測數據;但**質性觀察**(疼痛徵象、衣物遮蔽、鞋具、環境、輔具)是骨架追蹤本質上看不到的資訊,請務必納入臨床判斷。
${trackB ? JSON.stringify(trackB, null, 2) : '(本次獨立觀察未能完成)'}

═══ 雙軌一致性(由程式計算)═══
${JSON.stringify(reconciliation, null, 2)}

═══ 撰寫要求 ═══
- 全部使用繁體中文。
- summary:3 到 4 句的臨床總結,點出最關鍵的發現。
- findings 四個面向各寫一段,每段都要引用具體數值:
  · spatiotemporal:步頻、步長、站立/擺盪期、雙支撐期的解讀
  · symmetry:左右對稱性,說明哪些指標不對稱、臨床意義為何
  · kinematics:髖膝踝關節活動度與角度曲線形態的解讀
  · posturalControl:軀幹控制、節律穩定度、平衡相關的解讀
- clinicalConcerns:值得留意的臨床議題,每項要說明是哪個數據支持的。若數據正常,請誠實說明未發現明顯異常。
- recommendations:5 到 7 條具體可執行的建議。
- exercises:4 到 6 個針對本次發現的運動處方。每個都要說明它對應解決哪一項步態問題。
- consistencyComment:根據雙軌一致性資料,用一到兩句話向使用者說明這份報告的可信度,以及是否建議重拍。

回傳以下結構的 JSON,不要有任何額外文字:
{
  "summary": "字串",
  "findings": {
    "spatiotemporal": "字串",
    "symmetry": "字串",
    "kinematics": "字串",
    "posturalControl": "字串"
  },
  "clinicalConcerns": ["字串"],
  "recommendations": ["字串"],
  "exercises": [
    {
      "name": "練習名稱",
      "description": "練習簡介,說明對應哪一項步態問題",
      "duration": "建議時間或次數",
      "benefit": "預期效益",
      "steps": ["步驟1", "步驟2"],
      "coachTip": "教練的小叮嚀"
    }
  ],
  "consistencyComment": "字串"
}
`.trim();
}

function normalizeExercises(v: unknown): Exercise[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      name: str(e.name, '未命名練習'),
      description: str(e.description),
      duration: str(e.duration, '30 秒'),
      benefit: str(e.benefit),
      steps: strList(e.steps),
      coachTip: str(e.coachTip),
    }))
    .filter((e) => e.name !== '未命名練習' || e.steps.length > 0);
}

/**
 * Writes the final report from track A's measurements.
 *
 * Keyframes are attached so the model can ground its qualitative language in
 * what the walk actually looked like, but the prompt is explicit that the
 * numbers are not up for revision.
 */
export async function interpretGait(
  metrics: GaitMetrics,
  trackB: TrackBObservation | null,
  reconciliation: TrackReconciliation,
  heightCm: number,
  keyFrames: string[] = [],
): Promise<GaitInterpretation> {
  try {
    // A few frames are enough for context; the measurements carry the report.
    const contextFrames = keyFrames.filter((_, i) => i % 4 === 0).slice(0, 4);

    const response = await getAI().models.generateContent({
      model: MODEL,
      contents: [
        {
          parts: [
            { text: buildInterpretationPrompt(metrics, trackB, reconciliation, heightCm) },
            ...contextFrames.map(imagePart),
          ],
        },
      ],
      config: { responseMimeType: 'application/json' },
    });

    const raw = parseJson<Record<string, unknown>>(response.text, '步態解讀報告');
    const findings = (raw.findings ?? {}) as Record<string, unknown>;

    return {
      summary: str(raw.summary, '本次步態分析已完成,詳細數據請參閱下方各項指標。'),
      findings: {
        spatiotemporal: str(findings.spatiotemporal, '未提供'),
        symmetry: str(findings.symmetry, '未提供'),
        kinematics: str(findings.kinematics, '未提供'),
        posturalControl: str(findings.posturalControl, '未提供'),
      },
      clinicalConcerns: strList(raw.clinicalConcerns),
      recommendations: strList(raw.recommendations),
      exercises: normalizeExercises(raw.exercises),
      consistencyComment: str(raw.consistencyComment, ''),
    };
  } catch (e) {
    throw toError(e, '步態解讀失敗');
  }
}
