/**
 * OpenRouter-backed context-window metadata fallback.
 *
 * When opencode's `/config/providers` doesn't report `limit.context` for
 * a model (common for OSS / free-tier hosts), we ask OpenRouter for the
 * spec. OpenRouter aggregates ~hundreds of models across providers and
 * exposes `/api/v1/models` with no auth required. Since the context
 * window is a property of the model weights — not the host — we can
 * key by short model id (e.g. `kimi-k2.5`) and serve a sensible
 * fallback regardless of which provider is currently routing the call.
 *
 * Cache strategy: fetch on first need, persist to globalState (or disk
 * via a thin wrapper), refresh after 24h. We never block UI on the
 * network; a missing fallback just leaves the UI as-is.
 */
// No vscode-coupled imports here — keeps the module unit-testable
// without the vscode module being present. Callers inject a logger.

export interface OpenRouterFetchOptions {
  /** Allows tests to substitute their own fetch implementation. */
  fetch?: typeof fetch
  /** Bypass the 15s timeout for tests. */
  timeoutMs?: number
  /** Injectable logger so this module doesn't pull in vscode. */
  log?: (message: string) => void
}

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Parse the OpenRouter /v1/models response into a `model-id → context_length`
 * map. The map is double-indexed: each model is stored under both its
 * full `provider/model` id AND its short `model` id. The short id makes
 * cross-provider lookups work — opencode and OpenRouter often disagree
 * on the provider prefix even when referring to the same weights.
 *
 * Pure / synchronous so it's trivially testable.
 */
export function parseOpenRouterModels(payload: unknown): Map<string, number> {
  const map = new Map<string, number>()
  if (!payload || typeof payload !== "object") return map
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return map

  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue
    const id = (entry as { id?: unknown }).id
    const ctx = (entry as { context_length?: unknown }).context_length
    if (typeof id !== "string" || id.length === 0) continue
    if (typeof ctx !== "number" || !Number.isFinite(ctx) || ctx <= 0) continue

    map.set(id, ctx)
    // Also index by short id (post-slash) so a different provider prefix
    // still resolves. Multiple OpenRouter entries can collide on the
    // short id; first writer wins (data is typically sorted with the
    // canonical entry first).
    const slash = id.indexOf("/")
    if (slash >= 0 && slash < id.length - 1) {
      const shortId = id.slice(slash + 1)
      if (!map.has(shortId)) map.set(shortId, ctx)
    }
  }
  return map
}

/**
 * Look up a model's context window in a parsed OpenRouter map.
 *
 * Tries:
 *   1. Exact `provider/model` match (the happy path).
 *   2. Short id match (`model`) — same model behind a different provider.
 *   3. Case-insensitive short id match — OpenRouter and opencode
 *      sometimes disagree on casing (e.g. `Kimi-K2.5` vs `kimi-k2.5`).
 * Returns undefined when no entry matches; callers must handle that
 * gracefully (hide the UI / show a "set context window" affordance).
 */
export function lookupContextWindow(map: Map<string, number>, modelId: string): number | undefined {
  if (!modelId) return undefined
  const exact = map.get(modelId)
  if (typeof exact === "number") return exact

  const slash = modelId.indexOf("/")
  const shortId = slash >= 0 ? modelId.slice(slash + 1) : modelId
  const short = map.get(shortId)
  if (typeof short === "number") return short

  // Case-insensitive last-resort scan. We don't pre-build a lowercased
  // map because the cache is consulted infrequently and the map is
  // small (~500 entries).
  const targetLower = shortId.toLowerCase()
  for (const [key, value] of map.entries()) {
    if (key.toLowerCase() === targetLower) return value
    // Also try the short id of map entries that have a provider prefix.
    const keySlash = key.indexOf("/")
    if (keySlash >= 0 && key.slice(keySlash + 1).toLowerCase() === targetLower) return value
  }
  return undefined
}

/**
 * True when a stored cache timestamp is still within the 24h refresh
 * window. Rejects NaN / null / undefined so a corrupted globalState
 * entry forces a clean refetch.
 */
export function isCacheFresh(timestamp: number | null | undefined): boolean {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return false
  return Date.now() - timestamp < CACHE_TTL_MS
}

/**
 * Fetch the OpenRouter model catalogue and return the parsed map.
 * Returns an empty map on any network / parse failure — callers must
 * not assume freshness. Logs but does not throw, so a flaky network
 * never blocks model-list refreshes.
 */
export async function fetchOpenRouterModels(
  options?: OpenRouterFetchOptions,
): Promise<Map<string, number>> {
  const fetchImpl = options?.fetch || fetch
  const logFn = options?.log ?? (() => {})
  const controller = new AbortController()
  const timeoutMs = options?.timeoutMs ?? 15_000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetchImpl(OPENROUTER_MODELS_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
    if (!resp.ok) {
      logFn(`OpenRouter /v1/models returned HTTP ${resp.status} — context-window fallback unavailable for this session`)
      return new Map()
    }
    const json = await resp.json()
    const map = parseOpenRouterModels(json)
    logFn(`OpenRouter context-window cache: loaded ${map.size} entries`)
    return map
  } catch (err) {
    logFn(`OpenRouter /v1/models fetch failed (${(err as Error).message ?? "unknown"}) — context-window fallback unavailable for this session`)
    return new Map()
  } finally {
    clearTimeout(timeout)
  }
}

export const CACHE_TTL = CACHE_TTL_MS
