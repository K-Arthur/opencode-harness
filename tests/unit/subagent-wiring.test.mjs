/**
 * Subagent UI wiring tests.
 *
 * Behavioral + structural checks that the four subagent-panel fixes
 * introduced by the "subagent UI reliability" change are wired end-to-end:
 *
 *   A. Placement: `.main-layout` wrapper present in index.html
 *   B. Event routing: ChatProvider.serverEventHandlers has a
 *      `subagent_update` entry that calls recordSubagentActivity
 *   C. Reconciliation: WebviewEventRouter `get_subagent_activities`
 *      cross-references the live tracker (no hardcoded "completed")
 *   D. Inline card liveness: streamHandlers.handleToolUpdate / handleToolEnd
 *      call applySubagentCardUpdate for `.subagent-card` elements
 *   E. Type fix: setupSubagentDetailView returns undefined (not null-cast)
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..", "..")

function src(...segs) {
  return readFileSync(join(root, "src", ...segs), "utf8")
}

void describe("subagent UI reliability — wiring", () => {

  void describe("A. placement — `.main-layout` wrapper", () => {
    const html = src("chat", "webview", "index.html")

    void it("wraps #tab-panels + the four side panels + the detail view", () => {
      // The wrapper must exist and be closed BEFORE the changed-files strip.
      const openIdx = html.indexOf('<div class="main-layout">')
      const closeIdx = html.indexOf("</div>", html.indexOf("<!-- #context-usage-panel removed"))
      assert.ok(openIdx > 0, ".main-layout wrapper must exist in index.html")
      assert.ok(closeIdx > openIdx, ".main-layout wrapper must be closed before the changed-files strip")
      // Each of the four side panels lives inside the wrapper.
      const wrapper = html.slice(openIdx, closeIdx)
      for (const id of ["#tab-panels", "#todos-panel", "#activity-panel", "#tasks-panel", "#subagent-panel", "#subagent-detail-view"]) {
        assert.ok(wrapper.includes(`id="${id.slice(1)}"`), `${id} must be inside .main-layout`)
      }
    })

    void it("each side panel uses the shared .tab-pane class inside .side-region", () => {
      const html2 = src("chat", "webview", "index.html")
      for (const id of ["todos-panel", "activity-panel", "tasks-panel", "subagent-panel"]) {
        const re = new RegExp(`id="${id}"[^>]*class="[^"]*\\btab-pane\\b`)
        assert.ok(re.test(html2), `${id} must have class="tab-pane"`)
      }
    })

    void it("the .main-layout rule is positioned relative (for detail-view overlay)", () => {
      const css = src("chat", "webview", "css", "layout.css")
      const ruleIdx = css.indexOf(".main-layout {")
      const ruleEnd = css.indexOf("}", ruleIdx)
      const rule = css.slice(ruleIdx, ruleEnd)
      assert.ok(/position:\s*relative/.test(rule), ".main-layout must be position: relative")
      assert.ok(/display:\s*flex/.test(rule), ".main-layout must be display: flex")
      assert.ok(/flex-direction:\s*row/.test(rule), ".main-layout must be flex-direction: row")
    })

    void it(".side-region rule enforces sidebar width and full height", () => {
      const css = src("chat", "webview", "css", "layout.css")
      assert.ok(css.includes(".side-region {"), ".side-region { rule must exist")
      const ruleIdx = css.indexOf(".side-region {")
      const ruleEnd = css.indexOf("}", ruleIdx)
      const rule = css.slice(ruleIdx, ruleEnd)
      assert.ok(/flex:\s*0\s*0\s*var\(--sidebar-width,\s*320px\)/.test(rule), ".side-region must use flex: 0 0 var(--sidebar-width, 320px)")
      assert.ok(/height:\s*100%/.test(rule), ".side-region must take height: 100%")
    })
  })

  void describe("B. `subagent_update` event handler", () => {
    const chatProvider = src("chat", "ChatProvider.ts")

    void it("ChatProvider.serverEventHandlers has a subagent_update entry", () => {
      assert.ok(
        /\["subagent_update",\s*\(/.test(chatProvider),
        "serverEventHandlers must contain a subagent_update entry",
      )
    })

    void it("subagent_update handler calls recordSubagentActivity", () => {
      const handlerIdx = chatProvider.indexOf('["subagent_update"')
      const handlerEnd = chatProvider.indexOf("}]", handlerIdx)
      const handler = chatProvider.slice(handlerIdx, handlerEnd)
      assert.ok(handler.includes("recordSubagentActivity"), "handler must call recordSubagentActivity")
      assert.ok(handler.includes("data.id"), "handler must thread data.id into the tracker")
      assert.ok(handler.includes("data.agentName"), "handler must thread agentName")
      assert.ok(handler.includes("data.currentActivity"), "handler must thread currentActivity")
    })

    void it("StreamCoordinator exposes getSubagentSnapshot for the router", () => {
      const sc = src("chat", "handlers", "StreamCoordinator.ts")
      assert.ok(/getSubagentSnapshot\(tabId:\s*string\)/.test(sc), "StreamCoordinator must expose getSubagentSnapshot(tabId)")
      assert.ok(/this\.activityTracker\.getSnapshot\(tabId\)\?\.subagents/.test(sc), "getSubagentSnapshot must source from activityTracker")
    })
  })

  void describe("C. reconciliation truth — no more hardcoded status", () => {
    const router = src("chat", "WebviewEventRouter.ts")

    void it("get_subagent_activities cross-references the live tracker", () => {
      const handlerIdx = router.indexOf('["get_subagent_activities"')
      const handlerEnd = router.indexOf('["', handlerIdx + 5)
      const handler = router.slice(handlerIdx, handlerEnd === -1 ? undefined : handlerEnd)
      assert.ok(
        handler.includes("streamCoordinator.getSubagentSnapshot"),
        "get_subagent_activities must cross-reference getSubagentSnapshot",
      )
      assert.ok(
        handler.includes("live?.status"),
        "status must be derived from the live tracker when available",
      )
    })

    void it("get_subagent_detail cross-references the live tracker", () => {
      const handlerIdx = router.indexOf('["get_subagent_detail"')
      // Slice a generous window — handler bodies in this file can be long.
      const handler = router.slice(handlerIdx, handlerIdx + 5000)
      assert.ok(
        handler.includes("getSubagentSnapshot"),
        "get_subagent_detail must cross-reference getSubagentSnapshot",
      )
      // Must not hardcode status: "completed"
      assert.ok(
        !/status:\s*"completed"/.test(handler),
        "get_subagent_detail must not hardcode status: \"completed\"",
      )
      assert.ok(
        !/isLive:\s*false/.test(handler),
        "get_subagent_detail must not hardcode isLive: false",
      )
    })
  })

  void describe("D. inline card liveness", () => {
    const sh = src("chat", "webview", "streamHandlers.ts")

    void it("imports applySubagentCardUpdate from subagentCard", () => {
      assert.ok(
        /import\s*\{[^}]*applySubagentCardUpdate[^}]*\}\s*from\s*"\.\/subagentCard"/.test(sh),
        "streamHandlers must import applySubagentCardUpdate",
      )
    })

    void it("handleToolUpdate routes .subagent-card elements via applySubagentCardUpdate", () => {
      const fnIdx = sh.indexOf("export function handleToolUpdate")
      const fnEnd = sh.indexOf("\nexport function ", fnIdx + 5)
      const fn = sh.slice(fnIdx, fnEnd === -1 ? fnEnd : fnEnd)
      assert.ok(fn.includes('classList.contains("subagent-card")'), "must detect subagent cards")
      assert.ok(fn.includes("applySubagentCardUpdate"), "must call applySubagentCardUpdate for subagent cards")
      assert.ok(/return\s*\n?\s*\}/.test(fn), "must early-return after routing to applySubagentCardUpdate")
    })

    void it("handleToolEnd routes .subagent-card elements via applySubagentCardUpdate", () => {
      const fnIdx = sh.indexOf("export function handleToolEnd")
      const fnEnd = sh.indexOf("\nexport function ", fnIdx + 5)
      const fn = sh.slice(fnIdx, fnEnd === -1 ? fnEnd : fnEnd)
      assert.ok(fn.includes('classList.contains("subagent-card")'), "must detect subagent cards")
      assert.ok(fn.includes("applySubagentCardUpdate"), "must call applySubagentCardUpdate for subagent cards")
    })

    void it("main.ts run_activity_update handler updates inline cards", () => {
      const main = src("chat", "webview", "main.ts")
      const block = main.slice(
        main.indexOf('["run_activity_update"'),
        main.indexOf('["instructions_changed"'),
      )
      assert.ok(block.includes("applySubagentCardUpdate"), "must call applySubagentCardUpdate on activity updates")
      assert.ok(block.includes("subagent-card"), "must query for subagent-card elements")
      assert.ok(block.includes('startsWith("subagent:")'), "must strip subagent: prefix from tracker id")
    })
  })

  void describe("E. setupSubagentDetailView type fix", () => {
    const src2 = src("chat", "webview", "subagentDetailView.ts")
    void it("returns SubagentDetailViewApi | undefined (not null-cast lie)", () => {
      assert.ok(
        /setupSubagentDetailView\([^)]*\):\s*SubagentDetailViewApi\s*\|\s*undefined/.test(src2),
        "must declare return type as SubagentDetailViewApi | undefined",
      )
      assert.ok(
        !/null\s+as\s+unknown\s+as\s+SubagentDetailViewApi/.test(src2),
        "must not use `null as unknown as SubagentDetailViewApi` lie",
      )
    })
  })

  void describe("F. user-dismissal respected", () => {
    const main = src("chat", "webview", "main.ts")
    void it("declares subagentDismissedBySession set", () => {
      assert.ok(/subagentDismissedBySession\s*=\s*new\s+Set<string>/.test(main), "must declare the dismissed set")
    })
    void it("setSubagentPanelOpen tracks explicit close", () => {
      const fnIdx = main.indexOf("function setSubagentPanelOpen")
      const fnEnd = main.indexOf("\n  function ", fnIdx + 5)
      const fn = main.slice(fnIdx, fnEnd === -1 ? undefined : fnEnd)
      assert.ok(fn.includes("subagentDismissedBySession.add"), "close must add to dismissed set")
      assert.ok(fn.includes("subagentDismissedBySession.delete"), "open must remove from dismissed set")
    })
    void it("auto-open honors dismissed set", () => {
      const block = main.slice(
        main.indexOf('["run_activity_update"'),
        main.indexOf('["instructions_changed"'),
      )
      assert.ok(block.includes("subagentDismissedBySession.has(sid)"), "auto-open must check dismissed set")
    })
    void it("handleStreamStart resets per-session dismissal", () => {
      const fnIdx = main.indexOf("function handleStreamStart")
      const fnEnd = main.indexOf("\n  function ", fnIdx + 5)
      const fn = main.slice(fnIdx, fnEnd === -1 ? undefined : fnEnd)
      assert.ok(fn.includes("subagentDismissedBySession.delete"), "must clear dismissed flag on new run")
    })
  })
})
