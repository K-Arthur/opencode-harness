/**
 * Context Usage Dropdown — floating panel anchored below the status strip.
 * Contains a compact summary, optional breakdown rows, and recovery actions.
 */

import {
  deriveUsageColor,
  formatTokenCount,
  buildSummaryText,
  formatCost,
  formatUsagePercent,
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
  sessionId?: string
  breakdown?: ContextBreakdown
  projected?: { withQueue: number; overflow: boolean }
  cost?: number
  source?: "estimated" | "actual"
  updatedAt?: number
}

let _postMessage: ((msg: Record<string, unknown>) => void) | null = null
let _btn: HTMLButtonElement | null = null
let _panel: HTMLElement | null = null
let _content: HTMLElement | null = null
let _isOpen = false
let _currentUsage: ContextUsage | null = null
let _outsideClickHandler: ((e: MouseEvent) => void) | null = null
let _keyHandler: ((e: KeyboardEvent) => void) | null = null
let _resizeHandler: (() => void) | null = null

export function resetContextUsageDropdown(): void {
  _currentUsage = null
  _isOpen = false
}

export function openContextUsageDropdown(): void {
  _open()
}

export function closeContextUsageDropdownIfOpen(): void {
  if (_isOpen) _close()
}

export interface ContextUsageDropdownOptions {
  btn: HTMLButtonElement | null   // null when status-strip bar is used as the trigger instead
  panel: HTMLElement
  content: HTMLElement
  postMessage: (msg: Record<string, unknown>) => void
}

export function setupContextUsageDropdown(opts: ContextUsageDropdownOptions): void {
  _btn = opts.btn
  _panel = opts.panel
  _content = opts.content
  _postMessage = opts.postMessage

  _panel.classList.add("hidden")
  if (_btn) {
    _btn.setAttribute("aria-expanded", "false")
    _btn.addEventListener("click", (e) => {
      e.stopPropagation()
      _toggle()
    })
  }

  // Close button inside the dropdown
  const closeBtn = document.getElementById("ctx-dropdown-close")
  if (closeBtn) {
    closeBtn.addEventListener("click", () => _close())
  }
}

export function updateUsage(data: Record<string, unknown>): void {
  if (data.type === "context_usage" || data.type === "context_window_unknown") {
    _currentUsage = normalizeUsage(data)
    const pct = _currentUsage?.percent ?? 0
    if (_btn) {
      _btn.classList.toggle("hidden", false)
      _btn.classList.toggle("ctx-btn--active", pct > 0)
      _btn.setAttribute("aria-label", `Context usage (${formatUsagePercent(pct)})`)
    }
    if (_isOpen && _content) {
      _render(_content, _currentUsage)
    }
  }
}

function normalizeUsage(data: Record<string, unknown>): ContextUsage {
  const percent = typeof data.percent === "number" && Number.isFinite(data.percent) ? data.percent : 0
  const tokens = typeof data.tokens === "number" && Number.isFinite(data.tokens) ? Math.max(0, data.tokens) : 0
  const maxTokens = typeof data.maxTokens === "number" && Number.isFinite(data.maxTokens) ? Math.max(0, data.maxTokens) : 0
  const cost = typeof data.cost === "number" && Number.isFinite(data.cost) ? data.cost : undefined
  const sessionId = typeof data.sessionId === "string" ? data.sessionId : undefined
  const breakdown = data.breakdown && typeof data.breakdown === "object"
    ? data.breakdown as ContextBreakdown
    : undefined
  const projected = data.projected && typeof data.projected === "object"
    ? data.projected as { withQueue: number; overflow: boolean }
    : undefined
  const source = data.source === "actual" ? "actual" : data.source === "estimated" ? "estimated" as const : undefined
  const updatedAt = typeof data.updatedAt === "number" ? data.updatedAt : undefined
  return { percent, tokens, maxTokens, sessionId, breakdown, projected, cost, source, updatedAt }
}

function _toggle(): void {
  if (_isOpen) _close()
  else _open()
}

function _open(): void {
  if (!_panel || !_content) return
  _isOpen = true
  _panel.classList.remove("hidden")
  if (_btn) _btn.setAttribute("aria-expanded", "true")

  // Anchor below the trigger (toolbar button or status-strip bar)
  const anchor = _btn ?? document.getElementById("context-usage")
  if (anchor) positionPanel(anchor)

  _render(_content, _currentUsage)

  _outsideClickHandler = (e: MouseEvent) => {
    const trigger = _btn ?? document.getElementById("context-usage")
    if (_panel && !_panel.contains(e.target as Node) && !trigger?.contains(e.target as Node)) {
      _close()
    }
  }
  _keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") _close() }
  _resizeHandler = () => {
    const trigger = _btn ?? document.getElementById("context-usage")
    if (_isOpen && trigger) positionPanel(trigger)
  }
  requestAnimationFrame(() => {
    document.addEventListener("click", _outsideClickHandler!)
    document.addEventListener("keydown", _keyHandler!)
    window.addEventListener("resize", _resizeHandler!)
  })

  _postMessage?.({
    type: "get_context_usage",
    sessionId: _currentUsage?.sessionId,
  })
}

function positionPanel(anchor: Element): void {
  if (!_panel) return
  const margin = 8
  const r = anchor.getBoundingClientRect()
  const panelWidth = Math.min(360, Math.max(280, window.innerWidth - margin * 2))
  const estimatedHeight = Math.min(420, Math.max(180, _panel.getBoundingClientRect().height || 320))
  const spaceBelow = window.innerHeight - r.bottom - margin
  const spaceAbove = r.top - margin
  const openAbove = spaceBelow < Math.min(260, estimatedHeight) && spaceAbove > spaceBelow
  const maxHeight = Math.max(180, Math.floor((openAbove ? spaceAbove : spaceBelow) - 4))
  const visibleHeight = Math.min(estimatedHeight, maxHeight)
  const left = Math.min(
    Math.max(margin, r.right - panelWidth),
    Math.max(margin, window.innerWidth - panelWidth - margin),
  )
  const top = openAbove
    ? Math.max(margin, r.top - visibleHeight - 6)
    : Math.min(window.innerHeight - margin - visibleHeight, r.bottom + 6)

  _panel.style.position = "fixed"
  _panel.style.left = `${left}px`
  _panel.style.right = "auto"
  _panel.style.top = `${Math.max(margin, top)}px`
  _panel.style.width = `${panelWidth}px`
  _panel.style.maxHeight = `${maxHeight}px`
  _panel.style.overflow = "auto"
}

function _close(): void {
  if (!_panel) return
  _isOpen = false
  _panel.classList.add("hidden")
  if (_btn) _btn.setAttribute("aria-expanded", "false")
  if (_outsideClickHandler) document.removeEventListener("click", _outsideClickHandler)
  if (_keyHandler) document.removeEventListener("keydown", _keyHandler)
  if (_resizeHandler) window.removeEventListener("resize", _resizeHandler)
  _outsideClickHandler = null
  _keyHandler = null
  _resizeHandler = null
}

function _render(container: HTMLElement, usage: ContextUsage | null): void {
  if (!usage) {
    container.innerHTML = '<div class="ctx-empty">No context usage data available.</div>'
    return
  }

  const color = deriveUsageColor(usage.percent)

  let criticalHtml = ""
  if (color === "critical") {
    criticalHtml = `<div class="ctx-critical-banner" role="alert">
      <span aria-hidden="true">⚠</span> Context nearly full (${escapeHtml(formatUsagePercent(usage.percent))}) — consider compacting or starting a new session.
    </div>`
  }

  let breakdownHtml = ""
  if (usage.breakdown) {
    const segments: Array<{ key: keyof ContextBreakdown; label: string }> = [
      { key: "system", label: "System" },
      { key: "history", label: "History" },
      { key: "workspace", label: "Workspace" },
      { key: "queued", label: "Queued" },
      { key: "steer", label: "Steer" },
    ]

    const rows = segments.map(({ key, label }) => {
      const tokenCount = usage.breakdown![key]
      return `<div class="cup-breakdown-row ${key}">
        <span class="cup-breakdown-dot" aria-hidden="true"></span>
        <span class="cup-breakdown-label">${escapeHtml(label)}</span>
        <span class="cup-breakdown-value">${formatTokenCount(tokenCount)}</span>
      </div>`
    }).join("")

    breakdownHtml = `
      <div class="cup-section-title">Breakdown</div>
      <div class="cup-breakdown-list">
        ${rows}
      </div>
    `
  } else {
    breakdownHtml = '<p class="cup-muted">No breakdown available.</p>'
  }

  const projectedHtml = usage.projected
    ? `<div class="cup-projected${usage.projected.overflow ? " cup-projected--overflow" : ""}">
        <span class="cup-projected-label">Projected with queue:</span>
        <span class="cup-projected-value">${formatTokenCount(usage.projected.withQueue)} / ${formatTokenCount(usage.maxTokens)}</span>
        ${usage.projected.overflow ? '<span class="cup-overflow-badge">Overflow</span>' : ""}
      </div>`
    : ""

  const costStr = formatCost(usage.cost)
  const costHtml = costStr
    ? `<div class="cup-cost-row"><span class="cup-cost-label">Session cost:</span><span class="cup-cost-value">${costStr}</span></div>`
    : ""

  const summaryText = buildSummaryText(usage.tokens, usage.maxTokens, usage.percent)
  const sourcePill = usage.source
    ? `<span class="cup-source-pill cup-source-pill--${usage.source}">${usage.source}</span>`
    : ""

  // Actions row — only show actions the host supports
  const sessionId = usage.sessionId ? escapeHtml(usage.sessionId) : ""
  const actionsHtml = `<div class="cup-actions">
    <span class="cup-actions-label">Actions:</span>
    <button class="cup-action-btn" data-action="compact" data-sid="${sessionId}">Compact context</button>
    <button class="cup-action-btn" data-action="new-session">New session</button>
    <button class="cup-action-btn" data-action="switch-model">Switch model</button>
    <button class="cup-action-btn" data-action="set-override">Set limit</button>
  </div>`

  container.innerHTML = `
    ${criticalHtml}
    <div class="cup-header-row">
      <div class="cup-header-text">
        <div class="cup-summary-line">
          <span class="cup-summary-percent cup-summary-percent--${color}">${escapeHtml(formatUsagePercent(usage.percent))}</span>
          <span class="cup-summary-text">${escapeHtml(summaryText)}</span>
          ${sourcePill}
        </div>
        ${costHtml}
      </div>
    </div>
    ${breakdownHtml}
    ${projectedHtml}
    ${actionsHtml}
  `

  // Wire action buttons
  container.querySelectorAll<HTMLButtonElement>(".cup-action-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation()
      const action = btn.dataset.action
      const sid = btn.dataset.sid
      switch (action) {
        case "compact":
          _postMessage?.({ type: "compact_context", sessionId: sid })
          break
        case "new-session":
          _postMessage?.({ type: "new_session" })
          break
        case "switch-model":
          _postMessage?.({ type: "open_model_selector" })
          break
        case "set-override":
          _postMessage?.({ type: "open_context_window_override_dialog" })
          break
      }
    })
  })
}
