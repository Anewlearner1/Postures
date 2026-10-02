/**
 * 這個檔案做什麼：
 *   依 docs/spec/exercise-library.md §3「動作挑選規則」，由程式決定每張問題卡片要放哪些訓練動作。
 *   AI 不能改這個結果：AI 只能替這裡選出的動作寫「為什麼建議」的白話句（SPEC D7）。
 *
 *   規則對照（§3）：
 *   1. 只為「輕度」「明顯」挑動作；只用第一版啟用（v1_active）的原因、對應列與動作。
 *   2. 輕度 2 個（1 步態提示＋1 伸展或肌力）；明顯 3 個（1 步態提示＋1 伸展＋1 肌力）；
 *      候選原因裡沒有該類型時，從同問題的其他原因補。
 *      D40：補位只能用同一子型態的原因（gait-rules.md §4.4「對應型態」，見 exercises.ts 的 SUBTYPE_CAUSES），
 *      例如「膝蓋彎得較多」不可補擺盪期的 `swing-knee-lift-walking-cue`；沒有對題的動作時寧可少給。
 *   3. 整份報告最多 6 個不同動作；同一動作出現在多張卡片時只算一次，後面的卡片改成「見某某卡片」。
 *   4. 可信度「較低」（display = low）時，每張卡片最多 1 個，優先步態提示、其次伸展。
 *   6. 只提醒就醫的原因（pain_guarding 等）不加動作；population_caveat 時整份最多 3 個，並用退階版；
 *      且因為可能包含懷孕（D35 只知道「有勾選」），`glute-bridge` 一律換成 `standing-hip-extension`（避免長時間仰躺）。
 *   7. 頭部前傾只是觀察，不會進到這裡（observations 不產生卡片）。
 *
 *   數量上限的分配方式：依卡片優先順序「輪流」分配（每張卡片先拿第 1 個，再輪第 2 個……），
 *   讓排在後面的卡片也盡量分得到練習。
 */

import { CARD_ORDER, type CardId } from "@/data/problem-copy";
import { cardIdOf } from "./card-id";
import type { ProblemCode, Severity } from "@/lib/gait/types";
import {
  activeMappingsFor,
  causeFitsSubtype,
  getExercise,
  isActiveCause,
  isActiveExercise,
  isReferOnlyCause,
  type ExerciseCategory,
} from "./exercises";
import type { ReportRequest, ReportRequestFinding } from "./request";

/** 整份報告最多幾個不同動作（§3 規則 3、規則 6）。 */
export const MAX_EXERCISES = 6;
export const MAX_EXERCISES_POPULATION_CAVEAT = 3;

export interface SelectedCard {
  cardId: CardId;
  finding: ReportRequestFinding;
  /** 依顯示順序排列的動作 id（可能包含已在前面卡片出現過的動作）。 */
  exerciseIds: string[];
  /** 這張卡片的候選原因中，屬於「只提醒就醫」的原因代碼。 */
  referOnlyCauses: string[];
}

export interface ExerciseSelection {
  /** 只有「輕度」「明顯」的問題會有卡片，依優先順序排列（明顯 > 輕度；同等級依 CARD_ORDER）。 */
  cards: SelectedCard[];
  /** 「在常見範圍內」的問題。 */
  normalFindings: Array<{ cardId: CardId; finding: ReportRequestFinding }>;
  /** 整份報告用到的不同動作 id。 */
  uniqueExerciseIds: string[];
}

export { cardIdOf };

const SEVERITY_RANK: Record<Severity, number> = { marked: 0, mild: 1, normal: 2 };

/** 依「明顯 > 輕度 > 正常」，同等級依 CARD_ORDER 排序。 */
export function compareFindings(a: ReportRequestFinding, b: ReportRequestFinding): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  return CARD_ORDER.indexOf(cardIdOf(a)) - CARD_ORDER.indexOf(cardIdOf(b));
}

/** 一個「名額」：可接受的動作類型，以及挑選方式。 */
interface Slot {
  categories: ExerciseCategory[];
  /**
   * pool：依候選原因的順序，挑第一個類型符合的動作（原因順序代表可能性高低）。
   * priority：依 categories 的先後順序挑（例如低可信度時「先步態提示、再伸展」）。
   */
  mode: "pool" | "priority";
}

function slotsFor(severity: Severity, lowConfidence: boolean): Slot[] {
  if (severity === "normal") return [];
  if (lowConfidence) return [{ categories: ["motor_control", "stretch"], mode: "priority" }];
  if (severity === "mild") {
    return [
      { categories: ["motor_control"], mode: "priority" },
      { categories: ["stretch", "strength"], mode: "pool" },
    ];
  }
  return [
    { categories: ["motor_control"], mode: "priority" },
    { categories: ["stretch"], mode: "priority" },
    { categories: ["strength"], mode: "priority" },
  ];
}

/** 依原因順序展開成不重複的動作 id 清單（只留第一版啟用的動作）。 */
function poolFromCauses(problem: ProblemCode, subtype: string | undefined, causes: readonly string[] | null): string[] {
  // D40：只用與這個子型態對題的原因（例如「膝蓋彎得較多」不用擺盪期的原因與動作）
  const rows = activeMappingsFor(problem).filter((row) => causeFitsSubtype(row.cause, subtype));
  const ordered = causes === null ? rows : causes.flatMap((cause) => rows.filter((row) => row.cause === cause));
  const ids: string[] = [];
  for (const row of ordered) {
    for (const id of row.exercise_ids) {
      if (isActiveExercise(id) && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function pickForSlot(slot: Slot, pool: string[], taken: Set<string>): string | undefined {
  const available = pool.filter((id) => !taken.has(id));
  const categoryOf = (id: string) => getExercise(id)?.category;
  if (slot.mode === "pool") {
    return available.find((id) => slot.categories.includes(categoryOf(id) as ExerciseCategory));
  }
  for (const category of slot.categories) {
    const found = available.find((id) => categoryOf(id) === category);
    if (found) return found;
  }
  return undefined;
}

/** population_caveat 時的動作替換（§3 規則 6）：仰躺的臀橋改成站姿後抬腿。 */
export const POPULATION_CAVEAT_SUBSTITUTES: Readonly<Record<string, string>> = {
  "glute-bridge": "standing-hip-extension",
};

/** 套用替換並去除重複（替換後與既有動作重複時只留第一個）。 */
function substitute(pool: string[], substitutes: Readonly<Record<string, string>>): string[] {
  const result: string[] = [];
  for (const id of pool) {
    const replaced = substitutes[id] ?? id;
    if (isActiveExercise(replaced) && !result.includes(replaced)) result.push(replaced);
  }
  return result;
}

/** 單張卡片「理想上」要放的動作（還沒套用整份報告的數量上限）。 */
function planCard(finding: ReportRequestFinding, lowConfidence: boolean, populationCaveat: boolean): string[] {
  const usableCauses = finding.candidate_causes.filter(
    (cause) => !isReferOnlyCause(cause) && isActiveCause(cause) && causeFitsSubtype(cause, finding.subtype),
  );
  const onlyReferCauses =
    finding.candidate_causes.length > 0 && finding.candidate_causes.every((cause) => isReferOnlyCause(cause));
  if (onlyReferCauses) return []; // §3 規則 6：只有就醫提醒的原因，不給動作

  // 沒有可用（對題）的候選原因時，直接用該問題（同子型態）的全部對應列
  const substitutes = populationCaveat ? POPULATION_CAVEAT_SUBSTITUTES : {};
  const primary = substitute(
    poolFromCauses(finding.problem, finding.subtype, usableCauses.length > 0 ? usableCauses : null),
    substitutes,
  );
  // §3 規則 2：從同問題其他原因補；D40：只補同子型態的原因，沒有對題的動作就少給
  const fallback = substitute(poolFromCauses(finding.problem, finding.subtype, null), substitutes);

  const chosen: string[] = [];
  const taken = new Set<string>();
  for (const slot of slotsFor(finding.severity, lowConfidence)) {
    const id = pickForSlot(slot, primary, taken) ?? pickForSlot(slot, fallback, taken);
    if (id) {
      chosen.push(id);
      taken.add(id);
    }
  }
  return chosen;
}

export function selectExercises(request: ReportRequest): ExerciseSelection {
  const lowConfidence = request.confidence.display === "low";
  const cap = request.population_caveat ? MAX_EXERCISES_POPULATION_CAVEAT : MAX_EXERCISES;

  const sorted = [...request.findings].sort(compareFindings);
  const abnormal = sorted.filter((finding) => finding.severity !== "normal");
  const normalFindings = sorted
    .filter((finding) => finding.severity === "normal")
    .map((finding) => ({ cardId: cardIdOf(finding), finding }));

  const plans = abnormal.map((finding) => planCard(finding, lowConfidence, request.population_caveat));
  const cards: SelectedCard[] = abnormal.map((finding) => ({
    cardId: cardIdOf(finding),
    finding,
    exerciseIds: [],
    referOnlyCauses: finding.candidate_causes.filter((cause) => isReferOnlyCause(cause)),
  }));

  // 依卡片優先順序輪流分配，套用整份報告的上限（同一動作重複出現不另外計算）
  const unique: string[] = [];
  const rounds = Math.max(0, ...plans.map((plan) => plan.length));
  for (let round = 0; round < rounds; round += 1) {
    plans.forEach((plan, cardIndex) => {
      const id = plan[round];
      if (!id) return;
      if (unique.includes(id)) {
        cards[cardIndex].exerciseIds.push(id);
      } else if (unique.length < cap) {
        unique.push(id);
        cards[cardIndex].exerciseIds.push(id);
      }
    });
  }

  return { cards, normalFindings, uniqueExerciseIds: unique };
}
