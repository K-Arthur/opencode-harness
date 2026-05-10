import type { ContextChip, ContextUsage } from "./types"
import type { ElementRefs } from "./dom"

export function updateContextChips(els: ElementRefs, chips?: ContextChip[]) {
  els.contextChips.innerHTML = ""
  if (!chips || chips.length === 0) {
    els.contextBar.classList.add("hidden")
    return
  }
  els.contextBar.classList.remove("hidden")
  chips.forEach((chip) => {
	    const el = document.createElement("span")
	    el.className = "context-chip"
	    if (chip.kind) el.dataset.kind = chip.kind
    const label = document.createElement("span")
    label.textContent = chip.label || ""
    el.appendChild(label)
    if (chip.removable !== false) {
      const rem = document.createElement("button")
      rem.className = "context-chip-remove"
      rem.textContent = "\u00D7"
      rem.setAttribute("aria-label", "Remove context chip")
      rem.addEventListener("click", () => {
        el.remove()
        if (els.contextChips.children.length === 0) {
          els.contextBar.classList.add("hidden")
        }
        if (chip.onRemove) chip.onRemove()
      })
      el.appendChild(rem)
    }
    els.contextChips.appendChild(el)
  })
}

export function updateContextUsage(contextMonitorEl: HTMLElement, usage?: { percent: number; tokens: number; maxTokens: number; breakdown?: { system: number; history: number; workspace: number } }) {
  if (usage && usage.maxTokens > 0) {
    contextMonitorEl.classList.remove("hidden")
    const progressFill = contextMonitorEl.querySelector(".context-progress-fill") as HTMLElement
    const contextText = contextMonitorEl.querySelector(".context-text") as HTMLElement
    
    if (progressFill) {
      progressFill.style.width = `${usage.percent}%`
      // Update color based on percent
      progressFill.classList.remove("context-warning", "context-critical")
      if (usage.percent >= 95) {
        progressFill.classList.add("context-critical")
      } else if (usage.percent >= 80) {
        progressFill.classList.add("context-warning")
      }
    }
    
    if (contextText) {
      contextText.textContent = `Context: ${usage.tokens.toLocaleString()} / ${usage.maxTokens.toLocaleString()}`
      if (usage.breakdown) {
        contextText.title = `System: ${usage.breakdown.system.toLocaleString()} tok\nHistory: ${usage.breakdown.history.toLocaleString()} tok\nWorkspace: ${usage.breakdown.workspace.toLocaleString()} tok`
      }
    }
  } else {
    contextMonitorEl.classList.add("hidden")
  }
}

export function applyThemeVars(vars?: Record<string, string>) {
  if (!vars || typeof vars !== "object") return
  const root = document.documentElement
  for (const [key, val] of Object.entries(vars)) {
    if (typeof val !== "string") continue
    // Only allow valid CSS custom properties (must start with --)
    if (!key.startsWith("--")) {
      console.warn("[OpenCode] Rejected non-custom CSS property:", key)
      continue
    }
    // Block dangerous CSS values that could exfiltrate data
    if (/url\(|expression\(|javascript:|data:text\/html/i.test(val)) {
      console.warn("[OpenCode] Blocked unsafe CSS value for:", key)
      continue
    }
    root.style.setProperty(key, val)
  }
}

export function updateModelIndicator(model?: string) {
  const indicator = document.getElementById("model-indicator")
  if (!indicator) return
  if (model) {
    const short = model.split("/").pop() || model
    indicator.textContent = short
    indicator.title = "Model: " + model
  } else {
    indicator.textContent = ""
  }
}

export function handleRateLimitExhausted(els: ElementRefs, resetAt?: string) {
  ;(els.sendBtn as HTMLButtonElement).disabled = true
  const resetMsg = resetAt ? "Reset at " + resetAt : "Please wait for the rate limit to reset."
  const notification = document.createElement("div")
  notification.className = "rate-limit-notice"
  notification.textContent = "\u26A0 Rate limit exceeded. " + resetMsg
  els.inputArea.appendChild(notification)

  if (resetAt) {
    const now = Date.now()
    const resetTime = new Date(resetAt).getTime()
    const delay = Math.max(resetTime - now, 30000)
    setTimeout(() => {
      const existing = els.inputArea.querySelector(".rate-limit-notice")
      if (existing) existing.remove()
      ;(els.sendBtn as HTMLButtonElement).disabled = false
    }, delay)
  }
}
