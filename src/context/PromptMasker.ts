import { Minimatch } from "minimatch"
import { estimateTokens } from "../utils/tokenCounter"

export interface MaskableContextItem {
  id?: string
  type?: string
  path?: string
  [key: string]: unknown
}

export interface PromptMaskingPolicy {
  enabled?: boolean
  redactSecrets?: boolean
  excludedPathGlobs?: string[]
  maxPromptTokens?: number
  reserveTokens?: number
}

export interface PromptMaskingStats {
  redactedSecrets: number
  maskedFileMentions: number
  maskedDocumentBlocks: number
  removedContextItems: number
  truncatedTokens: number
  inputTokens: number
  outputTokens: number
}

export interface MaskPromptPayloadInput<T extends MaskableContextItem = MaskableContextItem> {
  text: string
  contextItems?: T[]
}

export interface MaskPromptPayloadResult<T extends MaskableContextItem = MaskableContextItem> {
  text: string
  contextItems?: T[]
  stats: PromptMaskingStats
}

export interface PruneResult {
  text: string
  truncated: boolean
  inputTokens: number
  outputTokens: number
  truncatedTokens: number
}

export const DEFAULT_MASKING_EXCLUDE_GLOBS = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "*.pem",
  "**/*.pem",
  "*.key",
  "**/*.key",
  "*.p12",
  "**/*.p12",
  "*.pfx",
  "**/*.pfx",
  "node_modules/**",
  "**/node_modules/**",
  ".git/**",
  "**/.git/**",
]

const SECRET_ASSIGNMENT_RE = /\b([A-Za-z0-9_.-]*(?:api[_-]?key|token|secret|password|passwd|pwd|authorization|private[_-]?key|client[_-]?secret)[A-Za-z0-9_.-]*)\b(\s*[:=]\s*)(["']?)([^\s"',;`]{8,}|[^"',\n]{16,})(\3)/gi
const BEARER_RE = /\b(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi
const OPENAI_STYLE_KEY_RE = /\b(sk-[A-Za-z0-9_-]{16,})\b/g
const AWS_ACCESS_KEY_RE = /\bAKIA[0-9A-Z]{16}\b/g
const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g

function zeroStats(inputTokens = 0, outputTokens = inputTokens): PromptMaskingStats {
  return {
    redactedSecrets: 0,
    maskedFileMentions: 0,
    maskedDocumentBlocks: 0,
    removedContextItems: 0,
    truncatedTokens: 0,
    inputTokens,
    outputTokens,
  }
}

export function redactSecrets(text: string): { text: string; stats: Pick<PromptMaskingStats, "redactedSecrets"> } {
  let redactedSecrets = 0
  let next = text.replace(PRIVATE_KEY_RE, () => {
    redactedSecrets += 1
    return "[REDACTED_PRIVATE_KEY]"
  })
  next = next.replace(SECRET_ASSIGNMENT_RE, (_match, key: string, sep: string, quote: string, _value: string, closing: string) => {
    redactedSecrets += 1
    return `${key}${sep}${quote}[REDACTED]${closing || quote}`
  })
  next = next.replace(BEARER_RE, (_match, prefix: string) => {
    redactedSecrets += 1
    return `${prefix}[REDACTED]`
  })
  next = next.replace(OPENAI_STYLE_KEY_RE, () => {
    redactedSecrets += 1
    return "[REDACTED_SECRET]"
  })
  next = next.replace(AWS_ACCESS_KEY_RE, () => {
    redactedSecrets += 1
    return "[REDACTED_AWS_ACCESS_KEY]"
  })
  return { text: next, stats: { redactedSecrets } }
}

function normalizePathForMatch(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "")
}

export function matchesExcludedPath(filePath: string | undefined, patterns: string[] = DEFAULT_MASKING_EXCLUDE_GLOBS): boolean {
  if (!filePath) return false
  const normalized = normalizePathForMatch(filePath)
  return patterns.some((pattern) => {
    const matcher = new Minimatch(pattern, { dot: true, nocase: process.platform === "win32" })
    return matcher.match(normalized) || matcher.match(`/${normalized}`)
  })
}

function maskExcludedDocumentBlocks(text: string, patterns: string[]): { text: string; count: number } {
  let count = 0
  const next = text.replace(/<file\s+name="([^"]+)"[^>]*>[\s\S]*?<\/file>/gi, (match, fileName: string) => {
    if (!matchesExcludedPath(fileName, patterns)) return match
    count += 1
    return `<file name="${fileName}">\n[masked file content for ${fileName}]\n</file>`
  })
  return { text: next, count }
}

function maskExcludedFileMentions(text: string, patterns: string[]): { text: string; count: number } {
  let count = 0
  const next = text.replace(/(^|[\s(])@(file|folder):([^\s)\]]+)/g, (match, prefix: string, kind: string, filePath: string) => {
    if (!matchesExcludedPath(filePath, patterns)) return match
    count += 1
    return `${prefix}[masked @${kind}:${filePath}]`
  })
  return { text: next, count }
}

function truncateByCharacters(text: string, targetChars: number, inputTokens: number): string {
  const marker = `\n\n[context pruned: approximately ${inputTokens} input tokens exceeded the active prompt budget]\n\n`
  const available = Math.max(32, targetChars - marker.length)
  const headChars = Math.max(16, Math.floor(available * 0.6))
  const tailChars = Math.max(16, available - headChars)
  return `${text.slice(0, headChars)}${marker}${text.slice(-tailChars)}`
}

export function prunePromptToBudget(text: string, policy: Pick<PromptMaskingPolicy, "maxPromptTokens" | "reserveTokens">): PruneResult {
  const maxPromptTokens = Math.max(1, Math.floor(policy.maxPromptTokens ?? 64_000))
  const reserveTokens = Math.max(0, Math.floor(policy.reserveTokens ?? 0))
  const inputTokens = estimateTokens(text)
  if (inputTokens <= maxPromptTokens) {
    return { text, truncated: false, inputTokens, outputTokens: inputTokens, truncatedTokens: 0 }
  }

  const contentBudget = Math.max(1, maxPromptTokens - reserveTokens)
  let targetChars = Math.max(64, contentBudget * 3)
  let next = truncateByCharacters(text, targetChars, inputTokens)
  let outputTokens = estimateTokens(next)
  while (outputTokens > maxPromptTokens && targetChars > 64) {
    targetChars = Math.floor(targetChars * 0.8)
    next = truncateByCharacters(text, targetChars, inputTokens)
    outputTokens = estimateTokens(next)
  }
  return {
    text: next,
    truncated: true,
    inputTokens,
    outputTokens,
    truncatedTokens: Math.max(0, inputTokens - outputTokens),
  }
}

export function maskPromptPayload<T extends MaskableContextItem>(
  input: MaskPromptPayloadInput<T>,
  policy: PromptMaskingPolicy = {},
): MaskPromptPayloadResult<T> {
  const inputTokens = estimateTokens(input.text)
  if (policy.enabled === false) {
    return {
      text: input.text,
      contextItems: input.contextItems,
      stats: zeroStats(inputTokens),
    }
  }

  const patterns = [...DEFAULT_MASKING_EXCLUDE_GLOBS, ...(policy.excludedPathGlobs ?? [])]
  let text = input.text
  const stats = zeroStats(inputTokens)

  const documentResult = maskExcludedDocumentBlocks(text, patterns)
  text = documentResult.text
  stats.maskedDocumentBlocks += documentResult.count

  const mentionResult = maskExcludedFileMentions(text, patterns)
  text = mentionResult.text
  stats.maskedFileMentions += mentionResult.count

  if (policy.redactSecrets !== false) {
    const redacted = redactSecrets(text)
    text = redacted.text
    stats.redactedSecrets += redacted.stats.redactedSecrets
  }

  let contextItems = input.contextItems
  if (contextItems) {
    const kept = contextItems.filter((item) => !matchesExcludedPath(item.path, patterns))
    stats.removedContextItems = contextItems.length - kept.length
    contextItems = kept
  }

  const pruned = prunePromptToBudget(text, policy)
  text = pruned.text
  stats.truncatedTokens = pruned.truncatedTokens
  stats.outputTokens = pruned.outputTokens

  return { text, contextItems, stats }
}
