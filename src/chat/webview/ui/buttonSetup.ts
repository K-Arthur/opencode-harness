export interface ButtonSetupEls {
  historyBtn: HTMLElement
  sessionModal: HTMLDivElement
  sessionModalBody: HTMLDivElement
  mcpBtn: HTMLElement
  themeCustomizerBtn: HTMLElement
  permConfigBtn: HTMLElement
  providerPanelBtn: HTMLElement | null
  settingsBtn: HTMLElement
  settingsMenu: HTMLElement
  checkpointPanel: HTMLElement | null
  todosToggleBtn: HTMLElement
  todosPanel: HTMLElement
  changedFilesList: HTMLElement | null
  attachBtn: HTMLElement
  skillsBtn: HTMLElement | null
}

export interface ButtonSetupDeps {
  els: ButtonSetupEls
  postMessage: (msg: Record<string, unknown>) => void
  closeSettingsMenu: () => void
  openMcpConfig: () => void
  openThemeCustomizer: () => void
  openPermissionConfig: () => void
  openProviderPanel: () => void
  getActiveSessionId: () => string | undefined
  skillsModalOpen: (() => void) | undefined
  /** Fired when the user toggles the todos panel via the toolbar button.
   *  `willBeVisible` indicates the post-toggle state. */
  onTodosToggle?: (willBeVisible: boolean) => void
  /** Toggle the side region for the todos tab. Returns true if now visible. */
  onTodosToggleRequest?: () => boolean
}

export function setupButtons(deps: ButtonSetupDeps): void {
  deps.els.historyBtn.addEventListener("click", () => {
    deps.els.sessionModal.classList.remove("hidden")
    deps.els.sessionModalBody.innerHTML = '<div class="modal-empty">Loading sessions...</div>'
    deps.postMessage({ type: "list_sessions" })
  })

  deps.els.mcpBtn.addEventListener("click", () => {
    deps.closeSettingsMenu()
    deps.openMcpConfig()
    deps.postMessage({ type: "open_mcp_config" })
  })

  deps.els.themeCustomizerBtn.addEventListener("click", () => {
    deps.closeSettingsMenu()
    deps.openThemeCustomizer()
  })

  deps.els.permConfigBtn?.addEventListener("click", () => {
    deps.closeSettingsMenu()
    deps.openPermissionConfig()
  })

  deps.els.providerPanelBtn?.addEventListener("click", () => {
    deps.closeSettingsMenu()
    deps.openProviderPanel()
    deps.postMessage({ type: "discover_providers" })
    deps.postMessage({ type: "list_provider_credentials" })
  })

  deps.els.settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    const isExpanded = deps.els.settingsBtn.getAttribute("aria-expanded") === "true"
    deps.els.settingsBtn.setAttribute("aria-expanded", String(!isExpanded))
    deps.els.settingsMenu.classList.toggle("hidden", isExpanded)
  })

  document.addEventListener("click", (e) => {
    if (
      !deps.els.settingsMenu.classList.contains("hidden") &&
      !deps.els.settingsMenu.contains(e.target as Node) &&
      e.target !== deps.els.settingsBtn
    ) {
      deps.closeSettingsMenu()
    }
  })

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !deps.els.settingsMenu.classList.contains("hidden")) {
      deps.closeSettingsMenu()
      deps.els.settingsBtn.focus()
    }
  })

  deps.els.settingsMenu.querySelectorAll<HTMLElement>('button[role="menuitem"]:not([role="menuitemcheckbox"])')
    .forEach((item) => {
      item.addEventListener("click", () => {
        deps.closeSettingsMenu()
      })
    })

  const checkpointToggle = document.getElementById("checkpoint-toggle-btn")
  checkpointToggle?.addEventListener("click", () => {
    const panel = deps.els.checkpointPanel
    if (!panel) return
    const showing = !panel.classList.contains("hidden")
    panel.classList.toggle("hidden", showing)
    checkpointToggle.setAttribute("aria-pressed", String(!showing))
    if (!showing) {
      const sessionId = deps.getActiveSessionId()
      if (sessionId) deps.postMessage({ type: "list_checkpoints", sessionId })
    }
  })

  deps.els.todosToggleBtn.addEventListener("click", () => {
    const showing = deps.onTodosToggleRequest?.() ?? false
    deps.els.todosToggleBtn.setAttribute("aria-pressed", String(showing))
    if (showing) {
      const sessionId = deps.getActiveSessionId()
      if (sessionId) {
        deps.postMessage({ type: "get_todos", sessionId })
        deps.postMessage({ type: "get_changed_files", sessionId })
      }
    }
  })

  deps.els.skillsBtn?.addEventListener("click", () => {
    if (deps.skillsModalOpen) {
      deps.skillsModalOpen()
      deps.postMessage({ type: "get_skills" })
    }
  })

  const filesToggle = document.getElementById("files-toggle-btn")
  filesToggle?.addEventListener("click", () => {
    deps.els.changedFilesList?.classList.toggle("hidden")
  })

  deps.els.attachBtn.addEventListener("click", () => {
    deps.postMessage({ type: "attach_files" })
  })
}
