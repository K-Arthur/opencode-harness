import { test, expect } from "@playwright/test"
import { installVsCodeApi, expectNoWebviewErrors } from "./webviewTestHarness"

/**
 * Drives the REAL Agent Activity Timeline as wired by the built bundle:
 * the toolbar toggle button → setupActivityPanel.open()/close() → filter chips,
 * styled by the real activity.css. (Event-row derivation is covered exhaustively
 * by the jsdom unit tests in activity-panel.dom.test.ts / activityModel.test.ts.)
 */
async function openSettingsMenu(page: import("@playwright/test").Page) {
  await page.locator("#settings-btn").click()
  await expect(page.locator("#settings-menu")).not.toHaveClass(/hidden/)
}

test.describe("Agent Activity Timeline", () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto("/")
    // The Activity panel is used during an active session, when the welcome
    // overlay is hidden. Remove it so the panel is interactable (mirrors the
    // other visual specs which clear the welcome view before driving the UI).
    await page.evaluate(() => {
      document.getElementById("welcome-view")?.remove()
      document.querySelector(".welcome-container")?.remove()
    })
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test("toolbar exposes an accessible activity toggle", async ({ page }) => {
    const btn = page.locator("#activity-toggle-btn")
    await expect(btn).toHaveAttribute("aria-label", /activity/i)
    await expect(btn).toHaveAttribute("aria-controls", "activity-panel")
    await expect(btn).toHaveAttribute("aria-pressed", "false")
  })

  test("clicking the toggle opens the panel with all seven filter chips", async ({ page }) => {
    const panel = page.locator("#activity-panel")
    await expect(panel).toBeHidden()

    await openSettingsMenu(page)
    await page.locator("#activity-toggle-btn").click()

    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute("aria-labelledby", "activity-panel-title")
    await expect(page.locator("#activity-panel-title")).toHaveText("Activity")
    await expect(page.locator("#activity-toggle-btn")).toHaveAttribute("aria-pressed", "true")

    const chips = page.locator(".activity-filter-chip")
    await expect(chips).toHaveCount(7)
    await expect(page.locator('.activity-filter-chip[data-filter="all"]')).toHaveText("All")
    await expect(page.locator('.activity-filter-chip[data-filter="errors"]')).toHaveText("Errors")
  })

  test("toggling again closes the panel and resets aria-pressed", async ({ page }) => {
    await openSettingsMenu(page)
    await page.locator("#activity-toggle-btn").click()
    await expect(page.locator("#activity-panel")).toBeVisible()

    await openSettingsMenu(page)
    await page.locator("#activity-toggle-btn").click()
    await expect(page.locator("#activity-panel")).toBeHidden()
    await expect(page.locator("#activity-toggle-btn")).toHaveAttribute("aria-pressed", "false")
  })

  test("the close button dismisses the panel", async ({ page }) => {
    await openSettingsMenu(page)
    await page.locator("#activity-toggle-btn").click()
    await expect(page.locator("#activity-panel")).toBeVisible()
    await page.locator("#activity-close-btn").click()
    await expect(page.locator("#activity-panel")).toBeHidden()
  })

  test("filter chips are pill-shaped and themed (real activity.css applied)", async ({ page }) => {
    await openSettingsMenu(page)
    await page.locator("#activity-toggle-btn").click()
    const chip = page.locator('.activity-filter-chip[data-filter="all"]')
    // border-radius: 999px in activity.css resolves to a large pixel radius.
    const radius = await chip.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius))
    expect(radius).toBeGreaterThan(8)
  })
})
