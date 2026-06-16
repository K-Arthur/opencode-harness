/**
 * Per-shot orchestration for the screenshot pipeline.
 *
 * Loads a fixture, injects dark theme vars, dispatches messages,
 * waits for rendering, and captures an element-level screenshot
 * of just the OpenCode chat panel (#app) — no VS Code chrome.
 */
import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"
import { dispatchHostMessage } from "../webviewTestHarness"
import type { ScreenshotEntry } from "./catalog"
import { SHOT_VIEWPORT_DEFAULT } from "./catalog"

const FIXTURES_DIR = path.resolve(__dirname, "fixtures/sessions")
const OUTPUT_DIR = path.resolve(__dirname, "../../../media/screenshots/dark")

/**
 * CSS variables matching the ThemeManager dark preset.
 *
 * The CSS_VAR_MAP in src/theme/ThemeManager.ts maps CSS variable names
 * (e.g. "--oc-bg") to OpencodeTheme property names (e.g. "panelBg").
 * This object uses the exact CSS variable names that the webview references,
 * so applyThemeVars() sets them directly on document.documentElement.
 *
 * The "vscode-*" fallbacks are also set so any CSS that references
 * VS Code CSS variables directly (outside --oc-* tokens) also resolves.
 */
export const DARK_THEME_VARS: Record<string, string> = {
  // ─── Layout Shell ───
  "--oc-bg": "#1e1e2e",
  "--oc-fg": "#c9d1d9",
  "--color-fg": "#c9d1d9",
  "--oc-editor-bg": "#161b22",
  "--oc-editor-fg": "#e6edf3",
  "--oc-element-bg": "#21262d",
  "--oc-glass-bg": "#1e1e2e",
  "--bg-primary": "#1e1e2e",
  "--oc-border": "#30363d",
  "--color-border": "#30363d",
  "--oc-border-active": "#58a6ff",
  "--oc-border-subtle": "#21262d",
  "--oc-muted": "#8b949e",
  "--color-muted": "#8b949e",
  "--oc-description": "#8b949e",
  // ─── Messages ───
  "--oc-user-msg-bg": "#2d2d2d",
  "--oc-user-msg-fg": "#e0e0e0",
  "--oc-assistant-msg-bg": "rgba(30, 30, 30, 0.6)",
  "--oc-assistant-msg-fg": "#c9d1d9",
  // ─── Tool Calls ───
  "--tool-read-color": "#58a6ff",
  "--tool-write-color": "#f85149",
  "--tool-exec-color": "#3fb950",
  // ─── Skill Badge ───
  "--oc-skill-badge-bg": "#00e5ff",
  "--oc-skill-badge-fg": "#0b0e14",
  // ─── Thinking ───
  "--oc-thinking-bg": "rgba(255, 171, 0, 0.05)",
  "--oc-thinking-border": "#ffab00",
  // ─── Status ───
  "--oc-warning": "#ffab00",
  "--oc-error": "#ff5252",
  "--oc-success": "#00e676",
  "--oc-info": "#58a6ff",
  "--color-warning": "#ffab00",
  "--color-error": "#ff5252",
  "--color-success": "#00e676",
  "--oc-usage-good": "#3fb950",
  "--oc-usage-caution": "#d29922",
  "--oc-usage-warning": "#e06c00",
  "--oc-usage-critical": "#f85149",
  // ─── Accent / Primary ───
  "--oc-primary": "#58a6ff",
  "--oc-accent": "#00e5ff",
  "--color-accent": "#00e5ff",
  "--oc-accent-fg": "#ffffff",
  "--oc-accent-hover": "#33ebff",
  // ─── Diff ───
  "--oc-diff-added": "rgba(63, 185, 80, 0.15)",
  "--oc-diff-removed": "rgba(248, 81, 73, 0.1)",
  "--oc-diff-context": "rgba(201, 209, 217, 0.5)",
  "--oc-diff-hunk-header": "rgba(88, 166, 255, 0.7)",
  "--oc-diff-added-bg": "rgba(63, 185, 80, 0.08)",
  "--oc-diff-removed-bg": "rgba(248, 81, 73, 0.06)",
  "--oc-diff-context-bg": "rgba(201, 209, 217, 0.3)",
  "--oc-diff-line-number": "rgba(139, 148, 158, 0.4)",
  // ─── Input ───
  "--oc-input-bg": "#161b22",
  "--oc-input-border": "#70767d",
  "--oc-mention-bg": "#1f6feb",
  // ─── Markdown ───
  "--oc-markdown-text": "#c9d1d9",
  "--oc-markdown-heading": "#00e5ff",
  "--oc-markdown-link": "#58a6ff",
  "--oc-markdown-link-text": "#58a6ff",
  "--oc-markdown-code": "#58a6ff",
  "--oc-markdown-blockquote": "#8b949e",
  "--oc-markdown-emph": "#c9d1d9",
  "--oc-markdown-strong": "#c9d1d9",
  "--oc-markdown-hr": "#30363d",
  "--oc-markdown-list-item": "#c9d1d9",
  "--oc-markdown-list-enumeration": "#8b949e",
  "--oc-markdown-code-block": "#c9d1d9",
  // ─── Syntax ───
  "--oc-syn-comment": "#8c959f",
  "--oc-syn-keyword": "#ff7b72",
  "--oc-syn-string": "#a5d6ff",
  "--oc-syn-number": "#d2a8ff",
  "--oc-syn-function": "#d2a8ff",
  "--oc-syn-variable": "#c9d1d9",
  "--oc-syn-type": "#ffa657",
  "--oc-syn-operator": "#79c0ff",
  "--oc-syn-punctuation": "#c9d1d9",
  // ─── VS Code fallbacks (for any CSS that references --vscode-* directly) ───
  "--vscode-sideBar-background": "#1e1e2e",
  "--vscode-sideBar-foreground": "#c9d1d9",
  "--vscode-editor-background": "#161b22",
  "--vscode-editor-foreground": "#e6edf3",
  "--vscode-sideBar-border": "#30363d",
  "--vscode-widget-border": "#30363d",
  "--vscode-button-background": "#00e5ff",
  "--vscode-button-foreground": "#ffffff",
  "--vscode-button-hoverBackground": "#33ebff",
  "--vscode-focusBorder": "#58a6ff",
  "--vscode-descriptionForeground": "#8b949e",
  "--vscode-disabledForeground": "#8b949e",
  "--vscode-foreground": "#c9d1d9",
  "--vscode-input-background": "#161b22",
  "--vscode-input-border": "#70767d",
  "--vscode-input-foreground": "#e6edf3",
  "--vscode-list-hoverBackground": "#21262d",
  "--vscode-list-activeSelectionBackground": "#1f6feb",
  "--vscode-list-activeSelectionForeground": "#ffffff",
  "--vscode-list-warningForeground": "#ffab00",
  "--vscode-errorForeground": "#ff5252",
  "--vscode-textLink-foreground": "#58a6ff",
  "--vscode-badge-background": "#00e5ff",
  "--vscode-badge-foreground": "#0b0e14",
  "--vscode-charts-yellow": "#ffab00",
  "--vscode-charts-green": "#00e676",
  "--vscode-diffEditor-insertedTextBackground": "rgba(63, 185, 80, 0.15)",
  "--vscode-diffEditor-removedTextBackground": "rgba(248, 81, 73, 0.1)",
  "--vscode-editor-selectionBackground": "#1f6feb",
  "--vscode-symbolIcon-propertyForeground": "#d19a66",
  "--vscode-symbolIcon-variableForeground": "#58a6ff",
  "--vscode-symbolIcon-keywordForeground": "#ff7b72",
  "--vscode-symbolIcon-stringForeground": "#a5d6ff",
  "--vscode-symbolIcon-numberForeground": "#d2a8ff",
  "--vscode-symbolIcon-functionForeground": "#d2a8ff",
  "--vscode-symbolIcon-classForeground": "#ffa657",
  "--vscode-symbolIcon-operatorForeground": "#79c0ff",
  "--vscode-testing-iconPassed": "#00e676",
  "--vscode-editorWarning-foreground": "#ffab00",
}

/**
 * Light preset CSS variables — used for the one screenshot that
 * showcases the theming feature (model-controls).
 */
export const LIGHT_THEME_VARS: Record<string, string> = {
  // ─── Layout Shell ───
  "--oc-bg": "#f6f8fa",
  "--oc-fg": "#24292f",
  "--color-fg": "#24292f",
  "--oc-editor-bg": "#ffffff",
  "--oc-editor-fg": "#1f2328",
  "--oc-element-bg": "#f0f0f0",
  "--oc-glass-bg": "#f6f8fa",
  "--bg-primary": "#f6f8fa",
  "--oc-border": "#8b949e",
  "--color-border": "#8b949e",
  "--oc-border-active": "#0969da",
  "--oc-border-subtle": "#d0d7de",
  "--oc-muted": "#656d76",
  "--color-muted": "#656d76",
  "--oc-description": "#656d76",
  // ─── Messages ───
  "--oc-user-msg-bg": "#f3f3f3",
  "--oc-user-msg-fg": "#333333",
  "--oc-assistant-msg-bg": "rgba(255, 255, 255, 0.8)",
  "--oc-assistant-msg-fg": "#24292f",
  // ─── Tool Calls ───
  "--tool-read-color": "#0550ae",
  "--tool-write-color": "#cf222e",
  "--tool-exec-color": "#116329",
  // ─── Skill Badge ───
  "--oc-skill-badge-bg": "#0550ae",
  "--oc-skill-badge-fg": "#ffffff",
  // ─── Thinking ───
  "--oc-thinking-bg": "rgba(154, 103, 0, 0.06)",
  "--oc-thinking-border": "#9a6700",
  // ─── Status ───
  "--oc-warning": "#9a6700",
  "--oc-error": "#cf222e",
  "--oc-success": "#116329",
  "--oc-info": "#0550ae",
  "--color-warning": "#9a6700",
  "--color-error": "#cf222e",
  "--color-success": "#116329",
  "--oc-usage-good": "#2da44e",
  "--oc-usage-caution": "#9a6700",
  "--oc-usage-warning": "#e06c00",
  "--oc-usage-critical": "#cf222e",
  // ─── Accent / Primary ───
  "--oc-primary": "#0969da",
  "--oc-accent": "#0969da",
  "--color-accent": "#0969da",
  "--oc-accent-fg": "#ffffff",
  "--oc-accent-hover": "#1158c7",
  // ─── Diff ───
  "--oc-diff-added": "rgba(45, 164, 78, 0.15)",
  "--oc-diff-removed": "rgba(207, 34, 46, 0.1)",
  "--oc-diff-context": "rgba(36, 41, 47, 0.5)",
  "--oc-diff-hunk-header": "rgba(5, 80, 174, 0.7)",
  "--oc-diff-added-bg": "rgba(45, 164, 78, 0.08)",
  "--oc-diff-removed-bg": "rgba(207, 34, 46, 0.06)",
  "--oc-diff-context-bg": "rgba(36, 41, 47, 0.3)",
  "--oc-diff-line-number": "rgba(101, 109, 18, 0.4)",
  // ─── Input ───
  "--oc-input-bg": "#ffffff",
  "--oc-input-border": "#8b949e",
  "--oc-mention-bg": "#ddf4ff",
  // ─── Markdown ───
  "--oc-markdown-text": "#24292f",
  "--oc-markdown-heading": "#0969da",
  "--oc-markdown-link": "#0550ae",
  "--oc-markdown-link-text": "#0550ae",
  "--oc-markdown-code": "#0550ae",
  "--oc-markdown-blockquote": "#656d76",
  "--oc-markdown-emph": "#24292f",
  "--oc-markdown-strong": "#24292f",
  "--oc-markdown-hr": "#d0d7de",
  "--oc-markdown-list-item": "#24292f",
  "--oc-markdown-list-enumeration": "#656d76",
  "--oc-markdown-code-block": "#24292f",
  // ─── Syntax ───
  "--oc-syn-comment": "#67707a",
  "--oc-syn-keyword": "#0550ae",
  "--oc-syn-string": "#0a3069",
  "--oc-syn-number": "#0550ae",
  "--oc-syn-function": "#8250df",
  "--oc-syn-variable": "#24292f",
  "--oc-syn-type": "#116329",
  "--oc-syn-operator": "#1e1e1e",
  "--oc-syn-punctuation": "#24292f",
  // ─── VS Code fallbacks ───
  "--vscode-sideBar-background": "#f6f8fa",
  "--vscode-sideBar-foreground": "#24292f",
  "--vscode-editor-background": "#ffffff",
  "--vscode-editor-foreground": "#1f2328",
  "--vscode-sideBar-border": "#8b949e",
  "--vscode-widget-border": "#8b949e",
  "--vscode-button-background": "#0969da",
  "--vscode-button-foreground": "#ffffff",
  "--vscode-button-hoverBackground": "#1158c7",
  "--vscode-focusBorder": "#0969da",
  "--vscode-descriptionForeground": "#656d76",
  "--vscode-disabledForeground": "#656d76",
  "--vscode-foreground": "#24292f",
  "--vscode-input-background": "#ffffff",
  "--vscode-input-border": "#8b949e",
  "--vscode-input-foreground": "#1f2328",
  "--vscode-list-hoverBackground": "#f0f0f0",
  "--vscode-list-activeSelectionBackground": "#ddf4ff",
  "--vscode-list-activeSelectionForeground": "#24292f",
  "--vscode-list-warningForeground": "#9a6700",
  "--vscode-errorForeground": "#cf222e",
  "--vscode-textLink-foreground": "#0550ae",
  "--vscode-badge-background": "#0550ae",
  "--vscode-badge-foreground": "#ffffff",
  "--vscode-charts-yellow": "#9a6700",
  "--vscode-charts-green": "#116329",
  "--vscode-diffEditor-insertedTextBackground": "rgba(45, 164, 78, 0.15)",
  "--vscode-diffEditor-removedTextBackground": "rgba(207, 34, 46, 0.1)",
  "--vscode-editor-selectionBackground": "#ddf4ff",
  "--vscode-symbolIcon-propertyForeground": "#953800",
  "--vscode-symbolIcon-variableForeground": "#0550ae",
  "--vscode-symbolIcon-keywordForeground": "#0550ae",
  "--vscode-symbolIcon-stringForeground": "#0a3069",
  "--vscode-symbolIcon-numberForeground": "#0550ae",
  "--vscode-symbolIcon-functionForeground": "#8250df",
  "--vscode-symbolIcon-classForeground": "#116329",
  "--vscode-symbolIcon-operatorForeground": "#1e1e1e",
  "--vscode-testing-iconPassed": "#116329",
  "--vscode-editorWarning-foreground": "#9a6700",
}

/**
 * Load a fixture JSON from the fixtures directory.
 */
function loadFixture(name: string): Record<string, unknown> {
  const filePath = path.join(FIXTURES_DIR, name)
  return JSON.parse(fs.readFileSync(filePath, "utf-8"))
}

/**
 * Capture a single screenshot of the OpenCode panel.
 *
 * Sets a tight panel-only viewport, injects theme vars,
 * dispatches the fixture, and screenshots the #app element
 * so the result is cropped to just the extension UI.
 */
export async function captureShot(page: Page, entry: ScreenshotEntry): Promise<string> {
  const vp = entry.viewport || SHOT_VIEWPORT_DEFAULT
  await page.setViewportSize(vp)

  // Use light theme only if explicitly marked; dark is the default
  const themeVars = entry.theme === "light" ? LIGHT_THEME_VARS : DARK_THEME_VARS
  await dispatchHostMessage(page, { type: "theme_vars", vars: themeVars })

  // Load and dispatch the fixture
  const fixture = loadFixture(entry.fixture)
  await dispatchHostMessage(page, fixture as Record<string, unknown>)

  // Dispatch any extra messages (e.g., model_list)
  if (entry.extraMessages) {
    for (const msg of entry.extraMessages) {
      await dispatchHostMessage(page, msg)
    }
  }

  // Wait for required elements to be visible
  for (const selector of entry.waitSelectors) {
    await expect(page.locator(selector).first()).toBeVisible({ timeout: 10000 })
  }

  // Small settle delay for rendering to complete
  await page.waitForTimeout(800)

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  // Screenshot just the #app element (the OpenCode panel) — crops out any page background
  const outputPath = path.join(OUTPUT_DIR, `${entry.name}.png`)
  const app = page.locator("#app")
  await app.screenshot({ path: outputPath })

  return outputPath
}
