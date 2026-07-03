/**
 * Context-usage attribution (reported bug, 2026-07-03).
 *
 * Multiple tabs showed IDENTICAL context-usage figures, sometimes a bogus
 * 100%. Root cause: ContextMonitor's sessionless getters (`percent`,
 * `tokensUsed`, `limit`) reflect whichever session updated last, but several
 * host paths read them and stamped the result with a specific tab's
 * sessionId — so tab B's bar was painted with tab A's numerator and/or
 * denominator (tokens_A / limit_B clamps to 100%).
 *
 * These tests pin the per-session attribution at every consumer:
 *   1. StreamCoordinator stream-start/end boundary emits
 *   2. AutoCompactor threshold gating
 *   3. ChatProvider onContextChanged → webview post
 *   4. WebviewEventRouter get_context_usage fallback window
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const streamCoordinator = readFileSync(resolve(__dirname, "handlers/StreamCoordinator.ts"), "utf8")
const autoCompactor = readFileSync(resolve(__dirname, "AutoCompactor.ts"), "utf8")
const chatProvider = readFileSync(resolve(__dirname, "ChatProvider.ts"), "utf8")
const eventRouter = readFileSync(resolve(__dirname, "WebviewEventRouter.ts"), "utf8")

void describe("context-usage attribution — per-session, never sessionless globals", () => {
  void it("StreamCoordinator boundary emits use the tab's own snapshot, not sessionless getters", () => {
    assert.match(
      streamCoordinator,
      /emitLatestForSession\(tabId\)/,
      "stream boundaries must re-emit the tab's own stored snapshot",
    )
    assert.ok(
      !streamCoordinator.includes("percent: this.contextMonitor.percent"),
      "must not emit the sessionless percent (last-updated session's value) under a tab's sessionId",
    )
    assert.ok(
      !streamCoordinator.includes("tokens: this.contextMonitor.tokensUsed"),
      "must not emit the sessionless token count under a tab's sessionId",
    )
    assert.ok(
      !streamCoordinator.includes("maxTokens: this.contextMonitor.limit"),
      "must not emit the sessionless limit (another tab's context window) under a tab's sessionId",
    )
  })

  void it("AutoCompactor gates on the active tab's own usage snapshot", () => {
    const fnIdx = autoCompactor.indexOf("tryCompactIfNeeded(")
    assert.ok(fnIdx >= 0)
    const block = autoCompactor.slice(fnIdx, autoCompactor.indexOf("handleBannerAction(", fnIdx))
    assert.match(
      block,
      /getCurrentUsage\(activeTab\.id\)/,
      "threshold decision must read the active tab's per-session usage",
    )
    assert.ok(
      !block.includes("this.contextMonitor.percent"),
      "must not gate on the sessionless percent — a background tab's usage would trigger/mask compaction",
    )
    assert.ok(
      !block.includes("this.contextMonitor.tokensUsed"),
      "must not read the sessionless token count for the active tab's compaction decision",
    )
    assert.ok(
      !/this\.contextMonitor\.limit\b/.test(block),
      "must not read the sessionless limit for the banner payload",
    )
  })

  void it("ChatProvider drops sessionless context_usage instead of posting it (webview would paint the viewed tab)", () => {
    const idx = chatProvider.indexOf("onContextChanged?.((usage)")
    assert.ok(idx >= 0, "onContextChanged subscription must exist")
    const block = chatProvider.slice(idx, idx + 2000)
    const guardIdx = block.search(/if\s*\(!sessionId\)\s*\{/)
    const postIdx = block.indexOf("postMessage(")
    assert.ok(guardIdx >= 0, "must guard against a missing sessionId")
    assert.ok(postIdx >= 0, "must still post attributed usage")
    assert.ok(
      guardIdx < postIdx,
      "the missing-sessionId guard must run BEFORE postMessage so unattributed usage is never sent",
    )
    assert.match(
      block.slice(guardIdx, postIdx),
      /return/,
      "the guard must early-return, not just log",
    )
  })

  void it("WebviewEventRouter get_context_usage fallback uses the session's own context window", () => {
    const idx = eventRouter.indexOf('["get_context_usage"')
    assert.ok(idx >= 0)
    const block = eventRouter.slice(idx, eventRouter.indexOf('["context_history_request"', idx))
    assert.match(
      block,
      /limitFor\(targetId\)/,
      "the no-usage fallback must resolve the requested session's window, not the sessionless default",
    )
    assert.ok(
      !/contextMonitor\.limit\b/.test(block),
      "must not read the sessionless limit — it belongs to whichever session resolved last",
    )
  })
})
