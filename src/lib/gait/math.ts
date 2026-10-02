/**
 * 這個檔案做什麼：
 *   步態分析共用的小型數學工具：統計量（中位數、百分位數、標準差）、角度換算、
 *   線性迴歸、線性內插、移動平均、零相位 Butterworth 低通濾波（§1.2）、
 *   峰值搜尋（類似 scipy.signal.find_peaks，§2.3）與拋物線次幀內插。
 *   全部是純函式，不依賴瀏覽器。缺值一律以 NaN 表示。
 */

export const RAD2DEG = 180 / Math.PI;
export const DEG2RAD = Math.PI / 180;

export function isFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

/** 只保留有限值。 */
export function finite(values: Iterable<number | undefined>): number[] {
  const out: number[] = [];
  for (const value of values) if (isFiniteNumber(value)) out.push(value);
  return out;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** 百分位數（線性內插，p 為 0–100）。空陣列回傳 NaN。 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

export function median(values: readonly number[]): number {
  return percentile(values, 50);
}

/** 樣本標準差（n − 1）。少於 2 個值回傳 NaN。 */
export function sampleStd(values: readonly number[]): number {
  if (values.length < 2) return NaN;
  const m = mean(values);
  let sum = 0;
  for (const value of values) sum += (value - m) ** 2;
  return Math.sqrt(sum / (values.length - 1));
}

/** 簡單線性迴歸 y = a + b·x，回傳斜率 b；點數不足或 x 沒有變化時回傳 NaN。 */
export function linearSlope(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  return sxx > 0 ? sxy / sxx : NaN;
}

/**
 * 線性內插補缺口：只補「兩端都有值、且缺口長度 ≤ maxGap 個樣本」的 NaN（§1.2）。
 * 回傳被補值的索引旗標（1 = 這一格是內插出來的）。會直接修改傳入的陣列。
 */
export function fillShortGaps(values: Float64Array, maxGap: number): Uint8Array {
  const filled = new Uint8Array(values.length);
  let i = 0;
  while (i < values.length) {
    if (!Number.isNaN(values[i])) {
      i++;
      continue;
    }
    const start = i;
    while (i < values.length && Number.isNaN(values[i])) i++;
    const end = i; // 第一個非 NaN（或陣列尾）
    const gap = end - start;
    if (start > 0 && end < values.length && gap <= maxGap) {
      const a = values[start - 1];
      const b = values[end];
      for (let k = start; k < end; k++) {
        const t = (k - start + 1) / (gap + 1);
        values[k] = a + (b - a) * t;
        filled[k] = 1;
      }
    }
  }
  return filled;
}

/** 以 NaN 分隔的連續有效區間 [start, end)。 */
export function validRuns(values: ArrayLike<number>): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let i = 0;
  while (i < values.length) {
    if (Number.isNaN(values[i])) {
      i++;
      continue;
    }
    const start = i;
    while (i < values.length && !Number.isNaN(values[i])) i++;
    runs.push([start, i]);
  }
  return runs;
}

/** 置中移動平均（忽略 NaN；視窗內沒有值時為 NaN）。 */
export function movingAverage(values: ArrayLike<number>, window: number): Float64Array {
  const half = Math.max(0, Math.floor(window / 2));
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) {
      out[i] = NaN;
      continue;
    }
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(values.length - 1, i + half); k++) {
      if (!Number.isNaN(values[k])) {
        sum += values[k];
        count++;
      }
    }
    out[i] = count > 0 ? sum / count : NaN;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 零相位 Butterworth 低通濾波（§1.2）
// ---------------------------------------------------------------------------

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** 2 階 Butterworth 低通（雙線性轉換、頻率預扭曲）。 */
function butterworth2(cutoffHz: number, sampleHz: number): Biquad {
  const k = Math.tan((Math.PI * cutoffHz) / sampleHz);
  const norm = 1 / (1 + Math.SQRT2 * k + k * k);
  const b0 = k * k * norm;
  return {
    b0,
    b1: 2 * b0,
    b2: b0,
    a1: 2 * (k * k - 1) * norm,
    a2: (1 - Math.SQRT2 * k + k * k) * norm,
  };
}

function applyBiquad(f: Biquad, x: number[]): number[] {
  const y = new Array<number>(x.length);
  // 以第一個值當穩態初始條件，減少起點暫態
  let x1 = x[0];
  let x2 = x[0];
  let y1 = x[0];
  let y2 = x[0];
  for (let i = 0; i < x.length; i++) {
    const out = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = out;
    y[i] = out;
  }
  return y;
}

/**
 * 零相位 4 階 Butterworth 低通（2 階濾波器正向＋反向各一次），分段處理 NaN 區間。
 * 太短的區段（< 7 個樣本）保持原值。回傳新陣列。
 */
export function lowpassZeroPhase(values: ArrayLike<number>, cutoffHz: number, sampleHz: number): Float64Array {
  const out = Float64Array.from(values as ArrayLike<number>);
  const nyquist = sampleHz / 2;
  if (!(cutoffHz > 0) || cutoffHz >= nyquist) return out;
  const filter = butterworth2(cutoffHz, sampleHz);
  for (const [start, end] of validRuns(values)) {
    const n = end - start;
    if (n < 7) continue;
    const segment: number[] = [];
    for (let i = start; i < end; i++) segment.push(values[i]);
    // 奇對稱延伸（odd reflection）以降低邊界效應
    const pad = Math.min(n - 1, Math.max(6, Math.round(sampleHz * 0.5)));
    const first = segment[0];
    const last = segment[n - 1];
    const padded: number[] = [];
    for (let i = pad; i >= 1; i--) padded.push(2 * first - segment[i]);
    padded.push(...segment);
    for (let i = n - 2; i >= n - 1 - pad; i--) padded.push(2 * last - segment[i]);
    const forward = applyBiquad(filter, padded);
    const backward = applyBiquad(filter, forward.reverse()).reverse();
    for (let i = 0; i < n; i++) out[start + i] = backward[pad + i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// 峰值搜尋（§2.3）
// ---------------------------------------------------------------------------

export interface PeakOptions {
  /** 兩個峰值的最小間距（樣本數）。 */
  minDistance: number;
  /** 最小突出度（與訊號同單位）。 */
  minProminence: number;
}

/**
 * 找局部最大值（NaN 視為斷點），依 scipy.signal.find_peaks 的邏輯套用突出度與最小間距。
 * 回傳依索引排序的峰值位置。
 */
export function findPeaks(signal: ArrayLike<number>, options: PeakOptions): number[] {
  const n = signal.length;
  const candidates: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = signal[i];
    if (Number.isNaN(v) || Number.isNaN(signal[i - 1]) || !(v > signal[i - 1])) continue;
    // 處理平台：往右找到第一個不相等的值
    let j = i + 1;
    while (j < n && signal[j] === v) j++;
    if (j < n && !Number.isNaN(signal[j]) && signal[j] < v) {
      candidates.push(Math.floor((i + j - 1) / 2));
      i = j - 1;
    }
  }

  // 突出度：往左右找，直到遇到更高的點或 NaN／邊界，取兩側最低點中較高者
  const prominent: Array<{ index: number; height: number }> = [];
  for (const index of candidates) {
    const height = signal[index];
    let leftMin = height;
    for (let k = index - 1; k >= 0; k--) {
      const v = signal[k];
      if (Number.isNaN(v) || v > height) break;
      if (v < leftMin) leftMin = v;
    }
    let rightMin = height;
    for (let k = index + 1; k < n; k++) {
      const v = signal[k];
      if (Number.isNaN(v) || v > height) break;
      if (v < rightMin) rightMin = v;
    }
    const prominence = height - Math.max(leftMin, rightMin);
    if (prominence >= options.minProminence) prominent.push({ index, height });
  }

  // 最小間距：由高到低保留
  const kept: number[] = [];
  for (const peak of [...prominent].sort((a, b) => b.height - a.height)) {
    if (kept.every((other) => Math.abs(other - peak.index) >= options.minDistance)) kept.push(peak.index);
  }
  return kept.sort((a, b) => a - b);
}

/** 拋物線內插的次幀偏移量（−0.5 ～ 0.5），用於事件時間精細化。 */
export function parabolicOffset(signal: ArrayLike<number>, index: number): number {
  if (index <= 0 || index >= signal.length - 1) return 0;
  const a = signal[index - 1];
  const b = signal[index];
  const c = signal[index + 1];
  if (![a, b, c].every(Number.isFinite)) return 0;
  const denominator = a - 2 * b + c;
  if (denominator === 0) return 0;
  return Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator));
}
