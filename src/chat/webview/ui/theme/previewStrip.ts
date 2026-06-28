/**
 * Live preview strip for the theme customizer.
 *
 * Renders a mini split-view preview: a fake user/assistant message pair and
 * a fake code block, using the current overrides to show how the theme will
 * look. Updates are debounced to avoid screen-reader spam.
 */

import { debounce } from "./themeUtils"
import { PREVIEW_CSS_VAR_MAP } from "./themeConstants"

/**
 * Create a live preview strip element.
 *
 * @returns An API for updating the preview with overrides and disposing.
 */
export function createPreviewStrip() {
  const strip = document.createElement("div")
  strip.className = "theme-preview-strip"
  strip.setAttribute("aria-label", "Theme preview")
  strip.setAttribute("aria-live", "off")

  // Messages column
  const messages = document.createElement("div")
  messages.className = "theme-preview-strip__messages"

  const userMsg = document.createElement("div")
  userMsg.className = "theme-preview-strip__user-msg"
  userMsg.textContent = "How do I parse JSON in TypeScript?"
  messages.appendChild(userMsg)

  const assistantMsg = document.createElement("div")
  assistantMsg.className = "theme-preview-strip__assistant-msg"
  assistantMsg.textContent = "Use JSON.parse() to convert a string to an object."
  messages.appendChild(assistantMsg)

  strip.appendChild(messages)

  // Code block column
  const code = document.createElement("div")
  code.className = "theme-preview-strip__code"

  const codeLines = [
    { text: "const data = JSON.parse(str);", cls: "syntaxKeyword" },
    { text: 'const name = data.name;', cls: "syntaxString" },
    { text: "console.log(name);", cls: "syntaxFunction" },
  ]

  const cssVarForCls: Record<string, string> = {
    syntaxKeyword: "--oc-syn-keyword",
    syntaxString: "--oc-syn-string",
    syntaxFunction: "--oc-syn-function",
  }

  for (const line of codeLines) {
    const lineEl = document.createElement("span")
    lineEl.className = "theme-preview-strip__code-line"
    lineEl.textContent = line.text
    const cssVar = cssVarForCls[line.cls]
    if (cssVar) {
      lineEl.style.color = `var(${cssVar}, var(--oc-fg))`
    }
    code.appendChild(lineEl)
  }

  strip.appendChild(code)

  const debouncedUpdate = debounce((overrides: Record<string, string>) => {
    for (const [key, cssVar] of PREVIEW_CSS_VAR_MAP) {
      const value = overrides[key]
      if (value) {
        strip.style.setProperty(cssVar, value)
      } else {
        strip.style.removeProperty(cssVar)
      }
    }
  }, 100)

  function update(overrides: Record<string, string>): void {
    debouncedUpdate(overrides)
  }

  function dispose(): void {
    debouncedUpdate.cancel()
    strip.remove()
  }

  return { element: strip, update, dispose }
}

export type PreviewStripApi = ReturnType<typeof createPreviewStrip>
