import { test, expect } from "@playwright/test"
import {
  installVsCodeApi,
  dispatchHostMessage,
  captureErrors,
  expectNoBrowserErrors,
} from "../visual/webviewTestHarness"

test.describe("Streaming Interleave Display", () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
  })

  test("text before tool call is finalized when tool starts", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "sess-1",
          name: "Test",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "sess-1",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })

    await page.waitForTimeout(500)

    await dispatchHostMessage(page, {
      type: "stream_start",
      sessionId: "sess-1",
      messageId: "msg-1",
    })

    await dispatchHostMessage(page, {
      type: "stream_chunk",
      sessionId: "sess-1",
      messageId: "msg-1",
      text: "Here is some text before a tool call. ",
    })

    await page.waitForTimeout(200)

    await dispatchHostMessage(page, {
      type: "stream_tool_start",
      sessionId: "sess-1",
      toolCall: { id: "tool-1", name: "Read", class: "read" },
    })

    await page.waitForTimeout(200)

    const messageBubble = page.locator('[data-message-id="msg-1"] .message-bubble')
    await expect(messageBubble).toBeVisible({ timeout: 5000 })

    const children = messageBubble.locator("> *")
    const count = await children.count()

    expect(count, `Expected at least 2 children (text + tool), got ${count}`).toBeGreaterThanOrEqual(2)

    const firstChild = children.nth(0)
    await expect(firstChild).toHaveClass(/msg-text/)
    await expect(firstChild).not.toHaveClass(/streaming-text/)

    expectNoBrowserErrors(captured)
  })

  test("text after tool is positioned after the tool element", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "sess-1",
          name: "Test",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "sess-1",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })

    await page.waitForTimeout(500)

    await dispatchHostMessage(page, {
      type: "stream_start",
      sessionId: "sess-1",
      messageId: "msg-2",
    })

    await dispatchHostMessage(page, {
      type: "stream_chunk",
      sessionId: "sess-1",
      messageId: "msg-2",
      text: "Before tool. ",
    })

    await page.waitForTimeout(100)

    await dispatchHostMessage(page, {
      type: "stream_tool_start",
      sessionId: "sess-1",
      toolCall: { id: "tool-2", name: "Write", class: "write" },
    })

    await page.waitForTimeout(100)

    await dispatchHostMessage(page, {
      type: "stream_tool_end",
      sessionId: "sess-1",
      result: { id: "tool-2", ok: true, result: "done" },
    })

    await page.waitForTimeout(100)

    await dispatchHostMessage(page, {
      type: "stream_chunk",
      sessionId: "sess-1",
      messageId: "msg-2",
      text: "After tool text. ",
    })

    await page.waitForTimeout(300)

    const bubble = page.locator('[data-message-id="msg-2"] .message-bubble')
    await expect(bubble).toBeVisible({ timeout: 5000 })

    const directChildren = bubble.locator("> *")
    const count = await directChildren.count()

    expect(count, `Expected at least 3 children (text + tool + text), got ${count}`).toBeGreaterThanOrEqual(3)

    const lastChild = directChildren.nth(count - 1)
    await expect(lastChild).toHaveClass(/streaming-text/)

    expectNoBrowserErrors(captured)
  })

  test("chat bar shows correct state for non-streaming new tab", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "sess-streaming",
          name: "Streaming Session",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
          isStreaming: true,
        },
        {
          id: "sess-idle",
          name: "Idle Session",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "sess-streaming",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })

    await page.waitForTimeout(500)

    await dispatchHostMessage(page, {
      type: "streaming_state",
      sessionId: "sess-streaming",
      isStreaming: true,
    })

    await page.waitForTimeout(300)

    const sendBtn = page.locator("#send-btn")
    await expect(sendBtn).toHaveClass(/stopping/, { timeout: 3000 })

    await page.click('[data-tab-id="sess-idle"]')

    await page.waitForTimeout(300)

    await expect(sendBtn).not.toHaveClass(/stopping/, { timeout: 3000 })

    const promptInput = page.locator("#prompt-input")
    await expect(promptInput).toHaveAttribute("placeholder", /Ask OpenCode/)

    expectNoBrowserErrors(captured)
  })
})

