/**
 * Context window resolution for AI models.
 *
 * The opencode server is the authoritative source — each model's
 * `limit.context` comes from `/config/providers` (or v2 `/api/model`).
 * This resolver does NOT carry a hardcoded table of context-window sizes;
 * a curated table inevitably drifts as new models ship and providers
 * silently bump limits, and any stale entry would mislead the UI just as
 * surely as the missing-value bug it tried to paper over.
 *
 * Behaviour:
 *   - If the server reports a positive `limit.context`, that value wins.
 *   - Otherwise the resolver returns `undefined`, and downstream
 *     consumers (ContextMonitor, the webview context bar) hide the
 *     usage indicator rather than display a fabricated denominator.
 *
 * A diagnostic log is emitted when the server provides nothing, so the
 * gap is visible to operators (and a future telemetry sink can surface
 * it as "model X is missing limit.context").
 */

/**
 * @deprecated Kept as an empty frozen object so any older import sites
 * that referenced it continue to compile. New code must rely solely on
 * the server-reported limit.context.
 */
export const KNOWN_CONTEXT_WINDOWS: Readonly<Record<string, number>> = Object.freeze({})

/**
 * Always returns undefined — there is no hardcoded fallback table. This
 * function is kept for backward source-compat with callers/tests; new
 * callers should consult the SDK directly.
 */
export function findKnownContextWindow(_modelKey: string): number | undefined {
  return undefined
}

export interface ResolveOptions {
  /** Optional logger for diagnostic info when the server didn't supply a value. */
  log?: (message: string) => void
}

/**
 * Resolve the effective context window for a model.
 *
 * Server-trust only. When the server doesn't supply a usable value the
 * function returns undefined and emits a log line so the missing data is
 * visible (rather than papered over with a hardcoded guess).
 */
export function resolveContextWindow(
  modelKey: string,
  serverValue?: number,
  options?: ResolveOptions,
): number | undefined {
  if (typeof serverValue === "number" && serverValue > 0) return serverValue
  if (modelKey) {
    options?.log?.(
      `Context window for ${modelKey}: server did not report limit.context — UI will hide the context bar until the server provides one`,
    )
  }
  return undefined
}
