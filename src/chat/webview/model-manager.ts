import type { ModelInfo } from "./types"
import type { ElementRefs } from "./dom"
import type { ProviderConfig } from "../../model/ProviderConfigManager"
import { mountModalFocus, type ModalFocusHandle } from "./focus-trap"

export interface ModelManagerCallbacks {
  onToggleModel: (modelId: string, enabled: boolean) => void
  onToggleFavorite: (modelId: string) => void
  onSelectModel: (modelId: string) => void
  onConnectProvider: () => void
  onDeleteProvider: (id: string) => void
}

const STAR_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.1 8.4 22 9.3 17 14.2 18.2 21 12 17.8 5.8 21 7 14.2 2 9.3 8.9 8.4 12 2"/></svg>'
const TRASH_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>'

export interface ModelManagerHandlers {
  open: () => void
  close: () => void
  toggle: () => void
  setModels: (models: ModelInfo[]) => void
  updateModelEnabled: (modelId: string, enabled: boolean) => void
  updateModelFavorite: (modelId: string, favorite: boolean) => void
  getEnabledModels: () => ModelInfo[]
  getAllModels: () => ModelInfo[]
  getContextWindow: (modelKey?: string) => number | undefined
  isOpen: () => boolean
  setProviders: (providers: ProviderConfig[]) => void
  addProvider: (name: string, apiKey: string, baseUrl?: string) => void
}

export function setupModelManager(els: ElementRefs, callbacks: ModelManagerCallbacks): ModelManagerHandlers {
  let models: ModelInfo[] = []
  let providers: ProviderConfig[] = []
  let searchQuery = ""
  let isOpen = false
  let focusHandle: ModalFocusHandle | null = null

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
    // Capture the invoker, trap Tab inside the dialog, and focus the search box.
    focusHandle = mountModalFocus(panel, { initialFocus: searchInput })
  }

  function close() {
    isOpen = false
    panel.classList.add("hidden")
    focusHandle?.release()
    focusHandle = null
  }

  function toggle() {
    if (isOpen) close()
    else open()
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

  function updateModelFavorite(modelId: string, favorite: boolean) {
    const model = models.find((m) => `${m.provider}/${m.id}` === modelId)
    if (model) {
      model.favorite = favorite
      if (isOpen) render()
    }
  }

  function getEnabledModels(): ModelInfo[] {
    return models.filter((m) => m.enabled !== false)
  }

  function getAllModels(): ModelInfo[] {
    return models
  }

  function getContextWindow(modelKey?: string): number | undefined {
    if (!modelKey) return undefined
    const model = models.find((m) => `${m.provider}/${m.id}` === modelKey)
    return model?.contextWindow
  }

  function render() {
    modelList.innerHTML = ""

    const filtered = sortModels(filterModels(models, searchQuery))

    if (filtered.length === 0) {
      const empty = document.createElement("div")
      empty.className = "model-manager-empty"
      empty.textContent = "No models found"
      modelList.appendChild(empty)
      return
    }

    const favoriteModels = filtered.filter((m) => m.favorite)
    const recentModels = filtered.filter((m) => !m.favorite && typeof m.recentRank === "number")
    const remainingModels = filtered.filter((m) => !m.favorite && typeof m.recentRank !== "number")

    if (providers.length > 0) {
      renderProvidersSection()
    }

    if (favoriteModels.length > 0) {
      renderGroup("Favorites", favoriteModels)
    }
    if (recentModels.length > 0) {
      renderGroup("Recently used", recentModels)
    }

    const byProvider = new Map<string, ModelInfo[]>()
    for (const m of remainingModels) {
      const list = byProvider.get(m.provider) || []
      list.push(m)
      byProvider.set(m.provider, list)
    }

    for (const [provider, providerModels] of byProvider) {
      renderGroup(provider, providerModels)
    }
  }

  function renderProvidersSection() {
    const group = document.createElement("div")
    group.className = "model-manager-group"

    const header = document.createElement("div")
    header.className = "model-manager-group-header"
    header.textContent = "Configured providers"
    group.appendChild(header)

    for (const provider of providers) {
      const row = document.createElement("div")
      row.className = "model-manager-provider-row"

      const name = document.createElement("span")
      name.className = "model-manager-provider-name"
      name.textContent = provider.name
      row.appendChild(name)

      const baseUrl = document.createElement("span")
      baseUrl.className = "model-manager-provider-url"
      baseUrl.textContent = provider.baseUrl ?? ""
      row.appendChild(baseUrl)

      const deleteBtn = document.createElement("button")
      deleteBtn.className = "model-manager-provider-delete"
      deleteBtn.innerHTML = TRASH_SVG
      deleteBtn.setAttribute("aria-label", `Remove ${provider.name} provider`)
      deleteBtn.title = "Remove provider"
      deleteBtn.addEventListener("click", () => {
        const ok = window.confirm(
          `Remove "${provider.name}" provider? This will delete its API key configuration.`,
        )
        if (ok) callbacks.onDeleteProvider(provider.id)
      })
      row.appendChild(deleteBtn)

      group.appendChild(row)
    }

    modelList.appendChild(group)
  }

  function renderGroup(label: string, providerModels: ModelInfo[]) {
    const group = document.createElement("div")
    group.className = "model-manager-group"

    const header = document.createElement("div")
    header.className = "model-manager-group-header"
    header.textContent = label
    group.appendChild(header)

    for (const model of providerModels) {
      const fullId = `${model.provider}/${model.id}`
      const isEnabled = model.enabled !== false

      const row = document.createElement("div")
      row.className = "model-manager-row"

      const favorite = document.createElement("button")
      favorite.className = "model-manager-favorite" + (model.favorite ? " active" : "")
      favorite.innerHTML = STAR_SVG
      favorite.setAttribute("aria-label", `${model.favorite ? "Remove" : "Add"} ${model.displayName} ${model.favorite ? "from" : "to"} favorites`)
      favorite.setAttribute("aria-pressed", String(Boolean(model.favorite)))
      favorite.title = model.favorite ? "Remove favorite" : "Add favorite"
      favorite.addEventListener("click", (event) => {
        event.stopPropagation()
        callbacks.onToggleFavorite(fullId)
      })
      row.appendChild(favorite)

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

  function sortModels(modelList: ModelInfo[]): ModelInfo[] {
    return [...modelList].sort((a, b) => {
      const fav = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite))
      if (fav !== 0) return fav
      const ar = typeof a.recentRank === "number" ? a.recentRank : Number.POSITIVE_INFINITY
      const br = typeof b.recentRank === "number" ? b.recentRank : Number.POSITIVE_INFINITY
      if (ar !== br) return ar - br
      const pc = a.provider.localeCompare(b.provider)
      return pc !== 0 ? pc : a.displayName.localeCompare(b.displayName)
    })
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
    updateModelFavorite,
    getEnabledModels,
    getAllModels,
    getContextWindow,
    isOpen: () => isOpen,
    setProviders: (newProviders: ProviderConfig[]) => {
      providers = newProviders
      render()
    },
    addProvider: (name: string, apiKey: string, baseUrl?: string) => {
      const provider: ProviderConfig = {
        id: `provider_${Date.now()}`,
        name,
        apiKey,
        baseUrl,
        enabled: true,
        models: [],
      }
      providers.push(provider)
      render()
    },
  }
}
