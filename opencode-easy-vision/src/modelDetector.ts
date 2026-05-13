import type { PluginConfig } from "./types"

const DEFAULT_VISION_MODEL_PATTERNS = [
  "anthropic/*-vision-*",
  "anthropic/*sonnet*",
  "anthropic/*opus*",
  "openai/gpt-4o*",
  "openai/gpt-4-vision*",
  "google/gemini-*",
  "*/*-vl-*",
  "*/*vision*",
]

function patternsToRegex(patterns: string[] | undefined): RegExp | null {
  if (!patterns || patterns.length === 0) return null

  const escapeRegex = (s: string): string =>
    s
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\*/g, ".*")
      .replace(/\\\?/g, ".")

  const joined = patterns.map(escapeRegex).join("|")
  return new RegExp(`^(?:${joined})$`, "i")
}

function matchesAnyPattern(modelId: string, patterns: RegExp[]): boolean {
  return patterns.some((regex) => regex.test(modelId))
}

export function hasNativeVision(
  modelId: string,
  config?: PluginConfig,
): boolean {
  const excludePatterns = config?.excludeModels ?? DEFAULT_VISION_MODEL_PATTERNS
  const allExcludePatterns = [
    ...excludePatterns,
    ...(config?.excludeModels ? [] : DEFAULT_VISION_MODEL_PATTERNS),
  ]

  const regex = patternsToRegex(allExcludePatterns)
  if (!regex) return false
  return regex.test(modelId)
}

export function shouldActivate(
  providerId: string,
  modelId: string,
  config?: PluginConfig,
): boolean {
  const fullModelId = `${providerId}/${modelId}`

  if (hasNativeVision(fullModelId, config)) {
    return false
  }

  if (!config?.models || config.models.length === 0) {
    return true
  }

  const regex = patternsToRegex(config.models)
  if (!regex) return true
  return regex.test(fullModelId)
}

export { patternsToRegex, matchesAnyPattern }
