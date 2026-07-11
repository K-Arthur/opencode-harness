export interface WelcomeViewEls {
  welcomeView: HTMLElement
  welcomeNewBtn: HTMLButtonElement
  welcomeTempBtn?: HTMLButtonElement | null
  welcomeModelCtx: HTMLElement | null
  welcomeContinueBtn: HTMLButtonElement | null
  welcomeModelName: HTMLElement | null
  welcomeSearchInput: HTMLElement | null
  promptInput: HTMLTextAreaElement
  welcomeModelEmptyBanner: HTMLElement | null
  welcomeEmptyBannerLink: HTMLElement | null
}

export interface WelcomeViewDeps {
  els: WelcomeViewEls
  postMessage: (msg: Record<string, unknown>) => void
  getAllSessions: () => Array<{ id: string; name?: string; messages: Array<{ timestamp?: number }>; cost?: number }>
  getState: () => { globalModel?: string; activeSessionId?: string }
  openModelManager: () => void
  sendMessage?: () => void
  /**
   * Resolve the model to show on the welcome card when `globalModel` has not
   * arrived yet — falls back to the active session model or the model the
   * picker is currently displaying. Keeps the card from being stuck on
   * "No model selected" during the init/model-list race.
   */
  getResolvedModel?: () => string | undefined
  renderRecentSessionsList: (query?: string) => void
  hideStatusStrip: () => void
  applyTimelineVisibility: (sessionId?: string) => void
  autoResizeTextarea: () => void
  updateSendButton: () => void
  onDeleteRecentSession?: (sessionId: string) => void
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
  // Prefer the global model, but fall back to whatever the picker/active
  // session resolves to so the card is never stuck on "No model selected"
  // when init_state arrives before the model list (or carries an empty model).
  const model = deps.getState().globalModel || deps.getResolvedModel?.() || ""
  if (deps.els.welcomeModelName) {
    if (model) {
      const parts = model.split("/")
      deps.els.welcomeModelName.textContent = parts[parts.length - 1] ?? model
    } else {
      deps.els.welcomeModelName.textContent = "No model selected"
    }
  }
  const hasSessions = deps.getAllSessions().some((s) => s.messages.length > 0)
  if (deps.els.welcomeContinueBtn) {
    deps.els.welcomeContinueBtn.classList.toggle("hidden", !hasSessions)
  }
  // NOTE: the history search box is intentionally always visible — it queries
  // the host/server (`list_sessions`), which can have far more history than the
  // webview's local `getAllSessions()`. Hiding it on local-empty would wrongly
  // suppress search for users whose sessions simply aren't loaded locally yet.
  // Toggle the empty-model action banner
  if (deps.els.welcomeModelEmptyBanner) {
    deps.els.welcomeModelEmptyBanner.classList.toggle("hidden", !!model)
  }
}

export function setupWelcomeActions(deps: WelcomeViewDeps): void {
  deps.els.welcomeNewBtn.addEventListener("click", () => {
    deps.postMessage({ type: "new_session" })
  })
  deps.els.welcomeTempBtn?.addEventListener("click", () => {
    deps.postMessage({ type: "new_temp_session" })
  })
  if (deps.els.welcomeModelCtx) {
    const openModelPicker = () => {
      deps.openModelManager()
      deps.postMessage({ type: "get_models" })
    }
    deps.els.welcomeModelCtx.addEventListener("click", openModelPicker)
    // The chip is a role=button span — make it keyboard-operable (WCAG 2.1.1).
    deps.els.welcomeModelCtx.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent
      if (ke.key === "Enter" || ke.key === " ") {
        ke.preventDefault()
        openModelPicker()
      }
    })
  }
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
    let sessionSearchDebounce: ReturnType<typeof setTimeout> | null = null

    const clearSessionSearch = () => {
      if (innerInput) innerInput.value = ""
      if (sessionSearchDebounce) clearTimeout(sessionSearchDebounce)
      sessionSearchDebounce = null
      deps.renderRecentSessionsList("")
    }

    const submitSessionSearch = () => {
      const query = (innerInput?.value || "").trim()
      if (sessionSearchDebounce) clearTimeout(sessionSearchDebounce)
      sessionSearchDebounce = null
      if (!query) {
        clearSessionSearch()
        return
      }
      deps.renderRecentSessionsList(query)
      deps.postMessage({ type: "list_sessions", query })
    }

    searchInput.addEventListener("click", (e) => {
      // Clicks on the inner <input> just focus it; clicks anywhere else in
      // the wrapper (icon, border, padding) trigger a search. The icon has
      // `pointer-events: none` in CSS, so a click on the icon glyph arrives
      // here with `target === wrapper` rather than the icon itself —
      // matching by descendant of `.search-icon` would miss that.
      const target = e.target as HTMLElement | null
      if (!target || target === innerInput) return
      e.preventDefault()
      submitSessionSearch()
    })

    if (innerInput) {
      innerInput.addEventListener("input", (e) => {
        const raw = (e.target as HTMLInputElement).value
        const query = raw.trim()
        if (sessionSearchDebounce) clearTimeout(sessionSearchDebounce)
        if (query.length === 0) {
          sessionSearchDebounce = null
          deps.renderRecentSessionsList("")
          return
        }
        sessionSearchDebounce = setTimeout(() => {
          deps.renderRecentSessionsList(query)
          deps.postMessage({ type: "list_sessions", query })
          sessionSearchDebounce = null
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
          const query = innerInput.value.trim()
          e.preventDefault()
          if (firstResult && query) {
            firstResult.click()
          } else {
            submitSessionSearch()
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

  // Wire the empty-model banner link to open the model manager
  deps.els.welcomeEmptyBannerLink?.addEventListener("click", () => {
    deps.openModelManager()
    deps.postMessage({ type: "get_models" })
  })

  const recentContainer = document.getElementById("welcome-recent-sessions")
  recentContainer?.addEventListener("recent-session-delete", ((e: CustomEvent) => {
    const sid = e.detail?.sessionId
    if (typeof sid === "string" && sid) {
      deps.onDeleteRecentSession?.(sid)
    }
  }) as EventListener)

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
      // Shift+click fills the textarea only (no auto-submit)
      if (e.shiftKey) {
        deps.els.promptInput.value = card.dataset.prompt
        deps.autoResizeTextarea()
        deps.updateSendButton()
        deps.els.promptInput.focus()
        return
      }
      // Plain click fills + auto-submits
      deps.els.promptInput.value = card.dataset.prompt
      deps.autoResizeTextarea()
      deps.updateSendButton()
      deps.els.promptInput.focus()
      // Use the shared send pipeline (handles no-model case gracefully)
      deps.sendMessage?.()
    }
  })
}

/**
 * Toggle the `.welcome-short` class on the welcome container whenever the
 * welcome panel is too short to comfortably show the tagline + keyboard hint.
 * CSS in welcome.css hides those rows when the class is set.
 *
 * Threshold (350px) is just above the height where the prompt-starter cards
 * begin to crowd against the input area on the standalone-served bundle.
 */
export function setupWelcomeResponsive(deps: WelcomeViewDeps): void {
  const container = deps.els.welcomeView.querySelector<HTMLElement>(".welcome-container")
  if (!container) return

  const SHORT_HEIGHT_PX = 350

  const apply = () => {
    container.classList.toggle("welcome-short", window.innerHeight < SHORT_HEIGHT_PX)
  }

  apply()
  // Use ResizeObserver on documentElement so we react to webview panel resize,
  // not just window resize (VS Code panels resize without firing a window event
  // in some embedding modes).
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => apply())
    ro.observe(document.documentElement)
  }
  window.addEventListener("resize", apply)
}
