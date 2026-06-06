import type { TokenUsageSnapshot, UsageDelta } from "../types"
import { shouldRefreshOnUpdate, selectDisplayedUsage } from "../tokenDisplayPolicy"
import { formatUsagePercent } from "../context-usage-service"

export type RateLimitWebviewState = {
  provider?: string
  remainingTokens?: number
  limitTokens?: number
  remainingRequests?: number
  limitRequests?: number
  usedTokens?: number
  usedCost?: number
  resetAt?: string
  lastUpdated?: string
}

export interface TokenCostEls {
  tokenDisplay: HTMLElement | null
  statusTokens: HTMLElement
  statusModel: HTMLElement
  costDisplay: HTMLElement | null
  statusCost: HTMLElement
  contextUsage: HTMLElement
  statusStrip: HTMLElement
  quotaBar: HTMLElement
  quotaProgressBar: HTMLElement
  quotaLabel: HTMLElement
  quotaDetail: HTMLElement
}

export interface TokenCostDeps {
  els: TokenCostEls
  getSession: (id: string) => { tokenUsage?: { prompt: number; completion: number; total: number; reasoning?: number; cacheRead?: number; cacheWrite?: number }; cost?: number; model?: string; changedFiles?: string[]; contextUsage?: { percent: number; tokens: number; maxTokens: number } } | undefined
  getActiveSessionId: () => string | undefined
  save: () => void
  getContextWindow: (modelKey?: string) => number | undefined
  showStatusStrip: () => void
  getActiveMessageList: () => HTMLElement | null
  timers: {
    setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  }
}

const recentStepUsage = new Map<string, { signature: string; timestamp: number }>()
const MAX_USAGE_SNAPSHOTS = 200
const OVERFLOW_WARN_THRESHOLD = 0.85
const OVERFLOW_CRITICAL_THRESHOLD = 0.95
const COST_WARN_THRESHOLD = 5.00
let lastOverflowWarningAt = 0

function usageSignature(usage: UsageDelta): string {
  return [
    usage.prompt,
    usage.completion,
    usage.total,
    usage.reasoning ?? 0,
    usage.cacheRead ?? 0,
    usage.cacheWrite ?? 0,
  ].join(":")
}

export function rememberStepUsage(sessionId: string, usage: UsageDelta): void {
  recentStepUsage.set(sessionId, { signature: usageSignature(usage), timestamp: Date.now() })
  // Limit map growth: evict entries older than 60s when over 100 entries
  if (recentStepUsage.size > 100) {
    const cutoff = Date.now() - 60_000
    for (const [sid, entry] of recentStepUsage) {
      if (entry.timestamp < cutoff) recentStepUsage.delete(sid)
    }
  }
}

export function isDuplicateRecentStepUsage(sessionId: string, usage: UsageDelta): boolean {
  const recent = recentStepUsage.get(sessionId)
  return !!recent && recent.signature === usageSignature(usage) && Date.now() - recent.timestamp < 30_000
}

function safeAdd(current: number, delta: number): number {
  if (!Number.isFinite(delta)) return current
  const result = current + delta
  return Number.isFinite(result) ? result : current
}

function isValidSessionId(id: string | undefined): id is string {
  return typeof id === "string" && id.length > 0 && !id.includes("\x00")
}

export function accumulateTokenUsage(deps: TokenCostDeps, sessionId: string, delta: UsageDelta): void {
  if (!isValidSessionId(sessionId)) return
  const session = deps.getSession(sessionId)
  if (!session) return
  const deltaTotal = Number.isFinite(delta.total)
    ? delta.total
    : (delta.prompt ?? 0) + (delta.completion ?? 0) + (delta.reasoning ?? 0) + (delta.cacheRead ?? 0) + (delta.cacheWrite ?? 0)

  if (!session.tokenUsage) {
    session.tokenUsage = { prompt: 0, completion: 0, total: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  }
  session.tokenUsage.prompt = safeAdd(session.tokenUsage.prompt, delta.prompt)
  session.tokenUsage.completion = safeAdd(session.tokenUsage.completion, delta.completion)
  session.tokenUsage.total = safeAdd(session.tokenUsage.total, deltaTotal)
  session.tokenUsage.reasoning = safeAdd(session.tokenUsage.reasoning ?? 0, delta.reasoning ?? 0)
  session.tokenUsage.cacheRead = safeAdd(session.tokenUsage.cacheRead ?? 0, delta.cacheRead ?? 0)
  session.tokenUsage.cacheWrite = safeAdd(session.tokenUsage.cacheWrite ?? 0, delta.cacheWrite ?? 0)
  deps.save()

  const activeId = deps.getActiveSessionId()
  if (shouldRefreshOnUpdate(sessionId, activeId)) {
    updateTokenDisplay(deps, session.tokenUsage)
    updateContextBarFromSession(deps, sessionId)
  }

  updateCostDisplay(deps, sessionId)
}

export function handleTokenUsage(deps: TokenCostDeps, sessionId: string, usage: UsageDelta): void {
  accumulateTokenUsage(deps, sessionId, usage)
}

export function accumulateCost(deps: TokenCostDeps, sessionId: string, costDelta: number): void {
  if (!isValidSessionId(sessionId) || !Number.isFinite(costDelta) || costDelta <= 0) return
  const session = deps.getSession(sessionId)
  if (!session) return
  if (session.cost === undefined) session.cost = 0
  session.cost = safeAdd(session.cost, costDelta)
  deps.save()
  updateCostDisplay(deps, sessionId)
}

export function recordUsageSnapshot(deps: TokenCostDeps & { getState: () => { tokenUsageHistory?: TokenUsageSnapshot[] } }, sessionId: string): void {
  const session = deps.getSession(sessionId)
  if (!session?.tokenUsage || !session.model) return

  const state = deps.getState()
  if (!state.tokenUsageHistory) state.tokenUsageHistory = []

  const snapshot: TokenUsageSnapshot = {
    timestamp: Date.now(),
    sessionId,
    model: session.model,
    prompt: session.tokenUsage.prompt,
    completion: session.tokenUsage.completion,
    total: session.tokenUsage.total,
    reasoning: session.tokenUsage.reasoning ?? 0,
    cacheRead: session.tokenUsage.cacheRead ?? 0,
    cacheWrite: session.tokenUsage.cacheWrite ?? 0,
    cost: session.cost ?? 0,
  }
  state.tokenUsageHistory.push(snapshot)
  if (state.tokenUsageHistory.length > MAX_USAGE_SNAPSHOTS) {
    state.tokenUsageHistory = state.tokenUsageHistory.slice(-MAX_USAGE_SNAPSHOTS)
  }
  deps.save()
}

export function handleRateLimitState(deps: TokenCostDeps, state?: RateLimitWebviewState | null): void {
  updateQuotaBar(deps, state ?? undefined)
}

export function updateQuotaBar(deps: TokenCostDeps, state?: RateLimitWebviewState): void {
  if (!state) {
    deps.els.quotaBar.classList.add("hidden")
    return
  }

  const tokenPct = typeof state.remainingTokens === "number" && Number.isFinite(state.remainingTokens) && state.limitTokens && state.limitTokens > 0
    ? Math.round((state.remainingTokens / state.limitTokens) * 100)
    : undefined
  const requestPct = typeof state.remainingRequests === "number" && Number.isFinite(state.remainingRequests) && state.limitRequests && state.limitRequests > 0
    ? Math.round((state.remainingRequests / state.limitRequests) * 100)
    : undefined
  const bindingPct = [tokenPct, requestPct].filter((value): value is number => value !== undefined).sort((a, b) => a - b)[0]
  const provider = state.provider ? state.provider.replace(/-/g, " ") : "provider"

  deps.els.quotaBar.classList.remove("hidden", "quota-bar--ok", "quota-bar--warning", "quota-bar--critical", "quota-bar--observed")
  if (bindingPct !== undefined) {
    const pct = Math.max(0, Math.min(100, bindingPct))
    const kind = requestPct !== undefined && requestPct === pct && (tokenPct === undefined || requestPct <= tokenPct) ? "requests" : "tokens"
    deps.els.quotaProgressBar.style.setProperty("--p", (pct / 100).toFixed(3))
    deps.els.quotaLabel.textContent = `${provider} ${pct}%`
    deps.els.quotaDetail.textContent = kind === "requests"
      ? `${formatNumber(state.remainingRequests)} / ${formatNumber(state.limitRequests)} req`
      : `${formatNumber(state.remainingTokens)} / ${formatNumber(state.limitTokens)} tok`
    deps.els.quotaBar.classList.add(pct > 50 ? "quota-bar--ok" : pct > 10 ? "quota-bar--warning" : "quota-bar--critical")
  } else {
    deps.els.quotaProgressBar.style.setProperty("--p", "1")
    deps.els.quotaLabel.textContent = `${provider} usage`
    const observed = typeof state.usedTokens === "number" && Number.isFinite(state.usedTokens) ? `${formatNumber(state.usedTokens)} tok` : "observed"
    const cost = typeof state.usedCost === "number" && Number.isFinite(state.usedCost) ? ` · $${state.usedCost.toFixed(4)}` : ""
    deps.els.quotaDetail.textContent = `${observed}${cost}`
    deps.els.quotaBar.classList.add("quota-bar--observed")
  }
  const reset = state.resetAt ? ` · resets ${formatTime(state.resetAt)}` : ""
  deps.els.quotaBar.title = `${deps.els.quotaLabel.textContent}: ${deps.els.quotaDetail.textContent}${reset}`
  deps.showStatusStrip()
}

export function formatNumber(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "-"
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

export function formatTokenCount(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k"
  return String(n)
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)
}

export function clearTokenDisplay(els: TokenCostEls): void {
  if (els.tokenDisplay) {
    els.tokenDisplay.textContent = ""
    els.tokenDisplay.removeAttribute("title")
  }
  if (els.statusTokens) {
    els.statusTokens.textContent = ""
    els.statusTokens.classList.add("hidden")
  }
}

export function updateTokenDisplay(els: TokenCostEls | TokenCostDeps, usage?: { prompt: number; completion: number; total: number; reasoning?: number; cacheRead?: number; cacheWrite?: number }): void {
  const tokenDisplay = "els" in els ? els.els.tokenDisplay : els.tokenDisplay
  const statusTokens = "els" in els ? els.els.statusTokens : els.statusTokens
  const showStrip = "showStatusStrip" in els ? els.showStatusStrip : undefined
  if (tokenDisplay && usage) {
    const parts: string[] = [`${usage.total.toLocaleString()} tok`]
    if (usage.reasoning && usage.reasoning > 0) parts.push(`reasoning: ${usage.reasoning.toLocaleString()}`)
    if (usage.cacheRead && usage.cacheRead > 0) parts.push(`cache read: ${usage.cacheRead.toLocaleString()}`)
    if (usage.cacheWrite && usage.cacheWrite > 0) parts.push(`cache write: ${usage.cacheWrite.toLocaleString()}`)
    tokenDisplay.textContent = parts.join(" · ")
    tokenDisplay.title = `Prompt: ${usage.prompt.toLocaleString()} · Completion: ${usage.completion.toLocaleString()} · Total: ${usage.total.toLocaleString()}`
  }
  if (usage) {
    statusTokens.textContent = `${usage.total.toLocaleString()} tok`
    statusTokens.classList.remove("hidden")
    showStrip?.()
  }
}

export function updateCostDisplay(deps: TokenCostDeps, sessionId: string): void {
  if (!shouldRefreshOnUpdate(sessionId, deps.getActiveSessionId())) return
  const session = deps.getSession(sessionId)
  const costEl = deps.els.costDisplay
  if (costEl && typeof session?.cost === "number" && Number.isFinite(session.cost) && session.cost > 0) {
    costEl.textContent = `$${session.cost.toFixed(4)}`
    costEl.title = `Session cost: $${session.cost.toFixed(4)}`
    costEl.classList.remove("hidden")
  } else if (costEl) {
    costEl.textContent = ""
    costEl.removeAttribute("title")
    costEl.classList.add("hidden")
  }
  if (typeof session?.cost === "number" && Number.isFinite(session.cost) && session.cost > 0) {
    deps.els.statusCost.textContent = `$${session.cost.toFixed(4)}`
    deps.els.statusCost.classList.remove("hidden")
    deps.showStatusStrip()
  } else {
    deps.els.statusCost.textContent = ""
    deps.els.statusCost.classList.add("hidden")
  }
}

export function updateContextBarFromSession(deps: TokenCostDeps, sessionId: string): void {
  const session = deps.getSession(sessionId)
  if (!session?.tokenUsage) return

  const ctxBar = deps.els.contextUsage
  if (!ctxBar) return

  // context_usage events drive the bar via updateContextUsageBar — don't overwrite
  // with cumulative tokenUsage.total, which is unbounded and produces impossible values.
  // Yield to the authoritative source when it has any data.
  if (session.contextUsage && session.contextUsage.tokens > 0) {
    deps.showStatusStrip()
    return
  }

  // Also yield when contextUsage exists but tokens === 0 (post-compact or fresh session)
  // The authoritative context_usage will update when the host fires it.
  if (session.contextUsage) {
    return
  }

  const modelKey = session.model ? `${session.model}` : undefined
  // No hardcoded fallback: when the server hasn't reported limit.context and
  // OpenRouter couldn't fill it either, we hide the bar rather than display a
  // fabricated denominator. The host fires context_window_unknown in this case.
  const contextWindow = deps.getContextWindow(modelKey)
  const totalApiTokens = session.tokenUsage.total ?? 0
  if (totalApiTokens <= 0 || !contextWindow || contextWindow <= 0) {
    // Only hide the bar if context_usage hasn't already shown it
    if (ctxBar.classList.contains("hidden")) {
      ctxBar.querySelector<HTMLElement>("#context-cost")?.classList.add("hidden")
    }
    return
  }
  const pct = Math.min(100, Math.max(0, (totalApiTokens / contextWindow) * 100))

  ctxBar.classList.remove("hidden")
  const model = session.model ? session.model.split("/").pop() || session.model : ""
  if (model) deps.els.statusModel.textContent = model

  const labelEl = ctxBar.querySelector<HTMLElement>("#context-label")
  const fillEl = ctxBar.querySelector<HTMLElement>("#context-progress-fill")
  const costEl = ctxBar.querySelector<HTMLElement>("#context-cost")
  const detailText = `${totalApiTokens.toLocaleString()} tokens / ${contextWindow.toLocaleString()}`

  if (labelEl) {
    labelEl.textContent = `${formatUsagePercent(pct)} used · ${detailText}`
  } else {
    ctxBar.textContent = `${formatUsagePercent(pct)} used · ${detailText}`
  }
  ctxBar.title = `${model ? `${model} · ` : ""}API tokens used: ${totalApiTokens.toLocaleString()} · Context window: ${contextWindow.toLocaleString()}`

  if (fillEl) {
    fillEl.style.setProperty("--usage-pct", String(Math.min(1, Math.max(0, pct / 100))))
  }
  if (costEl && typeof session.cost === "number" && Number.isFinite(session.cost) && session.cost > 0) {
    costEl.textContent = `$${session.cost.toFixed(4)}`
    costEl.classList.remove("hidden")
  } else if (costEl) {
    costEl.textContent = ""
    costEl.classList.add("hidden")
  }
  deps.showStatusStrip()
}

export function checkOverflowWarnings(deps: TokenCostDeps, sessionId: string): void {
  const session = deps.getSession(sessionId)
  if (!session?.tokenUsage) return

  const modelKey = session.model ? `${session.model}` : undefined
  // Suppress warnings when context window is unknown — a fabricated 200k
  // denominator would fire warnings at completely wrong thresholds.
  const contextWindow = deps.getContextWindow(modelKey)
  if (!contextWindow || contextWindow <= 0) return
  const totalApiTokens = session.tokenUsage.total ?? 0
  const usageRatio = totalApiTokens / contextWindow

  const now = Date.now()
  const cooldown = 60_000

  if (usageRatio >= OVERFLOW_CRITICAL_THRESHOLD && now - lastOverflowWarningAt > cooldown) {
    lastOverflowWarningAt = now
    showContextWarning(deps, `Context window nearly full (${Math.round(usageRatio * 100)}%). Consider compacting or starting a new session.`)
  } else if (usageRatio >= OVERFLOW_WARN_THRESHOLD && now - lastOverflowWarningAt > cooldown) {
    lastOverflowWarningAt = now
    showContextWarning(deps, `Context usage at ${Math.round(usageRatio * 100)}%. Approaching limit.`)
  }

  if (session.cost !== undefined && session.cost >= COST_WARN_THRESHOLD) {
    const costEl = deps.els.costDisplay
    if (costEl) costEl.classList.add("cost-display--warning")
  }
}

function showContextWarning(deps: TokenCostDeps, message: string): void {
  const msgList = deps.getActiveMessageList()
  if (!msgList) return

  const existing = msgList.querySelector<HTMLElement>(".context-overflow-warning")
  if (existing) existing.remove()

  const banner = document.createElement("div")
  banner.className = "context-overflow-warning"
  const icon = document.createElement("span")
  icon.className = "context-overflow-warning-icon"
  icon.textContent = "\u26A0"
  banner.appendChild(icon)
  banner.appendChild(document.createTextNode(" " + message))
  msgList.insertBefore(banner, msgList.firstChild)

  deps.timers.setTimeout(() => banner.remove(), 15_000)
}
