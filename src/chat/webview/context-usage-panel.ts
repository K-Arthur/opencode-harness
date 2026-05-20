/**
 * Context Usage Panel logic.
 * Manages the UI for viewing and managing context usage breakdown with historical tracking and cost display.
 */

/** I5: defense-in-depth — escape any string field before interpolating into innerHTML. */
function escapeHtml(input: unknown): string {
  if (typeof input !== "string") return ""
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** I5: coerce host-supplied numbers — non-numbers become 0 rather than rendering as raw HTML. */
function safeNum(input: unknown): number {
  const n = typeof input === "number" ? input : Number(input)
  return Number.isFinite(n) ? n : 0
}

let _postMessage: (msg: Record<string, unknown>) => void = () => {}

export function setContextUsagePostMessage(postMessage: (msg: Record<string, unknown>) => void): void {
  _postMessage = postMessage
}

interface ContextBreakdown {
  system: number
  history: number
  workspace: number
  queued: number
  steer: number
}

interface ContextUsage {
  percent: number
  tokens: number
  maxTokens: number
  breakdown?: ContextBreakdown
  projected?: {
    withQueue: number
    overflow: boolean
  }
  cost?: number
}

interface ContextUsageHistory {
  sessionId: string
  timestamp: number
  tokens: number
  maxTokens: number
  modelId?: string
  breakdown: ContextBreakdown
  cost: number
}

interface UsageStatistics {
  totalTokens: number
  totalCost: number
  sessionCount: number
  averageTokensPerSession: number
  averageCostPerSession: number
  dailyBreakdown: Array<{ date: string; tokens: number; cost: number }>
  topSessions: Array<{ sessionId: string; tokens: number; cost: number }>
}

interface OptimizationSuggestion {
  type: string
  title: string
  description: string
  priority: "high" | "medium" | "low"
}

let contextUsagePanelElement: HTMLElement | null = null
let currentUsage: ContextUsage | null = null
let usageHistory: ContextUsageHistory[] = []
let usageStatistics: UsageStatistics | null = null
let suggestions: OptimizationSuggestion[] = []

/**
 * Reset the context usage panel to initial state.
 * Called on tab switch to prevent stale data from bleeding into the new tab.
 * The element IDs here match index.html — earlier drafts referenced
 * non-existent ids (e.g. "context-usage-bar") which silently no-op'd via
 * the if-guards, so the reset never actually ran.
 */
export function resetContextUsagePanel(): void {
  currentUsage = null
  const bar = document.getElementById("context-usage")
  const progressBar = document.getElementById("context-progress-bar") as HTMLProgressElement | null
  const label = document.getElementById("context-label")
  const costDisplay = document.getElementById("context-cost")

  if (bar) {
    bar.classList.add("hidden")
  }
  if (progressBar) {
    progressBar.value = 0
  }
  if (label) {
    label.textContent = "0%"
  }
  if (costDisplay) {
    costDisplay.classList.add("hidden")
    costDisplay.textContent = ""
  }
}

/**
 * Initialize the context usage panel.
 */
export function setupContextUsagePanel(): void {
  postMessage({ type: "get_context_usage" })
}

export function handleContextUsageMessage(data: Record<string, unknown>): void {
  if (data.type === "context_usage") {
    currentUsage = data as unknown as ContextUsage
    updateContextUsageBar(currentUsage)
    if (contextUsagePanelElement && !contextUsagePanelElement.classList.contains("hidden")) {
      renderContextUsagePanel(currentUsage)
    }
  } else if (data.type === "usage_history") {
    usageHistory = (data.history as ContextUsageHistory[]) || []
    if (contextUsagePanelElement && !contextUsagePanelElement.classList.contains("hidden")) {
      renderHistoricalData()
    }
  } else if (data.type === "usage_statistics") {
    usageStatistics = data.statistics as UsageStatistics
    if (contextUsagePanelElement && !contextUsagePanelElement.classList.contains("hidden")) {
      renderStatistics()
    }
  }
}

/**
 * Update the context usage bar in the status strip.
 * Reads/writes the elements defined in index.html: #context-usage (container),
 * #context-progress-bar (progress element), #context-label (text), #context-cost.
 */
function updateContextUsageBar(usage: ContextUsage | null): void {
  const bar = document.getElementById("context-usage")
  const progressBar = document.getElementById("context-progress-bar") as HTMLProgressElement | null
  const label = document.getElementById("context-label")
  const costDisplay = document.getElementById("context-cost")

  if (!bar || !progressBar || !label || !usage) return

  if (usage.tokens === 0) {
    bar.classList.add("hidden")
    if (costDisplay) {
      costDisplay.classList.add("hidden")
      costDisplay.textContent = ""
    }
    return
  }

  bar.classList.remove("hidden")
  progressBar.value = usage.percent
  label.textContent = `${usage.tokens.toLocaleString()} / ${usage.maxTokens.toLocaleString()}`

  // Add cost display if available
  if (costDisplay && usage.cost !== undefined) {
    costDisplay.textContent = `$${usage.cost.toFixed(4)}`
    costDisplay.classList.remove("hidden")
  }

  // Color-coded zones
  if (usage.percent < 60) {
    progressBar.style.backgroundColor = "var(--usage-green, #4caf50)"
  } else if (usage.percent < 80) {
    progressBar.style.backgroundColor = "var(--usage-yellow, #ff9800)"
  } else if (usage.percent < 95) {
    progressBar.style.backgroundColor = "var(--usage-red, #f44336)"
  } else {
    progressBar.style.backgroundColor = "var(--usage-critical, #d32f2f)"
  }
}

/**
 * Render the context usage panel.
 */
function renderContextUsagePanel(usage: ContextUsage | null): void {
  if (!contextUsagePanelElement || !usage) return

  const breakdownSection = contextUsagePanelElement.querySelector(".context-breakdown-section")
  if (!breakdownSection) return

  if (!usage.breakdown) {
    breakdownSection.innerHTML = '<p class="text-muted">No breakdown available.</p>'
    return
  }

  const total = usage.breakdown.system + usage.breakdown.history + usage.breakdown.workspace + usage.breakdown.queued + usage.breakdown.steer

  // Avoid division by zero for empty breakdowns
  if (total === 0) {
    breakdownSection.innerHTML = '<p class="text-muted">No breakdown data available.</p>'
    return
  }

  breakdownSection.innerHTML = `
    <div class="context-breakdown-chart">
      <div class="breakdown-segment system" style="width: ${(usage.breakdown.system / total) * 100}%" title="System: ${usage.breakdown.system}"></div>
      <div class="breakdown-segment history" style="width: ${(usage.breakdown.history / total) * 100}%" title="History: ${usage.breakdown.history}"></div>
      <div class="breakdown-segment workspace" style="width: ${(usage.breakdown.workspace / total) * 100}%" title="Workspace: ${usage.breakdown.workspace}"></div>
      <div class="breakdown-segment queued" style="width: ${(usage.breakdown.queued / total) * 100}%" title="Queued: ${usage.breakdown.queued}"></div>
      <div class="breakdown-segment steer" style="width: ${(usage.breakdown.steer / total) * 100}%" title="Steer: ${usage.breakdown.steer}"></div>
    </div>
    <div class="breakdown-legend">
      <div class="legend-item system">
        <span class="legend-color"></span>
        <span>System (${usage.breakdown.system})</span>
      </div>
      <div class="legend-item history">
        <span class="legend-color"></span>
        <span>History (${usage.breakdown.history})</span>
      </div>
      <div class="legend-item workspace">
        <span class="legend-color"></span>
        <span>Workspace (${usage.breakdown.workspace})</span>
      </div>
      <div class="legend-item queued">
        <span class="legend-color"></span>
        <span>Queued (${usage.breakdown.queued})</span>
      </div>
      <div class="legend-item steer">
        <span class="legend-color"></span>
        <span>Steer (${usage.breakdown.steer})</span>
      </div>
    </div>
  `

  // Update projected usage if available
  if (usage.projected) {
    const projectedSection = contextUsagePanelElement.querySelector(".projected-section")
    if (projectedSection) {
      projectedSection.innerHTML = `
        <p>Projected with queue: ${usage.projected.withQueue} / ${usage.maxTokens}
          ${usage.projected.overflow ? '<span class="overflow-warning">⚠️ Overflow</span>' : ''}
        </p>
      `
    }
  }

  // Add cost display if available
  if (usage.cost !== undefined) {
    const costSection = contextUsagePanelElement.querySelector(".cost-section")
    if (costSection) {
      costSection.innerHTML = `
        <p class="cost-display">Current Cost: $${usage.cost.toFixed(4)}</p>
      `
    }
  }
}

/**
 * Render historical usage data.
 */
function renderHistoricalData(): void {
  if (!contextUsagePanelElement) return

  const historySection = contextUsagePanelElement.querySelector(".history-section")
  if (!historySection) return

  if (usageHistory.length === 0) {
    historySection.innerHTML = '<p class="text-muted">No historical data available.</p>'
    return
  }

  // Generate simple sparkline graph
  const sparklineSvg = generateSparkline(usageHistory.map(h => h.tokens))

  historySection.innerHTML = `
    <div class="history-graph">
      ${sparklineSvg}
    </div>
    <div class="history-stats">
      <p>Total entries: ${usageHistory.length}</p>
      <p>Average tokens: ${(usageHistory.reduce((sum, h) => sum + h.tokens, 0) / usageHistory.length).toFixed(0)}</p>
      <p>Total cost: $${usageHistory.reduce((sum, h) => sum + h.cost, 0).toFixed(4)}</p>
    </div>
  `
}

/**
 * Render usage statistics.
 */
function renderStatistics(): void {
  if (!contextUsagePanelElement || !usageStatistics) return

  const statsSection = contextUsagePanelElement.querySelector(".statistics-section")
  if (!statsSection) return

  statsSection.innerHTML = `
    <div class="stats-overview">
      <div class="stat-card">
        <h3>Total Tokens</h3>
        <p class="stat-value">${usageStatistics.totalTokens.toLocaleString()}</p>
      </div>
      <div class="stat-card">
        <h3>Total Cost</h3>
        <p class="stat-value">$${usageStatistics.totalCost.toFixed(4)}</p>
      </div>
      <div class="stat-card">
        <h3>Sessions</h3>
        <p class="stat-value">${usageStatistics.sessionCount}</p>
      </div>
      <div class="stat-card">
        <h3>Avg Tokens/Session</h3>
        <p class="stat-value">${usageStatistics.averageTokensPerSession.toFixed(0)}</p>
      </div>
    </div>
    <div class="daily-breakdown">
      <h3>Daily Breakdown</h3>
      ${usageStatistics.dailyBreakdown.map(day => `
        <div class="daily-row">
          <span class="date">${escapeHtml(day.date)}</span>
          <span class="tokens">${safeNum(day.tokens).toLocaleString()} tok</span>
          <span class="cost">$${safeNum(day.cost).toFixed(4)}</span>
        </div>
      `).join('')}
    </div>
  `
}

/**
 * Generate a simple sparkline SVG.
 */
function generateSparkline(values: number[]): string {
  if (values.length === 0) return ''

  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const width = 300
  const height = 50
  const padding = 5

  const points = values.map((val, i) => {
    const x = (i / (values.length - 1)) * (width - 2 * padding) + padding
    const y = height - padding - ((val - min) / range) * (height - 2 * padding)
    return `${x},${y}`
  }).join(' ')

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="sparkline">
      <polyline points="${points}" fill="none" stroke="var(--sparkline-color, #4caf50)" stroke-width="2"/>
    </svg>
  `
}

/**
 * Set the context usage panel element reference.
 */
export function setContextUsagePanel(element: HTMLElement): void {
  contextUsagePanelElement = element
  if (currentUsage) {
    renderContextUsagePanel(currentUsage)
  }
}

/**
 * Post a message to the extension.
 */
function postMessage(msg: Record<string, unknown>): void {
  _postMessage(msg)
}

// Re-export for main.ts
export { setupContextUsagePanel as default }
