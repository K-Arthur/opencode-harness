import { test, expect } from "@playwright/test"
import {
  installVsCodeApi,
  dispatchHostMessage,
  expectNoBrowserErrors,
  captureErrors,
} from "./webviewTestHarness"

function contextSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "s",
    name: "T",
    model: "anthropic/claude-3-5-sonnet-20241022",
    messages: [],
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
    ...overrides,
  }
}

function buildScrollableMessages(count = 80) {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    timestamp: 1700000000000 + i,
    blocks: [{
      type: "text",
      text: `Message ${i + 1}\n${"This message has enough text to make the transcript scroll. ".repeat(5)}`,
    }],
  }))
}

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
    const label = page.locator("#context-label")
    await expect(label).toContainText("25%")
    await expect(label).toHaveAttribute("title", /50[\s,]?000\s*\/\s*200[\s,]?000/)

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

  test("restores context usage from init_state session payload", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        contextSession({
          contextUsage: {
            tokens: 33000,
            maxTokens: 100000,
            percent: 33,
            source: "actual",
            updatedAt: 2000,
          },
        }),
      ],
      activeSessionId: "s",
    })

    const bar = page.locator("#context-usage")
    await expect(bar).not.toHaveClass(/hidden/, { timeout: 5000 })
    const label = page.locator("#context-label")
    await expect(label).toContainText("33%")
    await expect(label).toHaveAttribute("title", /33[\s,]?000\s*\/\s*100[\s,]?000/)

    expectNoBrowserErrors(captured)
  })

  test("keeps context usage visible after stream_end", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [contextSession()],
      activeSessionId: "s",
    })

    await dispatchHostMessage(page, {
      type: "context_usage",
      sessionId: "s",
      tokens: 50000,
      maxTokens: 200000,
      percent: 25,
      source: "actual",
      updatedAt: 3000,
    })
    await dispatchHostMessage(page, {
      type: "stream_end",
      sessionId: "s",
    })

    const bar = page.locator("#context-usage")
    await expect(bar).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(page.locator("#context-label")).toContainText("25%")

    expectNoBrowserErrors(captured)
  })

  test("zero fallback context_usage does not erase prior valid usage", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [contextSession()],
      activeSessionId: "s",
    })

    await dispatchHostMessage(page, {
      type: "context_usage",
      sessionId: "s",
      tokens: 64000,
      maxTokens: 200000,
      percent: 32,
      source: "actual",
      updatedAt: 4000,
    })
    await dispatchHostMessage(page, {
      type: "context_usage",
      sessionId: "s",
      tokens: 0,
      maxTokens: 200000,
      percent: 0,
      source: "estimated",
      updatedAt: 5000,
    })

    const bar = page.locator("#context-usage")
    await expect(bar).not.toHaveClass(/hidden/, { timeout: 5000 })
    const label = page.locator("#context-label")
    await expect(label).toContainText("32%")
    await expect(label).toHaveAttribute("title", /64[\s,]?000\s*\/\s*200[\s,]?000/)

    expectNoBrowserErrors(captured)
  })

  test("scroll position survives repeated init_state hydration", async ({ page }) => {
    const captured = captureErrors(page)
    await page.setViewportSize({ width: 900, height: 520 })
    await page.goto("/")

    const messages = buildScrollableMessages()
    const initState = {
      type: "init_state",
      sessions: [
        contextSession({
          messages,
          contextUsage: {
            tokens: 21000,
            maxTokens: 100000,
            percent: 21,
            source: "actual",
            updatedAt: 6000,
          },
        }),
      ],
      activeSessionId: "s",
    }

    await dispatchHostMessage(page, initState)
    const msgList = page.locator('.tab-panel[data-tab-id="s"] .message-list')
    await expect(msgList).toBeVisible({ timeout: 5000 })
    await page.waitForFunction(() => {
      const list = document.querySelector('.tab-panel[data-tab-id="s"] .message-list')
      return !!list && list.scrollHeight > list.clientHeight + 200
    })

    await msgList.evaluate((el) => {
      const list = el as HTMLElement
      list.scrollTop = 420
      list.dispatchEvent(new Event("scroll", { bubbles: true }))
    })
    await page.waitForTimeout(250)
    await dispatchHostMessage(page, initState)
    await page.waitForTimeout(250)

    const scrollTop = await msgList.evaluate((el) => Math.round((el as HTMLElement).scrollTop))
    expect(scrollTop).toBeGreaterThanOrEqual(360)
    expect(scrollTop).toBeLessThanOrEqual(480)

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
    const label = page.locator("#context-label")
    await expect(label).toContainText("25%")
    await expect(label).toHaveAttribute("title", /50[\s,]?000\s*\/\s*200[\s,]?000/)
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
    // The strip teases one representative chip and folds the rest into "+N more".
    await expect(page.locator(".file-chip")).toHaveCount(1)
    await expect(strip).toContainText("+2 more")
    await expect(page.locator(".file-chip").nth(0)).toContainText("index.ts")
    await expect(page.locator(".file-chip").nth(0)).toHaveAttribute("title", "src/index.ts")

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
    await expect(page.locator(".file-chip")).toHaveCount(0)

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

    const strip = page.locator("#changed-files-strip")
    await expect(strip).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(page.locator(".file-chip")).toHaveCount(1)
    await expect(strip).toContainText("+1 more")
    await expect(page.locator(".file-chip").nth(0)).toContainText("router.go")

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
    // Click the strip element itself (not the chip) to toggle the panel.
    await strip.evaluate((el) => (el as HTMLElement).click())

    const panel = page.locator("#changed-files-panel")
    await expect(panel).not.toHaveClass(/hidden/, { timeout: 5000 })
    const box = await panel.boundingBox()
    expect(box, "changed files panel must be visible").not.toBeNull()
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
