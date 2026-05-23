import { test, expect } from "@playwright/test"
import {
  installVsCodeApi,
  dispatchHostMessage,
  postedMessages,
  expectNoBrowserErrors,
  captureErrors,
} from "../visual/webviewTestHarness"

// End-to-end webview tests that drive the standalone-served bundle through
// the same host→webview message contract used at runtime. These verify the
// four user-visible fixes:
//   A) StreamCoordinator log-storm (no webview-side observable, covered by unit tests)
//   B) Changed-files chips render per-language colored badges
//   C) Model picker reflects the active session's model on restore
//   D) Context usage bar resets when switching tabs
test.describe("Chat Webview E2E", () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
  })

  // Fix C: a restored session's model must win over the global model.
  // We seed two sessions with different models and verify init_state's
  // active session model is what shows in the dropdown label, not the
  // global default.
  test("model picker shows the active session's model on restore", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "session-a",
          name: "Session A",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
        {
          id: "session-b",
          name: "Session B",
          model: "openai/gpt-4o",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "session-b",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })

    // The dropdown's short label shows the part after the last slash —
    // active session's model is gpt-4o, NOT the global sonnet model.
    const label = page.locator("#model-label")
    await expect(label).toHaveText(/gpt-4o/, { timeout: 5000 })

    expectNoBrowserErrors(captured)
  })

  // Fix D: switching tabs must zero out the context-usage bar so the previous
  // tab's totals don't bleed into the new one.
  test("context usage bar resets when switching to a tab with zero tokens", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "session-loaded",
          name: "Loaded",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          tokenUsage: { prompt: 5000, completion: 3000, total: 8000 },
        },
        {
          id: "session-empty",
          name: "Empty",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "session-loaded",
    })

    // Push some usage on the loaded session
    await dispatchHostMessage(page, {
      type: "context_usage",
      tokens: 8000,
      maxTokens: 200000,
      percent: 4,
    })

    // Switch to the empty session via the same host event the extension
    // sends when the active session changes.
    await dispatchHostMessage(page, {
      type: "active_session_changed",
      sessionId: "session-empty",
    })

    const bar = page.locator("#context-usage")
    // After switch the bar should be hidden again (no usage on the new tab).
    await expect(bar).toHaveClass(/hidden/, { timeout: 3000 })

    expectNoBrowserErrors(captured)
  })

  // Fix B: changed-files chips render with distinct per-language colored
  // monogram badges, not identical generic SVGs.
  test("changed-files chips render per-language colored badges", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "s",
          name: "T",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
          changedFiles: ["src/foo.ts", "src/bar.py", "README.md", "config.json"],
        },
      ],
      activeSessionId: "s",
    })

    await page.waitForSelector(".changed-file-chip", { timeout: 5000 })

    // One chip per file
    await expect(page.locator(".changed-file-chip")).toHaveCount(4)

    // Per-language classes should each appear at least once
    await expect(page.locator(".changed-file-icon--ts")).toHaveCount(1)
    await expect(page.locator(".changed-file-icon--py")).toHaveCount(1)
    await expect(page.locator(".changed-file-icon--md")).toHaveCount(1)
    await expect(page.locator(".changed-file-icon--json")).toHaveCount(1)

    // Icons must contain visible text labels (not just SVGs)
    const tsIcon = page.locator(".changed-file-icon--ts").first()
    await expect(tsIcon).toHaveText("TS")

    // Icons must be aria-hidden so screen readers skip the badge
    await expect(tsIcon).toHaveAttribute("aria-hidden", "true")

    expectNoBrowserErrors(captured)
  })

  // Regression: changed-files component supports more than the legacy core
  // set — kotlin, shell, yaml, html should all map to a distinct badge.
  test("changed-files chips cover extended language set", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "s",
          name: "T",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
          changedFiles: [
            "app/Main.kt",
            "scripts/deploy.sh",
            "ci/workflow.yaml",
            "public/index.html",
            "schema/migration.sql",
          ],
        },
      ],
      activeSessionId: "s",
    })

    await page.waitForSelector(".changed-file-chip", { timeout: 5000 })

    await expect(page.locator(".changed-file-icon--kt")).toHaveCount(1)
    await expect(page.locator(".changed-file-icon--sh")).toHaveCount(1)
    await expect(page.locator(".changed-file-icon--yaml")).toHaveCount(1)
    await expect(page.locator(".changed-file-icon--html")).toHaveCount(1)
    await expect(page.locator(".changed-file-icon--sql")).toHaveCount(1)

    expectNoBrowserErrors(captured)
  })

  // Fix C round-trip: when the user changes model via the dropdown, the
  // webview should post a set_model message so the host can persist it.
  test("model dropdown posts set_model when user picks a new model", async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "s",
          name: "T",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "s",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })

    // Inject a model list so the dropdown has selectable entries
    await dispatchHostMessage(page, {
      type: "model_list",
      items: [
        { id: "claude-3-5-sonnet-20241022", provider: "anthropic", displayName: "Claude Sonnet 3.5", contextWindow: 200000 },
        { id: "gpt-4o", provider: "openai", displayName: "GPT-4o", contextWindow: 128000 },
      ],
      model: "anthropic/claude-3-5-sonnet-20241022",
    })

    // Open the dropdown and choose the other model
    await page.click("#model-selector-btn")
    await page.locator('[role="option"]').filter({ hasText: /GPT-4o/i }).first().click()

    const messages = await postedMessages(page)
    const setModelMsg = messages.find((m) => m.type === "set_model")
    expect(setModelMsg).toBeDefined()
    expect(String(setModelMsg!.model)).toMatch(/gpt-4o/)
  })

  // Test: context usage shows tokens-only when maxTokens is unknown
  test("context usage shows tokens-only when maxTokens is unknown", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "session-a",
          name: "Session A",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "session-a",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })

    // Send context_usage with maxTokens = 0 (unknown)
    await dispatchHostMessage(page, {
      type: "context_usage",
      percent: 0,
      tokens: 12345,
      maxTokens: 0,
    })

    // Verify the context monitor shows tokens-only text
    const contextMonitor = page.locator(".context-monitor")
    await expect(contextMonitor).not.toHaveClass(/hidden/)

    const contextText = contextMonitor.locator(".context-text")
    await expect(contextText).toHaveText(/tokens \(limit unknown\)/)

    await expectNoBrowserErrors(captured)
  })
})
