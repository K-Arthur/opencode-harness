/**
 * Context Usage Dropdown — canonical single implementation.
 *
 * Toolbar button with a percent badge that opens a floating dropdown
 * anchored below the header. Replaces:
 *   - #context-usage-panel (inline panel below status strip)
 *   - #context-monitor-panel (full modal dialog)
 *   - click handler on #context-usage progress bar
 *
 * Pattern: Codex / Claude Code / Cline — toolbar icon → dropdown panel.
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

interface ContextUsage {
  percent: number
  tokens: number
  maxTokens: number
  breakdown?: ContextBreakdown
  projected?: { withQueue: number; overflow: boolean }
  cost?: number
}

let _postMessage: ((msg: Record<string, unknown>) => void) | null = null
let _btn: HTMLButtonElement | null = null
let _panel: HTMLElement | null = null
let _content: HTMLElement | null = null
let _badge: HTMLElement | null = null
let _isOpen = false
let _currentUsage: ContextUsage | null = null
let _outsideClickHandler: ((e: MouseEvent) => void) | null = null
let _keyHandler: ((e: KeyboardEvent) => void) | null = null

export function resetContextUsageDropdown(): void {
  _currentUsage = null
  _isOpen = false
}

export interface ContextUsageDropdownOptions {
  btn: HTMLButtonElement
  panel: HTMLElement
  content: HTMLElement
  badge: HTMLElement
  postMessage: (msg: Record<string, unknown>) => void
}

export function setupContextUsageDropdown(opts: ContextUsageDropdownOptions): void {
  _btn = opts.btn
  _panel = opts.panel
  _content = opts.content
  _badge = opts.badge
  _postMessage = opts.postMessage

  _panel.classList.add("hidden")
  _btn.setAttribute("aria-expanded", "false")
  _updateBadge(0)

  _btn.addEventListener("click", (e) => {
    e.stopPropagation()
    _toggle()
  })

  // Close button inside the dropdown
  const closeBtn = document.getElementById("ctx-dropdown-close")
  if (closeBtn) {
    closeBtn.addEventListener("click", () => _close())
  }
}

export function updateUsage(data: Record<string, unknown>): void {
  if (data.type === "context_usage" || data.type === "context_window_unknown") {
    _currentUsage = data as unknown as ContextUsage
    const pct = _currentUsage?.percent ?? 0
    _updateBadge(pct)
    if (_btn) {
      _btn.classList.toggle("hidden", false)
      _btn.classList.toggle("ctx-btn--active", pct > 0)
      _btn.setAttribute("aria-label", `Context usage (${pct}%)`)
    }
    if (_isOpen && _content) {
      _render(_content, _currentUsage)
    }
  }
}

function _toggle(): void {
  if (_isOpen) _close()
  else _open()
}

function _open(): void {
  if (!_panel || !_content || !_btn) return
  _isOpen = true
  _panel.classList.remove("hidden")
  _btn.setAttribute("aria-expanded", "true")

  // Position dropdown below the button
  const btnRect = _btn.getBoundingClientRect()
  _panel.style.position = "fixed"
  _panel.style.top = `${btnRect.bottom + 4}px`
  const rightEdge = window.innerWidth - btnRect.right
  _panel.style.right = `${rightEdge}px`
  _panel.style.width = "380px"

  _render(_content, _currentUsage)

  _outsideClickHandler = (e: MouseEvent) => {
    if (_panel && _btn && !_panel.contains(e.target as Node) && !_btn.contains(e.target as Node)) {
      _close()
    }
  }
  _keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") _close() }
  requestAnimationFrame(() => {
    document.addEventListener("click", _outsideClickHandler!)
    document.addEventListener("keydown", _keyHandler!)
  })

  _postMessage?.({ type: "get_context_usage" })
}

function _close(): void {
  if (!_panel || !_btn) return
  _isOpen = false
  _panel.classList.add("hidden")
  _btn.setAttribute("aria-expanded", "false")
  if (_outsideClickHandler) document.removeEventListener("click", _outsideClickHandler)
  if (_keyHandler) document.removeEventListener("keydown", _keyHandler)
  _outsideClickHandler = null
  _keyHandler = null
}

function _updateBadge(pct: number): void {
  if (!_badge) return
  _badge.textContent = pct > 0 ? `${pct}%` : ""
  _badge.classList.toggle("hidden", pct === 0)
}

function _render(container: HTMLElement, usage: ContextUsage | null): void {
  if (!usage) {
    container.innerHTML = '<div class="ctx-empty">No context usage data available.</div>'
    return
  }

  const pct = clampPercent(usage.percent)
  const color = deriveUsageColor(usage.percent)

  let criticalHtml = ""
  if (color === "critical") {
    criticalHtml = `<div class="ctx-critical-banner" role="alert">
      <span aria-hidden="true">⚠</span> Context nearly full (${usage.percent}%) — consider compacting or starting a new session.
    </div>`
  }

  let breakdownHtml = ""
  if (usage.breakdown) {
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
      return `<div class="breakdown-segment ${key} cup-segment" style="width:${widths[key]}%" title="${escapeHtml(label)}: ${tokenCount} tokens (${pctStr}%)"></div>`
    }).join("")

    const legendParts = segments.map(({ key, label }) =>
      `<div class="legend-item ${key}">
        <span class="legend-color"></span>
        <span>${escapeHtml(label)} (${formatTokenCount(usage.breakdown![key])})</span>
      </div>`
    ).join("")

    breakdownHtml = `
      <div class="context-breakdown-chart cup-breakdown-chart context-breakdown-chart--${color}">
        ${chartParts}
      </div>
      <div class="breakdown-legend">${legendParts}</div>
    `
  } else {
    breakdownHtml = '<p class="text-muted">No breakdown available.</p>'
  }

  const projectedHtml = usage.projected
    ? `<div class="cup-projected${usage.projected.overflow ? " cup-projected--overflow" : ""}">
        <span class="cup-projected-label">Projected with queue:</span>
        <span class="cup-projected-value">${formatTokenCount(usage.projected.withQueue)} / ${formatTokenCount(usage.maxTokens)}</span>
        ${usage.projected.overflow ? '<span class="cup-overflow-badge">⚠ Overflow</span>' : ""}
      </div>`
    : ""

  const costStr = formatCost(usage.cost)
  const costHtml = costStr
    ? `<div class="cup-cost-row"><span class="cup-cost-label">Session cost:</span><span class="cup-cost-value">${costStr}</span></div>`
    : ""

  const summaryText = buildSummaryText(usage.tokens, usage.maxTokens, usage.percent)
  const radius = 22
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (pct / 100) * circumference

  container.innerHTML = `
    ${criticalHtml}
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
    ${breakdownHtml}
    ${projectedHtml}
  `
}
