export interface ContextBreakdown {
  system: number
  history: number
  workspace: number
  queued?: number
  steer?: number
}

export interface ContextUsage {
  percent: number
  tokens: number
  maxTokens: number
  sessionId?: string
  breakdown?: ContextBreakdown
  projected?: { withQueue: number; overflow: boolean }
  cost?: number
  source?: "estimated" | "actual"
  updatedAt?: number
}
