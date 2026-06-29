/**
 * Comprehensive tests for session history listing and loading.
 *
 * Covers:
 *   - Bug 3: chooseHistorySession pre-filtered by workspace before
 *     importServerSessions, causing the prune step to delete
 *     cross-workspace sessions
 *   - Bug 4: isInCurrentWorkspace used exact string match, failing
 *     on trailing slashes and symlinks
 *   - Bug 5: request_more_messages server-fallback sliced to the end
 *     of the refreshed array instead of to beforeIndex, duplicating
 *     messages the user already had
 *   - Edge cases: empty workspace, missing directory, subagent filtering
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sessionCmdSource = readFileSync(path.join(__dirname, "..", "commands", "session.ts"), "utf8")
const managerSource = readFileSync(path.join(__dirname, "..", "session", "SessionManager.ts"), "utf8")
const routerSource = readFileSync(path.join(__dirname, "WebviewEventRouter.ts"), "utf8")
const storeSource = readFileSync(path.join(__dirname, "..", "session", "SessionStore.ts"), "utf8")

function blockBetween(src: string, startNeedle: string, endNeedle: string): string {
  const start = src.indexOf(startNeedle)
  assert.ok(start >= 0, `${startNeedle} must exist`)
  const end = src.indexOf(endNeedle, start)
  assert.ok(end > start, `${endNeedle} must follow ${startNeedle}`)
  return src.slice(start, end)
}

describe("Session history listing — comprehensive", () => {
  // ── Bug 3: chooseHistorySession pre-filtering ──

  describe("chooseHistorySession: passes ALL sessions to importServerSessions (Bug 3)", () => {
    const block = blockBetween(sessionCmdSource, "chooseHistorySession", "registerAttachRemoteCommand")

    it("filters only by !s.parentID, NOT by workspace, before importServerSessions", () => {
      // The old code filtered by !s.parentID && isInCurrentWorkspace(s.directory)
      // before passing to importServerSessions. The prune step in
      // importServerSessions deletes any needsBackfill session not in the
      // passed list, so pre-filtering by workspace silently nuked
      // cross-workspace sessions.
      const importIdx = block.indexOf("importServerSessions(serverSessions)")
      assert.ok(importIdx >= 0, "must call importServerSessions")

      const filterIdx = block.indexOf(".filter((s) => !s.parentID)")
      assert.ok(filterIdx >= 0, "must filter out subagents")
      assert.ok(filterIdx < importIdx, "filter must be before import")

      // Must NOT filter by isInCurrentWorkspace before import
      const beforeImport = block.slice(0, importIdx)
      assert.ok(
        !beforeImport.includes("isInCurrentWorkspace"),
        "must NOT pre-filter by workspace before importServerSessions — the prune step would delete cross-workspace sessions",
      )
    })

    it("applies workspace filtering for display only (after import)", () => {
      const filterBlock = block.indexOf("path.resolve(s.workspacePath)")
      assert.ok(filterBlock >= 0, "must use path.resolve for workspace comparison in display filter")
    })
  })

  // ── Bug 4: isInCurrentWorkspace path normalization ──

  describe("isInCurrentWorkspace: normalizes paths (Bug 4)", () => {
    const block = blockBetween(managerSource, "isInCurrentWorkspace", "recoverSessions")

    it("uses path.resolve for both paths", () => {
      assert.ok(
        block.includes("path.resolve(dir)"),
        "must resolve the server directory path",
      )
      assert.ok(
        block.includes("path.resolve(workspace)"),
        "must resolve the workspace path",
      )
    })

    it("returns true when workspace is undefined (no workspace folder)", () => {
      assert.ok(
        block.includes("if (!workspace) return true"),
        "must return true when no workspace is open — don't hide sessions",
      )
    })

    it("returns false when dir is undefined but workspace is set", () => {
      assert.ok(
        block.includes("if (!dir) return false"),
        "must return false when session has no directory but workspace is set",
      )
    })
  })

  // ── Bug 4b: list_server_sessions isCurrentWorkspace flag ──

  describe("list_server_sessions: normalizes isCurrentWorkspace flag (Bug 4b)", () => {
    const block = blockBetween(routerSource, '["list_server_sessions"', '["resume_server_session"')

    it("uses path.resolve for the isCurrentWorkspace comparison", () => {
      assert.ok(
        block.includes("path.resolve(s.directory)"),
        "must resolve server directory path",
      )
      assert.ok(
        block.includes("path.resolve(currentDir)"),
        "must resolve the current workspace directory",
      )
    })

    it("returns true when currentDir is undefined", () => {
      assert.ok(
        block.includes("!currentDir"),
        "must mark all sessions as current workspace when no workspace is open",
      )
    })

    it("returns true when session directory is undefined", () => {
      assert.ok(
        block.includes("!s.directory"),
        "must mark sessions with no directory as current workspace — don't hide silently",
      )
    })

    it("filters out subagents (parentID)", () => {
      assert.ok(
        block.includes("!s.parentID"),
        "must filter out subagent sessions from the server session list",
      )
    })
  })

  // ── Bug 5: request_more_messages server-fallback slicing ──

  describe("request_more_messages: correct slicing in server fallback (Bug 5)", () => {
    const block = blockBetween(routerSource, '["request_more_messages"', '["refresh_session_messages"')

    it("slices from newStart to beforeIndex, not to the end", () => {
      assert.ok(
        block.includes("beforeIndex - limit"),
        "must compute newStart relative to beforeIndex, not messages.length",
      )
      assert.ok(
        block.includes("Math.min(beforeIndex, refreshed.messages.length)"),
        "must cap the end index at beforeIndex to avoid duplicating messages the user already has",
      )
      assert.ok(
        block.includes("refreshed.messages.slice(newStart, endIdx)"),
        "must slice from newStart to endIdx (beforeIndex), not to the end of the array",
      )
    })

    it("does NOT use messages.length - limit for newStart in the server fallback", () => {
      // The old buggy code used refreshed.messages.length - limit, which
      // would send the last N messages of the refreshed array regardless
      // of where the user's current view cursor was.
      const serverFallback = block.slice(block.indexOf("// Local exhausted"))
      assert.ok(
        !serverFallback.includes("refreshed.messages.length - limit"),
        "must not use messages.length - limit in the server fallback — that sends the wrong slice",
      )
    })

    it("handles the case where server has fewer messages than local", () => {
      assert.ok(
        block.includes("serverMessages.length > session.messages.length"),
        "must only apply backfill if server has MORE messages than local",
      )
    })

    it("posts empty result with hasMore=false when both local and server are exhausted", () => {
      assert.ok(
        block.includes('hasMore: false'),
        "must signal no more messages when exhausted",
      )
    })
  })

  // ── SessionStore.importServerSessions: prune safety ──

  describe("importServerSessions: prune only deletes needsBackfill orphans", () => {
    it("only prunes sessions with needsBackfill === true", () => {
      assert.ok(
        storeSource.includes("sess.needsBackfill === true && !visibleServerIds.has(id)"),
        "must only prune sessions that are needsBackfill AND not in the server list — local sessions with messages must never be pruned",
      )
    })

    it("does not prune sessions that have been backfilled (needsBackfill deleted)", () => {
      // applyBackfilledMessages deletes needsBackfill, so backfilled
      // sessions are safe from pruning even if the server list shrinks.
      assert.ok(
        storeSource.includes("delete session.needsBackfill"),
        "applyBackfilledMessages must clear needsBackfill so the session is safe from future pruning",
      )
    })
  })

  // ── Bug 6: prune on empty server list ──

  describe("importServerSessions: does not prune on empty server list (Bug 6)", () => {
    it("guards the prune loop with serverSessions.length > 0", () => {
      assert.ok(
        storeSource.includes("if (serverSessions.length > 0)"),
        "must skip pruning when the server returns an empty list — an empty list likely means fresh server, different workspace, or transient issue, not that all sessions were deleted",
      )
    })

    it("prune condition still checks needsBackfill === true", () => {
      assert.ok(
        storeSource.includes("sess.needsBackfill === true && !visibleServerIds.has(id)"),
        "must only prune sessions that are needsBackfill AND not in the server list",
      )
    })
  })

  // ── Archive server sync ──

  describe("archive_session: propagates to server", () => {
    const block = blockBetween(routerSource, '["archive_session"', '["pin_session"')

    it("calls sessionManager.archiveSession after local archive", () => {
      assert.ok(
        block.includes("this.opts.sessionManager.archiveSession(cliId, true)"),
        "must propagate archive to the server via sessionManager.archiveSession",
      )
    })

    it("captures cliId from sessionStore.get AFTER archive (local state preserved)", () => {
      // Unlike delete_session, archive doesn't remove the session from the
      // store, so sessionStore.get() still works after archive().
      assert.ok(
        block.includes("this.opts.sessionStore.archive(targetId)"),
        "must archive locally first",
      )
      assert.ok(
        block.includes("session?.cliSessionId"),
        "must read cliSessionId from the archived session",
      )
    })

    it("guards on sessionManager.isRunning", () => {
      assert.ok(
        block.includes("this.opts.sessionManager.isRunning"),
        "must check isRunning before server call",
      )
    })

    it("catches server archive errors without blocking", () => {
      assert.ok(
        block.includes(".catch(err =>"),
        "must catch server archive errors",
      )
    })
  })

  describe("SessionClient.archiveSession: v2 wire format", () => {
    const clientSource = readFileSync(
      path.join(__dirname, "..", "session", "SessionClient.ts"),
      "utf8",
    )
    const archiveBlock = blockBetween(clientSource, "async archiveSession", "async getSessionMessages")

    it("uses session.update with time.archived parameter", () => {
      assert.ok(
        archiveBlock.includes("sessionID: id"),
        "must use flat { sessionID: id } parameter",
      )
      assert.ok(
        archiveBlock.includes("time:"),
        "must set time field for archive",
      )
      assert.ok(
        archiveBlock.includes("archived:"),
        "must set the archived timestamp",
      )
    })

    it("uses Date.now() for archived timestamp", () => {
      assert.ok(
        archiveBlock.includes("Date.now()"),
        "must use current timestamp when archiving",
      )
    })

    it("uses 0 to unarchive", () => {
      assert.ok(
        archiveBlock.includes("archived: 0"),
        "must use 0 to clear the archived state",
      )
    })
  })

  describe("extension.ts: session_updated syncs archive state from server", () => {
    const extSource = readFileSync(
      path.join(__dirname, "..", "extension.ts"),
      "utf8",
    )
    const block = blockBetween(extSource, 'case "session_updated"', "break")

    it("reads time.archived from the event data", () => {
      assert.ok(
        block.includes("time?.archived"),
        "must read time.archived from the session.updated event",
      )
    })

    it("archives locally when server says archived > 0", () => {
      assert.ok(
        block.includes("data.time.archived > 0"),
        "must check if archived timestamp is positive",
      )
      assert.ok(
        block.includes("sessionStore.archive"),
        "must call sessionStore.archive when server says archived",
      )
    })

    it("unarchives locally when server says archived === 0", () => {
      assert.ok(
        block.includes("sessionStore.unarchive"),
        "must call sessionStore.unarchive when server clears archived",
      )
    })

    it("only syncs when local state differs from server", () => {
      assert.ok(
        block.includes("local.archived !== isArchived"),
        "must only sync when local and server archive states differ — avoid feedback loop",
      )
    })
  })

  // ── Webview message validators ──

  describe("WebviewMessageValidator: covers all logged message types", () => {
    const validatorSource = readFileSync(
      path.join(__dirname, "WebviewMessageValidator.ts"),
      "utf8",
    )

    const missingTypes = [
      "get_voice_settings",
      "request_queue_state",
      "webview_ready",
      "list_commands",
      "get_models",
      "init_ack",
      "list_providers",
      "panel_visibility_state",
      "request_state_sync",
      "get_theme_config",
      "list_sessions",
      "list_server_sessions",
      "get_todos",
      "get_changed_files",
      "probe_run_status",
      "resume_session",
      "create_tab",
      "switch_tab",
      "webview_log",
    ]

    for (const msgType of missingTypes) {
      it(`has a validator for "${msgType}"`, () => {
        assert.ok(
          validatorSource.includes(`${msgType}:`),
          `must have a validator for "${msgType}" to suppress the "has no validator" warning`,
        )
      })
    }

    it("resume_session validator requires sessionId", () => {
      assert.ok(
        validatorSource.includes('resume_session: requiredStringValidator("sessionId"'),
        "resume_session must validate sessionId is present",
      )
    })

    it("create_tab validator requires sessionId", () => {
      assert.ok(
        validatorSource.includes('create_tab: requiredStringValidator("sessionId"'),
        "create_tab must validate sessionId is present",
      )
    })

    it("switch_tab validator requires sessionId", () => {
      assert.ok(
        validatorSource.includes('switch_tab: requiredStringValidator("sessionId"'),
        "switch_tab must validate sessionId is present",
      )
    })

    it("webview_log validator requires level", () => {
      assert.ok(
        validatorSource.includes('typeof msg.level !== "string"'),
        "webview_log must validate level is a non-empty string",
      )
    })
  })
})
