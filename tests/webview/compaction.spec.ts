import { test, expect } from "@playwright/test"
import {
  installVsCodeApi,
  dispatchHostMessage,
  postedMessages,
  expectNoBrowserErrors,
  captureErrors,
} from "../visual/webviewTestHarness"

// End-to-end coverage for the compaction flow that was previously
// silently broken (the host emitted compact_banner messages that the
// webview ignored).
test.describe("Compaction flow", () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
  })

  test("compact_banner from host renders an interactive banner", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "s",
          name: "T",
          model: "anthropic/claude-sonnet-4-6-20251015",
          messages: [],
          tokenUsage: { prompt: 160000, completion: 0, total: 160000 },
        },
      ],
      activeSessionId: "s",
    })

    await page.waitForSelector('.tab-panel[data-tab-id="s"]', { timeout: 5000 })

    await dispatchHostMessage(page, {
      type: "compact_banner",
      sessionId: "s",
      percent: 82,
      tokens: 164000,
      maxTokens: 200000,
      actions: ["compact_now", "remind_later"],
    })

    const banner = page.locator(".compact-banner")
    await expect(banner).toBeVisible({ timeout: 5000 })
    await expect(banner).toContainText("82%")
    await expect(banner).toContainText("164,000")
    await expect(banner).toContainText("200,000")

    const buttons = banner.locator(".compact-banner-btn")
    await expect(buttons).toHaveCount(2)

    expectNoBrowserErrors(captured)
  })

  test("clicking 'Compact now' posts compact_banner_action and hides the banner", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "s",
          name: "T",
          model: "anthropic/claude-sonnet-4-6-20251015",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "s",
    })

    await page.waitForSelector('.tab-panel[data-tab-id="s"]', { timeout: 5000 })

    await dispatchHostMessage(page, {
      type: "compact_banner",
      sessionId: "s",
      percent: 90,
      tokens: 180000,
      maxTokens: 200000,
      actions: ["compact_now", "remind_later"],
    })

    await page.locator(".compact-banner-btn--primary").click()

    // Banner hides optimistically
    await expect(page.locator(".compact-banner")).toHaveCount(0)

    const msgs = await postedMessages(page)
    const action = msgs.find((m) => m.type === "compact_banner_action")
    expect(action).toBeDefined()
    expect(action!.action).toBe("compact_now")
    expect(action!.sessionId).toBe("s")
  })

  test("compact_banner_dismissed from host removes the banner", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "s",
          name: "T",
          model: "anthropic/claude-sonnet-4-6-20251015",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "s",
    })

    await page.waitForSelector('.tab-panel[data-tab-id="s"]', { timeout: 5000 })

    await dispatchHostMessage(page, {
      type: "compact_banner",
      sessionId: "s",
      percent: 80,
      tokens: 160000,
      maxTokens: 200000,
    })

    await expect(page.locator(".compact-banner")).toBeVisible()

    await dispatchHostMessage(page, {
      type: "compact_banner_dismissed",
      sessionId: "s",
    })

    await expect(page.locator(".compact-banner")).toHaveCount(0)
  })

  test("session_compacted hides the banner AND posts a resume_session to refresh messages", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "s",
          name: "T",
          model: "anthropic/claude-sonnet-4-6-20251015",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "s",
    })

    await page.waitForSelector('.tab-panel[data-tab-id="s"]', { timeout: 5000 })

    await dispatchHostMessage(page, {
      type: "compact_banner",
      sessionId: "s",
      percent: 85,
      tokens: 170000,
      maxTokens: 200000,
    })
    await expect(page.locator(".compact-banner")).toBeVisible()

    await dispatchHostMessage(page, { type: "session_compacted", sessionId: "s" })

    // Banner is removed (no stacking with the success indicator).
    await expect(page.locator(".compact-banner")).toHaveCount(0)

    // Refresh request is posted so the visual message list updates to the
    // post-compact state instead of continuing to show stale messages.
    const msgs = await postedMessages(page)
    const refresh = msgs.find((m) => m.type === "resume_session" && m.sessionId === "s")
    expect(refresh).toBeDefined()
  })

  test("a second compact_banner replaces the first instead of stacking", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "s",
          name: "T",
          model: "anthropic/claude-sonnet-4-6-20251015",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "s",
    })

    await page.waitForSelector('.tab-panel[data-tab-id="s"]', { timeout: 5000 })

    await dispatchHostMessage(page, {
      type: "compact_banner", sessionId: "s", percent: 80, tokens: 160000, maxTokens: 200000,
    })
    await dispatchHostMessage(page, {
      type: "compact_banner", sessionId: "s", percent: 85, tokens: 170000, maxTokens: 200000,
    })

    const banners = page.locator(".compact-banner")
    await expect(banners).toHaveCount(1)
    await expect(banners).toContainText("85%")
  })
})
