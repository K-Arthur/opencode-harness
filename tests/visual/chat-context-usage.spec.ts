import { test, expect } from "@playwright/test"
import {
  installVsCodeApi,
  dispatchHostMessage,
  expectNoBrowserErrors,
  captureErrors,
} from "./webviewTestHarness"

// Behavioral coverage for the context-usage bar and changed-files list.
// These replace earlier screenshot-only assertions whose mocks didn't
// install before page load — meaning the previous tests never exercised
// the real webview init path.
test.describe("Context Usage", () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
  })

  test("renders per-tab context monitor when usage is non-zero", async ({ page }) => {
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
          tokenUsage: { prompt: 30000, completion: 20000, total: 50000 },
        },
      ],
      activeSessionId: "s",
    })

    // Per-tab context monitor lives inside each tab-panel and is updated by
    // the context_usage host message. Wait for it to be created.
    await page.waitForSelector('.tab-panel[data-tab-id="s"]', { timeout: 5000 })

    await dispatchHostMessage(page, {
      type: "context_usage",
      tokens: 50000,
      maxTokens: 200000,
      percent: 25,
    })

    const monitor = page.locator('.tab-panel[data-tab-id="s"] .context-monitor')
    await expect(monitor).not.toHaveClass(/hidden/, { timeout: 5000 })

    const text = monitor.locator(".context-text")
    await expect(text).toContainText(/50,000.*200,000/)

    expectNoBrowserErrors(captured)
  })

  test("shows the per-tab monitor as tokens-only when maxTokens is unknown (0)", async ({ page }) => {
    // When the active model's context window can't be resolved, keep the
    // per-tab monitor useful without inventing a misleading denominator.
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "s",
          name: "T",
          model: "opencode/big-pickle",
          messages: [],
          tokenUsage: { prompt: 5000, completion: 3000, total: 8000 },
        },
      ],
      activeSessionId: "s",
    })

    await page.waitForSelector('.tab-panel[data-tab-id="s"]', { timeout: 5000 })

    await dispatchHostMessage(page, {
      type: "context_usage",
      tokens: 8000,
      maxTokens: 0, // unresolved
      percent: 0,
    })

    const monitor = page.locator('.tab-panel[data-tab-id="s"] .context-monitor')
    await expect(monitor).not.toHaveClass(/hidden/, { timeout: 3000 })
    await expect(monitor.locator(".context-text")).toHaveText(/tokens \(limit unknown\)/)

    expectNoBrowserErrors(captured)
  })

  test("hides the usage bar when the session has zero tokens", async ({ page }) => {
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
    })

    await dispatchHostMessage(page, {
      type: "context_usage",
      tokens: 0,
      maxTokens: 200000,
      percent: 0,
    })

    const bar = page.locator("#context-usage")
    await expect(bar).toHaveClass(/hidden/, { timeout: 5000 })

    expectNoBrowserErrors(captured)
  })

  test("status strip shows model, percent used, tokens over limit, and session cost", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "s",
          name: "T",
          model: "opencode/big-pickle",
          messages: [],
          tokenUsage: { prompt: 40000, completion: 10000, total: 50000 },
          cost: 0.1234,
        },
      ],
      activeSessionId: "s",
    })

    const contextBar = page.locator("#context-usage")
    await expect(contextBar).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(page.locator("#status-model")).toHaveText("big-pickle")
    await expect(page.locator("#context-label")).toContainText("25% used")
    await expect(page.locator("#context-label")).toContainText("50,000 tokens / 200,000")
    await expect(page.locator("#status-cost")).toHaveText("$0.1234")

    expectNoBrowserErrors(captured)
  })
})

test.describe("Changed Files", () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
  })

  test("renders a chip per changed file and hides the list when empty", async ({ page }) => {
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
          changedFiles: ["src/index.ts", "src/utils.ts", "src/components/Button.tsx"],
        },
      ],
      activeSessionId: "s",
    })

    await page.waitForSelector(".changed-file-chip", { timeout: 5000 })
    await expect(page.locator(".changed-file-chip")).toHaveCount(3)

    // Filenames (not full paths) should be visible in chips
    await expect(page.locator(".changed-file-name").nth(0)).toHaveText("index.ts")
    await expect(page.locator(".changed-file-name").nth(1)).toHaveText("utils.ts")
    await expect(page.locator(".changed-file-name").nth(2)).toHaveText("Button.tsx")

    // Full path should be in the chip's title attribute for hover/accessibility
    await expect(page.locator(".changed-file-chip").nth(0)).toHaveAttribute("title", "src/index.ts")

    expectNoBrowserErrors(captured)
  })

  test("changed-files list is hidden when no files have changed", async ({ page }) => {
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
          changedFiles: [],
        },
      ],
      activeSessionId: "s",
    })

    const list = page.locator("#changed-files-list")
    await expect(list).toHaveClass(/hidden/)
    await expect(page.locator(".changed-file-chip")).toHaveCount(0)

    expectNoBrowserErrors(captured)
  })

  test("changed-files list updates live via host messages", async ({ page }) => {
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
          changedFiles: [],
        },
      ],
      activeSessionId: "s",
    })

    // Initially empty
    await expect(page.locator("#changed-files-list")).toHaveClass(/hidden/)

    // Host pushes a changed-files update for the active session
    await dispatchHostMessage(page, {
      type: "changed_files_update",
      sessionId: "s",
      files: ["lib/router.go", "lib/handler.rs"],
    })

    await page.waitForSelector(".changed-file-chip", { timeout: 5000 })
    await expect(page.locator(".changed-file-chip")).toHaveCount(2)
    await expect(page.locator(".changed-file-icon--go")).toHaveCount(1)
    await expect(page.locator(".changed-file-icon--rs")).toHaveCount(1)

    expectNoBrowserErrors(captured)
  })
})

test.describe("Checkpoints", () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
  })

  test("empty checkpoint response leaves a visible panel state", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "s",
          name: "T",
          model: "opencode/big-pickle",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "s",
    })

    await dispatchHostMessage(page, {
      type: "checkpoint_list",
      sessionId: "s",
      checkpoints: [],
    })

    await expect(page.locator("#checkpoint-panel")).not.toHaveClass(/hidden/)
    await expect(page.locator(".checkpoint-empty")).toHaveText("No checkpoints yet")

    expectNoBrowserErrors(captured)
  })
})
