/**
 * CLI theme search component for the theme customizer.
 *
 * A combobox-like pattern: text input + `role="listbox"` popup with
 * debounced filtering. Options are `role="option"` with `aria-selected`.
 */

import { debounce } from "./themeUtils"

export interface CliThemeEntry {
  name: string
  source: string
}

export interface CliSearchOptions {
  /** Called when the user selects a CLI theme from the list. */
  onSelect: (theme: CliThemeEntry) => void
  /** Called when the user focuses the search input (to trigger lazy loading). */
  onFocus?: () => void
}

/**
 * Create a CLI theme search component.
 *
 * @param input - The text input element for searching.
 * @param list - The listbox container element for results.
 * @param options - Behavior options.
 * @returns An API for populating themes, showing/hiding the list, and disposing.
 */
export function createCliSearch(
  input: HTMLInputElement,
  list: HTMLElement,
  options: CliSearchOptions,
) {
  let themes: CliThemeEntry[] = []
  let disposed = false
  let loaded = false

  list.setAttribute("role", "listbox")
  list.setAttribute("aria-label", "CLI themes")
  list.classList.add("hidden")

  const debouncedFilter = debounce((query: string) => {
    if (disposed) return
    filterAndRender(query.trim().toLowerCase())
  }, 150)

  const onFocus = () => {
    if (!loaded) {
      loaded = true
      options.onFocus?.()
    }
    list.classList.remove("hidden")
  }

  const onInput = () => {
    debouncedFilter(input.value)
  }

  const onDocumentClick = (e: MouseEvent) => {
    if (!input.contains(e.target as Node) && !list.contains(e.target as Node)) {
      list.classList.add("hidden")
    }
  }

  const onKeydown = (e: KeyboardEvent) => {
    if (list.classList.contains("hidden")) return
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>(".theme-cli-row"))
    if (items.length === 0) return
    const currentIdx = items.findIndex((item) => item.getAttribute("aria-selected") === "true")

    if (e.key === "ArrowDown") {
      e.preventDefault()
      const nextIdx = Math.min(currentIdx + 1, items.length - 1)
      if (nextIdx >= 0) {
        items.forEach((item) => item.setAttribute("aria-selected", "false"))
        items[nextIdx]!.setAttribute("aria-selected", "true")
        items[nextIdx]!.focus()
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      const prevIdx = Math.max(currentIdx - 1, 0)
      items.forEach((item) => item.setAttribute("aria-selected", "false"))
      items[prevIdx]!.setAttribute("aria-selected", "true")
      items[prevIdx]!.focus()
    } else if (e.key === "Enter" && currentIdx >= 0) {
      e.preventDefault()
      const theme = themes.find((t) => t.name === items[currentIdx]!.dataset.cliTheme)
      if (theme) {
        selectTheme(theme)
      }
    } else if (e.key === "Escape") {
      list.classList.add("hidden")
      input.focus()
    }
  }

  input.addEventListener("focus", onFocus)
  input.addEventListener("input", onInput)
  input.addEventListener("keydown", onKeydown)
  document.addEventListener("click", onDocumentClick)

  function filterAndRender(query: string): void {
    list.innerHTML = ""
    const filtered = query
      ? themes.filter((t) => t.name.toLowerCase().includes(query))
      : themes

    if (filtered.length === 0) {
      const empty = document.createElement("div")
      empty.className = "theme-cli-empty"
      empty.textContent = "No CLI themes found. Add .json files to ~/.config/opencode/themes/"
      list.appendChild(empty)
      return
    }

    filtered.forEach((theme, idx) => {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "theme-cli-row"
      btn.dataset.cliTheme = theme.name
      btn.setAttribute("role", "option")
      btn.setAttribute("aria-selected", String(idx === 0))
      btn.innerHTML = `<span class="theme-cli-name">${escapeHtml(theme.name)}</span><span class="theme-cli-source">${escapeHtml(theme.source)}</span>`
      btn.addEventListener("click", () => selectTheme(theme))
      list.appendChild(btn)
    })
  }

  function selectTheme(theme: CliThemeEntry): void {
    input.value = theme.name
    list.classList.add("hidden")
    options.onSelect(theme)
  }

  function populate(incoming: CliThemeEntry[]): void {
    themes = incoming
    filterAndRender("")
  }

  function show(): void {
    list.classList.remove("hidden")
  }

  function hide(): void {
    list.classList.add("hidden")
  }

  function dispose(): void {
    disposed = true
    debouncedFilter.cancel()
    input.removeEventListener("focus", onFocus)
    input.removeEventListener("input", onInput)
    input.removeEventListener("keydown", onKeydown)
    document.removeEventListener("click", onDocumentClick)
  }

  return { populate, show, hide, dispose }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export type CliSearchApi = ReturnType<typeof createCliSearch>
