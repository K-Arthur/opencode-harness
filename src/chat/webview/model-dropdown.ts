import type { ModelInfo } from "./types"
import type { ElementRefs } from "./dom"
import { CHECK_SVG, GEAR_SVG } from "./icons"

export interface ModelDropdownCallbacks {
  onSelect: (modelId: string) => void
  onOpen?: () => void
  onManageModels?: () => void
}

function sortModels(models: ModelInfo[]): ModelInfo[] {
  return [...models].sort((a, b) => {
    const fav = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite))
    if (fav !== 0) return fav
    const ar = typeof a.recentRank === "number" ? a.recentRank : Number.POSITIVE_INFINITY
    const br = typeof b.recentRank === "number" ? b.recentRank : Number.POSITIVE_INFINITY
    if (ar !== br) return ar - br
    const pc = a.provider.localeCompare(b.provider)
    return pc !== 0 ? pc : a.displayName.localeCompare(b.displayName)
  })
}

function groupByProvider(models: ModelInfo[]): Map<string, ModelInfo[]> {
  const byProvider = new Map<string, ModelInfo[]>()
  for (const m of models) {
    const list = byProvider.get(m.provider) || []
    list.push(m)
    byProvider.set(m.provider, list)
  }
  return byProvider
}

function createProviderGroupLabel(provider: string): HTMLDivElement {
  const label = document.createElement("div")
  label.className = "model-group-label"
  label.setAttribute("role", "group")
  label.setAttribute("aria-label", provider)
  label.textContent = provider
  return label
}

function createModelOption(
  model: ModelInfo,
  index: number,
  currentModel: string,
  callbacks: ModelDropdownCallbacks,
  closeDropdown: () => void,
  focusBtn: () => void,
): HTMLDivElement {
  const fullId = `${model.provider}/${model.id}`
  const isSelected = fullId === currentModel
  const isUnavailable = model.available === false

  const option = document.createElement("div")
  option.className = "model-option" + (isSelected ? " selected" : "") + (isUnavailable ? " unavailable" : "")
  option.id = `model-option-${index}`
  // Stash the canonical model id on the DOM node so the selection re-sync in
  // setCurrentModel can match directly instead of by positional index. Index
  // mapping breaks when the displayed set changes between renders (search
  // filter, enabled-state toggles, model-list refresh) — which was the root
  // cause of the checkmark landing on the wrong row.
  option.dataset.modelId = fullId
  option.setAttribute("role", "option")
  option.setAttribute("aria-selected", isSelected ? "true" : "false")
  option.setAttribute("tabindex", "-1")

  const checkmark = document.createElement("span")
  checkmark.className = "checkmark"
  checkmark.setAttribute("aria-hidden", "true")
  checkmark.innerHTML = CHECK_SVG
  option.appendChild(checkmark)

  const name = document.createElement("span")
  name.className = "model-option-name"
  name.textContent = model.displayName + (isUnavailable ? " (discontinued)" : "")
  option.appendChild(name)

  if (model.favorite || typeof model.recentRank === "number") {
    const meta = document.createElement("span")
    meta.className = "model-option-meta"
    meta.textContent = model.favorite ? "Favorite" : "Recent"
    option.appendChild(meta)
  } else if (isUnavailable) {
    const meta = document.createElement("span")
    meta.className = "model-option-meta"
    meta.style.borderColor = "var(--oc-accent-border, #f44336)"
    meta.style.color = "var(--usage-red, #f44336)"
    meta.style.background = "rgba(244, 67, 54, 0.1)"
    meta.textContent = "Offline"
    option.appendChild(meta)
  } else if (model.connectionStatus === "needs_key") {
    const meta = document.createElement("span")
    meta.className = "model-option-meta provider-status-needs-key"
    meta.textContent = "Needs API Key"
    option.appendChild(meta)
  } else if (model.connectionStatus === "needs_oauth") {
    const meta = document.createElement("span")
    meta.className = "model-option-meta provider-status-needs-oauth"
    meta.textContent = "Needs OAuth"
    option.appendChild(meta)
  }

  if (!isUnavailable) {
    option.addEventListener("click", () => {
      callbacks.onSelect(fullId)
      closeDropdown()
      focusBtn()
    })
  } else {
    option.setAttribute("aria-disabled", "true")
  }
  return option
}

function createDivider(): HTMLDivElement {
  const divider = document.createElement("div")
  divider.className = "model-group-label"
  divider.style.marginTop = "4px"
  divider.style.borderTop = "1px solid var(--color-border)"
  divider.style.paddingTop = "8px"
  return divider
}

function createManageModelsOption(callbacks: ModelDropdownCallbacks, closeDropdown: () => void): HTMLDivElement {
  const manageOption = document.createElement("div")
  manageOption.className = "model-option manage-models-option"
  manageOption.setAttribute("role", "option")
  manageOption.setAttribute("tabindex", "-1")

  const manageIcon = document.createElement("span")
  manageIcon.setAttribute("aria-hidden", "true")
  manageIcon.innerHTML = GEAR_SVG
  manageOption.appendChild(manageIcon)

  const manageLabel = document.createElement("span")
  manageLabel.textContent = "Manage models"
  manageOption.appendChild(manageLabel)

  manageOption.addEventListener("click", () => {
    closeDropdown()
    callbacks.onManageModels?.()
  })
  return manageOption
}

export function setupModelDropdown(els: ElementRefs, callbacks: ModelDropdownCallbacks) {
  let isOpen = false
  let models: ModelInfo[] = []
  let focusedIndex = -1
  let searchQuery = ""
  let _currentModel = ""

  function getOptions(): HTMLElement[] {
    return Array.from(els.modelDropdown.querySelectorAll('[role="option"]:not(.manage-models-option)'))
  }

  function toggle() {
    if (isOpen) close()
    else open()
  }

  function positionDropdown() {
    const btn = els.modelSelectorBtn
    const dropdown = els.modelDropdown
    if (!btn || !dropdown) return
    const margin = 8
    const r = btn.getBoundingClientRect()
    const dropdownW = Math.min(440, Math.max(240, window.innerWidth - margin * 2))
    // Cap estimatedHeight to CSS max-height (320px) to prevent viewport overflow
    const cssMaxHeight = 320
    const estimatedHeight = Math.min(cssMaxHeight, dropdown.getBoundingClientRect().height || cssMaxHeight)
    const spaceBelow = window.innerHeight - r.bottom - margin
    const spaceAbove = r.top - margin
    const openAbove = spaceBelow < Math.min(200, estimatedHeight) && spaceAbove > spaceBelow
    // Ensure maxHeight never exceeds CSS max-height to prevent viewport overflow
    const maxHeight = Math.min(cssMaxHeight, Math.max(200, Math.floor((openAbove ? spaceAbove : spaceBelow) - 4)))
    const leftEdge = Math.min(
      Math.max(margin, r.right - dropdownW),
      Math.max(margin, window.innerWidth - dropdownW - margin),
    )
    const top = openAbove
      ? Math.max(margin, r.top - Math.min(estimatedHeight, maxHeight) - 6)
      : Math.min(window.innerHeight - margin - estimatedHeight, r.bottom + 6)

    dropdown.style.position = "fixed"
    dropdown.style.top = `${Math.max(margin, top)}px`
    dropdown.style.left = `${leftEdge}px`
    dropdown.style.right = "auto"
    dropdown.style.width = `${dropdownW}px`
    dropdown.style.maxHeight = `${maxHeight}px`
  }

  let _resizeHandler: (() => void) | null = null

  function open() {
    isOpen = true
    focusedIndex = -1
    els.modelDropdown.classList.remove("hidden")
    els.modelSelectorBtn.setAttribute("aria-expanded", "true")
    els.modelSelectorBtn.setAttribute("aria-activedescendant", "")
    callbacks.onOpen?.()
    
    // Position using fixed coordinates to escape overflow:hidden ancestors
    positionDropdown()
    _resizeHandler = () => positionDropdown()
    window.addEventListener("resize", _resizeHandler)

    // Auto-focus search input
    const searchInput = els.modelDropdown.querySelector(".model-dropdown-search") as HTMLInputElement | null
    if (searchInput) {
      setTimeout(() => {
        searchInput.focus()
        searchInput.select()
      }, 50)
    }

    if (models.length === 0 && els.modelDropdown.children.length === 0) {
      const empty = document.createElement("div")
      empty.className = "dropdown-empty"
      empty.setAttribute("role", "status")
      empty.setAttribute("aria-live", "polite")
      empty.textContent = "Loading models..."
      els.modelDropdown.appendChild(empty)
    }
  }

  function close() {
    isOpen = false
    focusedIndex = -1
    els.modelDropdown.classList.add("hidden")
    els.modelSelectorBtn.setAttribute("aria-expanded", "false")
    els.modelSelectorBtn.removeAttribute("aria-activedescendant")
    const options = getOptions()
    for (const opt of options) opt.classList.remove("focused")
    if (_resizeHandler) {
      window.removeEventListener("resize", _resizeHandler)
      _resizeHandler = null
    }
  }

  function focusOption(index: number) {
    const options = getOptions()
    for (const opt of options) opt.classList.remove("focused")
    if (options.length === 0) return
    if (index < 0) index = options.length - 1
    if (index >= options.length) index = 0
    focusedIndex = index
    const target = options[index]
    if (target) {
      target.classList.add("focused")
      target.scrollIntoView({ block: "nearest" })
      els.modelSelectorBtn.setAttribute("aria-activedescendant", target.id || "")
    }
  }

  function selectFocused() {
    const options = getOptions()
    if (focusedIndex >= 0 && focusedIndex < options.length) {
      const opt = options[focusedIndex]
      if (opt && !opt.classList.contains("unavailable")) {
        opt.dispatchEvent(new Event("click", { bubbles: true }))
      }
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        open()
        return
      }
      return
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        focusOption(focusedIndex + 1)
        break
      case "ArrowUp":
        e.preventDefault()
        focusOption(focusedIndex - 1)
        break
      case "Enter":
        e.preventDefault()
        selectFocused()
        break
      case "Escape":
        e.preventDefault()
        close()
        els.modelSelectorBtn.focus()
        break
      case "Home":
        e.preventDefault()
        focusOption(0)
        break
      case "End":
        e.preventDefault()
        focusOption(getOptions().length - 1)
        break
    }
  }

  function render(modelsList: ModelInfo[], currentModel: string) {
    models = modelsList
    _currentModel = currentModel
    
    updateList()
  }

  function getDisplayModels(): ModelInfo[] {
    const enabledModels = models.filter((m) => m.enabled !== false)
    const filteredModels = searchQuery
      ? enabledModels.filter(
          (m) =>
            m.displayName.toLowerCase().includes(searchQuery) ||
            m.provider.toLowerCase().includes(searchQuery) ||
            m.id.toLowerCase().includes(searchQuery)
        )
      : enabledModels
    const sortedModels = sortModels(filteredModels)
    return sortedModels.slice(0, 40)
  }

  function updateList() {
    els.modelDropdown.replaceChildren()

    // Add sticky search input
    const searchContainer = document.createElement("div")
    searchContainer.className = "model-dropdown-search-container"
    searchContainer.addEventListener("click", (e) => e.stopPropagation())

    const searchInput = document.createElement("input")
    searchInput.type = "text"
    searchInput.className = "model-dropdown-search"
    searchInput.placeholder = "Search models..."
    searchInput.value = searchQuery
    searchInput.setAttribute("role", "searchbox")
    searchInput.setAttribute("aria-label", "Search models")
    
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value.toLowerCase().trim()
      updateList()
      // Refocus after replacement
      const newInput = els.modelDropdown.querySelector(".model-dropdown-search") as HTMLInputElement | null
      if (newInput) {
        newInput.focus()
        newInput.setSelectionRange(newInput.value.length, newInput.value.length)
      }
    })

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        handleKeydown(e)
      }
    })

    searchContainer.appendChild(searchInput)
    els.modelDropdown.appendChild(searchContainer)

    const limitedModels = getDisplayModels()
    const byProvider = groupByProvider(limitedModels)

    let optionIndex = 0
    for (const [provider, providerModels] of byProvider) {
      els.modelDropdown.appendChild(createProviderGroupLabel(provider))
      for (const model of providerModels) {
        els.modelDropdown.appendChild(createModelOption(model, optionIndex, _currentModel, callbacks, close, () => els.modelSelectorBtn.focus()))
        optionIndex++
      }
    }

    if (optionIndex > 0) {
      els.modelDropdown.appendChild(createDivider())
    }
    
    els.modelDropdown.appendChild(createManageModelsOption(callbacks, close))
  }

  function setCurrentModel(modelId: string) {
    _currentModel = modelId
    const short = modelId.includes("/") ? modelId.split("/").pop()! : modelId
    els.modelLabel.textContent = short || "Default"
    els.modelSelectorBtn.title = `Model: ${modelId || "Default"}`

    // Re-sync the .selected / aria-selected state on existing options. Match
    // by the canonical model id stored in data-model-id rather than by
    // positional index — the displayed set can change between renders (search
    // filter, enabled toggles, model-list refresh), so index N at sync time
    // may point to a different model than index N at render time.
    const options = getOptions()
    for (const opt of options) {
      const optionModelId = opt.dataset.modelId
      if (!optionModelId) continue
      const isSelected = optionModelId === modelId
      opt.classList.toggle("selected", isSelected)
      opt.setAttribute("aria-selected", isSelected ? "true" : "false")
    }
  }

  function getCurrentModel(): string {
    return _currentModel
  }

  els.modelSelectorBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    toggle()
  })

  els.modelSelectorBtn.addEventListener("keydown", (e) => {
    handleKeydown(e)
  })

  document.addEventListener("click", (e: Event) => {
    if (isOpen && !els.modelDropdown.contains(e.target as Node) && !els.modelSelectorBtn.contains(e.target as Node)) {
      close()
    }
  })

  return { open, close, render, setCurrentModel, getCurrentModel }
}