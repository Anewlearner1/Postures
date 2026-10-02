/**
 * 這個檔案做什麼：
 *   讀取動作庫資料檔 `src/data/exercises.json`（SPEC D34：唯一資料來源），
 *   檢查格式是否正確，並提供查詢函式（依 id 找動作、依問題找對應列）。
 *
 *   動作庫的內容（名稱、步驟、劑量、禁忌）要改的話，直接改 `src/data/exercises.json`，
 *   並同步更新 `docs/spec/exercise-library.md` 結尾的 JSON 區塊；
 *   兩邊不一致時，`exercises.test.ts` 會失敗提醒。
 *
 * 閱讀提示：
 *   - `z.object({...}).strict()` 表示「欄位只能是這些，多一個都不行」。
 *   - 檔案載入時就會檢查一次，格式錯誤會直接報錯，不會讓錯誤資料進到報告。
 */

import { z } from "zod";
import rawLibrary from "@/data/exercises.json";
import type { ProblemCode } from "@/lib/gait/types";

// ---------------------------------------------------------------------------
// 1. 資料格式（對應 exercise-library.md §9 的欄位說明）
// ---------------------------------------------------------------------------

export const EXERCISE_CATEGORIES = ["stretch", "strength", "motor_control"] as const;
/** stretch = 放鬆／伸展；strength = 肌力；motor_control = 動作控制／步態再教育。 */
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];

const problemCodeSchema = z.enum(["hip_extension_deficit", "knee_flexion_abnormal", "trunk_head_forward_lean"]);

const exerciseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name_zh: z.string().min(1),
    category: z.enum(EXERCISE_CATEGORIES),
    problems: z.array(problemCodeSchema).min(1),
    causes: z.array(z.string()).min(1),
    purpose: z.string().min(1),
    equipment: z.string(),
    start_position: z.string(),
    steps: z.array(z.string().min(1)).min(1),
    dosage: z
      .object({
        sets: z.string(),
        reps_or_time: z.string(),
        frequency: z.string(),
        summary_zh: z.string().min(1),
        note: z.string(),
      })
      .strict(),
    common_mistakes: z.array(z.string()),
    regression: z.string().min(1),
    /** 退階版的完整步驟（可獨立閱讀，3–6 步）；population_caveat 時顯示這個（exercise-library.md §3 規則 6）。 */
    regression_steps: z.array(z.string().min(1)).min(3).max(6),
    progression: z.string(),
    safety: z
      .object({
        cautions: z.array(z.string()),
        contraindications: z.array(z.string()),
        stop_and_seek_care: z.array(z.string()),
      })
      .strict(),
    evidence_note: z.string(),
    v1_active: z.boolean(),
    v1_note: z.string(),
  })
  .strict();

const librarySchema = z
  .object({
    version: z.string(),
    decisions_applied: z.array(z.string()),
    problems: z.record(problemCodeSchema, z.string()),
    causes: z.record(
      z.string(),
      z.object({ name_zh: z.string().min(1), v1_active: z.boolean(), v1_note: z.string() }).strict(),
    ),
    refer_only_causes: z.record(
      z.string(),
      z.object({ problem: problemCodeSchema, name_zh: z.string().min(1) }).strict(),
    ),
    mapping: z.array(
      z
        .object({
          problem: problemCodeSchema,
          cause: z.string(),
          exercise_ids: z.array(z.string()).min(1),
          v1_active: z.boolean(),
        })
        .strict(),
    ),
    exercises: z.array(exerciseSchema).min(1),
  })
  .strict();

export type Exercise = z.infer<typeof exerciseSchema>;
export type ExerciseLibrary = z.infer<typeof librarySchema>;
export type ExerciseMapping = ExerciseLibrary["mapping"][number];

/** 檢查一份動作庫資料是否符合格式（測試也會用到）。格式錯誤時丟出錯誤。 */
export function parseExerciseLibrary(data: unknown): ExerciseLibrary {
  return librarySchema.parse(data);
}

// ---------------------------------------------------------------------------
// 2. 載入（模組第一次被使用時檢查一次）
// ---------------------------------------------------------------------------

export const EXERCISE_LIBRARY: ExerciseLibrary = parseExerciseLibrary(rawLibrary);

const exercisesById = new Map(EXERCISE_LIBRARY.exercises.map((exercise) => [exercise.id, exercise]));

/** 依 id 取得動作；找不到時回傳 undefined。 */
export function getExercise(id: string): Exercise | undefined {
  return exercisesById.get(id);
}

/** 這個動作第一版可不可以被選用（D24、D25 不觸發的動作會回傳 false）。 */
export function isActiveExercise(id: string): boolean {
  return exercisesById.get(id)?.v1_active === true;
}

/** 原因代碼是否為「不給動作、只提醒就醫」（exercise-library.md §3 規則 6）。 */
export function isReferOnlyCause(cause: string): boolean {
  return Object.hasOwn(EXERCISE_LIBRARY.refer_only_causes, cause);
}

/** 原因代碼在第一版是否啟用（可以對應到動作）。 */
export function isActiveCause(cause: string): boolean {
  return EXERCISE_LIBRARY.causes[cause]?.v1_active === true;
}

/** 原因的中文說明（一般原因或只提醒就醫的原因都適用）；找不到時回傳 undefined。 */
export function causeNameZh(cause: string): string | undefined {
  return EXERCISE_LIBRARY.causes[cause]?.name_zh ?? EXERCISE_LIBRARY.refer_only_causes[cause]?.name_zh;
}

/** 某問題在第一版可用的對應列（問題 → 原因 → 動作）。 */
export function activeMappingsFor(problem: ProblemCode): ExerciseMapping[] {
  return EXERCISE_LIBRARY.mapping.filter(
    (row) => row.problem === problem && row.v1_active && isActiveCause(row.cause),
  );
}

/** 某問題可以出現的所有原因代碼（含只提醒就醫的原因），用來檢查輸入資料。 */
export function knownCausesFor(problem: ProblemCode): Set<string> {
  const causes = new Set(EXERCISE_LIBRARY.mapping.filter((row) => row.problem === problem).map((row) => row.cause));
  for (const [cause, info] of Object.entries(EXERCISE_LIBRARY.refer_only_causes)) {
    if (info.problem === problem) causes.add(cause);
  }
  return causes;
}

/**
 * 子型態 → 對題的原因代碼（D40）。動作庫的對應表只分到「問題」，膝屈曲異常的兩種型態
 * 要再依 gait-rules.md §4.4「對應型態」欄位區分；沒有子型態的問題（髖、軀幹）不受限制。
 * `knee_pain_swelling` 適用任何型態，但它是只提醒就醫的原因，不會產生動作。
 */
export const SUBTYPE_CAUSES: Partial<Record<string, readonly string[]>> = {
  knee_swing_flexion_low: ["quad_rectus_tightness", "weak_push_off", "slow_short_stride", "knee_pain_swelling"],
  knee_stance_flexion_high: ["hamstring_tightness", "quad_weakness", "knee_pain_swelling"],
};

/** 這個原因對這個子型態是否「對題」（沒有子型態限制時一律為 true）。 */
export function causeFitsSubtype(cause: string, subtype: string | undefined): boolean {
  const allowed = subtype ? SUBTYPE_CAUSES[subtype] : undefined;
  return allowed ? allowed.includes(cause) : true;
}
