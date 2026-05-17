export interface WelcomeViewEls {
  welcomeView: HTMLElement
  welcomeNewBtn: HTMLButtonElement
  welcomeModelCtx: HTMLElement | null
  welcomeContinueBtn: HTMLButtonElement | null
  welcomeModelName: HTMLElement | null
  welcomeSearchInput: HTMLElement | null
  promptInput: HTMLTextAreaElement
}

export interface WelcomeViewDeps {
  els: WelcomeViewEls
  postMessage: (msg: Record<string, unknown>) => void
  getAllSessions: () => Array<{ id: string; name?: string; messages: Array<{ timestamp?: number }>; cost?: number }>
  getState: () => { globalModel?: string; activeSessionId?: string }
  openModelManager: () => void
  renderRecentSessionsList: (query?: string) => void
  hideStatusStrip: () => void
  applyTimelineVisibility: (sessionId?: string) => void
  autoResizeTextarea: () => void
  updateSendButton: () => void
}

export function showWelcomeView(deps: WelcomeViewDeps): void {
  deps.els.welcomeView.classList.remove("hidden")
  deps.hideStatusStrip()
  deps.renderRecentSessionsList()
  renderWelcomeContext(deps)
  deps.applyTimelineVisibility()
}

export function hideWelcomeView(els: WelcomeViewEls): void {
  els.welcomeView.classList.add("hidden")
}

export function renderWelcomeContext(deps: WelcomeViewDeps): void {
  const globalModel = deps.getState().globalModel
  if (globalModel && deps.els.welcomeModelName) {
    const parts = globalModel.split("/")
    deps.els.welcomeModelName.textContent = parts[parts.length - 1] ?? globalModel
  }
  const hasSessions = deps.getAllSessions().some((s) => s.messages.length > 0)
  if (deps.els.welcomeContinueBtn) {
    deps.els.welcomeContinueBtn.classList.toggle("hidden", !hasSessions)
  }
}

export function setupWelcomeActions(deps: WelcomeViewDeps): void {
  deps.els.welcomeNewBtn.addEventListener("click", () => {
    deps.postMessage({ type: "new_session" })
  })
  deps.els.welcomeModelCtx?.addEventListener("click", () => {
    deps.openModelManager()
    deps.postMessage({ type: "get_models" })
  })
  deps.els.welcomeContinueBtn?.addEventListener("click", () => {
    const mostRecent = deps.getAllSessions()
      .filter((s) => s.messages.length > 0)
      .sort((a, b) => {
        const tA = a.messages[a.messages.length - 1]?.timestamp ?? 0
        const tB = b.messages[b.messages.length - 1]?.timestamp ?? 0
        return tB - tA
      })[0]
    if (mostRecent) {
      deps.postMessage({ type: "resume_session", sessionId: mostRecent.id })
    }
  })

  if (deps.els.welcomeSearchInput) {
    const searchInput = deps.els.welcomeSearchInput
    const innerInput = searchInput.querySelector<HTMLInputElement>("input")

    const clearSessionSearch = () => {
      if (innerInput) innerInput.value = ""
      deps.renderRecentSessionsList("")
    }

    if (innerInput) {
      let sessionSearchDebounce: ReturnType<typeof setTimeout> | null = null
      innerInput.addEventListener("input", (e) => {
        const raw = (e.target as HTMLInputElement).value
        const query = raw.trim()
        if (sessionSearchDebounce) clearTimeout(sessionSearchDebounce)
        if (query.length === 0) {
          deps.renderRecentSessionsList("")
          return
        }
        sessionSearchDebounce = setTimeout(() => {
          deps.renderRecentSessionsList(query)
        }, 150)
      })
      innerInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          if (sessionSearchDebounce) clearTimeout(sessionSearchDebounce)
          clearSessionSearch()
          return
        }
        if (e.key === "Enter") {
          const firstResult = document.querySelector<HTMLElement>("#welcome-recent-sessions .recent-item[data-session-id]")
          if (firstResult) {
            e.preventDefault()
            firstResult.click()
          }
          return
        }
        if (e.key === "ArrowDown") {
          const firstResult = document.querySelector<HTMLElement>("#welcome-recent-sessions .recent-item[data-session-id]")
          if (firstResult) {
            e.preventDefault()
            firstResult.focus()
          }
        }
      })
    }
  }

  const greetingEl = document.getElementById("welcome-greeting") as HTMLElement | null
  if (greetingEl) {
    const hour = new Date().getHours()
    let greeting = "Good morning"
    if (hour >= 12 && hour < 18) greeting = "Good afternoon"
    else if (hour >= 18) greeting = "Good evening"
    greetingEl.textContent = greeting
    greetingEl.style.display = "block"
  }
}

export function setupWelcomeSuggestions(deps: WelcomeViewDeps): void {
  deps.els.welcomeView.addEventListener("click", (e) => {
    const target = e.target as HTMLElement
    const card = target.closest(".prompt-starter") as HTMLButtonElement
    if (card && card.dataset.prompt) {
      deps.els.promptInput.value = card.dataset.prompt
      deps.autoResizeTextarea()
      deps.updateSendButton()
      deps.els.promptInput.focus()
    }
  })
}

