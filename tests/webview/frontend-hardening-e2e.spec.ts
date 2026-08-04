/**
 * Playwright e2e tests for the three frontend hardening fixes:
 *   - Change A: compact "Edited N files" banner
 *   - Change B: interactive question UI
 *   - Change C: per-session isolation of the changed-files dropdown
 *
 * Drives the same host→webview message contract used at runtime.
 */
import { test, expect } from "@playwright/test"
import {
  installVsCodeApi,
  dispatchHostMessage,
  postedMessages,
  expectNoBrowserErrors,
  captureErrors,
} from "../visual/webviewTestHarness"

test.describe("Frontend Hardening E2E", () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
  })

  // ───────────────────────────────────────────────────────────────────
  // Change C: cross-session isolation
  // ───────────────────────────────────────────────────────────────────
  test("changed-files strip does not leak files between sessions", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "sess-A",
          name: "A",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
        {
          id: "sess-B",
          name: "B",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          mode: "plan",
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "sess-A",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })
    await page.waitForTimeout(300)

    // Session A receives an edit
    await dispatchHostMessage(page, {
      type: "changed_files_update",
      sessionId: "sess-A",
      files: [{ path: "src/from-A.ts", added: 5, removed: 1 }],
    })
    // Session B (plan mode) — should never receive edits in normal flow,
    // but even if a stale event arrives we want it stored, not displayed.
    await dispatchHostMessage(page, {
      type: "changed_files_update",
      sessionId: "sess-B",
      files: [
        { path: "src/from-B-1.ts", added: 10, removed: 2 },
        { path: "src/from-B-2.ts", added: 3, removed: 0 },
      ],
    })

    const strip = page.locator("#changed-files-strip")
    // While A is active, strip shows A's file only
    await expect(strip).toContainText("from-A.ts")
    await expect(strip).not.toContainText("from-B-1.ts")

    // Switch to session B the way a user does — clicking the tab (host-pushed
    // active_session_changed is intentionally not followed).
    await page.click('.tab-btn[data-tab-id="sess-B"]')

    // Now strip shows B's files; A's must not bleed in. The strip truncates
    // to one chip + overflow pill (CF_STRIP_MAX = 1); the full list lives in
    // the dropdown tree.
    await expect(strip).toContainText("2 files changed")
    await expect(strip).toContainText("from-B-1.ts")
    await expect(strip).not.toContainText("from-A.ts")
    await strip.locator(".cf-strip-label").click()
    const tree = page.locator("#cf-panel-tree")
    await expect(tree).toBeVisible({ timeout: 3000 })
    await expect(tree).toContainText("from-B-1.ts")
    await expect(tree).toContainText("from-B-2.ts")
    await expect(tree).not.toContainText("from-A.ts")
    await page.keyboard.press("Escape")

    // Switch back to A — A's file must still be there, B's gone
    await page.click('.tab-btn[data-tab-id="sess-A"]')
    await expect(strip).toContainText("from-A.ts")
    await expect(strip).not.toContainText("from-B-1.ts")

    expectNoBrowserErrors(captured)
  })

  test("changed_files_update without sessionId is dropped (does not leak to active session)", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "sess-A",
          name: "A",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "sess-A",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })
    await page.waitForTimeout(300)

    // Dispatch WITHOUT sessionId — must be dropped, not attributed to active session
    await dispatchHostMessage(page, {
      type: "changed_files_update",
      files: [{ path: "src/leaked.ts", added: 5, removed: 1 }],
    })
    await page.waitForTimeout(200)

    const strip = page.locator("#changed-files-strip")
    await expect(strip).not.toContainText("leaked.ts")
    // Strip stays hidden because no valid update arrived
    await expect(strip).toHaveClass(/hidden/)

    expectNoBrowserErrors(captured)
  })

  // ───────────────────────────────────────────────────────────────────
  // Change A: compact banner
  // ───────────────────────────────────────────────────────────────────
  test("Edited N files banner is suppressed (changed-files strip is canonical)", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "sess-A",
          name: "A",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "system",
              id: "msg-banner-1",
              blocks: [{
                type: "task_banner",
                status: "success",
                text: "Edited 13 files: a.ts, b.ts, c.ts, d.ts, e.ts, f.ts, g.ts, h.ts, i.ts, j.ts, k.ts, l.ts, m.ts",
              }],
              timestamp: Date.now(),
              sessionId: "sess-A",
            },
          ],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "sess-A",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })
    await page.waitForTimeout(300)

    // Inline "Edited N files" banners are intentionally NOT rendered — they
    // duplicated the persistent changed-files strip, stacked one card per
    // edit batch, and leaked unowned edits into the active tab. The strip is
    // the single, session-scoped source of truth (see renderTaskBanner).
    await expect(page.locator(".task-banner--compact")).toHaveCount(0)
    await expect(page.locator(".task-banner")).toHaveCount(0)

    expectNoBrowserErrors(captured)
  })

  test("non-edit task banners still render as legacy cards", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")
    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "sess-A",
          name: "A",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "system",
              id: "msg-banner-2",
              blocks: [{
                type: "task_banner",
                status: "error",
                text: "Auto-compact failed: model error",
              }],
              timestamp: Date.now(),
              sessionId: "sess-A",
            },
          ],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "sess-A",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })
    await page.waitForTimeout(300)

    const banner = page.locator(".task-banner--error").first()
    await expect(banner).toBeVisible()
    await expect(banner).toContainText("Auto-compact failed: model error")

    expectNoBrowserErrors(captured)
  })

  // ───────────────────────────────────────────────────────────────────
  // Change B: interactive question UI
  // ───────────────────────────────────────────────────────────────────
  test("opencode question tool renders interactive UI and posts question_answer", async ({ page }) => {
    const captured = captureErrors(page)
    await page.goto("/")

    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "sess-A",
          name: "A",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "assistant",
              id: "asst-1",
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
            },
          ],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "sess-A",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })
    await page.waitForTimeout(300)

    const block = page.locator(".question-block").first()
    await expect(block).toBeVisible()
    await expect(block).toContainText("Which database driver?")
    // Inline fallback controls (question not registered in the question bar)
    await expect(block.locator(".question-block-question-item")).toHaveCount(3)
    await expect(block.locator(".question-freetext")).toBeVisible()

    // Click "MySQL" then submit — the inline block requires an explicit
    // answer click (selection alone does not post).
    await block.locator(".question-block-question-item").filter({ hasText: "MySQL" }).click()
    await block.locator(".question-submit").click()

    // Verify the postMessage was sent
    const sent = await postedMessages(page)
    const answer = sent.find((m) => m.type === "question_answer")
    expect(answer).toBeTruthy()
    expect(answer!.value).toContain("MySQL")
    expect(answer!.structuredAnswers).toEqual([["MySQL"]])
    expect(answer!.source).toBe("option")
    expect(answer!.sessionId).toBe("sess-A")
    expect(answer!.toolCallId).toBe("tool-q-1")

    // The submit button flips to a sent state (the transcript block stays
    // pending until the server resolves the question).
    await expect(block.locator(".question-submit")).toBeDisabled()
    await expect(block.locator(".question-submit")).toHaveText("Sent!")

    expectNoBrowserErrors(captured)
  })

  test("question free-text submit fires source=freetext", async ({ page }) => {
    await page.goto("/")
    await dispatchHostMessage(page, {
      type: "init_state",
      sessions: [
        {
          id: "sess-A",
          name: "A",
          model: "anthropic/claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "assistant",
              id: "asst-1",
              blocks: [{
                type: "question",
                id: "tool-q-2",
                toolCallId: "tool-q-2",
                sessionId: "sess-A",
                text: "What's the deployment target?",
                options: [],
                allowFreeText: true,
              }],
              timestamp: Date.now(),
              sessionId: "sess-A",
            },
          ],
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
        },
      ],
      activeSessionId: "sess-A",
      globalModel: "anthropic/claude-3-5-sonnet-20241022",
    })
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
})
