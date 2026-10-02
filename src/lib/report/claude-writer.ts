/**
 * 這個檔案做什麼：
 *   呼叫 Claude API，請它把報告中「由 AI 撰寫」的段落寫成白話（UX 文件 §4.0）：
 *   總結語、每張卡片的「我們看到什麼」、每個練習「為什麼建議」的連結句。
 *   練習由程式先選好，Claude 只能替這些練習寫說明，不能新增或修改劑量（SPEC D7）。
 *
 *   安全與隱私：
 *   - `import "server-only"`：這個檔案只能在伺服器端使用；如果被前端引用，建置時就會報錯，
 *     確保 API 金鑰不會出現在瀏覽器程式碼中。
 *   - 金鑰只從伺服器的環境變數 ANTHROPIC_API_KEY 讀取。
 *   - 不記錄任何請求或回應內容（D18）；SDK 的日誌也關閉。
 *
 *   模型：預設 claude-opus-5-5（可用環境變數 CLAUDE_MODEL 改成其他模型，不用改程式）。
 */

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { aiOutputSchema, TEXT_LIMITS, type AiInput, type AiOutput } from "./ai-merge";
import { BANNED_WORDS } from "./content-filter";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

/** 呼叫 Claude 的時間上限（毫秒）。超過就放棄，改用模板文字。 */
export const CLAUDE_TIMEOUT_MS = 20_000;

/** Claude 沒有正常完成時的原因分類（只記錄分類，不記錄內容）。 */
export class ClaudeWriterError extends Error {
  constructor(public readonly kind: "refusal" | "incomplete" | "invalid_output") {
    super(`Claude writer failed: ${kind}`);
    this.name = "ClaudeWriterError";
  }
}

export const SYSTEM_PROMPT = `你是「走路姿勢分析」網站的報告撰寫助手。使用者上傳了一段側拍走路影片，程式已經算出分析結果，並選好了訓練動作。你的工作只有把下列段落寫成親切、白話的繁體中文（台灣用語）：

1. summary：報告最上方的總結語，1–3 句，${TEXT_LIMITS.summary} 字以內。
2. 每張卡片的 what_we_saw：「我們看到什麼」，1–2 句，${TEXT_LIMITS.whatWeSaw} 字以內。
3. 每個練習的 why：一句話說明「為什麼這個練習和這張卡片有關」，${TEXT_LIMITS.why} 字以內。

輸入資料中的 template_summary 與 template_what_we_saw 是審閱過的範本。請以範本的意思為準，只做小幅潤飾，讓語氣自然、連貫；不要加入範本以外的事實或推測。

必須遵守：
- 這不是醫療服務。描述「影片中觀察到的走路特徵」，不判斷病因，不給醫療建議。
- 不可使用這些詞：${BANNED_WORDS.join("、")}。也不要用「嚴重」「警告」「風險」等讓人擔心的字眼。
- 不可提到左腳、右腳、左側、右側、兩側、單側或任何側別，只說「走路時」「腳往後推時」等整體說法。
- 不可描述頭部或頸部的位置，也不可提出與頭部有關的建議。「長高走路」練習只能說成讓上半身整體保持直立。
- 數字只能使用輸入資料中提供的時間點、出現次數、平均前傾角度與卡片數量；不要自己寫出任何其他數字、劑量、次數或秒數。
- 只能替輸入中列出的練習 id 寫 why，不可新增練習、不可改變練習內容或份量。
- 可信度 confidence 為 "low" 時，用「可能」「影片中看起來」等保留語氣。
- near_threshold 為 true 的卡片，要保留「數值在分界附近，參考就好」的意思。
- population_caveat 為 true 時，語氣更保守，不要鼓勵使用者自行加強練習。
- 稱呼使用者為「你」。用全形標點。不要使用 Markdown、網址或表情符號。

輸出：依指定的 JSON 格式回傳，card_id 與練習 id 必須和輸入完全相同。`;

export interface ClaudeWriterOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

export async function writeReportWithClaude(input: AiInput, options: ClaudeWriterOptions): Promise<AiOutput> {
  const client = new Anthropic({
    apiKey: options.apiKey,
    timeout: options.timeoutMs ?? CLAUDE_TIMEOUT_MS,
    // 不自動重試：使用者在等報告，失敗就直接用模板文字
    maxRetries: 0,
    // 不輸出 SDK 日誌，避免任何請求內容出現在伺服器紀錄（D18）
    logLevel: "off",
  });

  const response = await client.beta.messages.parse({
    model: options.model ?? DEFAULT_CLAUDE_MODEL,
    max_tokens: 16000,
    // 這是短篇改寫工作，用較低的思考強度即可（較快、較省）
    output_config: { effort: "low", format: betaZodOutputFormat(aiOutputSchema) },
    // 模型因安全分類拒答時，由伺服器自動改用合適的備援模型
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(input) }],
  });

  if (response.stop_reason === "refusal") throw new ClaudeWriterError("refusal");
  if (response.stop_reason !== "end_turn") throw new ClaudeWriterError("incomplete");
  if (!response.parsed_output) throw new ClaudeWriterError("invalid_output");
  return response.parsed_output;
}
