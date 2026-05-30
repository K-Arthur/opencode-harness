/**
 * Playwright E2E tests for the model question block feature.
 *
 * Covers the full lifecycle:
 *   1. Static render from init_state (post-stream re-render path)
 *   2. Live streaming render via stream_tool_start (mid-stream path)
 *   3. User interaction: option click, free-text submit, Ctrl+Enter
 *   4. Edge cases: empty submit, double-submit, XSS, options-only, free-text-only
 *   5. Accessibility: aria-label, maxlength
 *   6. Message contract: correct messageId, toolCallId, sessionId, source
 */
import { test, expect } from "@playwright/test"
import {
  installVsCodeApi,
  dispatchHostMessage,
  postedMessages,
  captureErrors,
  expectNoBrowserErrors,
} from "../visual/webviewTestHarness"

const MODEL = "anthropic/claude-3-5-sonnet-20241022"

function initState(sessionOverrides: Record<string, unknown> = {}) {
  return {
    type: "init_state",
    sessions: [
      {
        id: "sess-A",
        name: "Test Session",
        model: MODEL,
        messages: [],
        tokenUsage: { prompt: 0, completion: 0, total: 0 },
        ...sessionOverrides,
      },
    ],
    activeSessionId: "sess-A",
    globalModel: MODEL,
  }
}

test.describe("Model Question Block — Static Render", () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
  })

  test("renders question with options and free-text textarea", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, initState({
      messages: [{
        role: "assistant",
        id: "msg-1",
        blocks: [{
          type: "question",
          id: "tool-q-1",
          toolCallId: "tool-q-1",
          sessionId: "sess-A",
          text: "Which database driver?",
          options: ["Postgres", "MySQL", "SQLite"],
          allowFreeText: true,
        }],
        timestamp: Date.now(),
        sessionId: "sess-A",
      }],
    }))
    await page.waitForTimeout(300)

    const block = page.locator(".question-block").first()
    await expect(block).toBeVisible()
    await expect(block).toContainText("Which database driver?")
    await expect(block.locator(".question-option")).toHaveCount(3)
    await expect(block.locator(".question-freetext")).toBeVisible()
    await expect(block.locator(".question-submit")).toBeVisible()

    expectNoBrowserErrors(captured)
  })

  test("clicking an option posts question_answer with source=option", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, initState({
      messages: [{
        role: "assistant",
        id: "msg-2",
        blocks: [{
          type: "question",
          id: "tool-q-2",
          toolCallId: "tool-q-2",
          sessionId: "sess-A",
          text: "Pick one",
          options: ["A", "B", "C"],
          allowFreeText: true,
        }],
        timestamp: Date.now(),
        sessionId: "sess-A",
      }],
    }))
    await page.waitForTimeout(300)

    await page.locator(".question-option").filter({ hasText: "B" }).click()

    const sent = await postedMessages(page)
    const answer = sent.find((m) => m.type === "question_answer")
    expect(answer).toBeTruthy()
    expect(answer!.value).toBe("B")
    expect(answer!.source).toBe("option")
    expect(answer!.sessionId).toBe("sess-A")
    expect(answer!.toolCallId).toBe("tool-q-2")

    expectNoBrowserErrors(captured)
  })

  test("submitting via textarea posts source=freetext", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, initState({
      messages: [{
        role: "assistant",
        id: "msg-3",
        blocks: [{
          type: "question",
          id: "tool-q-3",
          toolCallId: "tool-q-3",
          sessionId: "sess-A",
          text: "What's the target?",
          options: [],
          allowFreeText: true,
        }],
        timestamp: Date.now(),
        sessionId: "sess-A",
      }],
    }))
    await page.waitForTimeout(300)

    const ta = page.locator(".question-freetext").first()
    await ta.fill("Vercel + Neon Postgres")
    await page.locator(".question-submit").first().click()

    const sent = await postedMessages(page)
    const answer = sent.find((m) => m.type === "question_answer")
    expect(answer).toBeTruthy()
    expect(answer!.value).toBe("Vercel + Neon Postgres")
    expect(answer!.source).toBe("freetext")
  })

  test("Ctrl+Enter in textarea submits free-text", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, initState({
      messages: [{
        role: "assistant",
        id: "msg-ctrl",
        blocks: [{
          type: "question",
          id: "tool-q-ctrl",
          toolCallId: "tool-q-ctrl",
          sessionId: "sess-A",
          text: "Quick answer",
          options: [],
          allowFreeText: true,
        }],
        timestamp: Date.now(),
        sessionId: "sess-A",
      }],
    }))
    await page.waitForTimeout(300)

    const ta = page.locator(".question-freetext").first()
    await ta.fill("Ctrl+Enter response")
    await ta.press("Control+Enter")

    const sent = await postedMessages(page)
    const answer = sent.find((m) => m.type === "question_answer")
    expect(answer).toBeTruthy()
    expect(answer!.value).toBe("Ctrl+Enter response")
    expect(answer!.source).toBe("freetext")
  })
})

test.describe("Model Question Block — Edge Cases", () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
  })

  test("double-clicking an option is idempotent (only one question_answer)", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, initState({
      messages: [{
        role: "assistant",
        id: "msg-dbl",
        blocks: [{
          type: "question",
          id: "tool-q-dbl",
          toolCallId: "tool-q-dbl",
          sessionId: "sess-A",
          text: "Pick",
          options: ["X", "Y"],
          allowFreeText: true,
        }],
        timestamp: Date.now(),
        sessionId: "sess-A",
      }],
    }))
    await page.waitForTimeout(300)

    const opt = page.locator(".question-option").first()
    await opt.click()
    await opt.dispatchEvent("click")

    const sent = await postedMessages(page)
    const answers = sent.filter((m) => m.type === "question_answer")
    expect(answers.length).toBe(1)

    const block = page.locator(".question-block").first()
    await expect(block).toHaveClass(/question-block--answered/)
  })

  test("empty free-text submit is a no-op", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, initState({
      messages: [{
        role: "assistant",
        id: "msg-empty",
        blocks: [{
          type: "question",
          id: "tool-q-empty",
          toolCallId: "tool-q-empty",
          sessionId: "sess-A",
          text: "Whatever",
          options: [],
          allowFreeText: true,
        }],
        timestamp: Date.now(),
        sessionId: "sess-A",
      }],
    }))
    await page.waitForTimeout(300)

    await page.locator(".question-submit").first().click()

    const sent = await postedMessages(page)
    const answer = sent.find((m) => m.type === "question_answer")
    expect(answer).toBeUndefined()

    const block = page.locator(".question-block").first()
    await expect(block).not.toHaveClass(/question-block--answered/)
  })

  test("options-only mode (allowFreeText=false) hides textarea", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, initState({
      messages: [{
        role: "assistant",
        id: "msg-optonly",
        blocks: [{
          type: "question",
          id: "tool-q-optonly",
          toolCallId: "tool-q-optonly",
          sessionId: "sess-A",
          text: "Choose one",
          options: ["Alpha", "Beta"],
          allowFreeText: false,
        }],
        timestamp: Date.now(),
        sessionId: "sess-A",
      }],
    }))
    await page.waitForTimeout(300)

    const block = page.locator(".question-block").first()
    await expect(block).toBeVisible()
    await expect(block.locator(".question-option")).toHaveCount(2)
    await expect(block.locator(".question-freetext")).toHaveCount(0)
    await expect(block.locator(".question-submit")).toHaveCount(0)
  })

  test("free-text-only mode (no options) renders just textarea", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, initState({
      messages: [{
        role: "assistant",
        id: "msg-freonly",
        blocks: [{
          type: "question",
          id: "tool-q-freonly",
          toolCallId: "tool-q-freonly",
          sessionId: "sess-A",
          text: "Describe the issue",
          options: [],
          allowFreeText: true,
        }],
        timestamp: Date.now(),
        sessionId: "sess-A",
      }],
    }))
    await page.waitForTimeout(300)

    const block = page.locator(".question-block").first()
    await expect(block).toBeVisible()
    await expect(block.locator(".question-option")).toHaveCount(0)
    await expect(block.locator(".question-freetext")).toBeVisible()
    await expect(block.locator(".question-submit")).toBeVisible()
  })

  test("HTML in question text and options is escaped (no injection)", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, initState({
      messages: [{
        role: "assistant",
        id: "msg-xss",
        blocks: [{
          type: "question",
          id: "tool-q-xss",
          toolCallId: "tool-q-xss",
          sessionId: "sess-A",
          text: '<img src=x onerror="alert(1)">',
          options: ['<script>bad</script>'],
          allowFreeText: false,
        }],
        timestamp: Date.now(),
        sessionId: "sess-A",
      }],
    }))
    await page.waitForTimeout(300)

    const block = page.locator(".question-block").first()
    await expect(block).toBeVisible()
    await expect(block.locator("img")).toHaveCount(0)
    await expect(block.locator("script")).toHaveCount(0)
    await expect(block).toContainText("<img")

    expectNoBrowserErrors(captured)
  })

  test("after answering, all inputs are disabled", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, initState({
      messages: [{
        role: "assistant",
        id: "msg-disable",
        blocks: [{
          type: "question",
          id: "tool-q-disable",
          toolCallId: "tool-q-disable",
          sessionId: "sess-A",
          text: "Pick",
          options: ["Yes", "No"],
          allowFreeText: true,
        }],
        timestamp: Date.now(),
        sessionId: "sess-A",
      }],
    }))
    await page.waitForTimeout(300)

    await page.locator(".question-option").first().click()

    const block = page.locator(".question-block").first()
    await expect(block).toHaveClass(/question-block--answered/)
    await expect(block.locator(".question-option").first()).toBeDisabled()
    await expect(block.locator(".question-freetext")).toBeDisabled()
    await expect(block.locator(".question-submit")).toBeDisabled()

    const echo = block.locator(".question-answer")
    await expect(echo).toContainText("Answered:")
  })
})

test.describe("Model Question Block — Accessibility & Attributes", () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
  })

  test("question block has role=form and aria-label", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, initState({
      messages: [{
        role: "assistant",
        id: "msg-a11y",
        blocks: [{
          type: "question",
          id: "tool-q-a11y",
          toolCallId: "tool-q-a11y",
          sessionId: "sess-A",
          text: "Pick one",
          options: ["A", "B"],
          allowFreeText: true,
        }],
        timestamp: Date.now(),
        sessionId: "sess-A",
      }],
    }))
    await page.waitForTimeout(300)

    const block = page.locator(".question-block").first()
    await expect(block).toHaveAttribute("role", "form")
    await expect(block).toHaveAttribute("aria-label", "Question from model")
  })

  test("options container has role=group and aria-label", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, initState({
      messages: [{
        role: "assistant",
        id: "msg-a11y2",
        blocks: [{
          type: "question",
          id: "tool-q-a11y2",
          toolCallId: "tool-q-a11y2",
          sessionId: "sess-A",
          text: "Pick",
          options: ["X", "Y"],
          allowFreeText: true,
        }],
        timestamp: Date.now(),
        sessionId: "sess-A",
      }],
    }))
    await page.waitForTimeout(300)

    const optionsList = page.locator(".question-options").first()
    await expect(optionsList).toHaveAttribute("role", "group")
    await expect(optionsList).toHaveAttribute("aria-label", "Answer options")
  })

  test("textarea has aria-label and maxlength=10000", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, initState({
      messages: [{
        role: "assistant",
        id: "msg-ta",
        blocks: [{
          type: "question",
          id: "tool-q-ta",
          toolCallId: "tool-q-ta",
          sessionId: "sess-A",
          text: "Answer freely",
          options: [],
          allowFreeText: true,
        }],
        timestamp: Date.now(),
        sessionId: "sess-A",
      }],
    }))
    await page.waitForTimeout(300)

    const ta = page.locator(".question-freetext").first()
    await expect(ta).toHaveAttribute("aria-label", "Type a custom answer")
    await expect(ta).toHaveAttribute("maxlength", "10000")
  })
})

test.describe("Model Question Block — Streaming Phase", () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
  })

  test("question tool renders during streaming via stream_tool_start", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, initState())
    await page.waitForTimeout(500)

    await dispatchHostMessage(page, {
      type: "stream_start",
      sessionId: "sess-A",
      messageId: "msg-stream-1",
    })
    await page.waitForTimeout(200)

    await dispatchHostMessage(page, {
      type: "stream_chunk",
      sessionId: "sess-A",
      messageId: "msg-stream-1",
      text: "I need to ask you something. ",
    })
    await page.waitForTimeout(200)

    await dispatchHostMessage(page, {
      type: "stream_tool_start",
      sessionId: "sess-A",
      toolCall: {
        id: "tool-q-stream",
        name: "question",
        class: "meta",
        state: "running",
        args: {
          question: "Which framework?",
          options: ["React", "Vue", "Svelte"],
          allowFreeText: true,
        },
      },
    })
    await page.waitForTimeout(300)

    const block = page.locator(".question-block").first()
    await expect(block).toBeVisible({ timeout: 5000 })
    await expect(block).toContainText("Which framework?")
    await expect(block.locator(".question-option")).toHaveCount(3)

    expectNoBrowserErrors(captured)
  })

  test("question block becomes interactive after stream_end re-render", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, initState())
    await page.waitForTimeout(500)

    await dispatchHostMessage(page, {
      type: "stream_start",
      sessionId: "sess-A",
      messageId: "msg-stream-rerender",
    })

    await dispatchHostMessage(page, {
      type: "stream_chunk",
      sessionId: "sess-A",
      messageId: "msg-stream-rerender",
      text: "Before question. ",
    })

    await dispatchHostMessage(page, {
      type: "stream_tool_start",
      sessionId: "sess-A",
      toolCall: {
        id: "tool-q-rerender",
        name: "question",
        class: "meta",
        state: "running",
        args: {
          question: "Pick a runtime",
          options: ["Node.js", "Bun", "Deno"],
          allowFreeText: true,
        },
      },
    })
    await page.waitForTimeout(200)

    await dispatchHostMessage(page, {
      type: "stream_tool_end",
      sessionId: "sess-A",
      result: { id: "tool-q-rerender", ok: true, result: "pending" },
    })

    await dispatchHostMessage(page, {
      type: "stream_chunk",
      sessionId: "sess-A",
      messageId: "msg-stream-rerender",
      text: "Waiting for your answer. ",
    })

    await dispatchHostMessage(page, {
      type: "stream_end",
      sessionId: "sess-A",
      messageId: "msg-stream-rerender",
      blocks: [{
        type: "question",
        id: "tool-q-rerender",
        toolCallId: "tool-q-rerender",
        sessionId: "sess-A",
        text: "Pick a runtime",
        options: ["Node.js", "Bun", "Deno"],
        allowFreeText: true,
      }],
    })
    await page.waitForTimeout(500)

    const block = page.locator(".question-block").first()
    await expect(block).toBeVisible({ timeout: 5000 })
    await expect(block).toContainText("Pick a runtime")

    await block.locator(".question-option").filter({ hasText: "Bun" }).click()

    const sent = await postedMessages(page)
    const answer = sent.find((m) => m.type === "question_answer")
    expect(answer).toBeTruthy()
    expect(answer!.value).toBe("Bun")
    expect(answer!.source).toBe("option")
    expect(answer!.toolCallId).toBe("tool-q-rerender")

    expectNoBrowserErrors(captured)
  })

  test("streaming question followed by stream_end with textarea submit", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, initState())
    await page.waitForTimeout(500)

    await dispatchHostMessage(page, {
      type: "stream_start",
      sessionId: "sess-A",
      messageId: "msg-stream-ta",
    })

    await dispatchHostMessage(page, {
      type: "stream_tool_start",
      sessionId: "sess-A",
      toolCall: {
        id: "tool-q-ta",
        name: "question",
        class: "meta",
        state: "running",
        args: {
          question: "Custom deploy target?",
          options: [],
          allowFreeText: true,
        },
      },
    })
    await page.waitForTimeout(200)

    await dispatchHostMessage(page, {
      type: "stream_end",
      sessionId: "sess-A",
      messageId: "msg-stream-ta",
      blocks: [{
        type: "question",
        id: "tool-q-ta",
        toolCallId: "tool-q-ta",
        sessionId: "sess-A",
        text: "Custom deploy target?",
        options: [],
        allowFreeText: true,
      }],
    })
    await page.waitForTimeout(500)

    const ta = page.locator(".question-freetext").first()
    await expect(ta).toBeVisible({ timeout: 5000 })
    await ta.fill("AWS Lambda")
    await page.locator(".question-submit").first().click()

    const sent = await postedMessages(page)
    const answer = sent.find((m) => m.type === "question_answer")
    expect(answer).toBeTruthy()
    expect(answer!.value).toBe("AWS Lambda")
    expect(answer!.source).toBe("freetext")
    expect(answer!.toolCallId).toBe("tool-q-ta")

    expectNoBrowserErrors(captured)
  })
})

test.describe("Model Question Block — Message Contract", () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
  })

  test("question_answer carries correct sessionId, toolCallId, and source", async ({ page }) => {
    await page.goto("/")

    await dispatchHostMessage(page, initState({
      messages: [{
        role: "assistant",
        id: "msg-contract",
        blocks: [{
          type: "question",
          id: "tool-q-contract",
          toolCallId: "tool-q-contract",
          sessionId: "sess-A",
          text: "Pick one",
          options: ["Go", "Rust"],
          allowFreeText: false,
        }],
        timestamp: Date.now(),
        sessionId: "sess-A",
      }],
    }))
    await page.waitForTimeout(300)

    await page.locator(".question-option").filter({ hasText: "Rust" }).click()

    const sent = await postedMessages(page)
    const answer = sent.find((m) => m.type === "question_answer") as Record<string, unknown> | undefined
    expect(answer).toBeTruthy()
    expect(answer!.sessionId).toBe("sess-A")
    expect(answer!.toolCallId).toBe("tool-q-contract")
    expect(answer!.value).toBe("Rust")
    expect(answer!.source).toBe("option")
    expect(typeof answer!.messageId).toBe("string")
  })
})
