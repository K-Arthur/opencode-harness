import { mountModalFocus, type ModalFocusHandle } from "../focus-trap"
import type { ModelInfo } from "../types"

export const ROLES = [
  { id: "planning", label: "Planning", description: "Architecture, design, and task breakdown" },
  { id: "implementation", label: "Implementation", description: "Writing code and building features" },
  { id: "review", label: "Review", description: "Code review, quality assessment, and auditing" },
  { id: "debugging", label: "Debugging", description: "Bug investigation, error analysis, and fixes" },
  { id: "visualReview", label: "Visual Review", description: "UI appearance, design review, and frontend QA" },
] as const

export interface ModelRoutingConfig {
  roleModels: Partial<Record<string, string>>
  modeModels: Record<string, string>
  enabled: boolean
}

export interface ModelRoutingDeps {
  els: {
    modelRoutingPanel: HTMLElement
    modelRoutingClose: HTMLElement
    modelRoutingCloseBtn: HTMLElement
    modelRoutingReset: HTMLElement
    modelRoutingBody: HTMLElement
    modelRoutingList: HTMLElement
    modelRoutingGlobal: HTMLElement
    modelRoutingGlobalValue: HTMLElement
    modelRoutingStatus: HTMLElement
    modelRoutingEnabledCheckbox: HTMLInputElement
  }
  vscode: {
    postMessage(msg: Record<string, unknown>): void
  }
  getModels(): ModelInfo[]
  getRoleModels(): Partial<Record<string, string>>
  getModeModels(): Record<string, string>
  getGlobalModel(): string
  getSessionModel(): string | undefined
  /** Master routing switch — see `opencode.roleModelsEnabled`. Defaults to true until the host's `role_models_config` reply arrives. */
  getRoutingEnabled(): boolean
}

function modelRef(model: ModelInfo): string {
  return `${model.provider}/${model.id}`
}

export function createModelRoutingPanel(deps: ModelRoutingDeps) {
  let isOpen = false
  let focusHandle: ModalFocusHandle | null = null
  let pendingRoleModels: Partial<Record<string, string>> = {}
  let currentRoleModels: Partial<Record<string, string>> = {}
  let currentGlobalModel = ""
  let currentSessionModel: string | undefined
  let currentModeModels: Record<string, string> = {}
  let currentModels: ModelInfo[] = []
  let pendingEnabled = true

  function open() {
    if (isOpen) return
    isOpen = true
    currentRoleModels = { ...deps.getRoleModels() }
    pendingRoleModels = { ...currentRoleModels }
    currentModeModels = { ...deps.getModeModels() }
    currentGlobalModel = deps.getGlobalModel()
    currentSessionModel = deps.getSessionModel()
    currentModels = deps.getModels()
    pendingEnabled = deps.getRoutingEnabled()
    deps.els.modelRoutingEnabledCheckbox.checked = pendingEnabled
    deps.els.modelRoutingPanel.classList.remove("hidden")
    render()
    deps.els.modelRoutingStatus.classList.add("hidden")
    focusHandle = mountModalFocus(deps.els.modelRoutingPanel, {
      initialFocus: deps.els.modelRoutingClose,
    })
  }

  function close() {
    if (!isOpen) return
    isOpen = false
    deps.els.modelRoutingPanel.classList.add("hidden")
    if (focusHandle) {
      focusHandle.release()
      focusHandle = null
    }
  }

  /**
   * Apply config pushed from the host (in reply to `get_role_models`, or
   * echoed back after a save). The panel opens synchronously on click but
   * the real saved settings arrive a tick later over postMessage — without
   * this the panel would render as blank/reset on every open even though
   * the settings were saved correctly last time.
   */
  function applyConfig(config: ModelRoutingConfig) {
    currentRoleModels = { ...config.roleModels }
    pendingRoleModels = { ...config.roleModels }
    currentModeModels = { ...config.modeModels }
    pendingEnabled = config.enabled
    deps.els.modelRoutingEnabledCheckbox.checked = pendingEnabled
    if (isOpen) render()
  }

  function resetAll() {
    pendingRoleModels = {}
    render()
    showStatus("All phase models reset to defaults (will use session/mode fallback)", "info")
  }

  function save() {
    deps.vscode.postMessage({
      type: "set_role_models",
      roleModels: pendingRoleModels,
      enabled: pendingEnabled,
    })
    currentRoleModels = { ...pendingRoleModels }
    showStatus(pendingEnabled ? "Model routing updated" : "Model routing disabled — every prompt now uses your selected model as-is", "success")
  }

  function showStatus(message: string, kind: "info" | "success" | "error") {
    const el = deps.els.modelRoutingStatus
    el.textContent = message
    el.className = "model-routing-status"
    el.classList.add(`model-routing-status--${kind}`)
    el.classList.remove("hidden")
    setTimeout(() => el.classList.add("hidden"), 3000)
  }

  function resolveFallback(roleId: string): string {
    const roleModel = pendingRoleModels[roleId]
    if (roleModel) return roleModel
    const modeModel = currentModeModels[roleId] ?? currentModeModels[roleId === "implementation" ? "build" : ""]
    if (modeModel) return modeModel
    return currentSessionModel || currentGlobalModel || "—"
  }

  function getFallbackChain(roleId: string): string[] {
    const chain: string[] = []
    const roleModel = pendingRoleModels[roleId]
    if (roleModel) chain.push(`Phase: ${roleModel}`)
    const modeModel = currentModeModels[roleId] ?? currentModeModels[roleId === "implementation" ? "build" : ""] ?? currentModeModels["build"]
    if (modeModel && !chain.includes(modeModel)) chain.push(`Mode: ${modeModel}`)
    if (currentSessionModel && !chain.includes(currentSessionModel)) chain.push(`Session: ${currentSessionModel}`)
    if (currentGlobalModel && !chain.includes(currentGlobalModel)) chain.push(`Default: ${currentGlobalModel}`)
    return chain
  }

  function handleModelSelect(roleId: string, value: string) {
    if (value) {
      pendingRoleModels[roleId] = value
    } else {
      delete pendingRoleModels[roleId]
    }
    const row = deps.els.modelRoutingList.querySelector(`[data-role-id="${roleId}"]`)
    if (row) {
      const fallbackEl = row.querySelector(".model-routing-row-fallback") as HTMLElement
      if (fallbackEl) {
        const fallback = resolveFallback(roleId)
        if (pendingRoleModels[roleId]) {
          fallbackEl.textContent = `Overrides default: ${fallback}`
          fallbackEl.className = "model-routing-row-fallback model-routing-row-fallback--overridden"
        } else {
          fallbackEl.textContent = `Falls back to: ${fallback}`
          fallbackEl.className = "model-routing-row-fallback"
        }
      }
    }
  }

  function buildModelOptions(select: HTMLSelectElement, selectedValue: string | undefined) {
    select.innerHTML = ""
    const auto = document.createElement("option")
    auto.value = ""
    auto.textContent = "Auto (use fallback)"
    select.appendChild(auto)

    const seen = new Set<string>()
    const sorted = currentModels
      .filter((m) => m.enabled !== false)
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
    for (const model of sorted) {
      const ref = modelRef(model)
      seen.add(ref)
      const option = document.createElement("option")
      option.value = ref
      option.textContent = `${model.displayName} (${model.provider})`
      select.appendChild(option)
    }

    // A previously-saved model that's no longer in the available list (e.g.
    // the provider was disabled) must still appear as a selectable option —
    // otherwise opening the panel silently drops the user's setting the
    // moment they touch the dropdown.
    if (selectedValue && !seen.has(selectedValue)) {
      const stale = document.createElement("option")
      stale.value = selectedValue
      stale.textContent = `${selectedValue} (not in available models)`
      select.appendChild(stale)
    }

    select.value = selectedValue || ""
  }

  function render() {
    const list = deps.els.modelRoutingList
    list.innerHTML = ""
    list.classList.toggle("model-routing-list--disabled", !pendingEnabled)

    for (const role of ROLES) {
      const row = document.createElement("div")
      row.className = "model-routing-row"
      row.setAttribute("data-role-id", role.id)

      const header = document.createElement("div")
      header.className = "model-routing-row-header"

      const label = document.createElement("div")
      label.className = "model-routing-row-label"
      label.textContent = role.label

      const desc = document.createElement("span")
      desc.className = "model-routing-row-desc"
      desc.textContent = role.description

      label.appendChild(desc)
      header.appendChild(label)

      const inputGroup = document.createElement("div")
      inputGroup.className = "model-routing-row-input-group"

      const select = document.createElement("select")
      select.className = "model-routing-row-select"
      select.id = `model-routing-input-${role.id}`
      select.disabled = !pendingEnabled
      select.setAttribute("aria-label", `Model for ${role.label} phase`)
      buildModelOptions(select, pendingRoleModels[role.id])
      select.addEventListener("change", () => handleModelSelect(role.id, select.value))

      inputGroup.appendChild(select)
      header.appendChild(inputGroup)
      row.appendChild(header)

      const fallback = document.createElement("div")
      fallback.className = "model-routing-row-fallback"
      const resolved = resolveFallback(role.id)
      if (pendingRoleModels[role.id]) {
        fallback.textContent = `Overrides default: ${resolved}`
        fallback.className += " model-routing-row-fallback--overridden"
      } else {
        fallback.textContent = `Falls back to: ${resolved}`
      }
      row.appendChild(fallback)

      const chain = getFallbackChain(role.id)
      if (chain.length > 0) {
        const chainEl = document.createElement("div")
        chainEl.className = "model-routing-row-chain"
        chainEl.textContent = `Chain: ${chain.join(" → ")}`
        row.appendChild(chainEl)
      }

      list.appendChild(row)
    }

    const globalValue = deps.els.modelRoutingGlobalValue
    if (currentGlobalModel) {
      globalValue.textContent = currentGlobalModel
    } else {
      globalValue.textContent = "—"
    }
  }

  deps.els.modelRoutingClose.addEventListener("click", close)
  deps.els.modelRoutingCloseBtn.addEventListener("click", () => {
    save()
    close()
  })
  deps.els.modelRoutingReset.addEventListener("click", resetAll)
  deps.els.modelRoutingEnabledCheckbox.addEventListener("change", () => {
    pendingEnabled = deps.els.modelRoutingEnabledCheckbox.checked
    render()
  })
  deps.els.modelRoutingPanel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault()
      close()
    }
  })
  deps.els.modelRoutingPanel.addEventListener("click", (e) => {
    if (e.target === deps.els.modelRoutingPanel) close()
  })

  return { open, close, applyConfig }
}
