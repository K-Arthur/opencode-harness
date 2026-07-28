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

  test("renders the status-strip context bar when usage is non-zero", async ({ page }) => {
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

    await dispatchHostMessage(page, {
      type: "context_usage",
      tokens: 50000,
      maxTokens: 200000,
      percent: 25,
    })

    const bar = page.locator("#context-usage")
    await expect(bar).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(page.locator("#context-label")).toContainText("25%")
    await expect(page.locator("#context-label")).toContainText(/50k|50K|50,000/)

    expectNoBrowserErrors(captured)
  })

  test("shows the context-window override chip when maxTokens is unknown", async ({ page }) => {
    // When the active model's context window can't be resolved, show the
    // explicit override affordance instead of inventing a denominator.
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

    await dispatchHostMessage(page, {
      type: "context_window_unknown",
      modelId: "opencode/big-pickle",
    })

    const chip = page.locator("#ctx-window-unknown-chip")
    await expect(chip).not.toHaveClass(/hidden/, { timeout: 3000 })
    await expect(chip).toContainText(/set override/i)

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
    await dispatchHostMessage(page, {
      type: "context_usage",
      tokens: 50000,
      maxTokens: 200000,
      percent: 25,
    })

    const contextBar = page.locator("#context-usage")
    await expect(contextBar).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(page.locator("#status-model")).toHaveText("big-pickle")
    await expect(page.locator("#context-label")).toContainText("25%")
    await expect(page.locator("#context-label")).toContainText(/50k|50K|50,000/)
    await expect(page.locator("#status-cost")).toHaveText("$0.1234")

    expectNoBrowserErrors(captured)
  })

  test("context usage dropdown stays fully visible in a narrow viewport", async ({ page }) => {
    const captured = captureErrors(page)
    await page.setViewportSize({ width: 360, height: 260 })
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "s",
          name: "T",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          tokenUsage: { prompt: 70000, completion: 2000, total: 72000 },
        },
      ],
      activeSessionId: "s",
    })

    await dispatchHostMessage(page, {
      type: "context_usage",
      tokens: 72000,
      maxTokens: 100000,
      percent: 72,
      breakdown: { system: 2000, history: 60000, workspace: 8000, queued: 1000, steer: 1000 },
    })

    const bar = page.locator("#context-usage")
    await expect(bar).not.toHaveClass(/hidden/, { timeout: 5000 })
    await bar.click()

    const dropdown = page.locator("#context-usage-dropdown")
    await expect(dropdown).not.toHaveClass(/hidden/, { timeout: 5000 })
    const box = await dropdown.boundingBox()
    expect(box, "context dropdown must be visible").not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(360)
    expect(box!.y + box!.height).toBeLessThanOrEqual(260)

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

    const strip = page.locator("#changed-files-strip")
    await expect(strip).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(page.locator(".cf-strip-chip")).toHaveCount(3)

    // Filenames (not full paths) should be visible in chips
    await expect(page.locator(".cf-strip-chip").nth(0)).toHaveText("index.ts")
    await expect(page.locator(".cf-strip-chip").nth(1)).toHaveText("utils.ts")
    await expect(page.locator(".cf-strip-chip").nth(2)).toHaveText("Button.tsx")

    // Full path should be in the chip's title attribute for hover/accessibility
    await expect(page.locator(".cf-strip-chip").nth(0)).toHaveAttribute("title", "src/index.ts")

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

    const strip = page.locator("#changed-files-strip")
    await expect(strip).toHaveClass(/hidden/)
    await expect(page.locator(".cf-strip-chip")).toHaveCount(0)

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
    await expect(page.locator("#changed-files-strip")).toHaveClass(/hidden/)

    // Host pushes a changed-files update for the active session
    await dispatchHostMessage(page, {
      type: "changed_files_update",
      sessionId: "s",
      files: [
        { path: "lib/router.go", added: 3, removed: 0 },
        { path: "lib/handler.rs", added: 1, removed: 1 },
      ],
    })

    await expect(page.locator("#changed-files-strip")).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(page.locator(".cf-strip-chip")).toHaveCount(2)
    await expect(page.locator(".cf-strip-chip").nth(0)).toHaveText("router.go")
    await expect(page.locator(".cf-strip-chip").nth(1)).toHaveText("handler.rs")

    expectNoBrowserErrors(captured)
  })

  test("changed-files strip appears from live update and opens a viewport-safe dropdown", async ({ page }) => {
    const captured = captureErrors(page)
    await page.setViewportSize({ width: 360, height: 260 })
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

    await dispatchHostMessage(page, {
      type: "changed_files_update",
      sessionId: "s",
      files: [{ path: "/home/kevinarthur/.claude/settings.json", added: 1, removed: 0 }],
    })

    const strip = page.locator("#changed-files-strip")
    await expect(strip).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(strip).toContainText("settings.json")
    await strip.click()

    const dropdown = page.locator("#changed-files-dropdown")
    await expect(dropdown).not.toHaveClass(/hidden/, { timeout: 5000 })
    const box = await dropdown.boundingBox()
    expect(box, "changed files dropdown must be visible").not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(360)
    expect(box!.y + box!.height).toBeLessThanOrEqual(260)

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
