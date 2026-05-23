/**
 * context-usage-service.ts
 * Pure helper functions shared by all three context UI implementations:
 *   1. Status strip bar (tokenCostDisplay.ts)
 *   2. Per-tab bottom monitor (tabs.ts)
 *   3. Breakdown panel + history modal (context-usage-panel.ts, context-monitor.ts)
 *
 * All functions are pure (no DOM, no side-effects) — fully unit-testable.
 */

export interface ContextBreakdown {
  system: number
  history: number
  workspace: number
  queued: number
  steer: number
}

export type UsageColor = "good" | "warning" | "critical"

/**
 * Derive a colour tier from a usage percentage.
 *   < 70%  → good    (green)
 *   70–89% → warning (amber)
 *   ≥ 90%  → critical (red + pulse)
 */
export function deriveUsageColor(pct: number): UsageColor {
  const p = typeof pct === "number" && Number.isFinite(pct) ? pct : 0
  if (p >= 90) return "critical"
  if (p >= 70) return "warning"
  return "good"
}

/**
 * Format a token count as a locale-aware string with thousand separators.
 * Non-finite or non-number inputs coerce to "0".
 */
export function formatTokenCount(n: unknown): string {
  const num = typeof n === "number" ? n : Number(n)
  if (!Number.isFinite(num)) return "0"
  return Math.round(num).toLocaleString()
}

/**
 * Compute proportional widths (%) for each breakdown segment.
 * Safe against all-zero inputs (returns all zeros instead of NaN).
 * Clamps negative values to 0 before computing.
 */
export function computeBreakdownWidths(bd: ContextBreakdown): Record<keyof ContextBreakdown, number> {
  const keys = ["system", "history", "workspace", "queued", "steer"] as const
  const clamped = keys.reduce(
    (acc, k) => {
      const v = typeof bd[k] === "number" && Number.isFinite(bd[k]) ? bd[k] : 0
      acc[k] = Math.max(0, v)
      return acc
    },
    {} as Record<keyof ContextBreakdown, number>
  )
  const total = keys.reduce((sum, k) => sum + clamped[k], 0)
  if (total === 0) return { system: 0, history: 0, workspace: 0, queued: 0, steer: 0 }
  return keys.reduce(
    (acc, k) => {
      acc[k] = (clamped[k] / total) * 100
      return acc
    },
    {} as Record<keyof ContextBreakdown, number>
  )
}

/**
 * Build the summary text shown in the status strip label and per-tab monitor.
 * When maxTokens is 0 (unknown context window), renders a "set limit" hint.
 * Never clamps the displayed percentage — overflow is intentional signal.
 */
export function buildSummaryText(tokens: number, maxTokens: number, pct: number): string {
  const tokStr = formatTokenCount(tokens)
  if (!maxTokens || maxTokens <= 0) {
    return `${tokStr} tok · set limit`
  }
  const maxStr = formatTokenCount(maxTokens)
  return `${pct}% used · ${tokStr} / ${maxStr}`
}

/**
 * Clamp a percentage value to [0, 100].
 * Used when driving CSS widths and SVG arcs (overflow would break layout).
 */
export function clampPercent(pct: number): number {
  return Math.max(0, Math.min(100, pct))
}

/**
 * Format a cost value as a 4-decimal-place string prefixed with $.
 * Returns "" for invalid/zero inputs.
 */
export function formatCost(cost: unknown): string {
  const n = typeof cost === "number" ? cost : Number(cost)
  if (!Number.isFinite(n) || n <= 0) return ""
  return `$${n.toFixed(4)}`
}
