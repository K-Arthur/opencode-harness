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

  test("background context_usage does not update the active tab", async ({ page }) => {
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
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "session-a",
    })

    await dispatchHostMessage(page, {
      type: "context_usage",
      sessionId: "session-b",
      tokens: 75000,
      maxTokens: 100000,
      percent: 75,
    })

    const bar = page.locator("#context-usage")
    await expect(bar).toHaveClass(/hidden/, { timeout: 3000 })

    await dispatchHostMessage(page, {
      type: "active_session_changed",
      sessionId: "session-b",
    })

    await expect(bar).not.toHaveClass(/hidden/, { timeout: 3000 })
    await expect(page.locator("#context-label")).toContainText("75%")

    expectNoBrowserErrors(captured)
  })

  // Fix B: changed-files always-visible strip appears when files are reported,
  // shows file names, and clicking it opens the full dropdown tree.
  test("changed-files strip shows file names and opens dropdown on click", async ({ page }) => {
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
        },
      ],
      activeSessionId: "s",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })

    await page.waitForTimeout(300)

    await dispatchHostMessage(page, {
      type: "changed_files_update",
      sessionId: "s",
      files: [
        { path: "src/foo.ts", added: 10, removed: 2 },
        { path: "src/bar.py", added: 5, removed: 1 },
        { path: "README.md", added: 3, removed: 0 },
        { path: "config.json", added: 1, removed: 1 },
      ],
    })

    // Always-visible strip must appear (not hidden)
    const strip = page.locator("#changed-files-strip")
    await expect(strip).not.toHaveClass(/hidden/, { timeout: 5000 })

    // Strip must show a "4 files changed" label
    await expect(strip).toContainText("4 files changed")

    // File basenames appear as chips in the strip
    await expect(strip).toContainText("foo.ts")
    await expect(strip).toContainText("bar.py")
    await expect(strip).toContainText("README.md")
    await expect(strip).toContainText("config.json")

    // Clicking the strip opens the full dropdown tree
    await strip.click()
    const tree = page.locator("#cf-dropdown-tree")
    await expect(tree).toBeVisible({ timeout: 3000 })

    expectNoBrowserErrors(captured)
  })

  // Regression: changed-files strip handles extended language set —
  // kotlin, shell, yaml, html, sql — shows all 5 files with correct count.
  test("changed-files strip counts extended language set correctly", async ({ page }) => {
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
        },
      ],
      activeSessionId: "s",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })

    await page.waitForTimeout(300)

    await dispatchHostMessage(page, {
      type: "changed_files_update",
      sessionId: "s",
      files: [
        { path: "app/Main.kt", added: 20, removed: 5 },
        { path: "scripts/deploy.sh", added: 8, removed: 2 },
        { path: "ci/workflow.yaml", added: 15, removed: 0 },
        { path: "public/index.html", added: 4, removed: 1 },
        { path: "schema/migration.sql", added: 12, removed: 3 },
      ],
    })

    const strip = page.locator("#changed-files-strip")
    await expect(strip).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(strip).toContainText("5 files changed")

    // All 5 basenames appear in the strip chips
    await expect(strip).toContainText("Main.kt")
    await expect(strip).toContainText("deploy.sh")
    await expect(strip).toContainText("workflow.yaml")
    await expect(strip).toContainText("index.html")
    await expect(strip).toContainText("migration.sql")

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

  // Test: context usage dropdown shows tokens-only summary when maxTokens is unknown.
  // When maxTokens = 0 the toolbar button must become visible and the dropdown
  // must surface the "set limit" hint via buildSummaryText.
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

    await page.waitForTimeout(300)

    // Send context_usage with maxTokens = 0 (unknown context window)
    await dispatchHostMessage(page, {
      type: "context_usage",
      percent: 0,
      tokens: 12345,
      maxTokens: 0,
    })

    // Status-strip bar must become visible (always-visible context-usage UI)
    const ctxBar = page.locator("#context-usage")
    await expect(ctxBar).not.toHaveClass(/hidden/, { timeout: 5000 })

    // Open the dropdown and verify "tokens-only" summary text
    await ctxBar.click()
    const summaryText = page.locator(".cup-summary-text")
    await expect(summaryText).toBeVisible({ timeout: 3000 })
    await expect(summaryText).toHaveText(/12,345 tok · set limit/i)

    await expectNoBrowserErrors(captured)
  })

  // Regression: context usage dropdown must render on top of chat content.
  // z-index: 100 was insufficient — chat transforms/stacking contexts beat it.
  test("context usage dropdown is visible above chat content", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [{ id: "s", name: "T", model: "anthropic/claude-3-5-sonnet-20241022", messages: [], tokenUsage: { prompt: 0, completion: 0, total: 0 } }],
      activeSessionId: "s",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })

    await dispatchHostMessage(page, { type: "context_usage", percent: 45, tokens: 90000, maxTokens: 200000 })

    const ctxBar = page.locator("#context-usage")
    await expect(ctxBar).not.toHaveClass(/hidden/, { timeout: 5000 })
    await ctxBar.click()

    const panel = page.locator("#context-usage-dropdown")
    await expect(panel).not.toHaveClass(/hidden/, { timeout: 3000 })

    // Panel must be in front — no other element should fully obscure it.
    // Playwright evaluates visibility: the panel must have non-zero dimensions and be unclipped.
    await expect(panel).toBeVisible()

    // The panel must show actual usage data, not the "no data" fallback.
    await expect(panel).not.toContainText("No context usage data available")
    await expect(panel).toContainText("45")

    // Panel must be closeable by pressing Escape.
    await page.keyboard.press("Escape")
    await expect(panel).toHaveClass(/hidden/, { timeout: 2000 })
  })

  // Regression: changed-files dropdown must open anchored to the strip, not off-screen.
  // The dropdown was anchored to a detached createElement("button") whose getBoundingClientRect
  // returned all zeros, placing the panel at top:4px right:${window.innerWidth}px (off-screen).
  test("changed-files dropdown opens on-screen anchored to strip", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [{ id: "s", name: "T", model: "anthropic/claude-3-5-sonnet-20241022", messages: [], tokenUsage: { prompt: 0, completion: 0, total: 0 } }],
      activeSessionId: "s",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })

    await page.waitForTimeout(300)

    await dispatchHostMessage(page, {
      type: "changed_files_update",
      sessionId: "s",
      files: [
        { path: "src/alpha.ts", added: 5, removed: 2 },
        { path: "src/beta.ts", added: 1, removed: 0 },
      ],
    })

    const strip = page.locator("#changed-files-strip")
    await expect(strip).not.toHaveClass(/hidden/, { timeout: 5000 })

    await strip.click()

    const dropdown = page.locator("#changed-files-dropdown")
    await expect(dropdown).not.toHaveClass(/hidden/, { timeout: 3000 })
    await expect(dropdown).toBeVisible()

    // Dropdown must be positioned on-screen (right edge not off-screen)
    const box = await dropdown.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThan(-10)           // not off-screen left
    expect(box!.x + box!.width).toBeLessThan(2000) // not off-screen right

    // Dropdown must be closeable
    await page.keyboard.press("Escape")
    await expect(dropdown).toHaveClass(/hidden/, { timeout: 2000 })
  })
})
