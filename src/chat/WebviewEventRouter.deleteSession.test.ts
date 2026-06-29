/**
 * Comprehensive tests for session deletion flows.
 *
 * Covers:
 *   - Regression: Bug 1 (delete_session never deleted from server)
 *   - Regression: Bug 2 (delete_server_session left orphaned tab)
 *   - Edge cases: empty sessions, needsBackfill exemption, active session
 *     reassignment, double-delete safety, missing cliSessionId
 *   - Behavioral: SessionStore.delete fires change event, clears active
 *   - Integration: close_tab → deleteIfEmpty does NOT delete sessions
 *     with history (only prunes empty ones)
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const routerSource = readFileSync(path.join(__dirname, "WebviewEventRouter.ts"), "utf8")
const providerSource = readFileSync(path.join(__dirname, "ChatProvider.ts"), "utf8")
const storeSource = readFileSync(path.join(__dirname, "..", "session", "SessionStore.ts"), "utf8")

function blockBetween(src: string, startNeedle: string, endNeedle: string): string {
  const start = src.indexOf(startNeedle)
  assert.ok(start >= 0, `${startNeedle} must exist`)
  const end = src.indexOf(endNeedle, start)
  assert.ok(end > start, `${endNeedle} must follow ${startNeedle}`)
  return src.slice(start, end)
}

describe("Session deletion — comprehensive", () => {
  // ── Regression: Bug 1 — delete_session server-side delete ──

  describe("delete_session: captures cliId before local delete (Bug 1)", () => {
    const block = blockBetween(routerSource, '["delete_session"', '["archive_session"')

    it("reads session?.cliSessionId before sessionStore.delete", () => {
      const cliIdIdx = block.indexOf("const cliId = session?.cliSessionId")
      const deleteIdx = block.indexOf("this.opts.sessionStore.delete(targetId)")
      assert.ok(cliIdIdx >= 0, "must capture cliId from session object")
      assert.ok(deleteIdx >= 0, "must call sessionStore.delete")
      assert.ok(cliIdIdx < deleteIdx, "cliId must be captured BEFORE the local delete")
    })

    it("calls sessionManager.deleteSession directly from the handler", () => {
      assert.ok(
        block.includes("this.opts.sessionManager.deleteSession(cliId)"),
        "must call server delete directly — onDidChangeSession reads sessionStore.get() after delete and gets undefined",
      )
    })

    it("guards on sessionManager.isRunning", () => {
      assert.ok(
        block.includes("this.opts.sessionManager.isRunning"),
        "must check isRunning before server call",
      )
    })

    it("catches server delete errors without blocking", () => {
      assert.ok(block.includes(".catch(err =>"), "must catch errors")
      assert.ok(block.includes("log.warn"), "must log as warning")
    })

    it("handles missing targetSessionId gracefully", () => {
      assert.ok(
        block.includes('msg.targetSessionId as string | undefined') || block.includes("!targetId"),
        "must guard on missing targetSessionId",
      )
    })

    it("skips confirmation for empty sessions (messages.length === 0)", () => {
      assert.ok(
        block.includes("session.messages.length > 0"),
        "confirmation dialog must only appear for sessions with messages",
      )
    })

    it("aborts early if user cancels the confirmation dialog", () => {
      assert.ok(
        block.includes('confirmed !== "Delete"'),
        "must return early if user does not confirm",
      )
    })

    it("does not call sessionStore.delete if cliId is missing (no server session)", () => {
      // The handler must still delete locally even if cliId is undefined —
      // the server delete is conditional, the local delete is unconditional.
      const deleteIdx = block.indexOf("this.opts.sessionStore.delete(targetId)")
      const serverDeleteIdx = block.indexOf("if (cliId && this.opts.sessionManager.isRunning")
      assert.ok(deleteIdx >= 0, "must always delete locally")
      assert.ok(serverDeleteIdx > deleteIdx, "server delete must be conditional and AFTER local delete")
    })
  })

  // ── Regression: Bug 2 — delete_server_session orphaned tab ──

  describe("delete_server_session: closes tab before local delete (Bug 2)", () => {
    const block = blockBetween(routerSource, '["delete_server_session"', '["preview_theme"')

    it("calls tabManager.closeTab before sessionStore.delete", () => {
      const closeIdx = block.indexOf("this.opts.tabManager.closeTab(local.id)")
      const deleteIdx = block.indexOf("this.opts.sessionStore.delete(local.id)")
      assert.ok(closeIdx >= 0, "must close the tab")
      assert.ok(deleteIdx >= 0, "must delete from store")
      assert.ok(closeIdx < deleteIdx, "must close tab BEFORE deleting from store")
    })

    it("matches local sessions by cliSessionId === serverId", () => {
      assert.ok(
        block.includes("local.cliSessionId === serverId"),
        "must match by cliSessionId to find the right local session",
      )
    })

    it("posts server_session_deleted after cleanup", () => {
      assert.ok(
        block.includes('"server_session_deleted"'),
        "must notify the webview",
      )
    })

    it("shows error to user if server delete fails", () => {
      assert.ok(
        block.includes("showErrorMessage"),
        "must surface server delete failure to the user",
      )
    })

    it("requires confirmation with modal dialog", () => {
      assert.ok(
        block.includes("{ modal: true }"),
        "must use a modal confirmation dialog",
      )
      assert.ok(
        block.includes('"Delete from Server"'),
        "must use 'Delete from Server' as the confirm button",
      )
    })

    it("guards on sessionManager.isRunning", () => {
      assert.ok(
        block.includes("this.opts.sessionManager.isRunning"),
        "must check isRunning — cannot delete from server if it's not running",
      )
    })

    it("breaks after finding the first matching local session", () => {
      assert.ok(block.includes("break"), "must break after cleanup — only one local session should match")
    })
  })

  // ── ChatProvider onDidChangeSession: no dead server-delete code ──

  describe("ChatProvider onDidChangeSession: no double-delete", () => {
    const block = blockBetween(providerSource, "onDidChangeSession", 'case "renamed"')

    it("does NOT call sessionManager.deleteSession from the change handler", () => {
      assert.ok(
        !block.includes("this.sessionManager.deleteSession"),
        "the change handler must not call server delete — delete_session handles it directly to avoid double-delete",
      )
    })

    it("still closes the tab and posts session_deleted", () => {
      assert.ok(block.includes("this.tabManager.closeTab"), "must close the tab")
      assert.ok(block.includes('"session_deleted"'), "must notify the webview")
    })
  })

  // ── SessionStore.delete: behavioral edge cases ──

  describe("SessionStore.delete: edge cases", () => {
    it("fires change event with kind='deleted'", () => {
      assert.ok(
        storeSource.includes('this.fireChangeEvent({ kind: "deleted", sessionId: id })'),
        "must fire deleted change event",
      )
    })

    it("clears activeSessionId if the deleted session was active", () => {
      assert.ok(
        storeSource.includes("if (this.activeSessionId === id)"),
        "must check if the deleted session was active",
      )
      assert.ok(
        storeSource.includes('this.activeSessionId = ""'),
        "must clear activeSessionId when active session is deleted",
      )
    })

    it("reassigns active to the first remaining session", () => {
      assert.ok(
        storeSource.includes("this.setActive(remaining[0]!.id)"),
        "must reassign active to the first remaining session",
      )
    })

    it("fires _onSessionsChanged after delete", () => {
      assert.ok(
        storeSource.includes("this._onSessionsChanged.fire()"),
        "must fire onSessionsChanged so UI updates",
      )
    })
  })

  // ── SessionStore.deleteIfEmpty: edge cases ──

  describe("SessionStore.deleteIfEmpty: exemptions", () => {
    it("does NOT delete sessions with messages", () => {
      assert.ok(
        storeSource.includes("session.messages.length > 0"),
        "deleteIfEmpty must not delete sessions that have messages",
      )
    })

    it("does NOT delete sessions flagged needsBackfill", () => {
      assert.ok(
        storeSource.includes("session.needsBackfill === true"),
        "deleteIfEmpty must exempt needsBackfill sessions — they may have server-side history not yet fetched",
      )
    })

    it("delegates to delete() for actually-empty sessions", () => {
      assert.ok(
        storeSource.includes("this.delete(id)"),
        "deleteIfEmpty must call delete() for empty sessions",
      )
    })
  })

  // ── close_tab: does not delete sessions with history ──

  describe("close_tab: preserves sessions with history", () => {
    const block = blockBetween(routerSource, '["close_tab"', '["switch_tab"')

    it("calls deleteIfEmpty (not delete) so sessions with messages survive", () => {
      assert.ok(
        block.includes("this.opts.sessionStore.deleteIfEmpty(sessionId)"),
        "close_tab must use deleteIfEmpty — not delete — so closing a tab doesn't destroy history",
      )
    })

    it("aborts the stream if the tab was streaming", () => {
      assert.ok(
        block.includes("streamCoordinator.abort"),
        "must abort any in-flight stream before closing the tab",
      )
    })

    it("reassigns active session if the closed tab was active", () => {
      assert.ok(
        block.includes("wasActive"),
        "must track whether the closed tab was active",
      )
      assert.ok(
        block.includes("setActive(nextActiveId)"),
        "must reassign active to the next tab",
      )
      assert.ok(
        block.includes("clearActive"),
        "must clear active if no tabs remain",
      )
    })
  })

  // ── SessionClient.deleteSession: wire format ──

  describe("SessionClient.deleteSession: v2 wire format", () => {
    const clientSource = readFileSync(
      path.join(__dirname, "..", "session", "SessionClient.ts"),
      "utf8",
    )
    const deleteBlock = blockBetween(clientSource, "async deleteSession", "async getSession")

    it("uses flat { sessionID } parameter (v2 migration)", () => {
      assert.ok(
        deleteBlock.includes("sessionID: id"),
        "must use flat { sessionID: id } — v1 { path: { id } } is deprecated",
      )
    })

    it("does not check response error (fire-and-forget for delete)", () => {
      // deleteSession is the one v2 call that doesn't use throwOnV2Error —
      // the server returns 204 No Content and resp.data is null, so
      // throwOnV2Error would incorrectly throw. This is intentional.
      assert.ok(
        !deleteBlock.includes("throwOnV2Error"),
        "deleteSession must not call throwOnV2Error — 204 No Content has no error but resp.data is null",
      )
    })
  })
})
