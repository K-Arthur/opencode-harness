/**
 * Color override accordion sections for the theme customizer.
 *
 * Renders collapsible sections (Common, Messages, Tools, Diff, Markdown, Syntax)
 * using native `<details>`/`<summary>` styled with CSS Grid animation.
 * Each section contains color rows with a native `<input type="color">` picker
 * and a text input for hex/rgba/var/transparent values.
 */

import { isValidColorFormat, isHexColor, resolveThemeToken } from "./themeUtils"
import { getCssVarForKey } from "./themeConstants"

export interface ColorFieldDef {
  key: string
  label: string
  placeholder?: string
}

export interface ColorSectionDef {
  id: string
  label: string
  fields: ColorFieldDef[]
}

export const COLOR_SECTIONS: readonly ColorSectionDef[] = [
  {
    id: "common",
    label: "Common",
    fields: [
      { key: "accentColor", label: "Accent" },
      { key: "panelBg", label: "Panel background" },
      { key: "panelFg", label: "Panel text" },
      { key: "editorBg", label: "Editor background" },
      { key: "errorColor", label: "Error" },
      { key: "successColor", label: "Success" },
      { key: "warningColor", label: "Warning" },
    ],
  },
  {
    id: "messages",
    label: "Messages",
    fields: [
      { key: "userMessageBg", label: "User message background" },
      { key: "userMessageFg", label: "User message text" },
      { key: "assistantMessageBg", label: "Assistant message background", placeholder: "transparent" },
      { key: "assistantMessageFg", label: "Assistant message text" },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    fields: [
      { key: "toolReadColor", label: "Read tools" },
      { key: "toolWriteColor", label: "Write tools" },
      { key: "toolExecColor", label: "Exec tools" },
    ],
  },
  {
    id: "diff",
    label: "Diff",
    fields: [
      { key: "diffAdded", label: "Added lines" },
      { key: "diffRemoved", label: "Removed lines" },
      { key: "diffAddedBg", label: "Added background" },
      { key: "diffRemovedBg", label: "Removed background" },
    ],
  },
  {
    id: "markdown",
    label: "Markdown",
    fields: [
      { key: "markdownHeading", label: "Headings" },
      { key: "markdownLink", label: "Links" },
      { key: "markdownCode", label: "Inline code" },
      { key: "markdownBlockQuote", label: "Block quotes" },
    ],
  },
  {
    id: "syntax",
    label: "Syntax",
    fields: [
      { key: "syntaxComment", label: "Comments" },
      { key: "syntaxKeyword", label: "Keywords" },
      { key: "syntaxString", label: "Strings" },
      { key: "syntaxNumber", label: "Numbers" },
      { key: "syntaxFunction", label: "Functions" },
      { key: "syntaxVariable", label: "Variables" },
    ],
  },
] as const

export interface ColorSectionsOptions {
  /** Called when any color override value changes. */
  onChange: (key: string, value: string) => void
}

/**
 * Create and render all color override accordion sections into a container.
 *
 * @param container - The element to render sections into.
 * @param options - Behavior options.
 * @returns An API for setting/getting override values and disposing.
 */
export function createColorSections(
  container: HTMLElement,
  options: ColorSectionsOptions,
) {
  const sectionEls: Array<{ details: HTMLDetailsElement; inputs: Map<string, { picker: HTMLInputElement; text: HTMLInputElement }> }> = []
  let disposed = false

  for (const sectionDef of COLOR_SECTIONS) {
    const details = document.createElement("details")
    details.className = "theme-accordion"
    details.dataset.section = sectionDef.id
    if (sectionDef.id === "common") details.open = true

    const summary = document.createElement("summary")
    summary.className = "theme-accordion__header"
    summary.innerHTML = `<svg class="theme-accordion__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l4 4-4 4"/></svg><span>${escapeHtml(sectionDef.label)}</span>`
    details.appendChild(summary)

    const contentWrap = document.createElement("div")
    contentWrap.className = "theme-accordion__content"
    const innerDiv = document.createElement("div")
    contentWrap.appendChild(innerDiv)

    const grid = document.createElement("div")
    grid.className = "theme-customizer-grid"

    const inputs = new Map<string, { picker: HTMLInputElement; text: HTMLInputElement }>()

    for (const field of sectionDef.fields) {
      const label = document.createElement("label")
      label.className = "theme-field"

      const labelSpan = document.createElement("span")
      labelSpan.textContent = field.label
      label.appendChild(labelSpan)

      const row = document.createElement("div")
      row.className = "theme-color-row"

      const pickerId = `tc-${field.key}`
      const picker = document.createElement("input")
      picker.type = "color"
      picker.className = "theme-color-picker"
      picker.dataset.target = pickerId
      picker.setAttribute("aria-label", `${field.label} color picker`)
      picker.id = `picker-${pickerId}`

      const text = document.createElement("input")
      text.type = "text"
      text.id = pickerId
      text.className = "theme-color-input"
      text.dataset.themeField = field.key
      text.placeholder = field.placeholder ?? "#..."
      text.setAttribute("aria-label", field.label)
      text.spellcheck = false

      // Sync picker → text input
      picker.addEventListener("input", () => {
        text.value = picker.value
        text.classList.remove("theme-color-input--invalid")
        if (!disposed) options.onChange(field.key, picker.value)
      })

      // Sync text → picker (only for hex values)
      text.addEventListener("change", () => {
        const value = text.value.trim()
        if (value && !isValidColorFormat(value)) {
          text.classList.add("theme-color-input--invalid")
          return
        }
        text.classList.remove("theme-color-input--invalid")
        if (isHexColor(value)) {
          picker.value = value
        } else if (!value) {
          // Reset picker to the current theme's resolved color
          const cssVar = getCssVarForKey(field.key)
          if (cssVar) {
            const resolved = resolveThemeToken(cssVar)
            if (resolved) picker.value = resolved
          }
        }
        if (!disposed) options.onChange(field.key, value)
      })

      row.appendChild(picker)
      row.appendChild(text)
      label.appendChild(row)
      grid.appendChild(label)

      inputs.set(field.key, { picker, text })
    }

    innerDiv.appendChild(grid)
    details.appendChild(contentWrap)
    container.appendChild(details)

    sectionEls.push({ details, inputs })
  }

  function setOverrides(overrides: Record<string, string>): void {
    for (const { inputs } of sectionEls) {
      for (const [key, { picker, text }] of inputs) {
        const value = overrides[key] ?? ""
        text.value = value
        text.classList.remove("theme-color-input--invalid")
        if (isHexColor(value)) {
          picker.value = value
        } else {
          const cssVar = getCssVarForKey(key)
          if (cssVar) {
            const resolved = resolveThemeToken(cssVar)
            if (resolved) picker.value = resolved
          }
        }
      }
    }
  }

  function getOverrides(): Record<string, string> {
    const overrides: Record<string, string> = {}
    for (const { inputs } of sectionEls) {
      for (const [key, { text }] of inputs) {
        const value = text.value.trim()
        if (value && isValidColorFormat(value)) {
          overrides[key] = value
        }
      }
    }
    return overrides
  }

  function clearAll(): void {
    for (const { inputs } of sectionEls) {
      for (const [, { picker, text }] of inputs) {
        text.value = ""
        text.classList.remove("theme-color-input--invalid")
        const cssVar = getCssVarForKey(text.dataset.themeField ?? "")
        if (cssVar) {
          const resolved = resolveThemeToken(cssVar)
          if (resolved) picker.value = resolved
        }
      }
    }
  }

  function dispose(): void {
    disposed = true
    container.innerHTML = ""
  }

  return { setOverrides, getOverrides, clearAll, dispose }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export type ColorSectionsApi = ReturnType<typeof createColorSections>
