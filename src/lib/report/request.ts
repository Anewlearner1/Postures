/**
 * 這個檔案做什麼：
 *   定義「送到 POST /api/report 的資料」格式，並用 zod 嚴格檢查。
 *   格式依 docs/spec/gait-rules.md §8「交給 LLM 的結構化結果」（欄位名稱用底線寫法）。
 *
 *   檢查重點：
 *   - 多一個欄位都不行（例如 left/right、NCK、TE、影像資料都會被拒絕）—— D18、D25、D26。
 *   - 每個問題只能帶它自己的指標（髖：PHE；膝擺盪期：PKF_sw；膝著地：KIC；軀幹：TRK）。
 *   - 原因代碼必須屬於該問題（依動作庫對應表）。
 *   - 數值、陣列長度都有合理上下限；整個請求的大小上限見 MAX_REQUEST_BYTES。
 *
 *   前端把 AnalysisResult（駝峰寫法）轉成這個格式的函式在 `to-request.ts`。
 *
 *   擴充欄位（gait-rules.md §8）：
 *   - 每個問題可以選填 `timestamps_sec`（D38：問題出現的時間點，秒），
 *     讓報告的「我們看到什麼」能寫出時間點（UX §4.3.0）。這不是角度數字，也不含左右側。
 *   - 軀幹前傾可以選填 `hip_attributed_to_trunk: true`（D39）：髖伸展偏小已歸因於軀幹前傾（D31），
 *     此時請求中不可以再有髖伸展的問題，軀幹卡片顯示 UX §4.2 的固定文案。
 */

import { z } from "zod";
import type {
  CauseCode,
  ConfidenceReason,
  ProblemCode,
  ProblemSubtype,
} from "@/lib/gait/types";
import { knownCausesFor } from "./exercises";
import { ALLOWED_METRIC } from "./to-request";

/** 請求內容的大小上限（位元組）。正常的分析結果約 1–2 KB。 */
export const MAX_REQUEST_BYTES = 16 * 1024;

const CAUSE_CODES = [
  "hip_flexor_tightness",
  "glute_weakness",
  "weak_push_off",
  "slow_short_stride",
  "pain_guarding",
  "quad_rectus_tightness",
  "hamstring_tightness",
  "quad_weakness",
  "knee_pain_swelling",
  "thoracic_stiffness",
  "pec_tightness",
  "back_scapular_endurance",
  "pain_balance_osteoporosis",
] as const satisfies readonly CauseCode[];

const CONFIDENCE_REASONS = [
  "angle_off",
  "occlusion",
  "few_cycles",
  "high_variability",
  "subject_small",
  "partial_out_of_frame",
  "low_light",
  "camera_motion",
  "camera_tilt",
  "lens_distortion",
  "low_fps",
  "lr_swap",
  "irregular_pace",
] as const satisfies readonly ConfidenceReason[];

const PROBLEM_CODES = [
  "hip_extension_deficit",
  "knee_flexion_abnormal",
  "trunk_head_forward_lean",
] as const satisfies readonly ProblemCode[];

const SUBTYPES = [
  "knee_swing_flexion_low",
  "knee_stance_flexion_high",
  "trunk_forward_lean",
] as const satisfies readonly ProblemSubtype[];

/** 角度（度）。範圍放寬到 −90～180，只擋明顯錯誤的值。 */
const angle = z.number().finite().min(-90).max(180);

const findingSchema = z
  .object({
    problem: z.enum(PROBLEM_CODES),
    subtype: z.enum(SUBTYPES).optional(),
    severity: z.enum(["normal", "mild", "marked"]),
    metrics: z
      .object({
        PHE: angle.optional(),
        PKF_sw: angle.optional(),
        KIC: angle.optional(),
        TRK: angle.optional(),
      })
      .strict(),
    metric_confidence: z.enum(["high", "medium", "low"]),
    near_threshold: z.boolean(),
    candidate_causes: z.array(z.enum(CAUSE_CODES)).max(CAUSE_CODES.length),
    timestamps_sec: z.array(z.number().finite().min(0).max(600)).max(20).optional(),
    /** D39：只允許出現在軀幹前傾（trunk_forward_lean）。 */
    hip_attributed_to_trunk: z.boolean().optional(),
  })
  .strict();

/** 依 D28，內部可信度與顯示等級必須對得上。 */
const DISPLAY_FOR_OVERALL = { high: "good", medium: "good_with_tip", low: "low" } as const;

export const reportRequestSchema = z
  .object({
    rules_version: z.string().regex(/^[A-Za-z0-9._-]{1,40}$/),
    standard_label: z.enum(["beta", "v1"]),
    confidence: z
      .object({
        overall: z.enum(["high", "medium", "low"]),
        display: z.enum(["good", "good_with_tip", "low"]),
        reasons: z.array(z.enum(CONFIDENCE_REASONS)).max(CONFIDENCE_REASONS.length),
      })
      .strict(),
    walking: z
      .object({
        passes: z.number().int().min(0).max(50),
        valid_cycles_total: z.number().int().min(1).max(500),
        slow_speed: z.boolean(),
      })
      .strict(),
    population_caveat: z.boolean(),
    findings: z.array(findingSchema).min(1).max(4),
    observations: z
      .array(z.object({ item: z.literal("head_forward"), status: z.enum(["observed", "not_assessable"]) }).strict())
      .max(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (DISPLAY_FOR_OVERALL[value.confidence.overall] !== value.confidence.display) {
      ctx.addIssue({
        code: "custom",
        path: ["confidence", "display"],
        message: "confidence.display does not match confidence.overall (D28)",
      });
    }
    if (new Set(value.confidence.reasons).size !== value.confidence.reasons.length) {
      ctx.addIssue({ code: "custom", path: ["confidence", "reasons"], message: "duplicate reasons" });
    }

    const seen = new Set<string>();
    const hasHipFinding = value.findings.some((finding) => finding.problem === "hip_extension_deficit");
    value.findings.forEach((finding, index) => {
      // D39：歸因旗標只能放在軀幹前傾，且軀幹必須有狀況、請求中不能同時有髖伸展的問題
      if (finding.hip_attributed_to_trunk === true) {
        const onTrunk = finding.problem === "trunk_head_forward_lean";
        if (!onTrunk || finding.severity === "normal" || hasHipFinding) {
          ctx.addIssue({
            code: "custom",
            path: ["findings", index, "hip_attributed_to_trunk"],
            message: "hip_attributed_to_trunk requires a non-normal trunk finding and no hip finding (D39)",
          });
        }
      }

      const subtype =
        finding.problem === "trunk_head_forward_lean" ? (finding.subtype ?? "trunk_forward_lean") : finding.subtype;
      const key = `${finding.problem}/${subtype ?? ""}`;
      const allowedMetric = ALLOWED_METRIC[key];
      if (!allowedMetric) {
        ctx.addIssue({ code: "custom", path: ["findings", index, "subtype"], message: "subtype does not match problem" });
        return;
      }
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: ["findings", index], message: "duplicate finding" });
      }
      seen.add(key);

      for (const metric of Object.keys(finding.metrics)) {
        if (metric !== allowedMetric) {
          ctx.addIssue({
            code: "custom",
            path: ["findings", index, "metrics", metric],
            message: "metric not allowed for this problem",
          });
        }
      }

      const known = knownCausesFor(finding.problem);
      finding.candidate_causes.forEach((cause, causeIndex) => {
        if (!known.has(cause)) {
          ctx.addIssue({
            code: "custom",
            path: ["findings", index, "candidate_causes", causeIndex],
            message: "cause does not belong to this problem",
          });
        }
      });
      if (new Set(finding.candidate_causes).size !== finding.candidate_causes.length) {
        ctx.addIssue({ code: "custom", path: ["findings", index, "candidate_causes"], message: "duplicate causes" });
      }
    });
  });

export type ReportRequest = z.infer<typeof reportRequestSchema>;
export type ReportRequestFinding = ReportRequest["findings"][number];

/** 驗證失敗時回傳給前端的問題清單：只有欄位路徑與錯誤類型，不回傳使用者送來的值。 */
export interface RequestIssue {
  path: string;
  code: string;
}

export type ParseRequestResult =
  | { ok: true; data: ReportRequest }
  | { ok: false; issues: RequestIssue[] };

export function parseReportRequest(input: unknown): ParseRequestResult {
  const result = reportRequestSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    issues: result.error.issues.slice(0, 20).map((issue) => ({
      path: issue.path.map(String).join("."),
      code: issue.code,
    })),
  };
}
