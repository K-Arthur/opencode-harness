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

  const option = document.createElement("div")
  option.className = "model-option" + (isSelected ? " selected" : "")
  option.id = `model-option-${index}`
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
  name.textContent = model.displayName
  option.appendChild(name)

  if (model.favorite || typeof model.recentRank === "number") {
    const meta = document.createElement("span")
    meta.className = "model-option-meta"
    meta.textContent = model.favorite ? "Favorite" : "Recent"
    option.appendChild(meta)
  }

  option.addEventListener("click", () => {
    callbacks.onSelect(fullId)
    closeDropdown()
    focusBtn()
  })
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

  function getOptions(): HTMLElement[] {
    return Array.from(els.modelDropdown.querySelectorAll('[role="option"]'))
  }

  function toggle() {
    isOpen ? close() : open()
  }

  function open() {
    isOpen = true
    focusedIndex = -1
    els.modelDropdown.classList.remove("hidden")
    els.modelSelectorBtn.setAttribute("aria-expanded", "true")
    els.modelSelectorBtn.setAttribute("aria-activedescendant", "")
    callbacks.onOpen?.()
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
  }

  function focusOption(index: number) {
    const options = getOptions()
    for (const opt of options) opt.classList.remove("focused")
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
      if (opt) opt.dispatchEvent(new Event("click", { bubbles: true }))
    }
  }

  function render(modelsList: ModelInfo[], currentModel: string) {
    models = modelsList
    els.modelDropdown.replaceChildren()

    const enabledModels = modelsList.filter((m) => m.enabled !== false)
    const sortedModels = sortModels(enabledModels)
    const byProvider = groupByProvider(sortedModels)

    let optionIndex = 0
    for (const [provider, providerModels] of byProvider) {
      els.modelDropdown.appendChild(createProviderGroupLabel(provider))
      for (const model of providerModels) {
        els.modelDropdown.appendChild(createModelOption(model, optionIndex, currentModel, callbacks, close, () => els.modelSelectorBtn.focus()))
        optionIndex++
      }
    }

    if (optionIndex > 0) {
      els.modelDropdown.appendChild(createDivider())
    }
    els.modelDropdown.appendChild(createManageModelsOption(callbacks, close))
  }

  let _currentModel = ""

  function setCurrentModel(modelId: string) {
    _currentModel = modelId
    const short = modelId.includes("/") ? modelId.split("/").pop()! : modelId
    els.modelLabel.textContent = short || "Default"
    els.modelSelectorBtn.title = `Model: ${modelId || "Default"}`
  }

  function getCurrentModel(): string {
    return _currentModel
  }

  els.modelSelectorBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    toggle()
  })

  els.modelSelectorBtn.addEventListener("keydown", (e) => {
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
      case " ":
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
  })

  document.addEventListener("click", (e: Event) => {
    if (isOpen && !els.modelDropdown.contains(e.target as Node) && !els.modelSelectorBtn.contains(e.target as Node)) {
      close()
    }
  })

  return { open, close, render, setCurrentModel, getCurrentModel }
}