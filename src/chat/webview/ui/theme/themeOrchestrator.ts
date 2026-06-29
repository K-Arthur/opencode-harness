/**
 * Theme customizer orchestrator.
 *
 * Wires together the modal, preset grid, CLI search, color sections, and
 * preview strip into a single cohesive modal. Replaces the legacy
 * `themeCustomizer.ts` module.
 */

import { createThemeState, type ThemePreset } from "./themeState"
import { createThemeModal, type ThemeModalHandle } from "./themeModal"
import { createPresetGrid, type PresetGridApi } from "./presetGrid"
import { createCliSearch, type CliSearchApi, type CliThemeEntry } from "./cliSearch"
import { createColorSections, type ColorSectionsApi } from "./colorSections"
import { createPreviewStrip, type PreviewStripApi } from "./previewStrip"
import {
  createGetThemeConfigMsg,
  createUpdateThemeConfigMsg,
  createListCliThemesMsg,
  createUpdateSwitchWorkbenchThemeMsg,
  asThemeConfigMsg,
  asCliThemesListMsg,
  asThemeConfigErrorMsg,
} from "./themeBridge"

export interface ThemeOrchestratorDeps {
  postMessage: (msg: Record<string, unknown>) => void
  pushUndo: (state: { themePreset: string; themeOverrides: Record<string, string> }) => void
}

/**
 * Create the theme customizer orchestrator.
 *
 * Builds the entire modal DOM dynamically and appends it to `document.body`.
 * The modal is opened/closed via the returned API.
 *
 * @param deps - Dependencies for posting messages to the host.
 * @returns An API for opening/closing the modal and handling host messages.
 */
export function createThemeOrchestrator(deps: ThemeOrchestratorDeps) {
  const state = createThemeState()
  let modal: ThemeModalHandle | null = null
  let presetGrid: PresetGridApi | null = null
  let cliSearch: CliSearchApi | null = null
  let colorSections: ColorSectionsApi | null = null
  let previewStrip: PreviewStripApi | null = null

  function buildDialog(): HTMLDialogElement {
    const dialog = document.createElement("dialog")
    dialog.className = "theme-customizer-dialog"
    dialog.setAttribute("aria-labelledby", "theme-customizer-title")
    dialog.setAttribute("aria-describedby", "theme-customizer-desc")

    // Header
    const header = document.createElement("div")
    header.className = "theme-customizer-header"
    header.innerHTML = `
      <div class="theme-customizer-header-text">
        <h2 id="theme-customizer-title">Customize theme</h2>
        <p id="theme-customizer-desc">Choose a preset or CLI theme, then override individual colors.</p>
      </div>
      <button class="theme-customizer-close" aria-label="Close theme customizer" type="button">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6 6 18"/><path d="M6 6l12 12"/>
        </svg>
      </button>
    `
    dialog.appendChild(header)

    // Body
    const body = document.createElement("div")
    body.className = "theme-customizer-body"

    // Preset grid
    const presetContainer = document.createElement("fieldset")
    presetContainer.className = "theme-preset-card-grid"
    body.appendChild(presetContainer)

    // CLI search
    const cliSection = document.createElement("div")
    cliSection.innerHTML = `<div class="theme-customizer-section-label">CLI Theme</div>`
    const cliSearchWrap = document.createElement("div")
    cliSearchWrap.className = "theme-cli-search-wrap"
    const cliInput = document.createElement("input")
    cliInput.type = "text"
    cliInput.className = "theme-cli-search-input"
    cliInput.placeholder = "Search CLI themes..."
    cliInput.setAttribute("aria-label", "Search CLI themes")
    cliInput.spellcheck = false
    const cliList = document.createElement("div")
    cliList.className = "theme-cli-list"
    cliSearchWrap.appendChild(cliInput)
    cliSearchWrap.appendChild(cliList)
    cliSection.appendChild(cliSearchWrap)
    body.appendChild(cliSection)

    // Workbench theme toggle
    const toggleWrap = document.createElement("label")
    toggleWrap.className = "theme-workbench-toggle"
    const toggleInput = document.createElement("input")
    toggleInput.type = "checkbox"
    toggleInput.id = "theme-switch-workbench"
    toggleInput.checked = false
    toggleInput.addEventListener("change", () => {
      deps.postMessage(createUpdateSwitchWorkbenchThemeMsg(toggleInput.checked) as unknown as Record<string, unknown>)
    })
    const toggleLabel = document.createElement("span")
    toggleLabel.textContent = "Also switch VS Code theme"
    toggleWrap.appendChild(toggleInput)
    toggleWrap.appendChild(toggleLabel)
    body.appendChild(toggleWrap)

    // Hint
    const hint = document.createElement("div")
    hint.className = "theme-customizer-hint"
    hint.textContent = "Overrides apply immediately in the preview. Use hex, rgba, or CSS variables."
    body.appendChild(hint)

    // Color sections
    const colorContainer = document.createElement("div")
    colorContainer.className = "theme-color-sections"
    body.appendChild(colorContainer)

    // Preview strip
    previewStrip = createPreviewStrip()
    body.appendChild(previewStrip.element)

    dialog.appendChild(body)

    // Actions
    const actions = document.createElement("div")
    actions.className = "theme-customizer-actions"
    actions.innerHTML = `
      <button class="theme-btn--danger" id="theme-reset-btn" type="button">Restore Defaults</button>
      <button class="theme-btn--secondary" id="theme-cancel-btn" type="button">Cancel</button>
      <button class="theme-btn--primary" id="theme-save-btn" type="button">Save</button>
    `
    dialog.appendChild(actions)

    document.body.appendChild(dialog)

    // Wire components
    presetGrid = createPresetGrid(presetContainer, {
      selectedPreset: state.getPreset(),
      onSelect: (preset: ThemePreset) => {
        state.setPreset(preset)
        colorSections?.clearAll()
        previewStrip?.update({})
        deps.postMessage(createUpdateThemeConfigMsg(preset, {}) as unknown as Record<string, unknown>)
      },
    })

    cliSearch = createCliSearch(cliInput, cliList, {
      onSelect: (_theme: CliThemeEntry) => {
        state.setPreset("cli-default")
        presetGrid?.setSelected("cli-default")
        colorSections?.clearAll()
        previewStrip?.update({})
        deps.postMessage(createUpdateThemeConfigMsg("cli-default", {}) as unknown as Record<string, unknown>)
      },
      onFocus: () => {
        deps.postMessage(createListCliThemesMsg() as unknown as Record<string, unknown>)
      },
    })

    colorSections = createColorSections(colorContainer, {
      onChange: (key, value) => {
        state.setOverride(key, value)
        previewStrip?.update(state.getOverrides())
      },
    })

    // Action buttons
    dialog.querySelector("#theme-save-btn")?.addEventListener("click", () => {
      const config = state.getConfig()
      deps.pushUndo({
        themePreset: config.preset,
        themeOverrides: config.overrides,
      })
      deps.postMessage(createUpdateThemeConfigMsg(config.preset, config.overrides) as unknown as Record<string, unknown>)
      modal?.close()
    })

    dialog.querySelector("#theme-cancel-btn")?.addEventListener("click", () => {
      modal?.close()
    })

    dialog.querySelector("#theme-reset-btn")?.addEventListener("click", () => {
      state.snapshot()
      state.setPreset("cli-default")
      state.clearOverrides()
      presetGrid?.setSelected("cli-default")
      colorSections?.clearAll()
      previewStrip?.update({})
      deps.postMessage(createUpdateThemeConfigMsg("cli-default", {}) as unknown as Record<string, unknown>)
    })

    // Modal
    modal = createThemeModal(dialog, {
      initialFocus: presetContainer.querySelector<HTMLElement>(".theme-preset-card"),
      onClose: () => {},
      onBackdropClick: () => modal?.close(),
    })

    return dialog
  }

  function open(): void {
    if (!modal) {
      buildDialog()
    }
    modal?.open()
    // Request the current config from the host to hydrate the state
    deps.postMessage(createGetThemeConfigMsg() as unknown as Record<string, unknown>)
  }

  function close(): void {
    modal?.close()
  }

  /**
   * Handle an incoming host message. Returns `true` if the message was
   * consumed, `false` if it was not a theme message.
   */
  function handleHostMessage(msg: Record<string, unknown>): boolean {
    const configMsg = asThemeConfigMsg(msg)
    if (configMsg) {
      state.hydrate(configMsg.theme)
      presetGrid?.setSelected(state.getPreset())
      colorSections?.setOverrides(state.getOverrides())
      previewStrip?.update(state.getOverrides())
      const toggle = document.getElementById("theme-switch-workbench") as HTMLInputElement | null
      if (toggle && typeof msg.switchWorkbenchTheme === "boolean") {
        toggle.checked = msg.switchWorkbenchTheme
      }
      return true
    }

    const cliMsg = asCliThemesListMsg(msg)
    if (cliMsg) {
      cliSearch?.populate(cliMsg.themes)
      return true
    }

    const errorMsg = asThemeConfigErrorMsg(msg)
    if (errorMsg) {
      console.error(`[opencode-harness] Theme config error: ${errorMsg.error}`)
      return true
    }

    return false
  }

  function dispose(): void {
    presetGrid?.dispose()
    cliSearch?.dispose()
    colorSections?.dispose()
    previewStrip?.dispose()
    modal?.dispose()
    modal = null
    presetGrid = null
    cliSearch = null
    colorSections = null
    previewStrip = null
  }

  return { open, close, handleHostMessage, dispose }
}

export type ThemeOrchestrator = ReturnType<typeof createThemeOrchestrator>
