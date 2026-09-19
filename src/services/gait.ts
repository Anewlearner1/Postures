import { GoogleGenAI } from "@google/genai";
import type { Exercise } from "./gemini";

export interface AbnormalPattern {
  name: string;
  description: string;
  severity: '輕微' | '中等' | '明顯';
}

export interface GaitAnalysis {
  observations: {
    head: string;
    trunk: string;
    pelvis: string;
    knees: string;
    feet: string;
    armSwing: string;
  };
  metrics: {
    cadence: number; // 步頻 (步/分鐘)
    strideSymmetry: number; // 左右步幅對稱度 0-100
    trunkLeanAngle: number; // 軀幹前傾/側傾角度
    kneeFlexionSwing: number; // 擺動期膝屈曲角度
    footProgressionAngle: number; // 足偏角
    armSwingSymmetry: number; // 手臂擺動對稱度 0-100
  };
  scoreBreakdown: {
    symmetry: number;
    rhythm: number;
    stability: number;
    efficiency: number;
  };
  abnormalPatterns: AbnormalPattern[];
  summary: string;
  recommendations: string[];
  exercises: Exercise[];
  riskLevel: '低' | '中' | '高';
  score: number;
}

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }
  return aiInstance;
}

export interface GaitVideoMeta {
  duration: number;
  timestamps: number[];
  notes?: string;
}

export async function analyzeGait(frames: string[], meta: GaitVideoMeta): Promise<GaitAnalysis> {
  const model = "gemini-3.1-pro-preview";
  const ai = getAI();

  if (frames.length < 2) {
    throw new Error("影片畫面不足，無法進行步態分析，請上傳較長的走路影片。");
  }

  const prompt = `
    你是一位資深的「復健科醫師」與「步態分析（Gait Analysis）專家」。
    以下是同一段走路影片依時間順序擷取的 ${frames.length} 張連續影格，
    影片總長約 ${meta.duration.toFixed(1)} 秒，各影格對應的時間點（秒）依序為：${meta.timestamps.join(', ')}。
    ${meta.notes ? `使用者補充說明：${meta.notes}` : ''}

    請把這些影格視為一段連續的步行動作，從生物力學角度分析此人的步態：
    1. 步態週期：站立期（Stance）與擺動期（Swing）的比例、著地方式（腳跟著地 Heel Strike / 前足著地）、推進期（Toe Off）表現。
    2. 左右對稱性：步幅、步寬、單腳站立時間是否對稱，是否有跛行（Antalgic Gait）。
    3. 軀幹與骨盆：軀幹前傾/側傾、骨盆下墜（Trendelenburg）、骨盆旋轉代償。
    4. 下肢排列：膝關節屈曲角度、膝內/外翻、足偏角（Foot Progression Angle）、足弓塌陷或過度旋前/旋後。
    5. 上肢：手臂擺動幅度與左右對稱性、肩膀是否僵硬。
    6. 常見異常步態辨識：例如剪刀步態、蹣跚步態、垂足步態（Foot Drop）、髖外展肌無力步態等；若無明顯異常，abnormalPatterns 請回傳空陣列。

    評分標準（四個維度各 0-25 分，總分 100）：
    - 對稱性 (Symmetry)：左右動作的一致程度。
    - 節律性 (Rhythm)：步頻與步態週期的規律度。
    - 穩定性 (Stability)：重心轉移與單腳支撐的穩定度。
    - 效率性 (Efficiency)：推進效率與能量耗損（代償動作多寡）。

    數值若無法精確測量，請依影像做出合理的臨床估計，不要留空。
    請務必以繁體中文回覆，並嚴格輸出以下 JSON 結構（不要加上任何說明文字）：
    {
      "observations": {
        "head": "頭頸部於步行中的表現",
        "trunk": "軀幹表現",
        "pelvis": "骨盆表現",
        "knees": "膝關節表現",
        "feet": "足踝與著地方式",
        "armSwing": "手臂擺動表現"
      },
      "metrics": {
        "cadence": 數值,
        "strideSymmetry": 0-100,
        "trunkLeanAngle": 數值,
        "kneeFlexionSwing": 數值,
        "footProgressionAngle": 數值,
        "armSwingSymmetry": 0-100
      },
      "scoreBreakdown": {
        "symmetry": 0-25,
        "rhythm": 0-25,
        "stability": 0-25,
        "efficiency": 0-25
      },
      "abnormalPatterns": [
        { "name": "異常步態名稱", "description": "觀察到的依據與可能成因", "severity": "輕微" | "中等" | "明顯" }
      ],
      "summary": "專業臨床總結",
      "recommendations": ["具體的步態矯正或訓練建議"],
      "exercises": [
        {
          "name": "訓練名稱",
          "description": "訓練簡介",
          "duration": "建議時間或次數",
          "benefit": "對此步態問題的幫助",
          "steps": ["步驟1", "步驟2"],
          "coachTip": "教練的小叮嚀"
        }
      ],
      "riskLevel": "低" | "中" | "高",
      "score": 0-100之間的整數總評分
    }
  `;

  const frameParts = frames.flatMap((frame, index) => ([
    { text: `影格 ${index + 1}（第 ${meta.timestamps[index] ?? 0} 秒）：` },
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: frame.split(',')[1],
      },
    },
  ]));

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [{ text: prompt }, ...frameParts],
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("AI 未能產出有效的步態分析內容。");
    }

    const cleanJson = text.replace(/```json\n?|```/g, "").trim();
    const parsed = JSON.parse(cleanJson) as GaitAnalysis;
    return {
      ...parsed,
      abnormalPatterns: parsed.abnormalPatterns ?? [],
      recommendations: parsed.recommendations ?? [],
      exercises: parsed.exercises ?? [],
    };
  } catch (e: any) {
    console.error("Gemini Gait Analysis Error:", e);
    const errorMessage = e.message || "未知錯誤";
    if (errorMessage.includes("API_KEY_INVALID")) {
      throw new Error("API 金鑰無效，請檢查您的設定。");
    }
    throw new Error(`步態分析失敗: ${errorMessage}`);
  }
}
