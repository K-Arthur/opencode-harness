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
    await expect(strip).not.toContainText("from-B-2.ts")

    // Switch to session B
    await dispatchHostMessage(page, { type: "active_session_changed", sessionId: "sess-B" })
    await page.waitForTimeout(200)

    // Now strip shows B's files; A's must not bleed in
    await expect(strip).toContainText("from-B-1.ts")
    await expect(strip).toContainText("from-B-2.ts")
    await expect(strip).not.toContainText("from-A.ts")

    // Switch back to A — A's file must still be there, B's gone
    await dispatchHostMessage(page, { type: "active_session_changed", sessionId: "sess-A" })
    await page.waitForTimeout(200)
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
  test("Edited N files banner renders as a single compact row", async ({ page }) => {
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

    const banner = page.locator(".task-banner--compact").first()
    await expect(banner).toBeVisible()
    // The compact variant must NOT use the legacy multi-row card styling
    // (no big icon, no max-height scroll area).
    await expect(banner.locator(".task-banner-files")).toHaveCount(0)
    // The +N more pill must appear since 13 files > FILE_CHIP_VISIBLE (4)
    await expect(banner.locator(".cf-strip-overflow")).toHaveText(/\+\d+ more/)
  })

  test("clicking the compact banner expands the chip list", async ({ page }) => {
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

    const banner = page.locator(".task-banner--compact").first()
    await expect(banner).not.toHaveClass(/task-banner--expanded/)
    // Click the chevron, not a file chip — clicking on a chip would route to
    // open_file instead of toggling expansion (intentional separation).
    await banner.locator(".task-banner-chevron").click()
    await expect(banner).toHaveClass(/task-banner--expanded/)
    // After expansion all 13 chips are present, no overflow pill
    await expect(banner.locator(".cf-strip-chip")).toHaveCount(13)
    await expect(banner.locator(".cf-strip-overflow")).toHaveCount(0)
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
    await expect(block.locator(".question-option")).toHaveCount(3)
    await expect(block.locator(".question-freetext")).toBeVisible()

    // Click "MySQL"
    await block.locator(".question-option").filter({ hasText: "MySQL" }).click()

    // Verify the postMessage was sent
    const sent = await postedMessages(page)
    const answer = sent.find((m) => m.type === "question_answer")
    expect(answer).toBeTruthy()
    expect(answer!.value).toBe("MySQL")
    expect(answer!.source).toBe("option")
    expect(answer!.sessionId).toBe("sess-A")
    expect(answer!.toolCallId).toBe("tool-q-1")

    // Block goes into answered state and disables further input
    await expect(block).toHaveClass(/question-block--answered/)

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
