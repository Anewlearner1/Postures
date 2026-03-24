import { GoogleGenAI } from "@google/genai";

export interface Exercise {
  name: string;
  description: string;
  duration: string;
  benefit: string;
  steps: string[];
  coachTip: string;
}

export interface PostureAnalysis {
  alignment: {
    head: string;
    shoulders: string;
    pelvis: string;
    knees: string;
    ankles: string;
  };
  metrics: {
    headTiltAngle: number;
    shoulderLevelDiff: number;
    pelvicTiltAngle: number;
    kneeAlignmentAngle: number;
    forwardHeadDistance: number;
  };
  scoreBreakdown: {
    symmetry: number;
    alignment: number;
    balance: number;
    stability: number;
  };
  summary: string;
  recommendations: string[];
  exercises: Exercise[];
  riskLevel: '低' | '中' | '高';
  score: number;
}

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    // Directly use process.env.GEMINI_API_KEY which is injected by AI Studio
    aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }
  return aiInstance;
}

export async function analyzePosture(frontImageBase64: string, sideImageBase64: string): Promise<PostureAnalysis> {
  const model = "gemini-3.1-pro-preview";
  const ai = getAI();
  
  const getMimeType = (base64: string) => {
    const match = base64.match(/^data:(image\/[a-zA-Z+]+);base64,/);
    return match ? match[1] : "image/jpeg";
  };

  const frontMime = getMimeType(frontImageBase64);
  const sideMime = getMimeType(sideImageBase64);

  const prompt = `
    你是一位資深的「復健科醫生」與「人體工學專家」。請以專業醫學與生物力學的角度，分析提供的正面與側面照片，評估患者的身體排列與體態健康。
    
    分析重點與評分標準：
    1. 頭部位置：是否有頸椎前傾（Forward Head Posture）、頸椎生理曲度變直或側傾。估計頭部前傾角度與距離。
    2. 肩膀水平：是否有高低肩（Shoulder Imbalance）、圓肩（Rounded Shoulders）或翼狀肩胛。估計左右肩膀高度差。
    3. 骨盆排列：是否有骨盆前傾/後傾（Pelvic Tilt）、側傾或旋轉。估計傾斜角度。
    4. 膝蓋與足部：是否有膝內翻/外翻（Genu Valgum/Varum）、足弓塌陷。估計膝蓋對齊角度。
    5. 脊椎動力鏈：整體動力鏈的代償情況。
    
    請計算以下四個維度的分數（每個維度 0-25 分，總分 100）：
    - 對稱性 (Symmetry)：左右兩側的平衡程度。
    - 排列性 (Alignment)：各關節點是否在理想的重力線上。
    - 平衡感 (Balance)：重心分佈的穩定度。
    - 穩定性 (Stability)：維持標準姿勢的潛在能力。

    請以繁體中文提供結構化的 JSON 回應，格式如下：
    {
      "alignment": {
        "head": "醫學描述",
        "shoulders": "醫學描述",
        "pelvis": "醫學描述",
        "knees": "醫學描述",
        "ankles": "醫學描述"
      },
      "metrics": {
        "headTiltAngle": 數值,
        "shoulderLevelDiff": 數值,
        "pelvicTiltAngle": 數值,
        "kneeAlignmentAngle": 數值,
        "forwardHeadDistance": 數值
      },
      "scoreBreakdown": {
        "symmetry": 0-25,
        "alignment": 0-25,
        "balance": 0-25,
        "stability": 0-25
      },
      "summary": "專業臨床總結",
      "recommendations": ["具體的復健或運動建議"],
      "exercises": [
        {
          "name": "練習名稱",
          "description": "練習簡介",
          "duration": "建議時間或次數",
          "benefit": "對此體態問題的幫助",
          "steps": ["步驟1", "步驟2"],
          "coachTip": "教練的小叮嚀"
        }
      ],
      "riskLevel": "低" | "中" | "高",
      "score": 0-100之間的整數總評分
    }
  `;

  const frontPart = {
    inlineData: {
      mimeType: frontMime,
      data: frontImageBase64.split(',')[1],
    },
  };

  const sidePart = {
    inlineData: {
      mimeType: sideMime,
      data: sideImageBase64.split(',')[1],
    },
  };

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: prompt },
            frontPart,
            sidePart
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("AI 未能產出有效的分析內容。");
    }

    // Robust JSON parsing: strip potential markdown code blocks
    const cleanJson = text.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(cleanJson);
  } catch (e: any) {
    console.error("Gemini Analysis Error:", e);
    const errorMessage = e.message || "未知錯誤";
    if (errorMessage.includes("API_KEY_INVALID")) {
      throw new Error("API 金鑰無效，請檢查您的設定。");
    }
    throw new Error(`分析失敗: ${errorMessage}`);
  }
}
