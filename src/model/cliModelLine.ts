export interface ParsedCliModelLine {
  id: string
  provider: string
  displayName: string
  available: true
}

const PROVIDER_PATTERN = /^[A-Za-z0-9_.-]+$/
const MODEL_ID_PATTERN = /^[A-Za-z0-9_.:/~@+-]+$/
const MAX_MODEL_LINE_LENGTH = 240

export function parseCliModelLine(line: string): ParsedCliModelLine | undefined {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > MAX_MODEL_LINE_LENGTH || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return undefined
  }

  const slashIdx = trimmed.indexOf("/")
  if (slashIdx >= 0) {
    const provider = trimmed.slice(0, slashIdx)
    const id = trimmed.slice(slashIdx + 1)
    if (!provider || !id) return undefined
    if (!PROVIDER_PATTERN.test(provider) || !MODEL_ID_PATTERN.test(id)) return undefined
    return {
      id,
      provider,
      displayName: id,
      available: true,
    }
  }

  if (!MODEL_ID_PATTERN.test(trimmed)) return undefined
  return {
    id: trimmed,
    provider: "unknown",
    displayName: trimmed,
    available: true,
  }
}
