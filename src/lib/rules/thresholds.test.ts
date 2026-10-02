/**
 * 閾值設定檔與規格文件的一致性檢查：
 *   `thresholds.ts` 的分級閾值必須和 docs/spec/gait-rules.md §8 閾值總表（YAML）一致。
 *   之後 M5 校正時，兩邊要一起改；只改一邊這個測試會失敗提醒。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HIP_EXTENSION,
  KNEE_STANCE,
  KNEE_SWING,
  RULES_VERSION,
  SLOW_SPEED_LEG_PER_SEC,
  STANDARD_LABEL,
  TRUNK,
} from "./thresholds";

const MD_PATH = new URL("../../../docs/spec/gait-rules.md", import.meta.url);

function section8Yaml(): string {
  const text = readFileSync(MD_PATH, "utf8");
  const start = text.indexOf("## 8. 閾值總表");
  const block = text.slice(start).match(/```yaml\n([\s\S]*?)```/);
  if (!block) throw new Error("gait-rules.md §8 YAML block not found");
  return block[1];
}

/** 取出某個 YAML 區段（以縮排判斷）中的一行值。 */
function yamlValue(yaml: string, path: string[]): string {
  const lines = yaml.split("\n");
  let index = 0;
  let indent = -1;
  for (const key of path) {
    const found = lines.findIndex((line, i) => {
      if (i < index) return false;
      const match = line.match(/^(\s*)([A-Za-z_]+):/);
      return match !== null && match[2] === key && match[1].length > indent;
    });
    if (found < 0) throw new Error(`key not found: ${path.join(".")}`);
    indent = lines[found].match(/^(\s*)/)![1].length;
    index = found + 1;
  }
  return lines[index - 1].replace(/^\s*[A-Za-z_]+:\s*/, "").replace(/\s+#.*$/, "").replace(/"/g, "");
}

describe("thresholds.ts 與 gait-rules.md §8 一致", () => {
  const yaml = section8Yaml();

  it("版本與測試版標籤", () => {
    expect(yamlValue(yaml, ["version"])).toBe(RULES_VERSION);
    expect(yamlValue(yaml, ["standard_label"])).toBe(STANDARD_LABEL);
  });

  it("髖伸展 PHE 與 D31 歸因條件", () => {
    expect(yamlValue(yaml, ["hip_extension_deficit", "normal"])).toBe(`>= ${HIP_EXTENSION.normalMin}`);
    expect(yamlValue(yaml, ["hip_extension_deficit", "mild"])).toBe(`[${HIP_EXTENSION.markedBelow}, ${HIP_EXTENSION.normalMin})`);
    expect(yamlValue(yaml, ["hip_extension_deficit", "marked"])).toBe(`< ${HIP_EXTENSION.markedBelow}`);
    expect(yaml).toContain(`if TE >= ${HIP_EXTENSION.attributionMinTE} and TRK >= ${HIP_EXTENSION.attributionMinTRK}`);
  });

  it("膝擺盪期 PKF_sw 與 ΔPKF", () => {
    const path = ["knee_flexion_abnormal", "swing_flexion_low"];
    expect(yamlValue(yaml, [...path, "normal"])).toBe(`>= ${KNEE_SWING.normalMin}`);
    expect(yamlValue(yaml, [...path, "mild"])).toBe(`[${KNEE_SWING.markedBelow}, ${KNEE_SWING.normalMin})`);
    expect(yamlValue(yaml, [...path, "marked"])).toBe(`< ${KNEE_SWING.markedBelow}`);
    const aux = yamlValue(yaml, [...path, "asymmetry_aux"]);
    expect(aux).toContain(`mild: (${KNEE_SWING.asymmetryNormalMax}, ${KNEE_SWING.asymmetryMildMax}]`);
    expect(aux).toContain(`marked: > ${KNEE_SWING.asymmetryMildMax}`);
  });

  it("膝著地 KIC", () => {
    const path = ["knee_flexion_abnormal", "stance_flexion_high"];
    expect(yamlValue(yaml, [...path, "normal"])).toBe(`<= ${KNEE_STANCE.normalMax}`);
    expect(yamlValue(yaml, [...path, "mild"])).toBe(`(${KNEE_STANCE.normalMax}, ${KNEE_STANCE.markedMin})`);
    expect(yamlValue(yaml, [...path, "marked"])).toBe(`>= ${KNEE_STANCE.markedMin}`);
  });

  it("軀幹 TRK", () => {
    const path = ["trunk_head_forward", "trunk_forward_lean"];
    expect(yamlValue(yaml, [...path, "normal"])).toBe(`< ${TRUNK.mildMin}`);
    expect(yamlValue(yaml, [...path, "mild"])).toBe(`[${TRUNK.mildMin}, ${TRUNK.markedMin})`);
    expect(yamlValue(yaml, [...path, "marked"])).toBe(`>= ${TRUNK.markedMin}`);
  });

  it("走得偏慢 slow_speed", () => {
    expect(yamlValue(yaml, ["interpretation_flags", "slow_speed"])).toBe(`v_hat < ${SLOW_SPEED_LEG_PER_SEC.toFixed(1)} leg_length/s`);
  });
});
