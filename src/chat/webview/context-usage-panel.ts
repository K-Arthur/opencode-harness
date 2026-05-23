/**
 * Context Usage Panel — premium redesign.
 * Uses context-usage-service.ts for all pure logic (testable without DOM).
 * Handles three UI zones:
 *   - Breakdown panel (#context-usage-panel) — inline stacked bar + critical banner
 *   - Shared state (currentUsage) — updated by host messages
 */
import {
  deriveUsageColor,
  formatTokenCount,
  computeBreakdownWidths,
  buildSummaryText,
  clampPercent,
  formatCost,
  type ContextBreakdown,
} from "./context-usage-service"

function escapeHtml(input: unknown): string {
  if (typeof input !== "string") return ""
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

let _postMessage: (msg: Record<string, unknown>) => void = () => {}

export function setContextUsagePostMessage(postMessage: (msg: Record<string, unknown>) => void): void {
  _postMessage = postMessage
}

interface ContextUsage {
  percent: number
  tokens: number
  maxTokens: number
  breakdown?: ContextBreakdown
  projected?: { withQueue: number; overflow: boolean }
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

let contextUsagePanelElement: HTMLElement | null = null
let currentUsage: ContextUsage | null = null
let usageHistory: ContextUsageHistory[] = []
let usageStatistics: UsageStatistics | null = null

// Debounce renders to avoid layout thrash on rapid updates
let _renderScheduled = false
function scheduleRender(): void {
  if (_renderScheduled) return
  _renderScheduled = true
  ;(typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : setTimeout)(
    () => { _renderScheduled = false; renderContextUsagePanel(currentUsage) }
  )
}

/**
 * Reset panel to initial state.
 * Re-queries all elements (port-change safe — never uses cached refs).
 */
export function resetContextUsagePanel(): void {
  currentUsage = null
  // Re-query each time (safe if elements don't exist yet after a port change)
  const bar = document.getElementById("context-usage")
  const progressBar = document.getElementById("context-progress-bar") as HTMLProgressElement | null
  const label = document.getElementById("context-label")
  const costDisplay = document.getElementById("context-cost")

  bar?.classList.add("hidden")
  if (progressBar) progressBar.value = 0
  if (label) label.textContent = "0%"
  costDisplay?.classList.add("hidden")
  if (costDisplay) costDisplay.textContent = ""
  contextUsagePanelElement?.classList.add("hidden")

  // Also clear breakdown content so stale data doesn't bleed into next tab
  const breakdownSection = contextUsagePanelElement?.querySelector(".context-breakdown-section")
  if (breakdownSection) (breakdownSection as HTMLElement).innerHTML = ""
  const criticalBanner = contextUsagePanelElement?.querySelector(".cup-critical-banner")
  criticalBanner?.remove()
}

export function setupContextUsagePanel(): void {
  postMessage({ type: "get_context_usage" })
}

export function handleContextUsageMessage(data: Record<string, unknown>): void {
  if (data.type === "context_usage") {
    currentUsage = data as unknown as ContextUsage
    if (contextUsagePanelElement && !contextUsagePanelElement.classList.contains("hidden")) {
      scheduleRender()
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

function renderContextUsagePanel(usage: ContextUsage | null): void {
  if (!contextUsagePanelElement || !usage) return

  const pct = clampPercent(usage.percent)
  const color = deriveUsageColor(usage.percent) // use raw percent for color (not clamped)

  // ── Critical banner ────────────────────────────────────────────────────────
  const existingBanner = contextUsagePanelElement.querySelector(".cup-critical-banner")
  existingBanner?.remove()
  if (color === "critical") {
    const banner = document.createElement("div")
    banner.className = "cup-critical-banner"
    banner.setAttribute("role", "alert")
    banner.innerHTML = `<span class="cup-critical-icon" aria-hidden="true">⚠</span> Context nearly full (${usage.percent}%) — consider compacting or starting a new session.`
    contextUsagePanelElement.insertBefore(banner, contextUsagePanelElement.firstChild)
  }

  // ── Breakdown section ─────────────────────────────────────────────────────
  const breakdownSection = contextUsagePanelElement.querySelector(".context-breakdown-section")
  if (!breakdownSection) return

  if (!usage.breakdown) {
    breakdownSection.innerHTML = '<p class="text-muted">No breakdown available.</p>'
  } else {
    const widths = computeBreakdownWidths(usage.breakdown)
    const segments: Array<{ key: keyof ContextBreakdown; label: string }> = [
      { key: "system", label: "System" },
      { key: "history", label: "History" },
      { key: "workspace", label: "Workspace" },
      { key: "queued", label: "Queued" },
      { key: "steer", label: "Steer" },
    ]

    const chartParts = segments.map(({ key, label }) => {
      const tokenCount = formatTokenCount(usage.breakdown![key])
      const pctStr = widths[key].toFixed(1)
      return `<div class="breakdown-segment ${key} cup-segment" style="width:${widths[key]}%" data-detail="${escapeHtml(label)}: ${tokenCount} tok (${pctStr}%)" title="${escapeHtml(label)}: ${tokenCount} tokens (${pctStr}%)"></div>`
    }).join('')

    const legendParts = segments.map(({ key, label }) =>
      `<div class="legend-item ${key}">
        <span class="legend-color"></span>
        <span>${escapeHtml(label)} (${formatTokenCount(usage.breakdown![key])})</span>
      </div>`
    ).join('')

    // Projected overflow badge
    const projectedHtml = usage.projected
      ? `<div class="cup-projected${usage.projected.overflow ? ' cup-projected--overflow' : ''}">
          <span class="cup-projected-label">Projected with queue:</span>
          <span class="cup-projected-value">${formatTokenCount(usage.projected.withQueue)} / ${formatTokenCount(usage.maxTokens)}</span>
          ${usage.projected.overflow ? '<span class="cup-overflow-badge">⚠ Overflow</span>' : ''}
        </div>`
      : ''

    // Cost display
    const costStr = formatCost(usage.cost)
    const costHtml = costStr
      ? `<div class="cup-cost-row"><span class="cup-cost-label">Session cost:</span><span class="cup-cost-value">${costStr}</span></div>`
      : ''

    // Summary header with radial ring
    const summaryText = buildSummaryText(usage.tokens, usage.maxTokens, usage.percent)
    const radius = 22
    const circumference = 2 * Math.PI * radius
    const dashOffset = circumference - (clampPercent(usage.percent) / 100) * circumference

    breakdownSection.innerHTML = `
      <div class="cup-header-row">
        <svg class="cup-ring-svg" viewBox="0 0 56 56" width="56" height="56" aria-hidden="true">
          <circle class="cup-ring-bg" cx="28" cy="28" r="${radius}" fill="none" stroke-width="4"/>
          <circle class="cup-ring-fill cup-ring-fill--${color}" cx="28" cy="28" r="${radius}" fill="none" stroke-width="4"
            stroke-dasharray="${circumference.toFixed(2)}"
            stroke-dashoffset="${dashOffset.toFixed(2)}"
            transform="rotate(-90 28 28)"/>
          <text class="cup-ring-label" x="28" y="33" text-anchor="middle" font-size="10">${pct}%</text>
        </svg>
        <div class="cup-header-text">
          <div class="cup-summary-text">${escapeHtml(summaryText)}</div>
          ${costHtml}
        </div>
      </div>
      <div class="context-breakdown-chart cup-breakdown-chart context-breakdown-chart--${color}">
        ${chartParts}
      </div>
      <div class="breakdown-legend">${legendParts}</div>
      ${projectedHtml}
    `
  }

  // ── Projected section (legacy selector) ───────────────────────────────────
  if (usage.projected) {
    const projectedSection = contextUsagePanelElement.querySelector(".projected-section")
    if (projectedSection) {
      projectedSection.innerHTML = `<p>Projected with queue: ${formatTokenCount(usage.projected.withQueue)} / ${formatTokenCount(usage.maxTokens)}${usage.projected.overflow ? ' <span class="overflow-warning">⚠️ Overflow</span>' : ''}</p>`
    }
  }

  // ── Cost section (legacy selector) ────────────────────────────────────────
  if (usage.cost !== undefined) {
    const costSection = contextUsagePanelElement.querySelector(".cost-section")
    if (costSection) {
      const costStr = formatCost(usage.cost)
      costSection.innerHTML = costStr ? `<p class="cost-display">Current Cost: ${costStr}</p>` : ""
    }
  }
}

function renderHistoricalData(): void {
  if (!contextUsagePanelElement) return
  const historySection = contextUsagePanelElement.querySelector(".history-section")
  if (!historySection) return

  if (usageHistory.length === 0) {
    historySection.innerHTML = '<p class="text-muted">No historical data available.</p>'
    return
  }

  const sparklineSvg = generateSparkline(usageHistory.map(h => h.tokens))
  const avgTokens = usageHistory.reduce((sum, h) => sum + h.tokens, 0) / usageHistory.length
  const totalCost = usageHistory.reduce((sum, h) => sum + h.cost, 0)

  historySection.innerHTML = `
    <div class="history-graph">${sparklineSvg}</div>
    <div class="history-stats">
      <p>Total entries: ${usageHistory.length}</p>
      <p>Average tokens: ${formatTokenCount(Math.round(avgTokens))}</p>
      <p>Total cost: ${formatCost(totalCost) || '$0.0000'}</p>
    </div>
  `
}

function renderStatistics(): void {
  if (!contextUsagePanelElement || !usageStatistics) return
  const statsSection = contextUsagePanelElement.querySelector(".statistics-section")
  if (!statsSection) return

  const s = usageStatistics
  statsSection.innerHTML = `
    <div class="stats-overview">
      <div class="stat-card"><h3>Total Tokens</h3><p class="stat-value">${formatTokenCount(s.totalTokens)}</p></div>
      <div class="stat-card"><h3>Total Cost</h3><p class="stat-value">${formatCost(s.totalCost) || '$0.0000'}</p></div>
      <div class="stat-card"><h3>Sessions</h3><p class="stat-value">${s.sessionCount}</p></div>
      <div class="stat-card"><h3>Avg Tokens/Session</h3><p class="stat-value">${formatTokenCount(Math.round(s.averageTokensPerSession))}</p></div>
    </div>
    <div class="daily-breakdown">
      <h3>Daily Breakdown</h3>
      ${s.dailyBreakdown.map(day => `
        <div class="daily-row">
          <span class="date">${escapeHtml(day.date)}</span>
          <span class="tokens">${formatTokenCount(day.tokens)} tok</span>
          <span class="cost">${formatCost(day.cost) || '$0.0000'}</span>
        </div>
      `).join('')}
    </div>
  `
}

function generateSparkline(values: number[]): string {
  if (values.length === 0) return ''
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const width = 300, height = 50, padding = 5

  const points = values.map((val, i) => {
    const x = (i / (Math.max(values.length - 1, 1))) * (width - 2 * padding) + padding
    const y = height - padding - ((val - min) / range) * (height - 2 * padding)
    return `${x},${y}`
  }).join(' ')

  // Area fill path
  const firstX = padding
  const lastX = (width - 2 * padding) + padding
  const areaPoints = `${firstX},${height - padding} ${points} ${lastX},${height - padding}`

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="sparkline" aria-hidden="true">
    <polygon points="${areaPoints}" fill="var(--sparkline-fill, rgba(76,175,80,0.15))" stroke="none"/>
    <polyline points="${points}" fill="none" stroke="var(--sparkline-color, #4caf50)" stroke-width="2" stroke-linejoin="round"/>
  </svg>`
}

export function setContextUsagePanel(element: HTMLElement): void {
  contextUsagePanelElement = element
  if (currentUsage) renderContextUsagePanel(currentUsage)
}

function postMessage(msg: Record<string, unknown>): void {
  _postMessage(msg)
}

export { setupContextUsagePanel as default }
