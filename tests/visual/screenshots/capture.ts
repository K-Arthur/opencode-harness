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

/** Dark preset CSS variables matching src/theme/ThemeManager.ts dark preset. */
export const DARK_THEME_VARS: Record<string, string> = {
  "--panelBg": "#1e1e2e",
  "--panelFg": "#c9d1d9",
  "--editorBg": "#161b22",
  "--editorFg": "#e6edf3",
  "--elementBg": "#21262d",
  "--borderColor": "#30363d",
  "--borderActive": "#58a6ff",
  "--borderSubtle": "#21262d",
  "--mutedFg": "#8b949e",
  "--userMessageBg": "#2d2d2d",
  "--userMessageFg": "#e0e0e0",
  "--assistantMessageBg": "rgba(30, 30, 30, 0.6)",
  "--assistantMessageFg": "#c9d1d9",
  "--toolCallColor": "#d19a66",
  "--toolReadColor": "#58a6ff",
  "--toolWriteColor": "#f85149",
  "--toolExecColor": "#3fb950",
  "--skillBadgeBg": "#00e5ff",
  "--skillBadgeFg": "#0b0e14",
  "--thinkingBg": "rgba(255, 171, 0, 0.05)",
  "--thinkingBorder": "#ffab00",
  "--warningColor": "#ffab00",
  "--errorColor": "#ff5252",
  "--successColor": "#00e676",
  "--infoColor": "#58a6ff",
  "--accentColor": "#00e5ff",
  "--primaryColor": "#58a6ff",
  "--diffAdded": "rgba(63, 185, 80, 0.15)",
  "--diffRemoved": "rgba(248, 81, 73, 0.1)",
  "--diffContext": "rgba(201, 209, 217, 0.5)",
  "--diffHunkHeader": "rgba(88, 166, 255, 0.7)",
  "--diffAddedBg": "rgba(63, 185, 80, 0.08)",
  "--diffRemovedBg": "rgba(248, 81, 73, 0.06)",
  "--diffLineNumber": "rgba(139, 148, 158, 0.4)",
  "--inputBg": "#161b22",
  "--inputBorder": "#70767d",
  "--mentionBg": "#1f6feb",
  "--usageGood": "#3fb950",
  "--usageCaution": "#d29922",
  "--usageWarning": "#e06c00",
  "--usageCritical": "#f85149",
  "--markdownText": "#c9d1d9",
  "--markdownHeading": "#00e5ff",
  "--markdownLink": "#58a6ff",
  "--markdownLinkText": "#58a6ff",
  "--markdownCode": "#58a6ff",
  "--markdownBlockQuote": "#8b949e",
  "--markdownEmph": "#c9d1d9",
  "--markdownStrong": "#c9d1d9",
  "--markdownHorizontalRule": "#30363d",
  "--markdownListItem": "#c9d1d9",
  "--markdownListEnumeration": "#8b949e",
  "--markdownCodeBlock": "#c9d1d9",
  "--syntaxComment": "#8c959f",
  "--syntaxKeyword": "#ff7b72",
  "--syntaxString": "#a5d6ff",
  "--syntaxNumber": "#d2a8ff",
  "--syntaxFunction": "#d2a8ff",
  "--syntaxVariable": "#c9d1d9",
  "--syntaxType": "#ffa657",
  "--syntaxOperator": "#79c0ff",
  "--syntaxPunctuation": "#c9d1d9",
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
 * Sets a tight panel-only viewport, injects dark theme vars,
 * dispatches the fixture, and screenshots the #app element
 * so the result is cropped to just the extension UI.
 */
export async function captureShot(page: Page, entry: ScreenshotEntry): Promise<string> {
  const vp = entry.viewport || SHOT_VIEWPORT_DEFAULT
  await page.setViewportSize(vp)

  // Push dark theme CSS variables so webview text is readable
  await dispatchHostMessage(page, { type: "theme_vars", vars: DARK_THEME_VARS })

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
