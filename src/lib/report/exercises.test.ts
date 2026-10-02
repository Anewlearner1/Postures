/**
 * 動作庫資料檔的測試：
 *   1. `src/data/exercises.json` 必須和 `docs/spec/exercise-library.md` 結尾的 JSON 區塊完全一致（D34）。
 *      日後只改了其中一邊，這個測試就會失敗，提醒要同步。
 *   2. 資料本身的完整性：對應表裡的動作 id 都存在、第一版不觸發的動作沒有被當成啟用等。
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import rawJson from "@/data/exercises.json";
import {
  EXERCISE_LIBRARY,
  activeMappingsFor,
  getExercise,
  isActiveExercise,
  isReferOnlyCause,
  parseExerciseLibrary,
} from "./exercises";

const MD_PATH = new URL("../../../docs/spec/exercise-library.md", import.meta.url);
const SECTION_HEADING = "## 9. 結構化資料（JSON）";

function extractJsonFromMarkdown(markdown: string): unknown {
  const start = markdown.indexOf(SECTION_HEADING);
  if (start < 0) throw new Error(`找不到「${SECTION_HEADING}」章節`);
  const match = markdown.slice(start).match(/```json\n([\s\S]*?)\n```/);
  if (!match) throw new Error("§9 章節內找不到 ```json 區塊");
  return JSON.parse(match[1]);
}

describe("exercises.json 與 exercise-library.md 同步（D34）", () => {
  it("JSON 內容與文件 §9 的 JSON 區塊完全相同", () => {
    const fromDoc = extractJsonFromMarkdown(readFileSync(MD_PATH, "utf8"));
    expect(rawJson).toEqual(fromDoc);
  });

  it("文件中的 JSON 也符合資料格式", () => {
    const fromDoc = extractJsonFromMarkdown(readFileSync(MD_PATH, "utf8"));
    expect(() => parseExerciseLibrary(fromDoc)).not.toThrow();
  });
});

describe("動作庫資料完整性", () => {
  it("動作 id 不重複", () => {
    const ids = EXERCISE_LIBRARY.exercises.map((exercise) => exercise.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("對應表中的每個動作 id 都存在於動作清單", () => {
    for (const row of EXERCISE_LIBRARY.mapping) {
      for (const id of row.exercise_ids) {
        expect(getExercise(id), `${row.problem}/${row.cause} → ${id}`).toBeDefined();
      }
    }
  });

  it("對應表中的原因代碼都有中文說明", () => {
    for (const row of EXERCISE_LIBRARY.mapping) {
      expect(EXERCISE_LIBRARY.causes[row.cause], row.cause).toBeDefined();
    }
  });

  it("第一版不觸發的動作（chin-tuck、soft-knee-single-leg-balance）不是啟用狀態", () => {
    expect(isActiveExercise("chin-tuck")).toBe(false);
    expect(isActiveExercise("soft-knee-single-leg-balance")).toBe(false);
  });

  it("每個問題第一版都至少有一個步態提示練習（motor_control）", () => {
    for (const problem of ["hip_extension_deficit", "knee_flexion_abnormal", "trunk_head_forward_lean"] as const) {
      const ids = activeMappingsFor(problem).flatMap((row) => row.exercise_ids);
      const hasMotorControl = ids.some(
        (id) => isActiveExercise(id) && getExercise(id)?.category === "motor_control",
      );
      expect(hasMotorControl, problem).toBe(true);
    }
  });

  it("只提醒就醫的原因不會出現在對應表中", () => {
    for (const row of EXERCISE_LIBRARY.mapping) {
      expect(isReferOnlyCause(row.cause)).toBe(false);
    }
  });
});
