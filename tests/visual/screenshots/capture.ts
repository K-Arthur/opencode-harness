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
  // ─── Layout Shell — VS Code Default Dark+ ───
  "--oc-bg": "#252526",
  "--oc-fg": "#cccccc",
  "--color-fg": "#cccccc",
  "--oc-editor-bg": "#1e1e1e",
  "--oc-editor-fg": "#d4d4d4",
  "--oc-element-bg": "#2d2d2d",
  "--oc-glass-bg": "#252526",
  "--bg-primary": "#252526",
  "--oc-border": "#474747",
  "--color-border": "#474747",
  "--oc-border-active": "#007fd4",
  "--oc-border-subtle": "#3c3c3c",
  "--oc-muted": "#969696",
  "--color-muted": "#969696",
  "--oc-description": "#969696",
  // ─── Messages (cli-default: uses editor bg/fg) ───
  "--oc-user-msg-bg": "#1e1e1e",
  "--oc-user-msg-fg": "#d4d4d4",
  "--oc-assistant-msg-bg": "transparent",
  "--oc-assistant-msg-fg": "#d4d4d4",
  // ─── Tool Calls ───
  "--tool-read-color": "#9cdcfe",
  "--tool-write-color": "#f48771",
  "--tool-exec-color": "#89d185",
  // ─── Skill Badge ───
  "--oc-skill-badge-bg": "#4d4d4d",
  "--oc-skill-badge-fg": "#ffffff",
  // ─── Thinking ───
  "--oc-thinking-bg": "rgba(210, 153, 34, 0.08)",
  "--oc-thinking-border": "#d29922",
  // ─── Status ───
  "--oc-warning": "#d29922",
  "--oc-error": "#f48771",
  "--oc-success": "#4ec9b0",
  "--oc-info": "#3794ff",
  "--color-warning": "#d29922",
  "--color-error": "#f48771",
  "--color-success": "#4ec9b0",
  "--oc-usage-good": "#4ec9b0",
  "--oc-usage-caution": "#d29922",
  "--oc-usage-warning": "#cc7832",
  "--oc-usage-critical": "#f44747",
  // ─── Accent / Primary ───
  "--oc-primary": "#3794ff",
  "--oc-accent": "#0e639c",
  "--color-accent": "#0e639c",
  "--oc-accent-fg": "#ffffff",
  "--oc-accent-hover": "#1177bb",
  // ─── Diff ───
  "--oc-diff-added": "rgba(78, 201, 176, 0.15)",
  "--oc-diff-removed": "rgba(244, 71, 71, 0.1)",
  "--oc-diff-context": "rgba(212, 212, 212, 0.5)",
  "--oc-diff-hunk-header": "rgba(55, 148, 255, 0.7)",
  "--oc-diff-added-bg": "rgba(78, 201, 176, 0.08)",
  "--oc-diff-removed-bg": "rgba(244, 71, 71, 0.06)",
  "--oc-diff-context-bg": "rgba(212, 212, 212, 0.3)",
  "--oc-diff-line-number": "rgba(150, 150, 150, 0.4)",
  // ─── Input ───
  "--oc-input-bg": "#3c3c3c",
  "--oc-input-border": "#5a5a5a",
  "--oc-mention-bg": "#264f78",
  // ─── Markdown ───
  "--oc-markdown-text": "#cccccc",
  "--oc-markdown-heading": "#3794ff",
  "--oc-markdown-link": "#3794ff",
  "--oc-markdown-link-text": "#3794ff",
  "--oc-markdown-code": "#ce9178",
  "--oc-markdown-blockquote": "#969696",
  "--oc-markdown-emph": "#cccccc",
  "--oc-markdown-strong": "#cccccc",
  "--oc-markdown-hr": "#474747",
  "--oc-markdown-list-item": "#cccccc",
  "--oc-markdown-list-enumeration": "#969696",
  "--oc-markdown-code-block": "#d4d4d4",
  // ─── Syntax ───
  "--oc-syn-comment": "#6a9955",
  "--oc-syn-keyword": "#569cd6",
  "--oc-syn-string": "#ce9178",
  "--oc-syn-number": "#b5cea8",
  "--oc-syn-function": "#dcdcaa",
  "--oc-syn-variable": "#9cdcfe",
  "--oc-syn-type": "#4ec9b0",
  "--oc-syn-operator": "#d4d4d4",
  "--oc-syn-punctuation": "#d4d4d4",
  // ─── VS Code Default Dark+ fallbacks ───
  "--vscode-sideBar-background": "#252526",
  "--vscode-sideBar-foreground": "#cccccc",
  "--vscode-editor-background": "#1e1e1e",
  "--vscode-editor-foreground": "#d4d4d4",
  "--vscode-sideBar-border": "#474747",
  "--vscode-widget-border": "#474747",
  "--vscode-button-background": "#0e639c",
  "--vscode-button-foreground": "#ffffff",
  "--vscode-button-hoverBackground": "#1177bb",
  "--vscode-focusBorder": "#007fd4",
  "--vscode-descriptionForeground": "#969696",
  "--vscode-disabledForeground": "#7a7a7a",
  "--vscode-foreground": "#cccccc",
  "--vscode-input-background": "#3c3c3c",
  "--vscode-input-border": "#5a5a5a",
  "--vscode-input-foreground": "#cccccc",
  "--vscode-list-hoverBackground": "#2a2d2e",
  "--vscode-list-activeSelectionBackground": "#04395e",
  "--vscode-list-activeSelectionForeground": "#ffffff",
  "--vscode-list-warningForeground": "#d29922",
  "--vscode-errorForeground": "#f48771",
  "--vscode-textLink-foreground": "#3794ff",
  "--vscode-badge-background": "#4d4d4d",
  "--vscode-badge-foreground": "#ffffff",
  "--vscode-charts-yellow": "#d29922",
  "--vscode-charts-green": "#4ec9b0",
  "--vscode-diffEditor-insertedTextBackground": "rgba(78, 201, 176, 0.15)",
  "--vscode-diffEditor-removedTextBackground": "rgba(244, 71, 71, 0.1)",
  "--vscode-editor-selectionBackground": "#264f78",
  "--vscode-symbolIcon-propertyForeground": "#d19a66",
  "--vscode-symbolIcon-variableForeground": "#3794ff",
  "--vscode-symbolIcon-keywordForeground": "#569cd6",
  "--vscode-symbolIcon-stringForeground": "#ce9178",
  "--vscode-symbolIcon-numberForeground": "#b5cea8",
  "--vscode-symbolIcon-functionForeground": "#dcdcaa",
  "--vscode-symbolIcon-classForeground": "#4ec9b0",
  "--vscode-symbolIcon-operatorForeground": "#d4d4d4",
  "--vscode-testing-iconPassed": "#4ec9b0",
  "--vscode-editorWarning-foreground": "#d29922",
  "--vscode-debugIcon-startForeground": "#89d185",
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
