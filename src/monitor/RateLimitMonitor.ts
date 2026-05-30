import * as vscode from "vscode"
import {
  safeParseInt,
  parseDuration,
  ADAPTERS,
  RateLimitState,
  SerializableRateLimitState,
  type RateLimitAdapter,
} from "./rateLimitCore"

export { safeParseInt, parseDuration, ADAPTERS, type RateLimitAdapter, type RateLimitState, type SerializableRateLimitState }
export { OPENAI_ADAPTER, ANTHROPIC_ADAPTER, GENERIC_ADAPTER } from "./rateLimitCore"

export class RateLimitMonitor {
  private _onStateChanged = new vscode.EventEmitter<RateLimitState | null>()
  readonly onStateChanged = this._onStateChanged.event

  private _onWarning = new vscode.EventEmitter<string>()
  readonly onWarning = this._onWarning.event

  private _onReset = new vscode.EventEmitter<void>()
  readonly onReset = this._onReset.event

  private state: RateLimitState | null = null
  private cumulativeInputTokens = 0
  private cumulativeOutputTokens = 0
  private cumulativeCost = 0
  private cumulativeProvider = ""
  private warnedLowTokens = false
  private warnedExhausted = false

  private statusBarItem: vscode.StatusBarItem
  private warningThreshold = 0.1
  private criticalThreshold = 0.05
  private providerLimits: Record<string, { tokensPerMin: number; requestsPerMin: number }> = {}
  private configListener: vscode.Disposable

  // Countdown timer for rate limit reset
  private countdownInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
    this.statusBarItem.name = "OpenCode Rate Limit"
    this.statusBarItem.command = "opencode-harness.showRateLimits"
    this.loadConfig()

    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("opencode.rateLimits")) this.loadConfig()
    })
  }

  /**
   * Start a real-time countdown to rate limit reset.
   * Updates the status bar every second and fires onReset when done.
   */
  private startCountdown(resetAt: Date): void {
    this.stopCountdown()
    this.countdownInterval = setInterval(() => {
      const remainingMs = resetAt.getTime() - Date.now()
      if (remainingMs <= 0) {
        this.stopCountdown()
        this.warnedExhausted = false
        this.warnedLowTokens = false
        this._onReset.fire()
        this.updateStatusBar()
        return
      }
      const remainingSec = Math.ceil(remainingMs / 1000)
      this.statusBarItem.text = `⚠ ${remainingSec}s`
      this.statusBarItem.tooltip = `Rate limit exhausted — resets in ${remainingSec}s`
      this.statusBarItem.show()
    }, 1000)
  }

  /**
   * Stop the countdown timer.
   */
  private stopCountdown(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval)
      this.countdownInterval = null
    }
  }

  private loadConfig(): void {
    const config = vscode.workspace.getConfiguration("opencode")
    const limits = config.get<Record<string, { tokensPerMin?: number; requestsPerMin?: number }>>("rateLimits")
    this.providerLimits = {}
    if (limits) {
      for (const [provider, vals] of Object.entries(limits)) {
        this.providerLimits[provider] = {
          tokensPerMin: vals.tokensPerMin || 100000,
          requestsPerMin: vals.requestsPerMin || 50,
        }
      }
    }
    this.warningThreshold = config.get("rateLimitWarningThreshold", 0.1)
    this.criticalThreshold = config.get("rateLimitCriticalThreshold", 0.05)
  }

  updateFromHeaders(headers: Record<string, string>): void {
    for (const adapter of ADAPTERS) {
      const parsed = adapter.parseFromHeaders(headers)
      if (parsed) {
        this.state = parsed
        this.evaluate()
        this._onStateChanged.fire(this.state)
        this.updateStatusBar()
        return
      }
    }
  }

  recordTokenUsage(inputTokens: number, outputTokens: number, provider?: string, cost?: number): void {
    const resolvedProvider = provider || this.state?.provider || "unknown"
    if (this.cumulativeProvider && this.cumulativeProvider !== resolvedProvider) {
      this.cumulativeInputTokens = 0
      this.cumulativeOutputTokens = 0
      this.cumulativeCost = 0
      this.warnedLowTokens = false
      this.warnedExhausted = false
    }
    this.cumulativeProvider = resolvedProvider
    this.cumulativeInputTokens += inputTokens
    this.cumulativeOutputTokens += outputTokens
    if (typeof cost === "number" && Number.isFinite(cost)) {
      this.cumulativeCost += cost
    }

    const limits = this.providerLimits[resolvedProvider]
    const usedTokens = this.cumulativeInputTokens + this.cumulativeOutputTokens
    const baseState: RateLimitState = {
      ...(this.state || { provider: resolvedProvider, lastUpdated: new Date() }),
      provider: resolvedProvider,
      usedInputTokens: this.cumulativeInputTokens,
      usedOutputTokens: this.cumulativeOutputTokens,
      usedTokens,
      usedCost: this.cumulativeCost || undefined,
      lastUpdated: new Date(),
    }
    if (limits) {
      const ratio = usedTokens / limits.tokensPerMin
      this.state = {
        ...baseState,
        remainingTokens: Math.max(0, Math.round((1 - ratio) * limits.tokensPerMin)),
        limitTokens: limits.tokensPerMin,
        remainingRequests: Math.max(0, Math.round((1 - ratio) * limits.requestsPerMin)),
        limitRequests: limits.requestsPerMin,
      }
    } else {
      this.state = baseState
    }
    this.evaluate()
    this._onStateChanged.fire(this.state)
    this.updateStatusBar()
  }

  private evaluate(): void {
    if (!this.state) return

    const tokenRatio = this.state.remainingTokens !== undefined && this.state.limitTokens
      ? this.state.remainingTokens / this.state.limitTokens
      : 1

    if (tokenRatio <= this.criticalThreshold && !this.warnedExhausted) {
      this.warnedExhausted = true
      const resetStr = this.state.resetAt
        ? ` Reset at ${this.state.resetAt.toLocaleTimeString()}.`
        : ""
      this._onWarning.fire(`Rate limit nearly exhausted (${Math.round(tokenRatio * 100)}% remaining).${resetStr} Consider reducing context size.`)
    } else if (tokenRatio <= this.warningThreshold && !this.warnedLowTokens && !this.warnedExhausted) {
      this.warnedLowTokens = true
      this._onWarning.fire(`Low rate limit — ${Math.round(tokenRatio * 100)}% tokens remaining.`)
    }
  }

  private updateStatusBar(): void {
    if (!this.state) {
      this.statusBarItem.hide()
      return
    }

    const tokens = this.state.remainingTokens
    const requests = this.state.remainingRequests
    const limitT = this.state.limitTokens
    const limitR = this.state.limitRequests

    // Use whichever is the binding constraint (lower percentage)
    let pct: number | undefined
    let constraintType: "tokens" | "requests" | undefined
    if (tokens !== undefined && limitT && limitT > 0) {
      pct = Math.round((tokens / limitT) * 100)
      constraintType = "tokens"
    }
    if (requests !== undefined && limitR && limitR > 0) {
      const reqPct = Math.round((requests / limitR) * 100)
      if (pct === undefined || reqPct < pct) {
        pct = reqPct
        constraintType = "requests"
      }
    }

    if (pct !== undefined) {
      // Color-coded progress bar visualization
      const progressBar = this.buildProgressBar(pct)
      const icon = pct > 50 ? "\u25D4" : pct > 10 ? "\u25D5" : "\u25D7"
      const label = constraintType === "requests" ? `${pct}% req` : `${pct}%`
      
      this.statusBarItem.text = `${icon}${progressBar} ${label}`
      this.statusBarItem.tooltip = this.buildTooltip()
      this.statusBarItem.color = pct > 50
        ? undefined
        : pct > 10
          ? new vscode.ThemeColor("statusBarItem.warningForeground")
          : new vscode.ThemeColor("statusBarItem.errorForeground")
      this.statusBarItem.show()

      // Start countdown if exhausted and we have a reset time
      if (pct <= 0 && this.state.resetAt && !this.countdownInterval) {
        this.startCountdown(this.state.resetAt)
      }
    } else if (requests !== undefined) {
      this.statusBarItem.text = `\u23F1 ${requests} req`
      this.statusBarItem.tooltip = this.buildTooltip()
      this.statusBarItem.show()
    } else if (this.state.usedTokens !== undefined) {
      this.statusBarItem.text = `$(pulse) ${this.formatCompactNumber(this.state.usedTokens)} tok used`
      this.statusBarItem.tooltip = this.buildTooltip()
      this.statusBarItem.color = undefined
      this.statusBarItem.show()
    } else {
      this.statusBarItem.hide()
    }
  }

  private formatCompactNumber(value: number): string {
    return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value)
  }

  /**
   * Build a text-based progress bar for the status bar.
   * Uses Unicode block characters for visual representation.
   */
  private buildProgressBar(pct: number): string {
    const barLength = 10
    const filled = Math.max(0, Math.min(barLength, Math.round((pct / 100) * barLength)))
    const empty = barLength - filled
    
    // Use different block characters based on percentage for better visualization
    if (pct <= 0) {
      return "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588" // Full block (red)
    } else if (pct <= 10) {
      return "\u2588".repeat(filled) + "\u2591".repeat(empty) // Heavy + light
    } else if (pct <= 50) {
      return "\u2588".repeat(filled) + "\u2592".repeat(empty) // Heavy + medium
    } else {
      return "\u2588".repeat(filled) + "\u2593".repeat(empty) // Heavy + dark
    }
  }

  get isExhausted(): boolean {
    if (!this.state) return false
    if (this.state.remainingTokens !== undefined && this.state.remainingTokens <= 0) return true
    if (this.state.remainingRequests !== undefined && this.state.remainingRequests <= 0) return true
    return false
  }

  getState(): RateLimitState | null {
    return this.state
  }

  getSerializableState(): SerializableRateLimitState | null {
    if (!this.state) return null
    return {
      ...this.state,
      resetAt: this.state.resetAt?.toISOString(),
      lastUpdated: this.state.lastUpdated.toISOString(),
    }
  }

  showDetail(): void {
    if (!this.state) {
      vscode.window.showInformationMessage("No rate limit data available yet. Send a prompt to populate.")
      return
    }
    const items: vscode.QuickPickItem[] = []
    const s = this.state

    items.push({ label: "Provider", description: s.provider })
    if (s.limitTokens !== undefined && s.remainingTokens !== undefined) {
      items.push({
        label: "Tokens Remaining",
        description: `${s.remainingTokens.toLocaleString()} / ${s.limitTokens.toLocaleString()}`,
      })
    }
    if (s.limitRequests !== undefined && s.remainingRequests !== undefined) {
      items.push({
        label: "Requests Remaining",
        description: `${s.remainingRequests} / ${s.limitRequests}`,
      })
    }
    if (s.remainingInputTokens !== undefined) {
      items.push({ label: "Input Tokens Remaining", description: s.remainingInputTokens.toLocaleString() })
    }
    if (s.remainingOutputTokens !== undefined) {
      items.push({ label: "Output Tokens Remaining", description: s.remainingOutputTokens.toLocaleString() })
    }
    if (s.resetAt) {
      items.push({ label: "Reset At", description: s.resetAt.toLocaleTimeString() })
    }
    items.push({ label: "Last Updated", description: s.lastUpdated.toLocaleTimeString() })

    vscode.window.showQuickPick(items, { placeHolder: "View your rate limit status" })
  }

  private buildTooltip(): string {
    if (!this.state) return "No rate limit data"
    const parts: string[] = [`Provider: ${this.state.provider}`]
    if (this.state.remainingTokens !== undefined && this.state.limitTokens !== undefined) {
      const pct = Math.round((this.state.remainingTokens / this.state.limitTokens) * 100)
      parts.push(`Tokens: ${this.state.remainingTokens.toLocaleString()} / ${this.state.limitTokens.toLocaleString()} (${pct}%)`)
    }
    if (this.state.remainingRequests !== undefined && this.state.limitRequests !== undefined) {
      parts.push(`Requests: ${this.state.remainingRequests} / ${this.state.limitRequests}`)
    }
    if (this.state.usedTokens !== undefined) {
      parts.push(`Observed this window: ${this.state.usedTokens.toLocaleString()} tokens`)
    }
    if (this.state.usedCost !== undefined) {
      parts.push(`Observed cost: $${this.state.usedCost.toFixed(4)}`)
    }
    if (this.state.resetAt) {
      parts.push(`Reset: ${this.state.resetAt.toLocaleTimeString()}`)
    }
    parts.push(`Updated: ${this.state.lastUpdated.toLocaleTimeString()}`)
    return parts.join("\n")
  }

  dispose(): void {
    this.stopCountdown()
    this.statusBarItem.dispose()
    this._onStateChanged.dispose()
    this._onWarning.dispose()
    this._onReset.dispose()
    this.configListener.dispose()
  }
}
