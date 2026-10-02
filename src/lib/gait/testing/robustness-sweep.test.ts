/**
 * 演算法穩健性「完整參數掃描」（分析腳本；平常 `npm test` 會略過，因為要跑好幾分鐘）。
 *
 * 執行：
 *   GAIT_SWEEP=1 npx vitest run src/lib/gait/testing/robustness-sweep.test.ts
 * 選項：
 *   GAIT_SWEEP_SEEDS=10            每個條件跑幾個亂數種子（預設 8）
 *   GAIT_SWEEP_OUT=/路徑/結果.md     把結果表格寫到檔案（預設只印在終端機）
 *   GAIT_SWEEP_PROFILES=normal,hipMarked   只跑部分步態（預設全部）
 *
 * 每一列只改一個拍攝條件（其餘維持 BASELINE），表格中的數字是比例：
 *   誤拒 = 被要求重拍；誤報 = 正常卻被標成問題；漏判 = 有問題卻判常見範圍內；低可信 = 可信度「較低」。
 * 結果整理在 docs/review/M5-qa.md。
 */

import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { BASELINE, PROFILES, runCondition, SWEEPS, type ConditionSummary } from "./robustness";

const enabled = process.env.GAIT_SWEEP === "1";
const seedCount = Number(process.env.GAIT_SWEEP_SEEDS ?? 8);
const seeds = Array.from({ length: seedCount }, (_, i) => 101 + i * 7);
const profileKeys = (process.env.GAIT_SWEEP_PROFILES?.split(",") ?? Object.keys(PROFILES)).filter((k) => k in PROFILES);

const pct = (x: number) => `${Math.round(x * 100)}%`;

function cell(summary: ConditionSummary, expectsProblem: boolean): string {
  const parts = [`拒${pct(summary.rejectRate)}`];
  parts.push(expectsProblem ? `漏${pct(summary.missRate)}` : `誤${pct(summary.falsePositiveRate)}`);
  if (summary.lowConfidenceRate > 0) parts.push(`低${pct(summary.lowConfidenceRate)}`);
  const codes = Object.entries(summary.rejectCodes)
    .map(([code, n]) => `${code}×${n}`)
    .join(",");
  const items = Object.entries(summary.falsePositiveItems)
    .map(([k, n]) => `${k}×${n}`)
    .join(",");
  return parts.join(" ") + (codes ? ` (${codes})` : "") + (items ? ` [${items}]` : "");
}

describe.skipIf(!enabled)("演算法穩健性參數掃描", () => {
  it("單一變因掃描", { timeout: 3_600_000 }, () => {
    const lines: string[] = [];
    lines.push(`種子數：${seedCount}；基準：${JSON.stringify(BASELINE)}`, "");
    const header = `| 條件 | 值 | ${profileKeys.map((k) => PROFILES[k].name).join(" | ")} |`;
    for (const sweep of SWEEPS) {
      lines.push(`### ${sweep.factor}`, "", header, `|---|---|${profileKeys.map(() => "---").join("|")}|`);
      for (const value of sweep.values) {
        const cells = profileKeys.map((key) => {
          const profile = PROFILES[key];
          const expectsProblem = Object.values(profile.expectProblem).some(Boolean);
          return cell(runCondition(profile, { ...BASELINE, ...sweep.apply(value) }, seeds), expectsProblem);
        });
        lines.push(`| ${sweep.factor} | ${sweep.label(value)} | ${cells.join(" | ")} |`);
      }
      lines.push("");
      console.log(lines.slice(-sweep.values.length - 3).join("\n"));
    }
    const text = lines.join("\n");
    if (process.env.GAIT_SWEEP_OUT) writeFileSync(process.env.GAIT_SWEEP_OUT, text);
  });
});
