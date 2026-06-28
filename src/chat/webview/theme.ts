import type { ContextChip } from "./types"
import type { ElementRefs } from "./dom"
import { timers } from "./timerRegistry"
import { EYE_SVG, EYE_OFF_SVG, REMOVE_SVG } from "./icons"

const warnTheme = (...args: unknown[]) => console.warn("[opencode-harness]", ...args)
const appliedThemeVarKeys = new Set<string>()

export function updateContextChips(els: ElementRefs, chips?: ContextChip[]) {
  if (!els.contextBar || !els.contextChips) {
    warnTheme("Context chip container missing; skipping context chip render")
    return
  }
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
    // Full path/URL on hover — the visible label is only the basename/host,
    // so the tooltip is the user's only way to disambiguate same-named files.
    if (chip.title) el.title = chip.title
    const label = document.createElement("span")
    label.className = "context-chip-label"
    label.textContent = chip.label || ""
    el.appendChild(label)

    // Add toggle button for chips that support on/off state (e.g., active file inclusion)
    if (chip.onToggle) {
      const toggle = document.createElement("button")
      toggle.className = "context-chip-toggle"
      toggle.setAttribute("type", "button")
      const included = chip.isIncluded !== false
      toggle.innerHTML = included ? EYE_SVG : EYE_OFF_SVG
      toggle.setAttribute("aria-label", included ? "Exclude file from context" : "Include file in context")
      toggle.setAttribute("aria-pressed", included ? "true" : "false")
      toggle.addEventListener("click", () => {
        chip.onToggle?.()
      })
      el.appendChild(toggle)
    }

    if (chip.removable !== false) {
      const rem = document.createElement("button")
      rem.className = "context-chip-remove"
      rem.setAttribute("type", "button")
      rem.innerHTML = REMOVE_SVG
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

export function updateContextUsage(contextMonitorEl: HTMLElement, usage?: { percent: number; tokens: number; maxTokens: number; breakdown?: { system: number; history: number; workspace: number; queued?: number; steer?: number }; cost?: number }) {
  if (usage && usage.tokens > 0) {
    contextMonitorEl.classList.remove("hidden")
    const progressFill = contextMonitorEl.querySelector(".context-progress-fill") as HTMLElement
    const contextText = contextMonitorEl.querySelector(".context-text") as HTMLElement
    const costText = contextMonitorEl.querySelector(".context-cost") as HTMLElement

    if (usage.maxTokens > 0) {
      // Full display with percentage when maxTokens is known
      if (progressFill) {
        progressFill.style.width = `${usage.percent}%`
        // Update color based on percent
        progressFill.classList.remove("context-warning", "context-critical", "context-good")
        if (usage.percent >= 95) {
          progressFill.classList.add("context-critical")
        } else if (usage.percent >= 80) {
          progressFill.classList.add("context-warning")
        } else if (usage.percent >= 50) {
          progressFill.classList.add("context-good")
        }
      }

      if (contextText) {
        contextText.textContent = `${usage.percent}% (${usage.tokens.toLocaleString()} / ${usage.maxTokens.toLocaleString()})`
        if (usage.breakdown) {
          const breakdownText = [
            `System: ${usage.breakdown.system.toLocaleString()} tok`,
            `History: ${usage.breakdown.history.toLocaleString()} tok`,
            `Workspace: ${usage.breakdown.workspace.toLocaleString()} tok`,
          ]
          if (usage.breakdown.queued) breakdownText.push(`Queued: ${usage.breakdown.queued.toLocaleString()} tok`)
          if (usage.breakdown.steer) breakdownText.push(`Steer: ${usage.breakdown.steer.toLocaleString()} tok`)
          contextText.title = breakdownText.join("\n")
        }
      }
    } else {
      // Tokens-only display when maxTokens is unknown.
      // Make the row clickable so the user can fix it with one click —
      // the previous version dropped a tooltip pointing them at a
      // command they had to find via the palette themselves.
      if (progressFill) {
        progressFill.style.width = "0%"
        progressFill.classList.remove("context-warning", "context-critical", "context-good")
      }
      if (contextText) {
        contextText.textContent = `${usage.tokens.toLocaleString()} tok · set limit`
        contextText.title = "Context window limit not reported by server or OpenRouter cache. Click to set a manual override."
        contextText.classList.add("context-text--unknown-limit")
        contextMonitorEl.classList.add("context-monitor--needs-override")
        contextMonitorEl.dataset.needsOverride = "true"
      } else {
        contextMonitorEl.classList.remove("context-monitor--needs-override")
        delete contextMonitorEl.dataset.needsOverride
      }
    }

    if (costText && usage.cost !== undefined) {
      costText.textContent = `$${usage.cost.toFixed(4)}`
      costText.title = `Estimated cost for current context: $${usage.cost.toFixed(4)}`
    }
  } else {
    contextMonitorEl.classList.add("hidden")
  }
}

export function applyThemeVars(vars?: Record<string, string>) {
  if (!vars || typeof vars !== "object") return
  const root = document.documentElement
  const nextKeys = new Set<string>()
  for (const [key, val] of Object.entries(vars)) {
    if (typeof val !== "string") continue
    // Only allow valid CSS custom properties (must start with --)
    if (!key.startsWith("--")) {
      warnTheme("[OpenCode] Rejected non-custom CSS property:", key)
      continue
    }
    // Block dangerous CSS values that could exfiltrate data
    if (/url\(|expression\(|javascript:|data:text\/html/i.test(val)) {
      warnTheme("[OpenCode] Blocked unsafe CSS value for:", key)
      continue
    }
    nextKeys.add(key)
    root.style.setProperty(key, val)
  }
  for (const key of appliedThemeVarKeys) {
    if (!nextKeys.has(key)) root.style.removeProperty(key)
  }
  appliedThemeVarKeys.clear()
  for (const key of nextKeys) appliedThemeVarKeys.add(key)
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
  const rateLimitBar = document.getElementById("rate-limit-bar")
  if (rateLimitBar) {
    rateLimitBar.textContent = "Rate limit exceeded. " + resetMsg
    rateLimitBar.classList.remove("hidden")
  }

  if (resetAt) {
    const now = Date.now()
    const resetTime = new Date(resetAt).getTime()
    const delay = Math.max(resetTime - now, 30000)
    timers.setTimeout(() => {
      if (rateLimitBar) rateLimitBar.classList.add("hidden")
      ;(els.sendBtn as HTMLButtonElement).disabled = false
    }, delay)
  }
}
