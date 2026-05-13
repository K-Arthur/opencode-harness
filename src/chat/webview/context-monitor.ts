import type { ElementRefs } from "./dom"

export interface ContextMonitorHandlers {
  open: () => void
  close: () => void
  toggle: () => void
  requestHistory: (days?: number, sessionId?: string) => void
  requestCostEstimate: (pendingTokens: number) => void
  requestSuggestions: (days?: number) => void
}

export function setupContextMonitor(els: ElementRefs, postMessage: (msg: Record<string, unknown>) => void): ContextMonitorHandlers {
  let isOpen = false
  const panel = els.contextMonitorPanel
  const closeBtn = els.contextMonitorClose
  const historyGraph = els.contextMonitorHistoryGraph
  const costDisplay = els.contextMonitorCostDisplay
  const suggestionsPanel = els.contextMonitorSuggestionsPanel

  function open(): void {
    if (!panel) return
    isOpen = true
    panel.classList.remove("hidden")
    // Request initial data
    postMessage({ type: "context_history_request", days: 7 })
    postMessage({ type: "context_suggestions_request", days: 7 })
  }

  function close(): void {
    if (!panel) return
    isOpen = false
    panel.classList.add("hidden")
  }

  function toggle(): void {
    isOpen ? close() : open()
  }

  function requestHistory(days: number = 7, sessionId?: string): void {
    postMessage({ type: "context_history_request", days, sessionId })
  }

  function requestCostEstimate(pendingTokens: number): void {
    postMessage({ type: "context_cost_estimate", pendingTokens })
  }

  function requestSuggestions(days: number = 7): void {
    postMessage({ type: "context_suggestions_request", days })
  }

  function renderHistoryGraph(history: any[]): void {
    if (!historyGraph) return

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("width", "100%")
    svg.setAttribute("height", "60")
    svg.setAttribute("viewBox", "0 0 200 60")
    svg.setAttribute("preserveAspectRatio", "none")

    if (history.length === 0) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text")
      text.setAttribute("x", "50%")
      text.setAttribute("y", "50%")
      text.setAttribute("text-anchor", "middle")
      text.setAttribute("dominant-baseline", "middle")
      text.setAttribute("fill", "var(--vscode-descriptionForeground)")
      text.setAttribute("font-size", "10")
      text.textContent = "No history"
      svg.appendChild(text)
      historyGraph.innerHTML = ""
      historyGraph.appendChild(svg)
      return
    }

    const maxTokens = Math.max(...history.map((h) => h.tokens))
    const points = history.map((h, i) => {
      const x = (i / (history.length - 1 || 1)) * 200
      const y = 60 - (h.tokens / maxTokens) * 50
      return `${x},${y}`
    }).join(" ")

    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline")
    polyline.setAttribute("points", points)
    polyline.setAttribute("fill", "none")
    polyline.setAttribute("stroke", "var(--vscode-textLink-foreground)")
    polyline.setAttribute("stroke-width", "2")
    svg.appendChild(polyline)

    historyGraph.innerHTML = ""
    historyGraph.appendChild(svg)
  }

  function renderCostDisplay(statistics: any): void {
    if (!costDisplay) return

    const totalCost = statistics.totalCost || 0
    const avgCost = statistics.averageCostPerSession || 0

    costDisplay.innerHTML = `
      <div class="cost-summary">
        <span class="cost-label">Total Cost:</span>
        <span class="cost-value">$${totalCost.toFixed(4)}</span>
      </div>
      <div class="cost-summary">
        <span class="cost-label">Avg/Session:</span>
        <span class="cost-value">$${avgCost.toFixed(4)}</span>
      </div>
    `
  }

  function renderSuggestions(suggestions: any[]): void {
    if (!suggestionsPanel) return

    suggestionsPanel.innerHTML = ""

    if (suggestions.length === 0) {
      const empty = document.createElement("div")
      empty.className = "suggestions-empty"
      empty.textContent = "No suggestions at this time"
      suggestionsPanel.appendChild(empty)
      return
    }

    suggestions.forEach((suggestion) => {
      const item = document.createElement("div")
      item.className = `suggestion-item priority-${suggestion.priority}`
      
      const title = document.createElement("div")
      title.className = "suggestion-title"
      title.textContent = suggestion.title
      
      const description = document.createElement("div")
      description.className = "suggestion-description"
      description.textContent = suggestion.description
      
      item.appendChild(title)
      item.appendChild(description)
      suggestionsPanel.appendChild(item)
    })
  }

  // Listen for messages from extension
  window.addEventListener("message", (event) => {
    const msg = event.data
    if (!msg) return

    if (msg.type === "context_history_response") {
      renderHistoryGraph(msg.history || [])
      if (msg.statistics) renderCostDisplay(msg.statistics)
    } else if (msg.type === "context_suggestions_response") {
      renderSuggestions(msg.suggestions || [])
    }
  })

  // Event listeners
  if (closeBtn) {
    closeBtn.addEventListener("click", close)
  }

  // Close on Escape
  if (panel) {
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault()
        close()
      }
    })
  }

  // Close on overlay click
  if (panel) {
    panel.addEventListener("click", (e) => {
      if (e.target === panel) {
        close()
      }
    })
  }

  return {
    open,
    close,
    toggle,
    requestHistory,
    requestCostEstimate,
    requestSuggestions,
  }
}
