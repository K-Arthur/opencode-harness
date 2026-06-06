export const CONTEXT_THRESHOLDS = Object.freeze({
  CAUTION: 70,
  WARNING: 85,
  CRITICAL: 95,
} as const)

export type ContextState = "good" | "caution" | "warning" | "critical" | "over" | "unknown"

export function deriveState(pct: number, tokens: number, maxTokens: number): ContextState {
  if (!Number.isFinite(pct)) return "unknown"
  if (maxTokens > 0 && tokens > maxTokens) return "over"
  if (pct >= CONTEXT_THRESHOLDS.CRITICAL) return "critical"
  if (pct >= CONTEXT_THRESHOLDS.WARNING) return "warning"
  if (pct >= CONTEXT_THRESHOLDS.CAUTION) return "caution"
  return "good"
}
