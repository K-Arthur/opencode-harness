export interface OpencodeUsageSummary {
  cost: number
  tokenUsage: {
    prompt: number
    completion: number
    total: number
    reasoning?: number
    cacheRead?: number
    cacheWrite?: number
  }
}

type UsageRow = {
  parts?: unknown
  info?: {
    role?: unknown
    cost?: unknown
    tokens?: {
      total?: unknown
      input?: unknown
      output?: unknown
      reasoning?: unknown
      cache?: {
        read?: unknown
        write?: unknown
      }
    }
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export function summarizeOpencodeMessageUsage(rows: ReadonlyArray<UsageRow>): OpencodeUsageSummary | undefined {
  let sawUsage = false
  let cost = 0
  const tokenUsage = {
    prompt: 0,
    completion: 0,
    total: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
  }

  for (const row of rows) {
    const info = row.info
    if (info?.role !== "assistant") continue

    const rowCost = numberOrZero(info.cost)
    const tokens = info.tokens
    if (rowCost > 0 || tokens) sawUsage = true
    cost += rowCost

    if (!tokens) continue
    const input = numberOrZero(tokens.input)
    const output = numberOrZero(tokens.output)
    const reasoning = numberOrZero(tokens.reasoning)
    const cacheRead = numberOrZero(tokens.cache?.read)
    const cacheWrite = numberOrZero(tokens.cache?.write)
    const total = numberOrZero(tokens.total) || input + output + reasoning + cacheRead + cacheWrite

    tokenUsage.prompt += input
    tokenUsage.completion += output
    tokenUsage.reasoning += reasoning
    tokenUsage.cacheRead += cacheRead
    tokenUsage.cacheWrite += cacheWrite
    tokenUsage.total += total
  }

  if (!sawUsage) return undefined
  return { cost, tokenUsage }
}
