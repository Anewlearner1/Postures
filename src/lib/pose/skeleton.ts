/**
 * 這個檔案做什麼：
 *   在畫布（canvas）上畫骨架：關節點與連線（UX 文件 §4.6「骨架的顏色規則」）。
 *   - 靠近鏡頭那一側（近側）的手腳：實線、較粗；遠側：較淡的虛線（側拍時遠側常被擋住，較不準）。
 *   - 偵測信心低（visibility < 0.5）的關節：半透明。
 *   近側判斷：比較左右腳關節的平均 visibility（越高越可能是近側），差不多時看深度 z（越小越近），
 *   並在前後幾格之間平滑，避免骨架顏色一直跳（gait-rules.md §1.4 的簡化版，只用於畫圖）。
 */

import { LANDMARK, type Landmark, type PoseFrame, type Side } from "@/lib/gait/types";

/** 一條骨架連線：兩端關節編號＋屬於哪一側（中軸＝"center"）。 */
export interface Bone {
  from: number;
  to: number;
  side: Side | "center";
}

const L = LANDMARK;

export const BONES: Bone[] = [
  { from: L.leftShoulder, to: L.rightShoulder, side: "center" },
  { from: L.leftHip, to: L.rightHip, side: "center" },
  { from: L.leftShoulder, to: L.leftHip, side: "left" },
  { from: L.rightShoulder, to: L.rightHip, side: "right" },
  { from: L.leftEar, to: L.leftShoulder, side: "left" },
  { from: L.rightEar, to: L.rightShoulder, side: "right" },
  // 手臂（11-13-15、12-14-16）
  { from: L.leftShoulder, to: 13, side: "left" },
  { from: 13, to: 15, side: "left" },
  { from: L.rightShoulder, to: 14, side: "right" },
  { from: 14, to: 16, side: "right" },
  // 腿
  { from: L.leftHip, to: L.leftKnee, side: "left" },
  { from: L.leftKnee, to: L.leftAnkle, side: "left" },
  { from: L.leftAnkle, to: L.leftHeel, side: "left" },
  { from: L.leftHeel, to: L.leftFootIndex, side: "left" },
  { from: L.leftAnkle, to: L.leftFootIndex, side: "left" },
  { from: L.rightHip, to: L.rightKnee, side: "right" },
  { from: L.rightKnee, to: L.rightAnkle, side: "right" },
  { from: L.rightAnkle, to: L.rightHeel, side: "right" },
  { from: L.rightHeel, to: L.rightFootIndex, side: "right" },
  { from: L.rightAnkle, to: L.rightFootIndex, side: "right" },
];

/** 畫骨架時要畫出的關節點。 */
export const JOINTS: { index: number; side: Side | "center" }[] = [
  { index: L.nose, side: "center" },
  { index: L.leftEar, side: "left" },
  { index: L.rightEar, side: "right" },
  { index: L.leftShoulder, side: "left" },
  { index: L.rightShoulder, side: "right" },
  { index: 13, side: "left" },
  { index: 14, side: "right" },
  { index: 15, side: "left" },
  { index: 16, side: "right" },
  { index: L.leftHip, side: "left" },
  { index: L.rightHip, side: "right" },
  { index: L.leftKnee, side: "left" },
  { index: L.rightKnee, side: "right" },
  { index: L.leftAnkle, side: "left" },
  { index: L.rightAnkle, side: "right" },
  { index: L.leftHeel, side: "left" },
  { index: L.rightHeel, side: "right" },
  { index: L.leftFootIndex, side: "left" },
  { index: L.rightFootIndex, side: "right" },
];

const LEG_POINTS: Record<Side, number[]> = {
  left: [L.leftHip, L.leftKnee, L.leftAnkle, L.leftHeel, L.leftFootIndex],
  right: [L.rightHip, L.rightKnee, L.rightAnkle, L.rightHeel, L.rightFootIndex],
};

/** 單一影格的「右側比較靠近鏡頭」分數：正值＝右側較近、負值＝左側較近；偵測不到人時為 null。 */
export function nearSideScore(landmarks: Landmark[] | null): number | null {
  if (!landmarks || landmarks.length < 33) return null;
  const mean = (indices: number[], pick: (p: Landmark) => number) =>
    indices.reduce((sum, index) => sum + pick(landmarks[index]), 0) / indices.length;
  const visibilityDiff = mean(LEG_POINTS.right, (p) => p.visibility) - mean(LEG_POINTS.left, (p) => p.visibility);
  // z 越小越近：左側 z − 右側 z 為正 → 右側較近。z 的尺度約與髖寬相當，權重放小，只在 visibility 接近時起作用
  const depthDiff = mean(LEG_POINTS.left, (p) => p.z) - mean(LEG_POINTS.right, (p) => p.z);
  return visibilityDiff + 0.1 * Math.tanh(depthDiff * 5);
}

/** 每一格的近側（前後各 windowFrames 格平滑）。偵測不到人的格子沿用最近的判斷。 */
export function nearSides(frames: PoseFrame[], windowFrames = 8): (Side | null)[] {
  const scores = frames.map((frame) => nearSideScore(frame.landmarks));
  return scores.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, index - windowFrames); j <= Math.min(scores.length - 1, index + windowFrames); j += 1) {
      const score = scores[j];
      if (score !== null) {
        sum += score;
        count += 1;
      }
    }
    if (count === 0) return null;
    return sum >= 0 ? "right" : "left";
  });
}

/** 找出最接近某個時間的影格編號（frames 依時間排序）；超出範圍太多時回傳 -1。 */
export function frameIndexAt(frames: PoseFrame[], timeSec: number, toleranceSec: number): number {
  if (frames.length === 0) return -1;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].timeSec < timeSec) lo = mid + 1;
    else hi = mid;
  }
  let best = lo;
  if (lo > 0 && Math.abs(frames[lo - 1].timeSec - timeSec) <= Math.abs(frames[lo].timeSec - timeSec)) best = lo - 1;
  return Math.abs(frames[best].timeSec - timeSec) <= toleranceSec ? best : -1;
}

/** 影片在畫布中的實際顯示範圍（object-fit: contain 時的上下或左右留黑邊）。 */
export interface ContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function containRect(boxWidth: number, boxHeight: number, videoWidth: number, videoHeight: number): ContentRect {
  if (!videoWidth || !videoHeight) return { x: 0, y: 0, width: boxWidth, height: boxHeight };
  const scale = Math.min(boxWidth / videoWidth, boxHeight / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}

export interface DrawOptions {
  rect: ContentRect;
  nearSide: Side | null;
  /** 線條粗細的基準（依畫布大小調整）。 */
  scale?: number;
  /** 要特別標示（脈動圓圈）的關節編號。 */
  highlight?: { joints: number[]; pulse: number } | null;
}

const COLOR_NEAR = "#ffffff";
const COLOR_FAR = "rgba(255,255,255,0.55)";
const COLOR_CENTER = "rgba(255,255,255,0.85)";
const OUTLINE = "rgba(13,74,66,0.9)";
const HIGHLIGHT = "#f6ad55";
const MIN_VISIBILITY = 0.5;

/** 在畫布上畫一格的骨架。 */
export function drawSkeleton(ctx: CanvasRenderingContext2D, landmarks: Landmark[], options: DrawOptions): void {
  const { rect, nearSide } = options;
  const s = options.scale ?? 1;
  const px = (p: Landmark) => rect.x + p.x * rect.width;
  const py = (p: Landmark) => rect.y + p.y * rect.height;
  const isFar = (side: Side | "center") => side !== "center" && nearSide !== null && side !== nearSide;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 先畫遠側，再畫近側，近側才會蓋在上面
  const ordered = [...BONES].sort((a, b) => Number(isFar(b.side)) - Number(isFar(a.side)));
  for (const bone of ordered) {
    const a = landmarks[bone.from];
    const b = landmarks[bone.to];
    if (!a || !b) continue;
    const far = isFar(bone.side);
    const lowConfidence = a.visibility < MIN_VISIBILITY || b.visibility < MIN_VISIBILITY;
    ctx.globalAlpha = lowConfidence ? 0.35 : 1;
    ctx.setLineDash(far ? [6 * s, 5 * s] : []);
    // 深色外框讓線條在亮背景上也看得清楚
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = (far ? 4 : 6.5) * s;
    ctx.beginPath();
    ctx.moveTo(px(a), py(a));
    ctx.lineTo(px(b), py(b));
    ctx.stroke();
    ctx.strokeStyle = bone.side === "center" ? COLOR_CENTER : far ? COLOR_FAR : COLOR_NEAR;
    ctx.lineWidth = (far ? 2 : 3.5) * s;
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const joint of JOINTS) {
    const p = landmarks[joint.index];
    if (!p) continue;
    const far = isFar(joint.side);
    ctx.globalAlpha = p.visibility < MIN_VISIBILITY ? 0.35 : far ? 0.7 : 1;
    ctx.beginPath();
    ctx.arc(px(p), py(p), (far ? 3 : 4.5) * s, 0, Math.PI * 2);
    ctx.fillStyle = far ? COLOR_FAR : COLOR_NEAR;
    ctx.fill();
    ctx.lineWidth = 1.5 * s;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }

  if (options.highlight) {
    const { joints, pulse } = options.highlight;
    ctx.globalAlpha = 1;
    for (const index of joints) {
      const p = landmarks[index];
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(px(p), py(p), (10 + 8 * pulse) * s, 0, Math.PI * 2);
      ctx.strokeStyle = HIGHLIGHT;
      ctx.lineWidth = 3 * s;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 問題對應要標示的關節（近側）：髖伸展 → 髖、膝屈曲 → 膝、軀幹 → 肩與髖。 */
export function highlightJoints(problem: string, nearSide: Side | null): number[] {
  const side = nearSide ?? "left";
  const pick = (left: number, right: number) => (side === "left" ? left : right);
  if (problem === "hip_extension_deficit") return [pick(L.leftHip, L.rightHip)];
  if (problem === "knee_flexion_abnormal") return [pick(L.leftKnee, L.rightKnee)];
  if (problem === "trunk_head_forward_lean") return [pick(L.leftShoulder, L.rightShoulder), pick(L.leftHip, L.rightHip)];
  return [];
}
