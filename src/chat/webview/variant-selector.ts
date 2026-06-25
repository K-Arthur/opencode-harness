import type { ModelInfo } from "./types"
import type { ElementRefs } from "./dom"
import { CHECK_SVG } from "./icons"

export interface VariantSelectorCallbacks {
  onSelect: (variant: string) => void
}

const DEFAULT_VARIANTS = ["Default", "Low", "Medium", "High", "Max"]

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

  function getVariants(): string[] {
    if (currentModel?.variantNames && currentModel.variantNames.length > 0) {
      return ["Default", ...currentModel.variantNames]
    }
    return DEFAULT_VARIANTS
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

  function positionDropdown() {
    if (!btn || !dropdown) return
    const margin = 8
    const r = btn.getBoundingClientRect()
    const dropdownW = Math.min(300, Math.max(160, window.innerWidth - margin * 2))
    // Cap estimatedHeight to CSS max-height (240px) to prevent viewport overflow
    const cssMaxHeight = 240
    const estimatedHeight = Math.min(cssMaxHeight, dropdown.getBoundingClientRect().height || cssMaxHeight)
    const spaceBelow = window.innerHeight - r.bottom - margin
    const spaceAbove = r.top - margin
    const openAbove = spaceBelow < Math.min(160, estimatedHeight) && spaceAbove > spaceBelow
    // Ensure maxHeight never exceeds CSS max-height to prevent viewport overflow
    const maxHeight = Math.min(cssMaxHeight, Math.max(160, Math.floor((openAbove ? spaceAbove : spaceBelow) - 4)))
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
    dropdown.style.zIndex = "var(--z-dropdown)"
  }

  let _resizeHandler: (() => void) | null = null

  function open() {
    if (btn.classList.contains("hidden")) return
    isOpen = true
    focusedIndex = -1
    dropdown.classList.remove("hidden")
    btn.setAttribute("aria-expanded", "true")
    btn.removeAttribute("aria-activedescendant")
    render()
    positionDropdown()
    _resizeHandler = () => positionDropdown()
    window.addEventListener("resize", _resizeHandler)
  }

  function close() {
    isOpen = false
    focusedIndex = -1
    dropdown.classList.add("hidden")
    btn.setAttribute("aria-expanded", "false")
    btn.removeAttribute("aria-activedescendant")
    const options = getOptions()
    for (const opt of options) opt.classList.remove("focused")
    if (_resizeHandler) {
      window.removeEventListener("resize", _resizeHandler)
      _resizeHandler = null
    }
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
    for (const variant of getVariants()) {
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
