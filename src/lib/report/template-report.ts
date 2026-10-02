/**
 * 這個檔案做什麼：
 *   不用 AI，只用固定文案（UX 文件 §4 的範本）和動作庫，把分析結果組成一份完整的報告內容。
 *   這就是「降級方案」：沒有 API 金鑰、Claude 失敗或逾時、或 AI 寫的文字沒通過檢查時，都用這份。
 *   有 AI 時，也是先組出這份，再用 AI 寫的段落替換「總結語」「我們看到什麼」與練習連結句。
 *
 *   這個檔案不呼叫任何外部服務，前端與後端都可以使用。
 */

import {
  CONFIDENCE_LOW_GENERIC,
  CONFIDENCE_REASON_COPY,
  CONFIDENCE_TIP_TEMPLATE,
} from "@/data/confidence-copy";
import {
  HIP_ATTRIBUTED_TO_TRUNK_SENTENCE,
  NEAR_THRESHOLD_GOOD_SUFFIX,
  NEAR_THRESHOLD_SENTENCE,
  PROBLEM_COPY,
  SUMMARY_COPY,
  type CardId,
} from "@/data/problem-copy";
import { EXTRA_REPORT_NOTES, HEAD_OBSERVATION_COPY, POPULATION_CAVEAT_COPY } from "@/data/report-copy";
import { causeNameZh, getExercise, isReferOnlyCause } from "./exercises";
import type { ReportRequest } from "./request";
import { selectExercises, type ExerciseSelection, type SelectedCard } from "./select-exercises";
import type { ExerciseView, ProblemCardView, ReportBody } from "./types";

/** 秒數 → 「0:03」格式（UX §8.4）。 */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([A-Z_]+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** 卡片「我們看到什麼」會用到的時間點（最多列 2 個例子）。 */
export function cardTimestamps(card: SelectedCard): string[] {
  return (card.finding.timestamps_sec ?? []).map(formatTimestamp);
}

/** 軀幹前傾的平均角度（四捨五入到整數度），只有身體往前傾卡片會用到。 */
export function trunkDegrees(card: SelectedCard): number | undefined {
  const value = card.finding.metrics.TRK;
  return card.cardId === "trunk_forward_lean" && value !== undefined ? Math.round(value) : undefined;
}

/** 模板版「我們看到什麼」（UX §4.3.1–§4.3.3）。不提左右腳（D26）。 */
export function templateWhatWeSaw(card: SelectedCard): string {
  const copy = PROBLEM_COPY[card.cardId];
  let text = copy.sawSentence;

  if (card.cardId === "trunk_forward_lean") {
    const degrees = trunkDegrees(card);
    text += degrees !== undefined ? `（平均約前傾 ${degrees} 度）。` : "。";
  }

  const timestamps = cardTimestamps(card);
  if (timestamps.length > 0 && card.cardId !== "trunk_forward_lean") {
    text += copy.listTimestamps
      ? `這個情況在影片中出現了 ${timestamps.length} 次（例如 ${timestamps.slice(0, 2).join("、")}）。`
      : `這個情況在影片中出現了 ${timestamps.length} 次。`;
  }

  if (card.finding.near_threshold) text += NEAR_THRESHOLD_SENTENCE;
  return text;
}

const GOOD_ITEM_ORDER = ["後腳推蹬", "膝蓋彎曲", "身體姿勢"];

/** 「看起來不錯」的項目名稱（同一項目只列一次；膝蓋任一型態有問題時不列膝蓋）。 */
export function goodItemNames(selection: ExerciseSelection): string[] {
  const abnormalNames = new Set(selection.cards.map((card) => PROBLEM_COPY[card.cardId].goodItemName));
  const items: string[] = [];
  for (const { cardId, finding } of selection.normalFindings) {
    const name = PROBLEM_COPY[cardId].goodItemName;
    if (abnormalNames.has(name)) continue;
    const label = finding.near_threshold ? `${name}${NEAR_THRESHOLD_GOOD_SUFFIX}` : name;
    if (!items.some((item) => item.startsWith(name))) items.push(label);
  }
  // 依 UX §4.4 的順序：後腳推蹬、膝蓋彎曲、身體姿勢
  const rank = (item: string) => GOOD_ITEM_ORDER.findIndex((name) => item.startsWith(name));
  return items.sort((a, b) => rank(a) - rank(b));
}

/** 模板版總結語（UX §4.2、§4.4）。 */
export function templateSummary(request: ReportRequest, selection: ExerciseSelection): string {
  const lowConfidence = request.confidence.display === "low";
  const goodItems = goodItemNames(selection).map((item) => item.replace(NEAR_THRESHOLD_GOOD_SUFFIX, ""));

  if (selection.cards.length === 0) {
    const assessed = new Set(selection.normalFindings.map(({ cardId }) => PROBLEM_COPY[cardId].goodItemName)).size;
    const parts = [
      lowConfidence ? SUMMARY_COPY.allNormalLowConfidence : "",
      fill(SUMMARY_COPY.allNormal, { N: assessed }),
      assessed === 3 ? SUMMARY_COPY.allNormalDetail : "",
      SUMMARY_COPY.allNormalNote,
    ];
    return parts.filter(Boolean).join("");
  }

  const names = selection.cards.map((card) => PROBLEM_COPY[card.cardId].plainName);
  const hasMarked = selection.cards.some((card) => card.finding.severity === "marked");
  const main = hasMarked
    ? fill(SUMMARY_COPY.hasMarked, { N: names.length, TOP: names[0] })
    : fill(SUMMARY_COPY.onlyMild, { N: names.length, LIST: names.join("、") });
  const good = goodItems.length > 0 ? fill(SUMMARY_COPY.goodItems, { GOOD: goodItems.join("、") }) : "";
  return `${lowConfidence ? SUMMARY_COPY.lowConfidencePrefix : ""}${main}${good}`;
}

/** 從動作庫組出一個練習的顯示內容。population_caveat 時顯示退階版（UX §4.2）。 */
export function exerciseViewFromLibrary(id: string, options: { gentle: boolean; alsoFor: string[] }): ExerciseView {
  const exercise = getExercise(id);
  if (!exercise) throw new Error(`exercise not found: ${id}`);
  const view: ExerciseView = {
    exerciseId: exercise.id,
    name: exercise.name_zh,
    purpose: exercise.purpose,
    steps: options.gentle ? [exercise.regression] : [...exercise.steps],
    dosage: exercise.dosage.summary_zh,
    tip: exercise.safety.cautions[0] ?? exercise.common_mistakes[0],
  };
  if (options.gentle) view.gentle = true;
  if (options.alsoFor.length > 0) view.alsoFor = options.alsoFor;
  return view;
}

export function buildTemplateReport(request: ReportRequest, selection = selectExercises(request)): ReportBody {
  const lowConfidence = request.confidence.display === "low";
  const caveat = request.population_caveat;

  // 每個動作第一次出現在哪張卡片
  const firstCardOf = new Map<string, CardId>();
  for (const card of selection.cards) {
    for (const id of card.exerciseIds) if (!firstCardOf.has(id)) firstCardOf.set(id, card.cardId);
  }

  const problems: ProblemCardView[] = selection.cards.map((card, index) => {
    const copy = PROBLEM_COPY[card.cardId];

    const exercises: ExerciseView[] = card.exerciseIds.map((id) => {
      const firstCard = firstCardOf.get(id)!;
      if (firstCard !== card.cardId) {
        return {
          exerciseId: id,
          name: getExercise(id)!.name_zh,
          purpose: fill(EXTRA_REPORT_NOTES.seeOtherCard, { CARD: PROBLEM_COPY[firstCard].plainName }),
          steps: [],
          ...(caveat ? { gentle: true } : {}),
        };
      }
      const alsoFor = selection.cards
        .filter((other) => other.cardId !== card.cardId && other.exerciseIds.includes(id))
        .map((other) => PROBLEM_COPY[other.cardId].plainName);
      return exerciseViewFromLibrary(id, { gentle: caveat, alsoFor });
    });

    const causes = card.finding.candidate_causes
      .filter((cause) => !isReferOnlyCause(cause))
      .map((cause) => causeNameZh(cause))
      .filter((name): name is string => Boolean(name));

    const notes = [copy.note, card.referOnlyCauses.length > 0 ? EXTRA_REPORT_NOTES.referOnlyCause : undefined].filter(
      (note): note is string => Boolean(note),
    );

    const intro: string[] = [];
    if (caveat) intro.push(POPULATION_CAVEAT_COPY.exercisesIntro);
    if (lowConfidence && exercises.length > 0) intro.push(EXTRA_REPORT_NOTES.lowConfidenceExercises);
    if (exercises.length === 0 && card.referOnlyCauses.length === 0) intro.push(POPULATION_CAVEAT_COPY.noExercises);

    const timestamps = cardTimestamps(card);
    const view: ProblemCardView = {
      id: card.cardId,
      markerNumber: index + 1,
      plainName: copy.plainName,
      professionalName: copy.professionalName,
      subtitle: copy.subtitle,
      severity: card.finding.severity,
      whatWeSaw: templateWhatWeSaw(card),
      // D39：髖伸展偏小已歸因於軀幹前傾時，軀幹卡片加 UX §4.2 的固定句
      meaning: card.finding.hip_attributed_to_trunk
        ? [...copy.meaning, HIP_ATTRIBUTED_TO_TRUNK_SENTENCE]
        : [...copy.meaning],
      causes: causes.length > 0 ? causes : [...copy.defaultCauses],
      exercises,
    };
    if (timestamps[0]) view.firstTimestamp = timestamps[0];
    if (notes.length > 0) view.note = notes.join("");
    if (card.finding.near_threshold) view.nearThreshold = true;
    if (intro.length > 0) view.exercisesIntro = intro.join("");
    return view;
  });

  const report: ReportBody = {
    summary: templateSummary(request, selection),
    cyclesAnalyzed: request.walking.valid_cycles_total,
    confidence: request.confidence.display,
    slowSpeed: request.walking.slow_speed,
    problems,
    goodItems: goodItemNames(selection),
  };

  const reasons = request.confidence.reasons;
  if (request.confidence.display === "good_with_tip" && reasons[0]) {
    report.confidenceTip = fill(CONFIDENCE_TIP_TEMPLATE, { FIX: CONFIDENCE_REASON_COPY[reasons[0]].fix });
  }
  if (request.confidence.display === "low") {
    const top = reasons.slice(0, 2).map((reason) => CONFIDENCE_REASON_COPY[reason]);
    report.lowConfidence =
      top.length > 0
        ? {
            reason: fill(top.map((item) => item.reason).join(""), { CYCLES: request.walking.valid_cycles_total }),
            fix: top.map((item) => item.fix).join(""),
          }
        : { ...CONFIDENCE_LOW_GENERIC };
  }

  const head = request.observations.find((observation) => observation.item === "head_forward");
  if (head) report.headObservation = [...HEAD_OBSERVATION_COPY[head.status]];
  if (caveat) report.populationCaveat = true;

  return report;
}
