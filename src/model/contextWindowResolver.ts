/**
 * Context window resolution for AI models.
 *
 * Server-reported `limit.context` values are frequently stale or wrong for
 * newer models (e.g. Qwen 3.6 Plus is 1M tokens but some providers still
 * advertise 262K). This resolver normalizes model keys and falls back to a
 * curated table when the server value disagrees significantly.
 */

/**
 * Authoritative context window sizes (May 2026). Keys are lowercase
 * `provider/model-id`. Used as fallback when the server returns missing or
 * implausible values.
 */
export const KNOWN_CONTEXT_WINDOWS: Readonly<Record<string, number>> = Object.freeze({
  "qwen/qwen3.6-plus": 1_048_576,
  "qwen/qwen3.6-plus-free": 1_048_576,
  "qwen/qwen3.6-max": 1_048_576,
  "qwen/qwen3-235b": 131_072,
  "qwen/qwen3-30b": 131_072,
  "qwen/qwen3-32b": 131_072,
  "qwen/qwen-plus": 131_072,
  "anthropic/claude-sonnet-4-20250514": 200_000,
  "anthropic/claude-sonnet-4-5-20250514": 200_000,
  "anthropic/claude-sonnet-4-6-20251015": 1_000_000,
  "anthropic/claude-opus-4-5-20251101": 200_000,
  "anthropic/claude-opus-4-6-20260301": 200_000,
  "anthropic/claude-opus-4-7-20260415": 200_000,
  "anthropic/claude-opus-4-20250514": 200_000,
  "anthropic/claude-haiku-4-5-20251001": 200_000,
  "openai/gpt-4.1": 1_048_576,
  "openai/gpt-4.1-mini": 1_048_576,
  "openai/gpt-4.1-nano": 1_048_576,
  "openai/gpt-5": 400_000,
  "openai/o3": 200_000,
  "openai/o3-pro": 200_000,
  "openai/o4-mini": 200_000,
  "google/gemini-2.5-pro": 1_048_576,
  "google/gemini-2.5-flash": 1_048_576,
  "google/gemini-2.5-flash-lite": 1_048_576,
  "google/gemini-3.0-pro": 2_097_152,
  "deepseek/deepseek-chat": 131_072,
  "deepseek/deepseek-reasoner": 65_536,
  "deepseek/deepseek-v3.5": 131_072,
  "deepseek/deepseek-v4-flash": 131_072,
  "grok/grok-4": 131_072,
  "mistral/mistral-large-2411": 131_072,
  "minimax/minimax-m1": 4_096_000,
  // opencode-routed models. The opencode server doesn't always populate
  // limit.context for these so without explicit entries the resolver
  // returned undefined and the ContextMonitor's old 100k default leaked
  // through to the UI as a misleading "1% (X / 100,000)" indicator.
  "opencode/big-pickle": 200_000,
  "opencode/deepseek-v4-flash": 131_072,
  "opencode/deepseek-v4-flash-free": 131_072,
})

/** Collapse separators so "qwen3.6-plus" matches "qwen-3.6-plus" matches "qwen3_6_plus". */
function normalizeId(s: string): string {
  return s.toLowerCase().replace(/[-._]/g, "")
}

function stripProvider(key: string): string {
  const slashIdx = key.indexOf("/")
  return slashIdx >= 0 ? key.substring(slashIdx + 1) : key
}

/**
 * Look up a context window with progressively looser matching:
 *   1. Exact (lowercase) key match
 *   2. Lookup by id, ignoring provider prefix (only if no exact match found)
 *   3. Lookup by separator-collapsed id (treats "3.6" / "3-6" / "36" as equal)
 */
export function findKnownContextWindow(modelKey: string): number | undefined {
  if (!modelKey) return undefined
  const lower = modelKey.toLowerCase()
  if (KNOWN_CONTEXT_WINDOWS[lower] !== undefined) return KNOWN_CONTEXT_WINDOWS[lower]

  const idOnly = stripProvider(lower)
  for (const [key, val] of Object.entries(KNOWN_CONTEXT_WINDOWS)) {
    if (stripProvider(key) === idOnly) return val
  }

  const normIdOnly = normalizeId(idOnly)
  for (const [key, val] of Object.entries(KNOWN_CONTEXT_WINDOWS)) {
    if (normalizeId(stripProvider(key)) === normIdOnly) return val
  }

  return undefined
}

export interface ResolveOptions {
  /** Optional logger for diagnostic info when server/known disagree. */
  log?: (message: string) => void
}

/**
 * Resolve the effective context window for a model.
 *
 * Rules:
 *   - If the server reported nothing usable, return the known value (or undefined).
 *   - If the server value disagrees with the known value by more than 50%,
 *     the server is presumed wrong (stale config) and we use the known value,
 *     UNLESS the modelKey provider is "opencode" (server override is trusted).
 *   - Otherwise we trust the server.
 */
export function resolveContextWindow(
  modelKey: string,
  serverValue?: number,
  options?: ResolveOptions,
): number | undefined {
  const known = findKnownContextWindow(modelKey)
  if (!serverValue || serverValue <= 0) return known ?? undefined
  
  // Special case: if provider is "opencode", trust server value over known
  const modelProvider = modelKey.split("/")[0]?.toLowerCase()
  if (modelProvider === "opencode") {
    return serverValue
  }
  
  if (known && Math.abs(serverValue - known) / known > 0.5) {
    options?.log?.(
      `Context window for ${modelKey}: server reports ${serverValue.toLocaleString()}, known is ${known.toLocaleString()} — using known value`,
    )
    return known
  }
  return serverValue
}
