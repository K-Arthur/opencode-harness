import type { ModelInfo } from "./types"

/**
 * Parse a model ID of the form "provider/modelId" into its parts.
 * Returns null when the separator is missing.
 */
export function parseModelId(modelId: string): { provider: string; id: string } | null {
  const slash = modelId.indexOf("/")
  if (slash === -1) return null
  return {
    provider: modelId.slice(0, slash),
    id: modelId.slice(slash + 1),
  }
}

/**
 * Extract the exhausted provider name from the active session's current model.
 * Returns null when no session or model is available.
 */
export function getExhaustedProvider(
  activeSession: { model?: string } | undefined,
): string | null {
  if (!activeSession?.model) return null
  const parsed = parseModelId(activeSession.model)
  return parsed?.provider ?? null
}

/**
 * Find a fallback model from a different provider.
 *
 * Selection priority:
 *  1. Models from providers other than the exhausted one
 *  2. Enabled models only (m.enabled !== false)
 *  3. Favorites first
 *  4. Alphabetical by provider, then by model id (stable)
 *
 * Returns the full model id ("provider/modelId") or null when no suitable
 * fallback exists.
 */
export function findFallbackModel(
  exhaustedProvider: string,
  currentModelId: string,
  availableModels: ModelInfo[],
): string | null {
  const candidates = availableModels.filter((m) => {
    const fullId = `${m.provider}/${m.id}`
    return (
      m.provider !== exhaustedProvider &&
      fullId !== currentModelId &&
      m.enabled !== false
    )
  })

  if (candidates.length === 0) return null

  candidates.sort((a, b) => {
    const fav = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite))
    if (fav !== 0) return fav
    const pc = a.provider.localeCompare(b.provider)
    if (pc !== 0) return pc
    return a.id.localeCompare(b.id)
  })

  const first = candidates[0]
  if (!first) return null
  return `${first.provider}/${first.id}`
}
