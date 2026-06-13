export interface SettingsMenuEls {
  settingsBtn: HTMLElement
  settingsMenu: HTMLElement
  modelManagerPanel: HTMLElement
  themeCustomizerPanel: HTMLElement
  mcpConfigPanel: HTMLElement
  sessionModal: HTMLElement
}

export interface SettingsMenuDeps {
  els: SettingsMenuEls
  closeModelManager: () => void
  closeThemeCustomizer: () => void
  closeMcpConfig: () => void
  closeSessionModal: () => void
}

export function closeSettingsMenu(els: { settingsMenu: HTMLElement; settingsBtn: HTMLElement }): void {
  els.settingsMenu.classList.add("hidden")
  els.settingsBtn.setAttribute("aria-expanded", "false")
}

export function closeCurrentModal(deps: SettingsMenuDeps): void {
  if (!deps.els.modelManagerPanel.classList.contains("hidden")) {
    deps.closeModelManager()
  } else if (!deps.els.themeCustomizerPanel.classList.contains("hidden")) {
    deps.closeThemeCustomizer()
  } else if (!deps.els.mcpConfigPanel.classList.contains("hidden")) {
    deps.closeMcpConfig()
  } else if (!deps.els.sessionModal.classList.contains("hidden")) {
    deps.closeSessionModal()
  }
}

export function setupSettingsMenuKeyboardNav(els: { settingsMenu: HTMLElement; settingsBtn: HTMLElement }, closeSettingsMenuFn: () => void): void {
  const items = els.settingsMenu.querySelectorAll<HTMLElement>("button, [role='menuitem']")
  const firstItem = items[0]
  const lastItem = items[items.length - 1]
  els.settingsMenu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSettingsMenuFn()
      els.settingsBtn.focus()
      return
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const current = document.activeElement
      const idx = Array.from(items).indexOf(current as HTMLElement)
      if (idx === -1) { firstItem?.focus(); return }
      const next = e.key === "ArrowDown"
        ? items[(idx + 1) % items.length]
        : items[(idx - 1 + items.length) % items.length]
      next?.focus()
    }
    if (e.key === "Home") { e.preventDefault(); firstItem?.focus() }
    if (e.key === "End") { e.preventDefault(); lastItem?.focus() }
  })
}
