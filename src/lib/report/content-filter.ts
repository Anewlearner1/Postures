/**
 * 這個檔案做什麼：
 *   檢查 AI 寫出來的文字能不能直接放進報告。任何一項不通過，該段就改用模板文字。
 *
 *   檢查項目：
 *   1. 禁用詞（UX 文件 §8.5）：診斷、治療、疾病、異常……
 *   2. 左右側（D26）：不可出現「左」「右」字，或「兩側」「單側」「另一側」等側別說法。
 *   3. 頭部前傾（D25、D33）：AI 不可描述頭部、頸部的位置或建議。
 *   4. 數字（SPEC §3「數字一律由程式算出」）：文字中的數字必須是程式提供的數值
 *      （角度四捨五入、時間點、次數、問題數），AI 不能自己產生數字或改劑量。
 *   5. 長度與格式：不可空白、不可太長、不可有網址或 HTML／Markdown 符號。
 */

/** UX 文件 §8.5 禁用詞清單（「就醫提醒」為固定文案，不經過這個檢查）。 */
export const BANNED_WORDS = [
  "診斷",
  "確診",
  "治療",
  "疾病",
  "病症",
  "病變",
  "症狀",
  "患者",
  "病人",
  "處方",
  "復健",
  "矯正",
  "退化",
  "損傷",
  "異常",
  "不正常",
  "危險",
  "保證",
  "根治",
  "一定會",
] as const;

/** 側別用語（D26）。「左」「右」兩個字一律不允許，避免「左腳」「右膝」「左右」等寫法。 */
const SIDE_PATTERN = /[左右]|兩側|單側|一側|另一側|同側|對側|兩腳不同|\b(?:left|right)\b/i;

/** 頭部、頸部相關描述（D25：頭部前傾只作觀察，AI 不可解讀；D33）。 */
const HEAD_PATTERN = /頭部|頭往前|頭前|頭向前|低頭|頸|脖子|烏龜/;

/** 格式：網址、HTML 標籤、Markdown 符號。 */
const FORMAT_PATTERN = /https?:|www\.|[<>*#`\[\]_]/i;

export type TextProblem = "empty" | "too_long" | "banned_word" | "side" | "head" | "number" | "format";

export interface TextRules {
  maxLength: number;
  /** 允許出現在文字中的數字（例如角度 9、9.4、次數 4）。 */
  allowedNumbers?: ReadonlySet<string>;
  /** 允許出現的時間點字串（例如 "0:03"）。 */
  allowedTimestamps?: readonly string[];
}

/** 全形數字與小數點轉成半形，方便比對。 */
function normalizeDigits(text: string): string {
  return text.replace(/[０-９．]/g, (char) =>
    char === "．" ? "." : String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  );
}

/** 找出第一個問題；全部通過時回傳 null。 */
export function findTextProblem(text: string, rules: TextRules): TextProblem | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length > rules.maxLength) return "too_long";
  if (BANNED_WORDS.some((word) => trimmed.includes(word))) return "banned_word";
  if (SIDE_PATTERN.test(trimmed)) return "side";
  if (HEAD_PATTERN.test(trimmed)) return "head";
  if (FORMAT_PATTERN.test(trimmed)) return "format";

  let rest = normalizeDigits(trimmed);
  for (const timestamp of rules.allowedTimestamps ?? []) {
    rest = rest.split(timestamp).join(" ");
  }
  const numbers = rest.match(/\d+(?:\.\d+)?/g) ?? [];
  const allowed = rules.allowedNumbers ?? new Set<string>();
  if (numbers.some((number) => !allowed.has(number))) return "number";

  return null;
}

export function isTextAcceptable(text: string, rules: TextRules): boolean {
  return findTextProblem(text, rules) === null;
}

/** 把一個數值轉成「AI 可以引用的寫法」：整數與一位小數兩種。 */
export function numberVariants(value: number): string[] {
  const variants = new Set<string>([String(Math.round(value)), (Math.round(value * 10) / 10).toString()]);
  return [...variants];
}
