/**
 * Preset grid component for the theme customizer.
 *
 * Renders theme presets as terminal-window thumbnail cards in a `role="radiogroup"`
 * with roving tabindex keyboard navigation (APG Radio Group Pattern).
 */

import type { ThemePreset } from "./themeState"

export interface PresetCardData {
  preset: ThemePreset
  label: string
  swatches: [string, string, string]
}

export const BUILTIN_PRESETS: readonly PresetCardData[] = [
  { preset: "cli-default", label: "CLI Default", swatches: ["#1e1e2e", "#c9d1d9", "#00e5ff"] },
  { preset: "light", label: "Light", swatches: ["#ffffff", "#24292f", "#0969da"] },
  { preset: "dark", label: "Dark", swatches: ["#1e1e2e", "#c9d1d9", "#00e5ff"] },
  { preset: "high-contrast", label: "High Contrast", swatches: ["#000000", "#ffffff", "#ffff00"] },
] as const

export interface PresetGridOptions {
  /** Called when the user selects a preset (via click or arrow key). */
  onSelect: (preset: ThemePreset) => void
  /** The currently-selected preset (for initial aria-checked state). */
  selectedPreset: ThemePreset
}

/**
 * Create and render the preset grid into a container element.
 *
 * @param container - The element to render the grid into (typically a `<fieldset>`).
 * @param options - Grid behavior options.
 * @returns An API for updating the selected preset and disposing listeners.
 */
export function createPresetGrid(
  container: HTMLElement,
  options: PresetGridOptions,
) {
  let selected = options.selectedPreset
  let disposed = false

  container.setAttribute("role", "radiogroup")
  container.setAttribute("aria-label", "Base theme preset")
  container.className = "theme-preset-grid"

  const cards: HTMLButtonElement[] = []

  for (const data of BUILTIN_PRESETS) {
    const card = document.createElement("button")
    card.type = "button"
    card.className = "theme-preset-card"
    card.setAttribute("role", "radio")
    card.dataset.preset = data.preset
    card.setAttribute("aria-checked", String(data.preset === selected))
    card.setAttribute("tabindex", data.preset === selected ? "0" : "-1")
    card.setAttribute("aria-label", data.label)

    // Terminal-window title bar
    const titlebar = document.createElement("div")
    titlebar.className = "theme-preset-card__titlebar"
    for (const color of ["red", "yellow", "green"] as const) {
      const dot = document.createElement("span")
      dot.className = `theme-preset-card__dot theme-preset-card__dot--${color}`
      dot.setAttribute("aria-hidden", "true")
      titlebar.appendChild(dot)
    }
    const name = document.createElement("span")
    name.className = "theme-preset-card__name"
    name.textContent = data.label
    titlebar.appendChild(name)

    // Checkmark (visible only when selected)
    const check = document.createElement("span")
    check.className = "theme-preset-card__check"
    check.setAttribute("aria-hidden", "true")
    check.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8l3 3 7-7"/></svg>'
    titlebar.appendChild(check)
    card.appendChild(titlebar)

    // Slim horizontal swatch strip
    const strip = document.createElement("div")
    strip.className = "theme-swatch-strip"
    strip.setAttribute("aria-hidden", "true")
    for (const color of data.swatches) {
      const chip = document.createElement("span")
      chip.className = "theme-swatch-strip__chip"
      chip.style.backgroundColor = color
      strip.appendChild(chip)
    }
    card.appendChild(strip)

    card.addEventListener("click", () => {
      selectPreset(data.preset)
    })

    cards.push(card)
    container.appendChild(card)
  }

  // Roving tabindex keyboard navigation (APG Radio Group Pattern)
  container.addEventListener("keydown", (e: KeyboardEvent) => {
    if (disposed) return
    const currentIdx = cards.findIndex((c) => c === document.activeElement)
    if (currentIdx === -1) return

    let nextIdx = currentIdx
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault()
      nextIdx = (currentIdx + 1) % cards.length
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault()
      nextIdx = (currentIdx - 1 + cards.length) % cards.length
    } else if (e.key === "Home") {
      e.preventDefault()
      nextIdx = 0
    } else if (e.key === "End") {
      e.preventDefault()
      nextIdx = cards.length - 1
    } else {
      return
    }

    if (nextIdx !== currentIdx) {
      cards[currentIdx]!.setAttribute("tabindex", "-1")
      cards[nextIdx]!.setAttribute("tabindex", "0")
      cards[nextIdx]!.focus()
      const preset = cards[nextIdx]!.dataset.preset as ThemePreset
      selectPreset(preset)
    }
  })

  function updateSelection(preset: ThemePreset): void {
    selected = preset
    for (const card of cards) {
      const isSel = card.dataset.preset === preset
      card.setAttribute("aria-checked", String(isSel))
      card.classList.toggle("theme-preset-card--selected", isSel)
      card.setAttribute("tabindex", isSel ? "0" : "-1")
    }
  }

  function selectPreset(preset: ThemePreset): void {
    updateSelection(preset)
    options.onSelect(preset)
  }

  function setSelected(preset: ThemePreset): void {
    updateSelection(preset)
  }

  function getSelected(): ThemePreset {
    return selected
  }

  function dispose(): void {
    disposed = true
    container.innerHTML = ""
  }

  return { setSelected, getSelected, dispose }
}

export type PresetGridApi = ReturnType<typeof createPresetGrid>
