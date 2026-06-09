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
import { lookupContextWindow } from "./openRouterMetadata"
import { lookupModelsDevEntry, type ModelsDevEntry } from "./modelsDevMetadata"

/**
 * @deprecated Kept as an empty frozen object so any older import sites
 * that referenced it continue to compile. New code must rely solely on
 * the server-reported limit.context.
 */
export const KNOWN_CONTEXT_WINDOWS: Readonly<Record<string, number>> = Object.freeze({})

const UNBOUNDED_CONTEXT_WINDOW_SENTINEL = 1_000_000_000

function isUsableServerContextWindow(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value > 0
    && value < UNBOUNDED_CONTEXT_WINDOW_SENTINEL
}

function isPlaceholderContextWindow(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= UNBOUNDED_CONTEXT_WINDOW_SENTINEL
}

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
   * Optional models.dev-backed metadata cache. models.dev is the
   * authoritative catalogue that opencode itself queries. It carries
   * opencode-only free SKUs (e.g. deepseek-v4-flash-free) that are
   * not listed on OpenRouter. Consulted before the OpenRouter cache
   * because it is the data source opencode's own CLI uses.
   */
  modelsDevCache?: Map<string, ModelsDevEntry>
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
 *   2. The models.dev metadata cache, looked up by full id then short id
 *      (covers opencode-hosted free SKUs that OpenRouter never carries).
 *   3. The OpenRouter metadata cache, looked up by full id then short id
 *      (net for models not in opencode's own catalogue).
 *   4. `undefined` — UI hides the bar / offers a "set context window" affordance.
 *
 * Hardcoded fallback tables are intentionally avoided: a curated list
 * drifts as new models ship. Both models.dev and OpenRouter are
 * auto-updated external catalogues.
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
  if (isUsableServerContextWindow(serverValue)) return serverValue

  // Tier 2: models.dev — authoritative for opencode-hosted free models.
  if (options?.modelsDevCache && modelKey) {
    const hit = lookupModelsDevEntry(options.modelsDevCache, modelKey)
    if (hit && hit.contextWindow > 0) return hit.contextWindow
  }

  // Tier 3: OpenRouter — cross-provider net for models not yet in models.dev.
  if (options?.openRouterCache && modelKey) {
    const fallback = lookupContextWindow(options.openRouterCache, modelKey)
    if (typeof fallback === "number" && fallback > 0) return fallback
  }

  if (modelKey) {
    const reason = isPlaceholderContextWindow(serverValue)
      ? `server reported placeholder limit.context=${serverValue}`
      : "server did not report limit.context"
    options?.log?.(
      `Context window for ${modelKey}: ${reason} and no models.dev / OpenRouter fallback hit — UI will hide the context bar until a manual override is set`,
    )
  }
  return undefined
}

/**
 * Resolve the output limit for a model. Follows the same resolution
 * chain as resolveContextWindow — server → models.dev → OpenRouter —
 * but returns the output limit instead of the context window.
 */
export function resolveModelOutputLimit(
  modelKey: string,
  serverOutputLimit?: number,
  options?: ResolveOptions,
): number | undefined {
  if (typeof serverOutputLimit === "number" && Number.isFinite(serverOutputLimit) && serverOutputLimit > 0) {
    return serverOutputLimit
  }

  // Tier 2: models.dev — carries output limit alongside context window.
  if (options?.modelsDevCache && modelKey) {
    const hit = lookupModelsDevEntry(options.modelsDevCache, modelKey)
    if (hit && typeof hit.outputLimit === "number" && hit.outputLimit > 0) return hit.outputLimit
  }

  return undefined
}
