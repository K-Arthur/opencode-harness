 * is loaded via a <script> tag in index.html pointing to toolkit.min.js. This
 * is the RECOMMENDED approach because:
 *
 * 1. The toolkit declares "sideEffects": false in its package.json
 * 2. esbuild respects this and drops the side-effect import during bundling
 *    (even with treeShaking: false)
 * 3. Loading via script tag ensures all custom elements are properly registered
 *
 * Toolkit components automatically handle:
 * - Theming (via --vscode-* CSS variables)
 * - Accessibility (ARIA roles, keyboard navigation)
 * - Focus management
 *
 * Reference: https://github.com/microsoft/vscode-webview-ui-toolkit
 */

/**
 * Apply the Webview UI Toolkit's recommended base styles.
 */
export const TOOLKIT_BASE_CSS = `
  vscode-button,
  vscode-dropdown,
  vscode-option,
  vscode-progress-ring,
  vscode-divider,
  vscode-badge,
  vscode-link,
  vscode-panels,
  vscode-tab,
  vscode-tab-panel {
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    font-weight: var(--vscode-font-weight, normal);
  }
`

/**
 * Helper to create a toolkit dropdown with options.
 * Useful for model selection and other pickers.
 */
export function createToolkitDropdown(
  id: string,
  options: Array<{ value: string; label: string; selected?: boolean }>,
  attrs?: Record<string, string>
): string {
  const attrStr = Object.entries(attrs || {})
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(" ")

  const optionsHtml = options
    .map((o) => {
      const sel = o.selected ? " selected" : ""
      return `<vscode-option value="${escapeAttr(o.value)}"${sel}>${escapeHtml(o.label)}</vscode-option>`
    })
    .join("")

  return `<vscode-dropdown id="${escapeAttr(id)}" ${attrStr}>${optionsHtml}</vscode-dropdown>`
}

// HTML entity escape helpers using numeric codes to avoid entity decoding
const AMP = "\x26" + "amp;"   // &
const LT = "\x26" + "lt;"    // <
const GT = "\x26" + "gt;"    // >
const QUOT = "\x26" + "quot;" // "

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, AMP)
    .replace(/</g, LT)
    .replace(/>/g, GT)
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, AMP)
    .replace(/"/g, QUOT)
    .replace(/</g, LT)
    .replace(/>/g, GT)
}