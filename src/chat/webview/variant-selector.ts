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
  let focusedIndex = -1

  const btn = els.variantSelectorBtn
  const label = els.variantLabel
  const dropdown = els.variantDropdown

  function getOptions(): HTMLElement[] {
    return Array.from(dropdown.querySelectorAll('[role="option"]'))
  }

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
      btn.setAttribute("aria-activedescendant", target.id || "")
    }
  }

  function open() {
    if (btn.classList.contains("hidden")) return
    isOpen = true
    focusedIndex = -1
    dropdown.classList.remove("hidden")
    btn.setAttribute("aria-expanded", "true")
    btn.removeAttribute("aria-activedescendant")
    render()
  }

  function close() {
    isOpen = false
    focusedIndex = -1
    dropdown.classList.add("hidden")
    btn.setAttribute("aria-expanded", "false")
    btn.removeAttribute("aria-activedescendant")
    const options = getOptions()
    for (const opt of options) opt.classList.remove("focused")
  }

  function toggle() {
    if (isOpen) close()
    else open()
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
    list.id = "variant-listbox"

    btn.setAttribute("aria-controls", "variant-listbox")

    let optionIndex = 0
    for (const variant of VARIANTS) {
      const isSelected = variant === currentVariant
      const option = document.createElement("div")
      option.className = "model-option" + (isSelected ? " selected" : "")
      option.id = `variant-option-${optionIndex}`
      option.setAttribute("role", "option")
      option.setAttribute("aria-selected", isSelected ? "true" : "false")
      option.setAttribute("tabindex", "-1")

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
        btn.focus()
      })

      list.appendChild(option)
      optionIndex++
    }

    dropdown.appendChild(list)
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation()
    toggle()
  })

  btn.addEventListener("keydown", (e) => {
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
        if (focusedIndex >= 0) {
          const options = getOptions()
          const opt = options[focusedIndex]
          if (opt) opt.dispatchEvent(new Event("click", { bubbles: true }))
        }
        break
      case "Escape":
        e.preventDefault()
        close()
        btn.focus()
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
