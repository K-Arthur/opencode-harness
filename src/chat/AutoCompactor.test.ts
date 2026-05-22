import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "AutoCompactor.ts"), "utf8")

void describe("AutoCompactor.ts", () => {
  void it("exports AutoCompactor class", () => {
    assert.ok(source.includes("export class AutoCompactor"), "AutoCompactor class must be exported")
  })

  void it("constructor accepts sessionManager, sessionStore, contextMonitor, tabManager", () => {
    assert.ok(source.includes("private readonly sessionManager: SessionManager"), "must accept SessionManager")
    assert.ok(source.includes("private readonly sessionStore: SessionStore"), "must accept SessionStore")
    assert.ok(source.includes("private readonly contextMonitor: ContextMonitor"), "must accept ContextMonitor")
    assert.ok(source.includes("private readonly tabManager: TabManager"), "must accept TabManager")
  })

  void it("has tryCompactIfNeeded method with auto, off, and banner modes", () => {
    assert.ok(source.includes("tryCompactIfNeeded("), "must have tryCompactIfNeeded method")
    assert.ok(source.includes("autoCompact === \"off\""), "must handle off setting")
    assert.ok(source.includes("autoCompact === \"auto\""), "must handle auto setting")
    assert.ok(source.includes("compaction_started"), "must send compaction_started message")
    assert.ok(source.includes("compact_banner"), "must send compact_banner in manual mode")
  })

  void it("has handleBannerAction for compact_now and remind_later", () => {
    assert.ok(source.includes("handleBannerAction("), "must have handleBannerAction method")
    assert.ok(source.includes("compact_now"), "must handle compact_now")
    assert.ok(source.includes("remind_later"), "must handle remind_later")
    assert.ok(source.includes("compact_banner_dismissed"), "must send dismiss event on remind")
  })

  void it("has compactNow method that compacts the server session", () => {
    assert.ok(source.includes("async compactNow("), "must have compactNow method")
    assert.ok(source.includes("this.sessionManager.compactSession("), "must call compactSession on server")
    assert.ok(source.includes("this.tabManager.getTab("), "must find tab")
    assert.ok(source.includes("server not running"), "must handle server not running")
  })

  void it("manages snooze state internally", () => {
    assert.ok(source.includes("snoozeUntil"), "must have snoozeUntil field")
    assert.ok(source.includes("snoozeTokens"), "must have snoozeTokens field")
    assert.ok(source.includes("snoozeUntil = Date.now() + 10 * 60 * 1000"), "must set 10-minute snooze")
    assert.ok(source.includes("snoozeUntil = 0"), "must reset snooze on compact_now")
  })

  void it("checks message threshold before auto-compacting", () => {
    assert.ok(source.includes("session.messages.length < 10"), "must require at least 10 messages")
    assert.ok(source.includes("this.contextMonitor.getAutoCompactSetting("), "must check auto compact setting")
  })

  void it("sends session_compacted message on completion", () => {
    assert.ok(source.includes("session_compacted"), "must send session_compacted message")
  })

  void describe("Stage 4: Compaction safety features", () => {
    void it("prevents compaction during active streaming", () => {
      assert.ok(
        source.includes("activeTab.isStreaming") && source.includes("return"),
        "tryCompactIfNeeded must guard against compaction during streaming"
      )
    })

    void it("handles compaction failures with error callback", () => {
      assert.ok(
        source.includes(".catch") && source.includes("postRequestError"),
        "compaction failures must call postRequestError callback"
      )
    })

    void it("sends compaction_started message before attempting compaction", () => {
      assert.ok(
        source.includes("compaction_started") && source.indexOf("compactSession") > source.indexOf("compaction_started"),
        "must send compaction_started before calling compactSession"
      )
    })

    // User-initiated compactNow path was missing the streaming guard. Without
    // it, clicking the banner's "Compact now" during a live stream would
    // truncate the message list mid-response and leave the UI in a torn state.
    void it("compactNow refuses to compact while the tab is streaming", () => {
      const fnIdx = source.indexOf("async compactNow(")
      assert.ok(fnIdx >= 0, "compactNow must exist")
      const fnEnd = source.indexOf("\n  }", fnIdx)
      const block = source.slice(fnIdx, fnEnd)
      assert.ok(
        /tab\?\.\s*isStreaming|tab\.isStreaming/.test(block),
        "compactNow must check tab.isStreaming and refuse compaction during an active response"
      )
      assert.ok(
        block.includes("postRequestError"),
        "compactNow must surface a user-actionable error when refusing due to active streaming"
      )
    })
  })

  void it("sends task_banner for completion", () => {
    assert.ok(source.includes("task_banner"), "must send task_banner for completion")
  })

  void describe("Stage 5: Audit hardening", () => {
    // Background-tab context_usage events used to call tryCompactIfNeeded
    // which always targets the *active* tab. So tab B at 90% would trigger
    // compaction on tab A even if A was at 5%. The trigger now passes
    // sessionId via CompactTriggerContext and bails when it doesn't match.
    void it("tryCompactIfNeeded refuses when the firing tab isn't the active tab", () => {
      const fnIdx = source.indexOf("tryCompactIfNeeded(")
      assert.ok(fnIdx >= 0)
      const block = source.slice(fnIdx, source.indexOf("handleBannerAction(", fnIdx))
      assert.match(
        block,
        /ctx\??\.sessionId|CompactTriggerContext/,
        "tryCompactIfNeeded must consult a trigger sessionId so background-tab triggers don't compact the active tab",
      )
      assert.match(
        block,
        /ctx\??\.sessionId\s*!==\s*activeTab\.id|sessionId\s*!==\s*activeTab\.id/,
        "tryCompactIfNeeded must compare the trigger sessionId against the active tab id",
      )
    })

    // A slow compactSession round-trip leaves the >=80% trigger free to
    // fire again on every subsequent context_usage update, stacking
    // duplicate compactions. The new inFlight Set blocks that.
    void it("guards against re-entrant compaction via an in-flight Set", () => {
      assert.match(source, /inFlight\s*=\s*new\s+Set<string>\(\)/,
        "must declare a per-session in-flight Set so duplicate compactions don't stack",
      )
      assert.match(source, /inFlight\.add\(/, "must add to the in-flight Set when compaction starts")
      assert.match(source, /inFlight\.delete\(/, "must clear the in-flight Set when compaction settles")
      assert.match(source, /\.finally\(/, "must use finally to ensure in-flight is cleared on both success and error")
    })

    void it("adds cooldown and token-density gates for repeated auto compaction", () => {
      assert.match(source, /lastAutoCompact/, "must track recent auto compactions")
      assert.match(source, /minAutoCompactIntervalMs/, "must enforce an auto-compaction cooldown")
      assert.match(source, /tokenDensity/, "must consider token density before compacting")
      assert.match(source, /minTokenDeltaRatio/, "must require material token growth before repeating")
    })

    // The old percent recomputation in the banner path did Math.round((usage / limit) * 100)
    // with no zero-guard. After the context-window fix, limit can legitimately
    // be 0 (model unresolved) and we'd surface NaN in the banner payload.
    void it("banner percent calc is safe when limit is 0 (model context window unresolved)", () => {
      const fnIdx = source.indexOf("tryCompactIfNeeded(")
      const block = source.slice(fnIdx, source.indexOf("handleBannerAction(", fnIdx))
      // Must either clamp via Math.min/Math.max or branch on limit > 0
      assert.match(
        block,
        /safeLimit|limit\s*>\s*0|Math\.(min|max)\([^)]*100/,
        "tryCompactIfNeeded must guard against limit === 0 when computing the banner percent",
      )
    })

    // compact_now used to reset snoozeUntil but leave snoozeTokens stale.
    // A future banner could then be suppressed by the 1.05× gate against
    // the old snoozeTokens value.
    void it("resets BOTH snoozeUntil and snoozeTokens on compact_now", () => {
      const fnIdx = source.indexOf("handleBannerAction(")
      const block = source.slice(fnIdx, source.indexOf("async compactNow(", fnIdx))
      assert.match(block, /snoozeUntil\s*=\s*0/, "must reset snoozeUntil on compact_now")
      assert.match(block, /snoozeTokens\s*=\s*0/, "must reset snoozeTokens on compact_now (else stale value can gate future banners)")
    })

    // user-initiated compactNow should also respect the in-flight guard so
    // double-clicking "Compact now" doesn't fire compactSession twice.
    void it("compactNow refuses re-entrant invocations", () => {
      const fnIdx = source.indexOf("async compactNow(")
      const fnEnd = source.indexOf("/** Test", fnIdx) > 0 ? source.indexOf("/** Test", fnIdx) : source.indexOf("dispose()", fnIdx)
      const block = source.slice(fnIdx, fnEnd)
      assert.match(block, /inFlight\.has\(/,
        "compactNow must short-circuit when a compaction is already in flight for this session",
      )
    })

    // The 80% trigger threshold used to be hardcoded in ChatProvider. Models
    // with very small contexts (e.g. 65k DeepSeek reasoner) may want a
    // higher threshold so they don't compact prematurely; large models
    // (1M Sonnet) may want a lower one to control cost. Threshold is now
    // read from VS Code config `opencode.autoCompactThreshold` (number,
    // default 80) with optional per-model overrides via
    // `opencode.autoCompactPerModelThreshold` (object keyed by
    // "provider/modelId" → number). The numeric logic lives in
    // ContextMonitor.getAutoCompactThreshold; AutoCompactor only consumes it.
    void it("AutoCompactor consults a configurable threshold per active model", () => {
      assert.match(
        source,
        /getAutoCompactThreshold\([^)]*activeTab\.model/,
        "tryCompactIfNeeded must call getAutoCompactThreshold(activeTab.model) so per-model overrides apply",
      )
    })

    void it("ContextMonitor implements the configurable threshold with clamp + override map", () => {
      const monitorSource = readFileSync(
        resolve(__dirname, "../monitor/ContextMonitor.ts"),
        "utf8",
      )
      assert.match(
        monitorSource,
        /getAutoCompactThreshold\s*\(/,
        "ContextMonitor must export getAutoCompactThreshold",
      )
      assert.match(
        monitorSource,
        /autoCompactPerModelThreshold/,
        "ContextMonitor must read the per-model override map from VS Code config",
      )
      assert.match(
        monitorSource,
        /Math\.max\([\s\S]{0,40}10[\s\S]{0,40}Math\.min\(95|clamp[\s\S]{0,40}10[\s\S]{0,40}95/,
        "ContextMonitor must clamp threshold to [10, 95]",
      )
    })

    // Multi-tab safety: when tabs A and B use different models, compactSession
    // must use the tab's own model — not SessionManager's global currentModel.
    // The earlier code called compactSession(cliSessionId) with no model arg,
    // so the SDK summarized using whichever model was set globally — could
    // be the wrong one for the tab being compacted.
    void it("compactSession is called with the active tab's specific model", () => {
      // Auto-compact path
      const autoIdx = source.indexOf("tryCompactIfNeeded(")
      const autoBlock = source.slice(autoIdx, source.indexOf("handleBannerAction(", autoIdx))
      assert.match(
        autoBlock,
        /compactSession\([^)]*,\s*[a-zA-Z_]+[\s)]/,
        "auto-compact must pass a second arg (model) to compactSession",
      )
      assert.match(
        autoBlock,
        /toModelRef|parseModelRef|activeTab\.model/,
        "auto-compact must derive a ModelRef from the active tab's model field",
      )

      // Manual compactNow path
      const manualIdx = source.indexOf("async compactNow(")
      const manualBlock = source.slice(manualIdx, source.indexOf("isCompacting(", manualIdx))
      assert.match(
        manualBlock,
        /compactSession\([^)]*,\s*[a-zA-Z_]+[\s)]/,
        "compactNow must pass a second arg (model) to compactSession",
      )
      assert.match(
        manualBlock,
        /toModelRef|parseModelRef|tab\.model/,
        "compactNow must derive a ModelRef from the tab's own model field",
      )
    })

    // post-compaction success must explicitly post session_compacted on the
    // compactNow path so the webview reload triggers and the user sees the
    // refreshed message list — earlier this only fired on the auto-compact path.
    void it("compactNow emits session_compacted on success", () => {
      const fnIdx = source.indexOf("async compactNow(")
      const fnEnd = source.indexOf("isCompacting", fnIdx)
      const block = source.slice(fnIdx, fnEnd)
      assert.match(
        block,
        /session_compacted/,
        "compactNow must post session_compacted on success so the webview refreshes the message list",
      )
    })
  })
})
