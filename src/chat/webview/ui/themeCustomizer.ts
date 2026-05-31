export interface ThemeCustomizerConfig {
  preset?: string
  overrides?: Record<string, string>
}

export interface ThemeCustomizerElements {
  themeCustomizerPanel: HTMLElement
  themeCustomizerClose: HTMLButtonElement
  themePresetCards: HTMLElement
  themeCliSearch: HTMLInputElement
  themeCliList: HTMLElement
  themeCustomizerSave: HTMLButtonElement
  themeCustomizerReset: HTMLButtonElement
  themePreviewSwatch: HTMLElement
}

export interface ThemeCustomizerDeps {
  els: ThemeCustomizerElements
  postMessage: (msg: Record<string, unknown>) => void
  pushUndo: (state: { themePreset: string; themeOverrides: Record<string, string> }) => void
  trapFocus: (container: HTMLElement) => (e: KeyboardEvent) => void
}

const PREVIEW_CSS_VAR_MAP: ReadonlyArray<[string, string]> = [
  ["panelBg", "--oc-bg"],
  ["panelFg", "--oc-fg"],
  ["editorBg", "--oc-editor-bg"],
  ["elementBg", "--oc-element-bg"],
  ["borderColor", "--oc-border"],
  ["mutedFg", "--oc-muted"],
  ["accentColor", "--oc-accent"],
  ["primaryColor", "--oc-primary"],
  ["secondaryColor", "--oc-secondary"],
  ["errorColor", "--oc-error"],
  ["successColor", "--oc-success"],
  ["warningColor", "--oc-warning"],
  ["infoColor", "--oc-info"],
  ["userMessageBg", "--oc-user-msg-bg"],
  ["userMessageFg", "--oc-user-msg-fg"],
  ["assistantMessageBg", "--oc-assistant-msg-bg"],
  ["assistantMessageFg", "--oc-assistant-msg-fg"],
  ["inputBg", "--oc-input-bg"],
  ["inputBorder", "--oc-input-border"],
  ["mentionBg", "--oc-mention-bg"],
  ["toolReadColor", "--tool-read-color"],
  ["toolWriteColor", "--tool-write-color"],
  ["toolExecColor", "--tool-exec-color"],
  ["toolCallColor", "--oc-tool-call-color"],
  ["thinkingBg", "--oc-thinking-bg"],
  ["thinkingBorder", "--oc-thinking-border"],
  ["skillBadgeBg", "--oc-skill-badge-bg"],
  ["skillBadgeFg", "--oc-skill-badge-fg"],
  ["syntaxComment", "--oc-syn-comment"],
  ["syntaxKeyword", "--oc-syn-keyword"],
  ["syntaxString", "--oc-syn-string"],
  ["syntaxNumber", "--oc-syn-number"],
  ["syntaxFunction", "--oc-syn-function"],
  ["syntaxType", "--oc-syn-type"],
  ["syntaxVariable", "--oc-syn-variable"],
  ["syntaxOperator", "--oc-syn-operator"],
  ["syntaxPunctuation", "--oc-syn-punctuation"],
  ["diffAdded", "--oc-diff-added"],
  ["diffRemoved", "--oc-diff-removed"],
  ["diffContext", "--oc-diff-context"],
  ["diffHunkHeader", "--oc-diff-hunk-header"],
  ["diffAddedBg", "--oc-diff-added-bg"],
  ["diffRemovedBg", "--oc-diff-removed-bg"],
  ["markdownHeading", "--oc-markdown-heading"],
  ["markdownLink", "--oc-markdown-link"],
  ["markdownCode", "--oc-markdown-code"],
  ["markdownBlockQuote", "--oc-markdown-blockquote"],
  ["markdownStrong", "--oc-markdown-strong"],
]

let activePreset = "cli-default"
let focusTrap: ((e: KeyboardEvent) => void) | null = null
let lastFocus: HTMLElement | null = null
let cachedEls: ThemeCustomizerElements | null = null

export function setupThemeCustomizer(deps: ThemeCustomizerDeps): void {
  const { els, postMessage, pushUndo, trapFocus } = deps
  cachedEls = els

  els.themeCustomizerClose.addEventListener("click", () => closeThemeCustomizer())
  els.themeCustomizerPanel.addEventListener("click", (event) => {
    if (event.target === els.themeCustomizerPanel) closeThemeCustomizer()
  })
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.themeCustomizerPanel.classList.contains("hidden")) {
      closeThemeCustomizer()
    }
  })

  els.themePresetCards.addEventListener("click", (event) => {
    const card = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-preset]")
    if (!card) return
    activePreset = card.dataset.preset!
    els.themePresetCards.querySelectorAll("[data-preset]").forEach((c) => {
      c.setAttribute("aria-pressed", c === card ? "true" : "false")
    })
    getThemeFields(els).forEach((f) => { f.input.value = "" })
    syncAllColorPickers(els)
    updatePreviewSwatch(els)
    postMessage({ type: "update_theme_config", theme: { preset: activePreset, overrides: {} } })
  })

  let cliListLoaded = false
  els.themeCliSearch.addEventListener("focus", () => {
    if (!cliListLoaded) {
      cliListLoaded = true
      postMessage({ type: "list_cli_themes" })
    }
    els.themeCliList.classList.remove("hidden")
  })
  els.themeCliSearch.addEventListener("input", () => {
    filterCliList(els, els.themeCliSearch.value.trim().toLowerCase())
  })
  document.addEventListener("click", (event) => {
    if (!els.themeCliSearch.contains(event.target as Node) && !els.themeCliList.contains(event.target as Node)) {
      els.themeCliList.classList.add("hidden")
    }
  })

  els.themeCustomizerPanel.addEventListener("input", (event) => {
    const picker = event.target as HTMLInputElement
    if (picker.type !== "color" || !picker.dataset.target) return
    const textInput = document.getElementById(picker.dataset.target) as HTMLInputElement | null
    if (textInput) {
      textInput.value = picker.value
      updatePreviewSwatch(els)
    }
  })

  els.themeCustomizerPanel.addEventListener("change", (event) => {
    const textInput = event.target as HTMLInputElement
    if (textInput.type !== "text" || !textInput.id) return
    const value = textInput.value.trim()
    if (/^#([0-9a-fA-F]{6})$/.test(value)) {
      const picker = els.themeCustomizerPanel.querySelector<HTMLInputElement>(
        `input[type="color"][data-target="${textInput.id}"]`
      )
      if (picker) picker.value = value
    }
    updatePreviewSwatch(els)
  })

  els.themeCustomizerSave.addEventListener("click", () => {
    pushUndo({
      themePreset: activePreset,
      themeOverrides: collectThemeCustomizerConfig(els).overrides ?? {},
    })
    postMessage({ type: "update_theme_config", theme: collectThemeCustomizerConfig(els) })
    closeThemeCustomizer()
  })

  els.themeCustomizerReset.addEventListener("click", () => {
    pushUndo({
      themePreset: activePreset,
      themeOverrides: collectThemeCustomizerConfig(els).overrides ?? {},
    })
    getThemeFields(els).forEach((f) => { f.input.value = "" })
    syncAllColorPickers(els)
    updatePreviewSwatch(els)
    postMessage({ type: "update_theme_config", theme: { preset: activePreset, overrides: {} } })
  })
}

export function openThemeCustomizer(deps: ThemeCustomizerDeps): void {
  const { els, postMessage, trapFocus } = deps
  cachedEls = els
  els.themeCustomizerPanel.classList.remove("hidden")
  postMessage({ type: "get_theme_config" })
  lastFocus = document.activeElement as HTMLElement | null
  focusTrap = trapFocus(els.themeCustomizerPanel)
  document.addEventListener("keydown", focusTrap)
  els.themePresetCards.querySelector<HTMLButtonElement>("[data-preset]")?.focus()
}

export function closeThemeCustomizer(): void {
  const els = cachedEls
  if (els) els.themeCustomizerPanel.classList.add("hidden")
  if (focusTrap) {
    document.removeEventListener("keydown", focusTrap)
    focusTrap = null
  }
  if (lastFocus) {
    lastFocus.focus({ preventScroll: true })
    lastFocus = null
  }
}

export function populateCliList(els: ThemeCustomizerElements, themes: Array<{ name: string; source: string }>, postMessage: (msg: Record<string, unknown>) => void): void {
  els.themeCliList.innerHTML = ""
  if (themes.length === 0) {
    const empty = document.createElement("div")
    empty.className = "theme-cli-empty"
    empty.textContent = "No CLI themes found. Add .json files to ~/.config/opencode/themes/"
    els.themeCliList.appendChild(empty)
    return
  }
  for (const theme of themes) {
    const btn = document.createElement("button")
    btn.className = "theme-cli-row"
    btn.dataset.cliTheme = theme.name
    btn.setAttribute("role", "option")
    btn.innerHTML = `<span class="theme-cli-name">${theme.name}</span><span class="theme-cli-source">${theme.source}</span>`
    btn.addEventListener("click", () => {
      els.themeCliSearch.value = theme.name
      els.themeCliList.classList.add("hidden")
      activePreset = "cli-default"
      els.themePresetCards.querySelectorAll("[data-preset]").forEach((c) => {
        c.setAttribute("aria-pressed", (c as HTMLElement).dataset.preset === "cli-default" ? "true" : "false")
      })
      postMessage({ type: "update_theme_config", theme: { preset: "cli-default", overrides: {} } })
    })
    els.themeCliList.appendChild(btn)
  }
}

export function applyThemeCustomizerConfig(els: ThemeCustomizerElements, theme: ThemeCustomizerConfig | undefined): void {
  activePreset = theme?.preset || "cli-default"
  const overrides = theme?.overrides || {}
  els.themePresetCards.querySelectorAll("[data-preset]").forEach((card) => {
    card.setAttribute("aria-pressed", (card as HTMLElement).dataset.preset === activePreset ? "true" : "false")
  })
  getThemeFields(els).forEach(({ input, key }) => {
    input.value = typeof overrides[key] === "string" ? (overrides[key] as string) : ""
  })
  syncAllColorPickers(els)
  updatePreviewSwatch(els)
}

export function collectThemeCustomizerConfig(els: ThemeCustomizerElements): ThemeCustomizerConfig {
  const overrides: Record<string, string> = {}
  getThemeFields(els).forEach(({ input, key }) => {
    const value = input.value.trim()
    if (value && isValidColorFormat(value)) overrides[key] = value
  })
  return { preset: activePreset, overrides }
}

function getThemeFields(els: ThemeCustomizerElements): Array<{ input: HTMLInputElement; key: string }> {
  return Array.from(
    els.themeCustomizerPanel.querySelectorAll<HTMLInputElement>("input[data-theme-field]")
  ).map((input) => ({ input, key: input.dataset.themeField! }))
}

function filterCliList(els: ThemeCustomizerElements, query: string): void {
  const rows = els.themeCliList.querySelectorAll<HTMLButtonElement>("[data-cli-theme]")
  rows.forEach((row) => {
    const name = (row.dataset.cliTheme ?? "").toLowerCase()
    row.style.display = !query || name.includes(query) ? "" : "none"
  })
}

function syncAllColorPickers(els: ThemeCustomizerElements): void {
  getThemeFields(els).forEach(({ input }) => {
    const picker = els.themeCustomizerPanel.querySelector<HTMLInputElement>(
      `input[type="color"][data-target="${input.id}"]`
    )
    if (picker && /^#[0-9a-fA-F]{6}$/.test(input.value.trim())) {
      picker.value = input.value.trim()
    }
  })
}

function updatePreviewSwatch(els: ThemeCustomizerElements): void {
  const fields = getThemeFields(els)
  const overrides: Record<string, string> = {}
  fields.forEach(({ input, key }) => {
    if (input.value.trim()) overrides[key] = input.value.trim()
  })
  const swatch = els.themePreviewSwatch
  for (const [fieldKey, cssVar] of PREVIEW_CSS_VAR_MAP) {
    const v = overrides[fieldKey]
    if (v) swatch.style.setProperty(cssVar, v)
    else swatch.style.removeProperty(cssVar)
  }
}

function isValidColorFormat(value: string): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (/^var\(--[\w-]+\)$/.test(trimmed)) return true
  if (trimmed === "transparent") return true
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) return true
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/.test(trimmed)) return true
  if (/^hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(,\s*[\d.]+\s*)?\)$/i.test(trimmed)) return true
  if (/^color-mix\(\s*in\s+srgb\s*,/i.test(trimmed)) return true
  return false
}
