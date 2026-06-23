/**
 * Screenshot verification spec.
 *
 * Compares current screenshots against committed baselines.
 * Fails CI if any screenshot drifts beyond the configured threshold.
 *
 * Run: npx playwright test --project=screenshots-verify
 * Update baselines: npx playwright test --project=screenshots-verify --update-snapshots
 */
import { test, expect } from "@playwright/test"
import { catalog, SHOT_VIEWPORT_DEFAULT } from "./catalog"
import { installVsCodeApi, dispatchHostMessage, expectNoWebviewErrors } from "../webviewTestHarness"
import { loadFixture } from "./fixture-utils"
import { DARK_THEME_VARS, LIGHT_THEME_VARS } from "./capture"

test.describe("Screenshot Verification", () => {
  for (const entry of catalog) {
    test(`verify: ${entry.name}`, async ({ page }) => {
      const vp = entry.viewport || SHOT_VIEWPORT_DEFAULT
      await page.setViewportSize(vp)
      await installVsCodeApi(page)
      await page.goto("/")

      // Use light theme only if explicitly marked; dark is the default
      const themeVars = entry.theme === "light" ? LIGHT_THEME_VARS : DARK_THEME_VARS
      await dispatchHostMessage(page, { type: "theme_vars", vars: themeVars })

      const fixture = loadFixture(entry.fixture)
      await dispatchHostMessage(page, fixture)

      if (entry.extraMessages) {
        for (const msg of entry.extraMessages) {
          await dispatchHostMessage(page, msg)
        }
      }

      for (const selector of entry.waitSelectors) {
        await expect(page.locator(selector).first()).toBeVisible({ timeout: 10000 })
      }

      await page.waitForTimeout(800)

      // Screenshot just the #app element (the OpenCode panel) — crops out any page background.
      // Use maxDiffPixelRatio (not maxDiffPixels) so the tolerance scales with image size
      // and accommodates cross-environment font rendering differences (local vs CI runners).
      await expect(page.locator("#app")).toHaveScreenshot(`${entry.name}.png`, {
        maxDiffPixelRatio: 0.15,
        threshold: 0.06,
      })

      await expectNoWebviewErrors(page)
    })
  }
})
