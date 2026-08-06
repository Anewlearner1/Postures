/**
 * Chart tokens.
 *
 * The two series colors are categorical slots 1 and 2 of the reference data-viz
 * palette. Left/right is an identity encoding, not a magnitude one, so the pair
 * never varies with the values. Validated against the white card surface:
 * adjacent CVD ΔE 24.7 (protan), normal-vision ΔE 33.6, both above the floors.
 *
 * Status colors mean good/bad and are never reused as a series.
 */

export const SERIES = {
  left: '#2a78d6',
  right: '#eb6834',
} as const;

export const SERIES_LABEL = {
  left: '左側',
  right: '右側',
} as const;

export const CHROME = {
  surface: '#ffffff',
  gridline: '#e4e4e7',
  baseline: '#d4d4d8',
  muted: '#71717a',
  textPrimary: '#18181b',
  textSecondary: '#52525b',
} as const;

export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

export type StatusKey = keyof typeof STATUS;

/** Maps a 0-100 score onto the status scale. Higher is better. */
export function statusForScore(score: number): StatusKey {
  if (score >= 80) return 'good';
  if (score >= 60) return 'warning';
  if (score >= 40) return 'serious';
  return 'critical';
}

/**
 * Maps a symmetry index onto the status scale. Lower is better; below 10% is
 * generally taken as within normal variation for overground walking.
 */
export function statusForSymmetry(index: number): StatusKey {
  if (index < 10) return 'good';
  if (index < 20) return 'warning';
  if (index < 35) return 'serious';
  return 'critical';
}

export const STATUS_LABEL: Record<StatusKey, string> = {
  good: '良好',
  warning: '需留意',
  serious: '偏離',
  critical: '明顯異常',
};
