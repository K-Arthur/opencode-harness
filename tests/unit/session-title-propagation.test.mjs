import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const storeSource = readFileSync(path.join(__dirname, "..", "..", "src", "session", "SessionStore.ts"), "utf8")
const chatProviderSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "ChatProvider.ts"), "utf8")
const typesSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "types.ts"), "utf8")
const mainSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "main.ts"), "utf8")
const tabsSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "tabs.ts"), "utf8")

describe("Session title propagation — D1/D3/D4 defect fixes (structural)", () => {
  describe("D3 — race-free title push (registration-order-independent)", () => {
    it("SessionStore exposes setTitleAppliedCallback for direct IPC push", () => {
      assert.match(
        storeSource,
        /setTitleAppliedCallback\s*\(\s*cb\s*:/,
        "SessionStore must expose setTitleAppliedCallback(cb) for direct IPC push",
      )
    })

    it("SessionStore has a titleAppliedCallback private field", () => {
      assert.match(
        storeSource,
        /private\s+titleAppliedCallback\s*:/,
        "must declare the titleAppliedCallback field",
      )
    })

    it("applyServerTitle invokes titleAppliedCallback synchronously after fireChangeEvent", () => {
      const fnBody = storeSource.slice(storeSource.indexOf("applyServerTitle("))
      const slice = fnBody.slice(0, 2000)
      // Both calls must appear, and the callback invocation must come AFTER
      // the change event so consumers see consistent state.
      assert.ok(slice.includes("fireChangeEvent"), "must still fire legacy change event")
      assert.ok(slice.includes("titleAppliedCallback?."), "must invoke titleAppliedCallback")
      const cbIdx = slice.indexOf("titleAppliedCallback?.")
      const evIdx = slice.indexOf("fireChangeEvent(")
      assert.ok(cbIdx > evIdx, "titleAppliedCallback must fire AFTER fireChangeEvent")
    })

    it("setTitle invokes titleAppliedCallback (user-initiated rename uses the fast path)", () => {
      const fnBody = storeSource.slice(storeSource.indexOf("setTitle("))
      const slice = fnBody.slice(0, 1500)
      assert.ok(slice.includes("titleAppliedCallback?."), "setTitle must invoke titleAppliedCallback")
    })

    it("updateName invokes titleAppliedCallback", () => {
      const fnBody = storeSource.slice(storeSource.indexOf("updateName("))
      const slice = fnBody.slice(0, 1500)
      assert.ok(slice.includes("titleAppliedCallback?."), "updateName must invoke titleAppliedCallback")
    })

    it("ChatProvider wires setTitleAppliedCallback in the constructor", () => {
      assert.ok(
        chatProviderSource.includes("this.sessionStore.setTitleAppliedCallback("),
        "ChatProvider must register a callback that posts session_title_updated",
      )
      // The callback must post the new message type
      const slice = chatProviderSource.slice(chatProviderSource.indexOf("setTitleAppliedCallback"))
      assert.ok(
        slice.includes('"session_title_updated"'),
        "callback must post session_title_updated to webview",
      )
    })

    it("HostMessage type declares session_title_updated variant", () => {
      assert.ok(
        typesSource.includes('"session_title_updated"'),
        "HostMessage union must include session_title_updated",
      )
    })
  })

  describe("D1 — cliSessionId-not-yet-bound race (pendingTitles queue)", () => {
    it("SessionStore has a pendingTitles Map", () => {
      assert.match(
        storeSource,
        /private\s+pendingTitles\s*:\s*Map</,
        "must declare pendingTitles Map for the cliSessionId race",
      )
    })

    it("applyServerTitle queues into pendingTitles when no session matches", () => {
      const fnBody = storeSource.slice(storeSource.indexOf("applyServerTitle("))
      const slice = fnBody.slice(0, 2500)
      assert.ok(
        slice.includes("pendingTitles"),
        "applyServerTitle must reference pendingTitles when lookup misses",
      )
      assert.ok(
        slice.includes("pendingTitles.set("),
        "must set pendingTitles entry on miss",
      )
    })

    it("updateCliSessionId flushes pendingTitles on bind", () => {
      const fnBody = storeSource.slice(storeSource.indexOf("updateCliSessionId("))
      const slice = fnBody.slice(0, 2500)
      assert.ok(
        slice.includes("pendingTitles.get("),
        "updateCliSessionId must check pendingTitles",
      )
      assert.ok(
        slice.includes("pendingTitles.delete("),
        "must delete the consumed pending entry",
      )
      assert.ok(
        slice.includes("applyServerTitle(cliId,"),
        "must re-apply the queued title",
      )
    })

    it("updateCliSessionId defers flush to a microtask (so init_state lands first)", () => {
      const fnBody = storeSource.slice(storeSource.indexOf("updateCliSessionId("))
      const slice = fnBody.slice(0, 2500)
      assert.ok(
        slice.includes("queueMicrotask("),
        "flush must be deferred via queueMicrotask so other init code lands first",
      )
    })
  })

  describe("D4 — in-place tab-label patch (no innerHTML wipe)", () => {
    it("tabs.ts exports patchTabLabel", () => {
      assert.ok(
        tabsSource.includes("export function patchTabLabel"),
        "tabs.ts must export patchTabLabel",
      )
    })

    it("patchTabLabel does NOT clear innerHTML", () => {
      const fnBody = tabsSource.slice(tabsSource.indexOf("function patchTabLabel"))
      const slice = fnBody.slice(0, 1500)
      assert.ok(
        !slice.includes('innerHTML = ""'),
        "patchTabLabel must NOT wipe innerHTML (the D4 defect)",
      )
      assert.ok(
        slice.includes(".textContent"),
        "must update textContent in place",
      )
      assert.ok(
        slice.includes("aria-label"),
        "must update close-button aria-label",
      )
    })

    it("main.ts registers a session_title_updated handler", () => {
      assert.ok(
        mainSource.includes('"session_title_updated"'),
        "main.ts must register a handler for session_title_updated",
      )
      const slice = mainSource.slice(mainSource.indexOf('"session_title_updated"'))
      assert.ok(
        slice.includes("patchTabLabel"),
        "handler must call patchTabLabel (the no-teardown path)",
      )
    })

    it("main.ts imports patchTabLabel from tabs", () => {
      assert.ok(
        mainSource.includes("patchTabLabel") && mainSource.includes('from "./tabs"'),
        "main.ts must import patchTabLabel",
      )
    })

    it("main.ts imports extractTitle + dedupeTitle from shared pure module", () => {
      assert.ok(
        mainSource.includes("extractTitle") && mainSource.includes("dedupeTitle"),
        "main.ts must use the shared pure extractors",
      )
      assert.ok(
        mainSource.includes("../../session/titleExtractor"),
        "main.ts must import from the shared pure module (not a duplicate)",
      )
    })

    it("main.ts dedupes auto-generated titles against the live session set", () => {
      // Locate the auto-title block and confirm it calls dedupeTitle
      const dedupeIdx = mainSource.indexOf("dedupeTitle(")
      assert.ok(dedupeIdx > 0, "auto-title block must call dedupeTitle")
      // And that getAllSessions is queried for the existing names
      const surrounding = mainSource.slice(Math.max(0, dedupeIdx - 1500), dedupeIdx + 200)
      assert.ok(
        surrounding.includes("getAllSessions"),
        "must compute existing names from getAllSessions for dedupe input",
      )
    })
  })

  describe("CLI / server propagation — title consistency across surfaces", () => {
    // Without this contract, the webview's deduped titles ("Fix bug (2)")
    // would never reach the CLI, causing a mismatch when the same session
    // is resumed from the CLI tab strip or a sibling window. The fix is to
    // route webview-initiated renames through setTitle (which calls
    // serverTitleUpdater) instead of rename/updateName (which doesn't).

    it("WebviewEventRouter.rename_session handler calls setTitle, not rename", () => {
      const routerSource = readFileSync(
        path.join(__dirname, "..", "..", "src", "chat", "WebviewEventRouter.ts"),
        "utf8",
      )
      // Search for the handler specifically — ["rename_session" skips the
      // message-type allowlist array which also contains the bare string.
      const handlerIdx = routerSource.indexOf('["rename_session"')
      assert.ok(handlerIdx >= 0, "rename_session handler must exist")
      const fnBody = routerSource.slice(handlerIdx)
      const slice = fnBody.slice(0, 2000)
      assert.ok(
        slice.includes("sessionStore.setTitle("),
        "rename_session must call setTitle so the title reaches the server/CLI",
      )
      assert.ok(
        !slice.includes("sessionStore.rename(") && !slice.match(/\.rename\(sessionId/),
        "rename_session must NOT call rename/updateName (those skip serverTitleUpdater)",
      )
    })

    it("SessionStore.setTitle calls serverTitleUpdater when cliSessionId is bound", () => {
      const fnBody = storeSource.slice(storeSource.indexOf("setTitle("))
      const slice = fnBody.slice(0, 2000)
      assert.ok(
        slice.includes("serverTitleUpdater"),
        "setTitle must reference serverTitleUpdater",
      )
      assert.ok(
        slice.includes("void this.serverTitleUpdater("),
        "must invoke serverTitleUpdater so the CLI sees the new title",
      )
    })

    it("SessionStore.setTitle is feedback-loop-safe (applyServerTitle has equality gate)", () => {
      // Cross-check: the return path (server → applyServerTitle) must no-op
      // on equal titles so the server's echo after a webview-initiated
      // rename doesn't trigger a redundant IPC push.
      const applyBody = storeSource.slice(storeSource.indexOf("applyServerTitle("))
      const applySlice = applyBody.slice(0, 1500)
      assert.ok(
        applySlice.includes('session.name === trimmed) return false'),
        "applyServerTitle must early-return on equal titles (feedback-loop guard)",
      )
    })
  })

  describe("Backwards compatibility (regression guards)", () => {
    it("session_renamed legacy message type is still declared", () => {
      assert.ok(
        typesSource.includes('"session_renamed"'),
        "session_renamed must remain for the legacy rename path",
      )
    })

    it("SessionStore.applyServerTitle preserves the equality gate (no redundant IPC)", () => {
      const fnBody = storeSource.slice(storeSource.indexOf("applyServerTitle("))
      const slice = fnBody.slice(0, 1500)
      assert.ok(
        slice.includes('session.name === trimmed) return false'),
        "equality gate must remain (T1.5 — no redundant IPC for identical titles)",
      )
    })

    it("SessionStore.applyServerTitle does NOT call serverTitleUpdater (feedback-loop guard)", () => {
      const fnBody = storeSource.slice(storeSource.indexOf("applyServerTitle("))
      const slice = fnBody.slice(0, 2500)
      assert.ok(
        !slice.includes("serverTitleUpdater("),
        "applyServerTitle must not echo back to the server (avoid feedback loop)",
      )
    })

    it("ChatProvider.onDidChangeSession 'renamed' case is preserved (legacy path)", () => {
      assert.ok(
        chatProviderSource.includes('case "renamed"'),
        "ChatProvider must keep the onDidChangeSession renamed case",
      )
    })
  })
})
