export function safeParseInt(value: string | undefined, logLabel?: string): number | undefined {
  if (value === undefined) return undefined
  const n = parseInt(value, 10)
  if (!Number.isFinite(n)) {
    console.warn(`[RateLimitMonitor] ${logLabel || "header"}: unable to parse "${value}" as integer`)
    return undefined
  }
  return n
}

export interface RateLimitState {
  provider: string
  remainingTokens?: number
  limitTokens?: number
  remainingRequests?: number
  limitRequests?: number
  remainingInputTokens?: number
  limitInputTokens?: number
  remainingOutputTokens?: number
  limitOutputTokens?: number
  usedInputTokens?: number
  usedOutputTokens?: number
  usedTokens?: number
  usedCost?: number
  resetAt?: Date
  lastUpdated: Date
}

export interface SerializableRateLimitState extends Omit<RateLimitState, "resetAt" | "lastUpdated"> {
  resetAt?: string
  lastUpdated: string
}

export interface RateLimitAdapter {
  name: string
  parseFromHeaders(headers: Record<string, string>): RateLimitState | null
}

export const OPENAI_ADAPTER: RateLimitAdapter = {
  name: "openai",
  parseFromHeaders(headers): RateLimitState | null {
    const remainingReqs = headers["x-ratelimit-remaining-requests"]
    const remainingTokens = headers["x-ratelimit-remaining-tokens"]
    const limitReqs = headers["x-ratelimit-limit-requests"]
    const limitToks = headers["x-ratelimit-limit-tokens"]
    const resetReqs = headers["x-ratelimit-reset-requests"]

    if (!remainingReqs && !remainingTokens) return null

    return {
      provider: "openai",
      remainingRequests: safeParseInt(remainingReqs, "openai x-ratelimit-remaining-requests"),
      limitRequests: safeParseInt(limitReqs, "openai x-ratelimit-limit-requests"),
      remainingTokens: safeParseInt(remainingTokens, "openai x-ratelimit-remaining-tokens"),
      limitTokens: safeParseInt(limitToks, "openai x-ratelimit-limit-tokens"),
      resetAt: resetReqs ? parseDuration(resetReqs) : undefined,
      lastUpdated: new Date(),
    }
  },
}

export const ANTHROPIC_ADAPTER: RateLimitAdapter = {
  name: "anthropic",
  parseFromHeaders(headers): RateLimitState | null {
    const remainingReqs = headers["anthropic-ratelimit-requests-remaining"]
    const remainingTokens = headers["anthropic-ratelimit-tokens-remaining"]
    const limitReqs = headers["anthropic-ratelimit-requests-limit"]
    const limitToks = headers["anthropic-ratelimit-tokens-limit"]
    const resetReqs = headers["anthropic-ratelimit-requests-reset"]
    const remainingInput = headers["anthropic-ratelimit-input-tokens-remaining"]
    const remainingOutput = headers["anthropic-ratelimit-output-tokens-remaining"]
    const limitInput = headers["anthropic-ratelimit-input-tokens-limit"]
    const limitOutput = headers["anthropic-ratelimit-output-tokens-limit"]

    if (!remainingReqs && !remainingTokens && !remainingInput) return null

    return {
      provider: "anthropic",
      remainingRequests: safeParseInt(remainingReqs, "anthropic-ratelimit-requests-remaining"),
      limitRequests: safeParseInt(limitReqs, "anthropic-ratelimit-requests-limit"),
      remainingTokens: safeParseInt(remainingTokens, "anthropic-ratelimit-tokens-remaining"),
      limitTokens: safeParseInt(limitToks, "anthropic-ratelimit-tokens-limit"),
      remainingInputTokens: safeParseInt(remainingInput, "anthropic-ratelimit-input-tokens-remaining"),
      remainingOutputTokens: safeParseInt(remainingOutput, "anthropic-ratelimit-output-tokens-remaining"),
      limitInputTokens: safeParseInt(limitInput, "anthropic-ratelimit-input-tokens-limit"),
      limitOutputTokens: safeParseInt(limitOutput, "anthropic-ratelimit-output-tokens-limit"),
      resetAt: resetReqs ? new Date(resetReqs) : undefined,
      lastUpdated: new Date(),
    }
  },
}

export const GENERIC_ADAPTER: RateLimitAdapter = {
  name: "generic",
  parseFromHeaders(headers): RateLimitState | null {
    const remaining = headers["ratelimit-remaining"]
    const limit = headers["ratelimit-limit"]
    const reset = headers["ratelimit-reset"]

    if (!remaining && !limit) return null

    return {
      provider: "generic",
      remainingRequests: safeParseInt(remaining, "ratelimit-remaining"),
      limitRequests: safeParseInt(limit, "ratelimit-limit"),
      resetAt: reset ? new Date(reset) : undefined,
      lastUpdated: new Date(),
    }
  },
}

export const ADAPTERS: RateLimitAdapter[] = [
  ANTHROPIC_ADAPTER,
  OPENAI_ADAPTER,
  GENERIC_ADAPTER,
]

export function parseDuration(duration: string): Date | undefined {
  const match = duration.match(/^(\d+)([smhd])$/)
  if (!match) {
    console.warn(`[RateLimitMonitor] parseDuration: unable to parse "${duration}" — expected format like "10s", "5m", "2h"`)
    return undefined
  }
  const val = parseInt(match[1]!, 10)
  if (!Number.isFinite(val)) return undefined
  const unit = match[2]!
  const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit]
  if (ms === undefined) return undefined
  return new Date(Date.now() + val * ms)
}
