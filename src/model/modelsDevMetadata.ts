/**
 * models.dev-backed context-window + output-limit metadata cache.
 *
 * When opencode's `/config/providers` doesn't report `limit.context` for
 * a model (common for opencode-hosted free models like deepseek-v4-flash-free),
 * we ask models.dev directly. models.dev is the authoritative catalogue
 * that opencode itself queries to build its provider list; the free-tier
 * SKUs (e.g. deepseek-v4-flash-free, kimi-k2.5-free) live only under the
 * `opencode` provider block on models.dev and do NOT appear on OpenRouter.
 * Since the context window is a published property of each model listing,
 * we key by short model id (dropping the provider prefix) and serve a
 * sensible fallback that agrees with the opencode CLI.
 *
 * Resolution order in contextWindowResolver.ts:
 *   server → models.dev → OpenRouter → user override
 *
 * Cache strategy: fetch on first need, persist to globalState (or disk
 * via a thin wrapper), refresh after 24h. We never block UI on the
 * network; a missing fallback just leaves the UI as-is.
 */
// No vscode-coupled imports here — keeps the module unit-testable
// without the vscode module being present. Callers inject a logger.

export interface ModelsDevEntry {
  contextWindow: number
  outputLimit?: number
}

export interface ModelsDevFetchOptions {
  /** Allows tests to substitute their own fetch implementation. */
  fetch?: typeof fetch
  /** Bypass the 15s timeout for tests. */
  timeoutMs?: number
  /** Injectable logger so this module doesn't pull in vscode. */
  log?: (message: string) => void
}

const MODELS_DEV_URL = "https://models.dev/api.json"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Parse the models.dev /api.json response into a `model-id → { contextWindow, outputLimit }`
 * map. The map is double-indexed: each model is stored under both its
 * full `providerId/modelId` id AND its short `modelId`. The short id makes
 * lookups work even when the provider prefix disagrees (e.g. a free model
 * keyed as `opencode/glm-5-free` can resolve to the same data as `z-ai/glm-5`).
 *
 * Pure / synchronous so it's trivially testable.
 */
export function parseModelsDevModels(payload: unknown): Map<string, ModelsDevEntry> {
  const map = new Map<string, ModelsDevEntry>()
  if (!payload || typeof payload !== "object") return map

  for (const [providerId, provider] of Object.entries(payload as Record<string, unknown>)) {
    if (!provider || typeof provider !== "object") continue
    const models = (provider as Record<string, unknown>).models
    if (!models || typeof models !== "object") continue

    for (const [modelId, model] of Object.entries(models as Record<string, unknown>)) {
      if (!model || typeof model !== "object") continue
      const m = model as Record<string, unknown>
      const entryId = (typeof m.id === "string" && m.id.length > 0) ? m.id : modelId
      if (!entryId) continue

      const limit = m.limit
      if (!limit || typeof limit !== "object") continue
      const l = limit as Record<string, unknown>
      const ctx = l.context
      if (typeof ctx !== "number" || !Number.isFinite(ctx) || ctx <= 0) continue

      const entry: ModelsDevEntry = { contextWindow: ctx }
      const out = l.output
      if (typeof out === "number" && Number.isFinite(out) && out > 0) {
        entry.outputLimit = out
      }

      // Index by full provider/model id
      const fullId = `${providerId}/${entryId}`
      if (!map.has(fullId)) map.set(fullId, entry)

      // Also index by short model id (provider-less) so a different
      // provider prefix still resolves. First writer wins.
      if (!map.has(entryId)) map.set(entryId, entry)
    }
  }
  return map
}

/**
 * Look up a model's context-window + output-limit in a parsed models.dev map.
 *
 * Tries:
 *   1. Exact `provider/model` match (the happy path).
 *   2. Short id match (`model`) — same model regardless of provider.
 *   3. Case-insensitive short id match — models.dev and opencode
 *      sometimes disagree on casing.
 * Returns undefined when no entry matches; callers must handle that
 * gracefully (hide the UI / show a "set context window" affordance).
 */
export function lookupModelsDevEntry(
  map: Map<string, ModelsDevEntry>,
  modelId: string,
): ModelsDevEntry | undefined {
  if (!modelId) return undefined
  const exact = map.get(modelId)
  if (exact) return exact

  const slash = modelId.indexOf("/")
  const shortId = slash >= 0 ? modelId.slice(slash + 1) : modelId
  const short = map.get(shortId)
  if (short) return short

  // Case-insensitive last-resort scan.
  const targetLower = shortId.toLowerCase()
  for (const [key, value] of map.entries()) {
    if (key.toLowerCase() === targetLower) return value
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
 * Fetch the models.dev catalogue and return the parsed map.
 * Returns an empty map on any network / parse failure — callers must
 * not assume freshness. Logs but does not throw, so a flaky network
 * never blocks model-list refreshes.
 */
export async function fetchModelsDevModels(
  options?: ModelsDevFetchOptions,
): Promise<Map<string, ModelsDevEntry>> {
  const fetchImpl = options?.fetch || fetch
  const logFn = options?.log ?? (() => {})
  const controller = new AbortController()
  const timeoutMs = options?.timeoutMs ?? 15_000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetchImpl(MODELS_DEV_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
    if (!resp.ok) {
      logFn(`models.dev /api.json returned HTTP ${resp.status} — context-window fallback unavailable for this session`)
      return new Map()
    }
    const json = await resp.json()
    const map = parseModelsDevModels(json)
    logFn(`models.dev context-window cache: loaded ${map.size} entries`)
    return map
  } catch (err) {
    logFn(`models.dev /api.json fetch failed (${(err as Error).message ?? "unknown"}) — context-window fallback unavailable for this session`)
    return new Map()
  } finally {
    clearTimeout(timeout)
  }
}

export const CACHE_TTL = CACHE_TTL_MS
