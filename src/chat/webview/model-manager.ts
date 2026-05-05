import type { ModelInfo } from "./types"
import type { ElementRefs } from "./dom"

export interface ModelManagerCallbacks {
  onToggleModel: (modelId: string, enabled: boolean) => void
  onSelectModel: (modelId: string) => void
  onConnectProvider: () => void
}

export function setupModelManager(els: ElementRefs, callbacks: ModelManagerCallbacks) {
  let models: ModelInfo[] = []
  let searchQuery = ""
  let isOpen = false

  const panel = els.modelManagerPanel
  const searchInput = els.modelManagerSearch
  const modelList = els.modelManagerList
  const closeBtn = els.modelManagerClose
  const connectBtn = els.modelManagerConnect

  function open() {
    isOpen = true
    panel.classList.remove("hidden")
    searchInput.value = ""
    searchQuery = ""
    render()
    searchInput.focus()
  }

  function close() {
    isOpen = false
    panel.classList.add("hidden")
  }

  function toggle() {
    isOpen ? close() : open()
  }

  function setModels(newModels: ModelInfo[]) {
    models = newModels
    if (isOpen) render()
  }

  function updateModelEnabled(modelId: string, enabled: boolean) {
    const model = models.find((m) => `${m.provider}/${m.id}` === modelId)
    if (model) {
      model.enabled = enabled
      if (isOpen) render()
    }
  }

  function getEnabledModels(): ModelInfo[] {
    return models.filter((m) => m.enabled !== false)
  }

  function getAllModels(): ModelInfo[] {
    return models
  }

  function render() {
    modelList.innerHTML = ""

    const filtered = filterModels(models, searchQuery)

    if (filtered.length === 0) {
      const empty = document.createElement("div")
      empty.className = "model-manager-empty"
      empty.textContent = "No models found"
      modelList.appendChild(empty)
      return
    }

    // Group by provider
    const byProvider = new Map<string, ModelInfo[]>()
    for (const m of filtered) {
      const list = byProvider.get(m.provider) || []
      list.push(m)
      byProvider.set(m.provider, list)
    }

    for (const [provider, providerModels] of byProvider) {
      const group = document.createElement("div")
      group.className = "model-manager-group"

      const header = document.createElement("div")
      header.className = "model-manager-group-header"
      header.textContent = provider
      group.appendChild(header)

      for (const model of providerModels) {
        const fullId = `${model.provider}/${model.id}`
        const isEnabled = model.enabled !== false

        const row = document.createElement("div")
        row.className = "model-manager-row"

        const name = document.createElement("span")
        name.className = "model-manager-row-name"
        name.textContent = model.displayName
        name.setAttribute("role", "button")
        name.setAttribute("tabindex", "0")
        name.setAttribute("aria-label", `Select ${model.displayName}`)
        name.addEventListener("click", () => {
          callbacks.onSelectModel(fullId)
        })
        name.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            callbacks.onSelectModel(fullId)
          }
        })
        row.appendChild(name)

        const toggle = document.createElement("button")
        toggle.className = "model-manager-toggle" + (isEnabled ? " enabled" : "")
        toggle.setAttribute("aria-label", `${isEnabled ? "Disable" : "Enable"} ${model.displayName}`)
        toggle.setAttribute("aria-pressed", String(isEnabled))
        toggle.setAttribute("role", "switch")

        const track = document.createElement("span")
        track.className = "model-manager-toggle-track"
        toggle.appendChild(track)

        const thumb = document.createElement("span")
        thumb.className = "model-manager-toggle-thumb"
        toggle.appendChild(thumb)

        toggle.addEventListener("click", () => {
          const newEnabled = !isEnabled
          callbacks.onToggleModel(fullId, newEnabled)
        })

        row.appendChild(toggle)
        group.appendChild(row)
      }

      modelList.appendChild(group)
    }
  }

  function filterModels(modelList: ModelInfo[], query: string): ModelInfo[] {
    if (!query.trim()) return modelList
    const q = query.toLowerCase()
    return modelList.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)
    )
  }

  // Event listeners
  closeBtn.addEventListener("click", close)

  connectBtn.addEventListener("click", () => {
    callbacks.onConnectProvider()
  })

  searchInput.addEventListener("input", (e) => {
    searchQuery = (e.target as HTMLInputElement).value
    render()
  })

  // Close on Escape
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault()
      close()
    }
  })

  // Close on overlay click
  panel.addEventListener("click", (e) => {
    if (e.target === panel) {
      close()
    }
  })

  return {
    open,
    close,
    toggle,
    setModels,
    updateModelEnabled,
    getEnabledModels,
    getAllModels,
    isOpen: () => isOpen,
  }
}
