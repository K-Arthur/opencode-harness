/**
 * Screenshot generation spec.
 *
 * Runs through the catalog, loads each fixture into the webview,
 * injects the synthetic VS Code frame, waits for rendering,
 * and writes PNGs to media/screenshots/dark/.
 *
 * Run: npx playwright test --project=screenshots-generate
 */
import { test } from "@playwright/test"
import { catalog } from "./catalog"
import { captureShot } from "./capture"
import { installVsCodeApi, expectNoWebviewErrors } from "../webviewTestHarness"

test.describe("Screenshot Generation", () => {
  for (const entry of catalog) {
    test(`generate: ${entry.name}`, async ({ page }) => {
      await installVsCodeApi(page)
      await page.goto("/")
      await captureShot(page, entry)
      await expectNoWebviewErrors(page)
    })
  }
})
