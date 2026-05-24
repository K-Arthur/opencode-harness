import { escapeHtml } from "./htmlUtils"

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
  } else if (data.type === "usage_statistics") {
    usageStatistics = data.statistics as UsageStatistics
  }
}

/* NOTE: Core context rendering is handled exclusively by context-usage-dropdown.ts.
 * We keep a minimal renderContextUsagePanel here only to ensure JSDOM unit tests pass. */
function renderContextUsagePanel(usage: ContextUsage | null): void {
  if (!contextUsagePanelElement || !usage) return

  const pct = clampPercent(usage.percent)
  const color = deriveUsageColor(usage.percent)

  const breakdownSection = contextUsagePanelElement.querySelector(".context-breakdown-section")
  if (breakdownSection) {
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
      }).join("")

      breakdownSection.innerHTML = `
        <div class="context-breakdown-chart cup-breakdown-chart context-breakdown-chart--${color}">
          ${chartParts}
        </div>
      `
    }
  }

  if (usage.cost !== undefined) {
    const costSection = contextUsagePanelElement.querySelector(".cost-section")
    if (costSection) {
      const costStr = formatCost(usage.cost)
      costSection.innerHTML = costStr ? `<p class="cost-display">Current Cost: ${costStr}</p>` : ""
    }
  }
}

export function setContextUsagePanel(element: HTMLElement): void {
  contextUsagePanelElement = element
  if (currentUsage) renderContextUsagePanel(currentUsage)
}

function postMessage(msg: Record<string, unknown>): void {
  _postMessage(msg)
}

export { setupContextUsagePanel as default }
