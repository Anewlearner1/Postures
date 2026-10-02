/**
 * 這個檔案做什麼：
 *   1. 準備要交給 Claude 的資料（buildAiInput）：只有白話名稱、等級、時間點、模板句子、
 *      以及程式已經選好的練習（id、名稱、目的）。不含影像、不含左右側（D26）、
 *      不含頭部數值（D25）；角度數字只送「身體往前傾」卡片會用到的平均前傾角。
 *   2. 定義 Claude 必須回傳的 JSON 格式（aiOutputSchema）。
 *   3. 把 Claude 寫的段落合併回模板報告（mergeAiOutput），合併前逐段檢查：
 *      - 卡片代碼、練習 id 必須是程式提供的候選；只要出現候選以外的 id，整份 AI 結果都不採用。
 *      - 每段文字都要通過 content-filter.ts 的檢查（禁用詞、左右腳、頭部、數字、長度）；
 *        沒通過的段落換回模板文字。
 *
 *   這個檔案不呼叫外部服務，可以直接測試。
 */

import { z } from "zod";
import { PROBLEM_COPY } from "@/data/problem-copy";
import { SEVERITY_COPY } from "@/data/report-copy";
import { findTextProblem, numberVariants, type TextProblem } from "./content-filter";
import { getExercise } from "./exercises";
import type { ReportRequest } from "./request";
import type { ExerciseSelection } from "./select-exercises";
import { cardTimestamps, goodItemNames, trunkDegrees } from "./template-report";
import type { ReportBody } from "./types";

/** 各段文字的長度上限（字元）。 */
export const TEXT_LIMITS = { summary: 260, whatWeSaw: 180, why: 90 } as const;

const CATEGORY_ZH = { stretch: "放鬆／伸展", strength: "肌力", motor_control: "走路時的動作提示" } as const;

/** Claude 回傳的格式。長度等限制在合併時檢查，不放在這裡（結構化輸出不支援長度限制）。 */
export const aiOutputSchema = z.object({
  summary: z.string(),
  cards: z.array(
    z.object({
      card_id: z.string(),
      what_we_saw: z.string(),
      exercises: z.array(z.object({ id: z.string(), why: z.string() })),
    }),
  ),
});
export type AiOutput = z.infer<typeof aiOutputSchema>;

export interface AiInput {
  confidence: "good" | "good_with_tip" | "low";
  population_caveat: boolean;
  slow_speed: boolean;
  good_items: string[];
  template_summary: string;
  cards: Array<{
    card_id: string;
    plain_name: string;
    severity_label: string;
    near_threshold: boolean;
    timestamps: string[];
    average_trunk_lean_degrees?: number;
    template_what_we_saw: string;
    exercises: Array<{ id: string; name: string; type: string; purpose: string }>;
  }>;
}

/** 每張卡片「第一次出現」的練習 id（重複出現的練習在後面卡片只放「見某某卡片」，不需要 AI 寫）。 */
export function firstOccurrenceIds(selection: ExerciseSelection): Map<string, string[]> {
  const seen = new Set<string>();
  const result = new Map<string, string[]>();
  for (const card of selection.cards) {
    const ids = card.exerciseIds.filter((id) => !seen.has(id));
    ids.forEach((id) => seen.add(id));
    result.set(card.cardId, ids);
  }
  return result;
}

export function buildAiInput(request: ReportRequest, selection: ExerciseSelection, template: ReportBody): AiInput {
  const firstIds = firstOccurrenceIds(selection);
  return {
    confidence: request.confidence.display,
    population_caveat: request.population_caveat,
    slow_speed: request.walking.slow_speed,
    good_items: goodItemNames(selection),
    template_summary: template.summary,
    cards: selection.cards.map((card, index) => {
      const degrees = trunkDegrees(card);
      return {
        card_id: card.cardId,
        plain_name: PROBLEM_COPY[card.cardId].plainName,
        severity_label: SEVERITY_COPY[card.finding.severity].label,
        near_threshold: card.finding.near_threshold,
        timestamps: cardTimestamps(card),
        ...(degrees !== undefined ? { average_trunk_lean_degrees: degrees } : {}),
        template_what_we_saw: template.problems[index].whatWeSaw,
        exercises: (firstIds.get(card.cardId) ?? []).map((id) => {
          const exercise = getExercise(id)!;
          return {
            id,
            name: exercise.name_zh,
            type: CATEGORY_ZH[exercise.category],
            purpose: exercise.purpose,
          };
        }),
      };
    }),
  };
}

export interface MergeResult {
  report: ReportBody;
  /** 至少有一段 AI 文字被採用。 */
  usedAi: boolean;
  /** 被換回模板的段落數與原因（只用於統計，不含文字內容）。 */
  rejected: TextProblem[];
}

export class AiOutputRejectedError extends Error {
  constructor(public readonly kind: "unknown_card" | "unknown_exercise" | "duplicate") {
    super(`AI output rejected: ${kind}`);
    this.name = "AiOutputRejectedError";
  }
}

/**
 * 把 AI 文字合併進模板報告。
 * 出現候選以外的卡片或練習 id 時丟出 AiOutputRejectedError（呼叫端改用整份模板）。
 */
export function mergeAiOutput(
  template: ReportBody,
  output: AiOutput,
  selection: ExerciseSelection,
): MergeResult {
  const firstIds = firstOccurrenceIds(selection);
  const cardIndex = new Map(selection.cards.map((card, index) => [card.cardId as string, index]));

  // 先檢查 id：AI 只能使用程式給的候選（SPEC D7）
  const seenCards = new Set<string>();
  for (const aiCard of output.cards) {
    if (!cardIndex.has(aiCard.card_id)) throw new AiOutputRejectedError("unknown_card");
    if (seenCards.has(aiCard.card_id)) throw new AiOutputRejectedError("duplicate");
    seenCards.add(aiCard.card_id);
    const allowed = firstIds.get(aiCard.card_id) ?? [];
    const seenExercises = new Set<string>();
    for (const exercise of aiCard.exercises) {
      if (!allowed.includes(exercise.id)) throw new AiOutputRejectedError("unknown_exercise");
      if (seenExercises.has(exercise.id)) throw new AiOutputRejectedError("duplicate");
      seenExercises.add(exercise.id);
    }
  }

  const report: ReportBody = structuredClone(template);
  const rejected: TextProblem[] = [];
  let usedAi = false;

  const accept = (text: string, rules: Parameters<typeof findTextProblem>[1]): string | null => {
    const problem = findTextProblem(text, rules);
    if (problem) {
      rejected.push(problem);
      return null;
    }
    usedAi = true;
    return text.trim();
  };

  // 總結語：可以出現的數字只有問題數量與「3 個項目」
  const summaryNumbers = new Set<string>([String(selection.cards.length), "3"]);
  const summary = accept(output.summary, { maxLength: TEXT_LIMITS.summary, allowedNumbers: summaryNumbers });
  if (summary) report.summary = summary;

  for (const aiCard of output.cards) {
    const index = cardIndex.get(aiCard.card_id)!;
    const card = selection.cards[index];
    const view = report.problems[index];

    const timestamps = cardTimestamps(card);
    const numbers = new Set<string>([String(timestamps.length)]);
    if (card.cardId === "trunk_forward_lean" && card.finding.metrics.TRK !== undefined) {
      numberVariants(card.finding.metrics.TRK).forEach((value) => numbers.add(value));
    }
    const saw = accept(aiCard.what_we_saw, {
      maxLength: TEXT_LIMITS.whatWeSaw,
      allowedNumbers: numbers,
      allowedTimestamps: timestamps,
    });
    if (saw) view.whatWeSaw = saw;

    for (const aiExercise of aiCard.exercises) {
      const target = view.exercises.find((exercise) => exercise.exerciseId === aiExercise.id && exercise.steps.length > 0);
      if (!target) continue;
      // 連結句不可以有任何數字：劑量、次數只能用動作庫原文（§3 規則 10）
      const why = accept(aiExercise.why, { maxLength: TEXT_LIMITS.why });
      if (why) target.why = why;
    }
  }

  return { report, usedAi, rejected };
}
