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
  /**
   * Optional OpenRouter-backed metadata cache. When the opencode server
   * returns no `limit.context` for a model, we consult this map as a
   * cross-provider fallback. The cache is built by `openRouterMetadata.ts`
   * from the public OpenRouter `/api/v1/models` catalogue — same model
   * weights typically have the same context window regardless of host.
   * See ADR/CHANGELOG for 0.2.15 for the rationale.
   */
  openRouterCache?: Map<string, number>
}

/**
 * Resolve the effective context window for a model.
 *
 * Resolution order:
 *   1. The opencode server's reported `limit.context` (authoritative when present).
 *   2. The OpenRouter metadata cache, looked up by full id then short id
 *      (handles providers that don't expose context in their config).
 *   3. `undefined` — UI hides the bar / offers a "set context window" affordance.
 *
 * Hardcoded fallback tables are intentionally avoided: a curated list
 * drifts as new models ship. OpenRouter's catalogue is auto-updated and
 * covers the cross-provider case (same weights, different host).
 *
 * NOTE: When called in a hot loop (e.g., model refresh), `options.log` should
 * be set to `debug`-level to avoid flooding the output channel with per-model
 * miss lines. The caller is responsible for aggregating misses into a single
 * summary.
 */
export function resolveContextWindow(
  modelKey: string,
  serverValue?: number,
  options?: ResolveOptions,
): number | undefined {
  if (typeof serverValue === "number" && serverValue > 0) return serverValue

  // Try the OpenRouter cache before logging a miss — same model weights
  // typically have the same window regardless of which provider hosts
  // them, so a lookup by short id usually succeeds.
  if (options?.openRouterCache && modelKey) {
    const exact = options.openRouterCache.get(modelKey)
    if (typeof exact === "number" && exact > 0) return exact
    const slash = modelKey.indexOf("/")
    const shortId = slash >= 0 ? modelKey.slice(slash + 1) : modelKey
    const short = options.openRouterCache.get(shortId)
    if (typeof short === "number" && short > 0) return short
  }

  if (modelKey) {
    options?.log?.(
      `Context window for ${modelKey}: server did not report limit.context and no OpenRouter fallback hit — UI will hide the context bar until a manual override is set`,
    )
  }
  return undefined
}
