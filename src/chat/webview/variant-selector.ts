import type { ModelInfo } from "./types"
import type { ElementRefs } from "./dom"
import { CHECK_SVG } from "./icons"

export interface VariantSelectorCallbacks {
  onSelect: (variant: string) => void
}

const VARIANTS = ["Default", "Low", "Medium", "High"]

export function setupVariantSelector(els: ElementRefs, callbacks: VariantSelectorCallbacks) {
  let isOpen = false
  let currentVariant = "Default"
  let currentModel: ModelInfo | null = null

  const btn = els.variantSelectorBtn
  const label = els.variantLabel
  const dropdown = els.variantDropdown

  function setModel(model: ModelInfo | null) {
    currentModel = model
    updateVisibility()
  }

  function updateVisibility() {
    const supportsVariants = currentModel?.supportsVariants ?? false
    if (supportsVariants) {
      btn.classList.remove("hidden")
    } else {
      btn.classList.add("hidden")
      close()
    }
  }

  function open() {
    if (btn.classList.contains("hidden")) return
    isOpen = true
    dropdown.classList.remove("hidden")
    btn.setAttribute("aria-expanded", "true")
    render()
  }

  function close() {
    isOpen = false
    dropdown.classList.add("hidden")
    btn.setAttribute("aria-expanded", "false")
  }

  function toggle() {
    isOpen ? close() : open()
  }

  function setVariant(variant: string) {
    currentVariant = variant
    label.textContent = variant
  }

  function render() {
    dropdown.innerHTML = ""

    const list = document.createElement("div")
    list.className = "model-dropdown"
    list.setAttribute("role", "listbox")

    for (const variant of VARIANTS) {
      const isSelected = variant === currentVariant
      const option = document.createElement("div")
      option.className = "model-option" + (isSelected ? " selected" : "")
      option.setAttribute("role", "option")
      option.setAttribute("aria-selected", String(isSelected))

      const text = document.createElement("span")
      text.textContent = variant
      option.appendChild(text)

      if (isSelected) {
        const check = document.createElement("span")
        check.className = "checkmark"
        check.setAttribute("aria-hidden", "true")
        check.innerHTML = CHECK_SVG
        option.appendChild(check)
      }

      option.addEventListener("click", () => {
        setVariant(variant)
        callbacks.onSelect(variant)
        close()
      })

      list.appendChild(option)
    }

    dropdown.appendChild(list)
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation()
    toggle()
  })

  document.addEventListener("click", (e) => {
    if (isOpen && !dropdown.contains(e.target as Node) && !btn.contains(e.target as Node)) {
      close()
    }
  })

  // Initially hide if no model supports variants
  updateVisibility()

  return {
    open,
    close,
    toggle,
    setVariant,
    setModel,
    render,
  }
}
