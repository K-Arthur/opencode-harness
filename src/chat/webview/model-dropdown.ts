import type { ModelInfo } from "./types"
import type { ElementRefs } from "./dom"

export interface ModelDropdownCallbacks {
  onSelect: (modelId: string) => void
  onOpen?: () => void
}

export function setupModelDropdown(els: ElementRefs, callbacks: ModelDropdownCallbacks) {
  let isOpen = false
  let models: ModelInfo[] = []
  let focusedIndex = -1

  // SECURITY NOTE: This dropdown uses a custom implementation instead of
  // <vscode-dropdown> because it supports provider-based grouping (like
  // optgroup) which the toolkit's dropdown does not support. All model names
  // are rendered via textContent (safe, no XSS risk). The only innerHTML usage
  // is for a hardcoded SVG checkmark icon (no user content).

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
    // Set active-descendant for screen reader tracking
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
    // Clear visual focus
    const options = getOptions()
    for (const opt of options) opt.classList.remove("focused")
  }

  function focusOption(index: number) {
    const options = getOptions()
    // Remove previous focus
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
      options[focusedIndex].dispatchEvent(new Event("click", { bubbles: true }))
    }
  }

  function render(modelsList: ModelInfo[], currentModel: string) {
    models = modelsList
    // Safe: clearing container, no user content involved
    els.modelDropdown.replaceChildren()

    // Group by provider
    const byProvider = new Map<string, ModelInfo[]>()
    for (const m of modelsList) {
      const list = byProvider.get(m.provider) || []
      list.push(m)
      byProvider.set(m.provider, list)
    }

    let optionIndex = 0
    for (const [provider, providerModels] of byProvider) {
      const groupLabel = document.createElement("div")
      groupLabel.className = "model-group-label"
      groupLabel.setAttribute("role", "group")
      groupLabel.setAttribute("aria-label", provider)
      groupLabel.textContent = provider
      els.modelDropdown.appendChild(groupLabel)

      for (const model of providerModels) {
        const fullId = `${model.provider}/${model.id}`
        const isSelected = fullId === currentModel

        const option = document.createElement("div")
        option.className = "model-option" + (isSelected ? " selected" : "")
        option.id = `model-option-${optionIndex}`
        option.setAttribute("role", "option")
        option.setAttribute("aria-selected", isSelected ? "true" : "false")
        option.setAttribute("tabindex", "-1")

        const checkmark = document.createElement("span")
        checkmark.className = "checkmark"
        checkmark.setAttribute("aria-hidden", "true")
        // Safe: hardcoded SVG constant, no user content
        checkmark.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>'
        option.appendChild(checkmark)

        const name = document.createElement("span")
        // Safe: textContent escapes all HTML
        name.textContent = model.displayName
        option.appendChild(name)

        option.addEventListener("click", () => {
          callbacks.onSelect(fullId)
          close()
          els.modelSelectorBtn.focus()
        })

        els.modelDropdown.appendChild(option)
        optionIndex++
      }
    }
  }

  function setCurrentModel(modelId: string) {
    const short = modelId.includes("/") ? modelId.split("/").pop()! : modelId
    els.modelLabel.textContent = short || "Default"
    els.modelSelectorBtn.title = `Model: ${modelId || "Default"}`
  }

  els.modelSelectorBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    toggle()
  })

  // Keyboard navigation for accessibility (matches <vscode-dropdown> behavior)
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

  // Close on outside click
  document.addEventListener("click", (e: Event) => {
    if (isOpen && !els.modelDropdown.contains(e.target as Node) && !els.modelSelectorBtn.contains(e.target as Node)) {
      close()
    }
  })

  return { open, close, render, setCurrentModel }
}
