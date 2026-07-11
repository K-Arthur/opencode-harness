import { mountModalFocus, type ModalFocusHandle } from "../focus-trap"
import type { ModelInfo } from "../types"

const ROLES = [
  { id: "planning", label: "Planning", description: "Architecture, design, and task breakdown" },
  { id: "implementation", label: "Implementation", description: "Writing code and building features" },
  { id: "review", label: "Review", description: "Code review, quality assessment, and auditing" },
  { id: "debugging", label: "Debugging", description: "Bug investigation, error analysis, and fixes" },
] as const

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
  }
  vscode: {
    postMessage(msg: Record<string, unknown>): void
  }
  getModels(): ModelInfo[]
  getRoleModels(): Partial<Record<string, string>>
  getModeModels(): Record<string, string>
  getGlobalModel(): string
  getSessionModel(): string | undefined
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

  function open() {
    if (isOpen) return
    isOpen = true
    currentRoleModels = { ...deps.getRoleModels() }
    pendingRoleModels = { ...currentRoleModels }
    currentModeModels = { ...deps.getModeModels() }
    currentGlobalModel = deps.getGlobalModel()
    currentSessionModel = deps.getSessionModel()
    currentModels = deps.getModels()
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

  function resetAll() {
    pendingRoleModels = {}
    render()
    showStatus("All phase models reset to defaults (will use session/mode fallback)", "info")
  }

  function save() {
    deps.vscode.postMessage({
      type: "set_role_models",
      roleModels: pendingRoleModels,
    })
    currentRoleModels = { ...pendingRoleModels }
    showStatus("Model routing updated", "success")
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

  function isModelAvailable(modelId: string): boolean {
    if (!modelId || modelId === "—") return true
    return currentModels.some((m) => m.id === modelId || m.displayName === modelId)
  }

  function handleModelInput(roleId: string, value: string) {
    const trimmed = value.trim()
    if (trimmed) {
      pendingRoleModels[roleId] = trimmed
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

  function render() {
    const list = deps.els.modelRoutingList
    list.innerHTML = ""
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

      const input = document.createElement("input")
      input.type = "text"
      input.className = "model-routing-row-input"
      input.id = `model-routing-input-${role.id}`
      input.placeholder = "Auto (use fallback)"
      input.value = pendingRoleModels[role.id] || ""
      input.setAttribute("aria-label", `Model for ${role.label} phase`)
      input.addEventListener("input", () => handleModelInput(role.id, input.value))

      const clearBtn = document.createElement("button")
      clearBtn.className = "model-routing-clear-btn"
      clearBtn.textContent = "×"
      clearBtn.title = `Clear model for ${role.label}`
      clearBtn.setAttribute("aria-label", `Clear ${role.label} model`)
      clearBtn.addEventListener("click", () => {
        input.value = ""
        handleModelInput(role.id, "")
        input.focus()
      })

      inputGroup.appendChild(input)
      inputGroup.appendChild(clearBtn)
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

      if (pendingRoleModels[role.id] && !isModelAvailable(pendingRoleModels[role.id]!)) {
        const warn = document.createElement("div")
        warn.className = "model-routing-row-warning"
        warn.textContent = `⚠ "${pendingRoleModels[role.id]}" not found in available models. Verify the provider/model ID.`
        row.appendChild(warn)
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
  deps.els.modelRoutingPanel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault()
      close()
    }
  })
  deps.els.modelRoutingPanel.addEventListener("click", (e) => {
    if (e.target === deps.els.modelRoutingPanel) close()
  })

  return { open, close }
}
