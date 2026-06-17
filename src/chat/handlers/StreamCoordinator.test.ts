import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "StreamCoordinator.ts"), "utf8")
const typesSource = readFileSync(resolve(__dirname, "StreamCoordinatorTypes.ts"), "utf8")

describe("StreamCoordinator.ts", () => {
  it("exports StreamCallbacks interface", () => {
    assert.ok(source.includes("export type { StreamCallbacks") || source.includes("export interface StreamCallbacks") || typesSource.includes("export interface StreamCallbacks"), "StreamCallbacks must be exported")
    assert.ok(source.includes("postMessage: (msg: Record<string, unknown>) => void") || typesSource.includes("postMessage: (msg: Record<string, unknown>) => void | boolean | Thenable<boolean | void>"),
      "StreamCallbacks must have postMessage")
    assert.ok(source.includes("postRequestError: (message: string, sessionId?: string) => void") || typesSource.includes("postRequestError: (message: string, sessionId?: string) => void"),
      "StreamCallbacks must have postRequestError with optional sessionId")
  })

  it("exports StreamCoordinator class", () => {
    assert.ok(source.includes("export class StreamCoordinator"), "StreamCoordinator class must be exported")
  })

  it("constructor accepts DiffApplier for showSideBySideDiff (DiffHandler removed C1-a)", () => {
    // C1-a: DiffHandler was removed (the server applies edits directly).
    // DiffApplier is kept for the showSideBySideDiff entry point.
    assert.ok(source.includes("DiffApplier"), "constructor must accept a DiffApplier")
    assert.ok(
      !source.includes("DiffHandler") || source.includes("// DiffHandler removed"),
      "DiffHandler must NOT be instantiated in the constructor (C1-a dead subsystem removal)"
    )
  })

  it("has stream watchdog with STREAM_STUCK_MS constant", () => {
    assert.ok(source.includes("STREAM_STUCK_MS"), "STREAM_STUCK_MS constant must exist")
    assert.ok(/STREAM_STUCK_MS\s*=\s*\d+/.test(source), "STREAM_STUCK_MS must be assigned a number")
    assert.ok(source.includes("private startWatchdog("), "must have startWatchdog method")
    assert.ok(source.includes("private stopWatchdog("), "must have stopWatchdog method")
  })

  it("has startPrompt method with full lifecycle", () => {
    assert.ok(
      /async\s+startPrompt\s*\(\s*tabId:\s*string,\s*text:\s*string,\s*callbacks:\s*StreamCallbacks/.test(source),
      "startPrompt method must exist"
    )
    assert.ok(source.includes("this.contextEngine.gatherContext()"), "must gather context")
    assert.ok(source.includes(".ensureSession("), "must ensure session")
    assert.ok(source.includes("this.tabManager.setStreaming(tabId, true)"), "must set streaming state")
  })

  it("sends plain prompts as a single user text part without implicit context", () => {
    // Parts array is now built up; verify the user text is always the last part pushed
    // and that no invisible auto-context (contextText) is injected.
    assert.ok(
      source.includes("parts.push({ type: \"text\", text })") ||
        /sendPromptAsync\(\s*cliSessionId,\s*\[\s*\{\s*type:\s*"text",\s*text\s*\}\s*\],/s.test(source),
      "startPrompt must include the user's text in the parts sent to sendPromptAsync"
    )
    assert.ok(
      !source.includes("text: contextText"),
      "startPrompt must not prepend generated context as a text part"
    )
  })

  it("has finalizeStream method", () => {
    assert.ok(
      source.includes("async finalizeStream(tabId: string, callbacks: StreamCallbacks)"),
      "finalizeStream must exist"
    )
    assert.ok(source.includes('type: "stream_end"'), "must post stream_end message")
    assert.ok(source.includes("this.stripContextWrapper("), "must strip context wrapper")
  })

  it("no longer carries the removed append-callback machinery", () => {
    // The "append" steer mode was folded into the visible queue (drained on
    // stream_end via onQueueDrain). The append callback path and its
    // append_cancelled notification are gone.
    assert.ok(!source.includes("appendCallbacks"), "appendCallbacks field must be removed")
    assert.ok(!source.includes("registerAppendCallback"), "registerAppendCallback must be removed")
    assert.ok(!source.includes("append_cancelled"), "append_cancelled message must be removed")
  })

  it("drains the host queue after finalizeStream (single follow-up path)", () => {
    assert.ok(source.includes("finalizeStream("), "must have finalizeStream method")
    assert.ok(source.includes('this.onQueueDrain(tabId, "completed")'), "finalize must drain the host queue on completion")
  })

  it("has guarded finalization for multi-message tool turns", () => {
	    assert.ok(
	      source.includes("async maybeFinalizeStream(tabId: string, callbacks: StreamCallbacks"),
	      "maybeFinalizeStream must exist"
	    )
	    assert.ok(
	      source.includes("getFinalizeDeferReason"),
	      "guarded finalization must ask for a defer reason"
	    )
	    assert.ok(
	      source.includes("assistant message only contains tool blocks"),
	      "tool-only assistant messages must be deferred until follow-up text or fallback completion"
	    )
	  })

  it("abort emits stream_end with reason aborted", () => {
    assert.ok(
      source.includes("async abort(tabId: string, callbacks: StreamCallbacks)"),
      "abort method must exist"
    )
    assert.ok(source.includes(".abortSession("), "must call abortSession")
    assert.ok(
      source.includes('reason: "aborted"'),
      "abort must emit stream_end with reason: aborted"
    )
    assert.ok(source.includes('type: "stream_end"'), "abort must emit stream_end")
    assert.ok(source.includes("callbacks.postMessage({"), "abort must post via callbacks")
  })

  it("streams live bash output through partial events with polling fallback", () => {
    assert.ok(source.includes("TOOL_PARTIAL_POLL_INTERVAL_MS = 500"), "must poll live tool output every 500ms")
    assert.ok(source.includes("TOOL_PARTIAL_FALLBACK_DELAY_MS = 1000"), "must delay polling so SSE partials can win first")
    assert.ok(source.includes("private armToolPartialPolling("), "must arm fallback polling after tool start")
    assert.ok(source.includes("pollToolPartialOutput("), "must poll session messages for live output")
    assert.ok(source.includes("getToolPartialOutput"), "polling must use SessionManager.getToolPartialOutput")
    assert.ok(source.includes('type: "stream_tool_partial"'), "must post stream_tool_partial messages")
    assert.ok(source.includes("source: \"sse\" | \"poll\""), "appendToolPartial must distinguish SSE from polling")
  })

  it("dedupes partial tokens, stops polling on SSE/finalization, and warns once when unsupported", () => {
    assert.ok(source.includes("toolPartialOffsets"), "must track per-tool partial tokens/lengths")
    assert.ok(source.includes("if (previous && partial.token <= previous.token) return"), "must drop duplicate partial tokens")
    assert.ok(source.includes("this.stopToolPartialPolling(tabId, toolId)"), "must stop polling on terminal paths")
    assert.ok(source.includes("this.toolPartialWarnedSessions.has(cliSessionId)"), "must warn once per session when no live buffer is exposed")
    assert.ok(source.includes("this.stopAllToolPartialPolling(tabId)"), "must clean up polling for tab cleanup/abort/dispose")
  })

  it("supports bash-card cancel through synthetic cancelled output plus whole-stream abort", () => {
    assert.ok(source.includes("async cancelToolFromCard("), "must expose cancelToolFromCard")
    assert.ok(source.includes('state: "cancelled"'), "cancel must synthesize a cancelled tool end")
    assert.ok(source.includes("this.stopToolPartialPolling(tabId, toolId)"), "cancel must stop partial polling for the tool")
    assert.ok(source.includes("await this.abort(tabId, callbacks)"), "cancel must fall back to whole-stream abort")
  })

  // Suppression POLICY is covered behaviorally in intentionalAbortRegistry.test.ts.
  // Here we only assert StreamCoordinator delegates to that registry at the right seams.
  it("delegates intentional-abort suppression to IntentionalAbortRegistry", () => {
    assert.ok(
      source.includes("new IntentionalAbortRegistry("),
      "must construct an IntentionalAbortRegistry",
    )
    assert.ok(
      source.includes("wasIntentionallyAborted(tabId: string, serverMessageId?: string): boolean"),
      "must expose wasIntentionallyAborted(tabId, serverMessageId?) for the server_error handler",
    )
    assert.ok(
      source.includes("this.abortRegistry.wasIntentional(tabId, serverMessageId,"),
      "wasIntentionallyAborted must consult the registry",
    )
    assert.ok(
      /async abort\(tabId: string[\s\S]*?this\.abortRegistry\.recordAbort\(/.test(source),
      "abort() must record the intentional abort (with the run's serverMessageId)",
    )
    assert.ok(source.includes("this.abortRegistry.clear()"), "dispose() must clear the registry")
  })

  it("records the server message id on the active run during appendChunk for abort correlation", () => {
    assert.ok(
      /if \(messageId\) \{[\s\S]*?runForMsgId\.serverMessageId = messageId/.test(source),
      "appendChunk must stash the server messageId on the active run",
    )
    assert.ok(typesSource.includes("serverMessageId") || source.includes("serverMessageId?: string"),
      "ActiveStreamRun must carry serverMessageId")
  })
  it("has appendChunk method (getDiffHandler removed C1-a)", () => {
    assert.ok(
      source.includes("appendChunk(tabId: string, text: string, callbacks?: StreamCallbacks, messageId?: string): void"),
      "appendChunk must exist with optional callbacks and messageId params"
    )
    assert.ok(
      !source.includes("getDiffHandler"),
      "C1-a: getDiffHandler must be removed (dead diff subsystem)"
    )
  })

  it("uses rendered chunk ACKs for streaming backpressure", () => {
    assert.ok(source.includes("MAX_UNACKED_STREAM_CHUNKS = 8"), "must cap unacked stream chunks")
    assert.ok(source.includes("MAX_STREAM_DEFER_MS = 250"), "must bound deferred chunk latency")
    assert.ok(source.includes("postedChunkSeqs"), "must track chunk seq separately from heartbeat seq")
    assert.ok(source.includes("deferredChunks"), "must coalesce deferred chunks")
    assert.ok(source.includes("postOrDeferChunk"), "appendChunk must route through backpressure gate")
    assert.ok(source.includes("this.drainDeferredChunk(tabId)"), "ACKs must drain deferred chunks")
  })

  it("has cleanupTab and no implicit context builder in the prompt path", () => {
    assert.ok(source.includes("cleanupTab(tabId: string): void {"), "cleanupTab must exist")
    assert.ok(!source.includes("private buildContextText("), "implicit context builder must not be used for prompt payloads")
    assert.ok(source.includes("private refreshContextTokenEstimate("), "token estimation may refresh separately from prompt sending")
  })

  it("has dispose method", () => {
    assert.ok(source.includes("dispose(): void"), "dispose must exist")
    assert.ok(source.includes("this.streamWatchdog"), "dispose must clear watchdog")
    assert.ok(source.includes("this.stuckStreamHandlers.clear()"), "dispose must clear stuck handlers")
  })

  it("emits partial hard_timeout stream_end when the watchdog detects a stuck stream", () => {
    const watchdogIdx = source.indexOf("private startWatchdog(")
    assert.ok(watchdogIdx >= 0, "startWatchdog must exist")
    const blockEnd = source.indexOf("\n  private stopWatchdog(", watchdogIdx)
    const block = source.slice(watchdogIdx, blockEnd > watchdogIdx ? blockEnd : watchdogIdx + 2500)
    assert.ok(
      block.includes("STREAM_STUCK_MS"),
      "watchdog must compare against STREAM_STUCK_MS"
    )
    assert.ok(
      /reason:\s*"hard_timeout"/.test(block),
      "watchdog must emit stream_end with reason: hard_timeout"
    )
    assert.ok(
      block.includes("partial: true"),
      "hard_timeout stream_end must mark the message as partial"
    )
  })

  it("has atomic stream slot reservation in startPrompt", () => {
    assert.ok(
      /startPrompt\s*\(\s*tabId:\s*string,\s*text:\s*string,\s*callbacks:\s*StreamCallbacks/.test(source),
      "startPrompt must exist"
    )
    assert.ok(
      source.includes("this.tabManager.setStreaming(tabId, true)"),
      "must set streaming state"
    )
  })

  it("has stripContextWrapper method", () => {
    assert.ok(
      source.includes("stripContextWrapper(text: string): string"),
      "stripContextWrapper must exist"
    )
    assert.ok(
      source.includes("<context>"),
      "must handle <context> tags"
    )
    assert.ok(
      source.includes("</context>"),
      "must handle </context> tags"
    )
  })

  it("cleans up tab on finalizeStream", () => {
    assert.ok(
      source.includes("async finalizeStream(tabId: string, callbacks: StreamCallbacks)"),
      "finalizeStream must exist"
    )
    assert.ok(
      source.includes("this.tabManager.setStreaming(tabId, false)"),
      "finalizeStream must clear streaming state"
    )
  })

  it("records assistant token usage in RateLimitMonitor with the selected provider", () => {
    assert.ok(source.includes("RateLimitMonitor"), "StreamCoordinator must receive RateLimitMonitor")
    assert.ok(source.includes("this.rateLimitMonitor.recordTokenUsage"), "finalization must record token usage")
    assert.match(
      source,
      /parseModelRef\(this\.modelManager\.model/,
      "recorded fallback quota must use provider from the selected model"
    )
  })

  it("final SDK token usage accumulates instead of replacing session totals", () => {
    const fetchIdx = source.indexOf("private async fetchFinalBlocks(")
    assert.ok(fetchIdx >= 0, "fetchFinalBlocks must exist")
    const fetchEnd = source.indexOf("\n  private mergeFinalBlocks(", fetchIdx)
    const block = source.slice(fetchIdx, fetchEnd > fetchIdx ? fetchEnd : fetchIdx + 5000)

    assert.ok(
      block.includes("this.sessionStore.accumulateTokenUsage(tabId"),
      "final SDK token usage must add to cumulative session totals"
    )
    assert.ok(
      !block.includes("this.sessionStore.updateTokenUsage(tabId"),
      "final SDK token usage must not replace cumulative session totals"
    )
  })

  it("has TTFB_TIMEOUT_MS configured for first-byte timeout", () => {
    assert.ok(source.includes("TTFB_TIMEOUT_MS"), "TTFB_TIMEOUT_MS constant must exist")
    assert.ok(/TTFB_TIMEOUT_MS\s*=\s*\d+/.test(source), "TTFB_TIMEOUT_MS must be assigned a number")
  })

  it("has firstChunkReceived flag on TabState-compatible stream tracking", () => {
    assert.ok(
      source.includes("clearTtfbTimeout("),
      "must have clearTtfbTimeout method"
    )
    assert.ok(
      source.includes("ttfbTimeout"),
      "must track TTFB timeout reference"
    )
  })

  it("does not install a chunk-inactivity timer that races server events", () => {
    assert.ok(
      !source.includes("CHUNK_INACTIVITY_TIMEOUT_MS"),
      "CHUNK_INACTIVITY_TIMEOUT_MS must not exist"
    )
    assert.ok(
      !/private\s+resetCompletionTimeout\s*\(/.test(source),
      "resetCompletionTimeout must not exist"
    )
  })

  // ── Server-driven activity tracking ───────────────────────────────────
  it("updates server activity on chunks and tool events instead of resetting a chunk timer", () => {
    assert.ok(
      source.includes("this.tabManager.touchActivity(tabId)"),
      "server-driven entry points must update tab activity"
    )
    assert.ok(
      !source.includes("resetCompletionTimeout"),
      "chunks must not reset a completion timeout"
    )
  })

  // ── Event-stream aware TTFB ───────────────────────────────────────────
  it("TTFB timeout distinguishes event stream disconnects from model first-byte timeout", () => {
    const ttfbIdx = source.indexOf("const ttfbTimeout = setTimeout(")
    assert.ok(ttfbIdx >= 0, "TTFB timeout must exist")
    const blockEnd = source.indexOf("\n      this.ttfbTimeouts.set", ttfbIdx)
    const block = source.slice(ttfbIdx, blockEnd > ttfbIdx ? blockEnd : ttfbIdx + 2000)
    assert.ok(
      block.includes("event_stream_disconnected"),
      "TTFB timeout must report event_stream_disconnected when transport is down"
    )
    assert.ok(
      block.includes("ttfb_timeout"),
      "TTFB timeout must still report ttfb_timeout when transport is connected"
    )
  })

  // ── TTFB timeout preserves transport-specific reason ──────────────────
  it("TTFB timeout emits a stream_end reason for both model and transport paths", () => {
    assert.ok(
      source.includes("reason,"),
      "TTFB timeout must pass the computed reason into stream_end"
    )
  })

  // ── Methodology advice visibility ──────────────────────────────────────
  it("posts methodology_selected to the webview when advice is applied", () => {
    // The doc comment promised this message for as long as the advisor has
    // existed, but it was never sent — methodology guidance was invisible.
    assert.ok(
      source.includes('"methodology_selected"'),
      "applyMethodologyAdvice must post methodology_selected to the webview"
    )
  })

  it("derives the status bar from the same advice — no second classification pass", () => {
    // The status bar used to run orchestrator.advise(text) — an independent
    // re-classification that could disagree with the addendum actually sent.
    assert.ok(
      !source.includes("orchestrator.advise("),
      "status bar must not re-classify; it must render the advice that was injected"
    )
  })

  it("reads the per-tab opt-out through a typed field, not an unsafe cast", () => {
    assert.ok(
      !source.includes("tab as unknown as { methodologyDisabled"),
      "methodologyDisabled must be a typed TabState field"
    )
    assert.ok(
      source.includes("methodologyDisabled"),
      "per-tab opt-out must still be honored"
    )
  })
})

  // ── Plan/build agent selection ──────────────────────────────────────────────
  it("maps extension plan mode to the OpenCode plan agent", () => {
    assert.ok(
      source.includes('const agent = modeToAgent(tab.mode)'),
      "plan mode must send agent: 'plan' to OpenCode"
    )
  })

  it("maps build and auto modes to the OpenCode build agent", () => {
    assert.ok(
      source.includes('import { modeToAgent } from "../modePolicy"'),
      "non-plan modes must send agent: 'build' so Auto remains a local UX mode"
    )
  })

  it("does not send deprecated prompt tools overrides for plan mode", () => {
    assert.ok(
      !source.includes("edit: false") &&
        !source.includes("write: false") &&
        !source.includes("apply_patch: false") &&
        !source.includes("bash: false"),
      "plan mode should rely on agent permissions, not deprecated tools overrides"
    )
  })

  it("plan mode no longer uses the obsolete file_edit key", () => {
    assert.ok(
      !source.includes("file_edit"),
      "tools key 'file_edit' is not a real opencode tool"
    )
  })

  it("passes the agent option to sendPromptAsync", () => {
    assert.ok(
      /sendPromptAsync\(cliSessionId,\s*parts,\s*\{[^}]*agent/s.test(source),
      "must pass agent to sendPromptAsync"
    )
  })

  // ── Tool ID mapping: stream_tool_end must carry the resolved ID in result.id
  // The webview reads msg.result.id; emitting only a top-level toolId field is ignored.
  it("appendToolEnd writes resolved tool ID into result.id so the webview can read it", () => {
    const postIdx = source.indexOf("private postToolEnd(")
    assert.ok(postIdx >= 0, "postToolEnd must exist")
    const blockEnd = source.indexOf("\n  private ", postIdx + 10)
    const block = source.slice(postIdx, blockEnd > postIdx ? blockEnd : postIdx + 2000)
    assert.ok(
      /result\s*:\s*\{\s*\.\.\.result\s*,\s*id\s*:\s*toolId\s*\}/.test(block) ||
        /result\.id\s*=\s*toolId/.test(block),
      "postToolEnd must overwrite result.id with the resolved toolId before posting (webview reads result.id)"
    )
  })

  // ── Parallel tool calls: activeToolCallIds must support multiple concurrent tools
  it("activeToolCallIds supports multiple concurrent tool calls per tab", () => {
    assert.ok(
      /activeToolCallIds\s*=\s*new\s+Map<string,\s*Set<string>>/.test(source) ||
        /activeToolCallIds\s*=\s*new\s+Map<string,\s*string\[\]>/.test(source),
      "activeToolCallIds must use Set<string> or string[] per tab to support parallel tool calls"
    )
  })

  it("appendToolStart adds to the per-tab tool-id set", () => {
    const startIdx = source.indexOf("appendToolStart(")
    assert.ok(startIdx >= 0, "appendToolStart must exist")
    // Look up to the next method definition, not the first internal call to getStableToolId.
    const endIdx = source.indexOf("private getStableToolId(", startIdx)
    const block = source.slice(startIdx, endIdx > startIdx ? endIdx : startIdx + 1200)
    assert.ok(
      /\.add\(\s*stableId\s*\)/.test(block) ||
        /\.push\(\s*stableId\s*\)/.test(block),
      "appendToolStart must add the tool ID to the tab's set/array"
    )
  })

  it("appendToolEnd removes resolved tool from the per-tab set on completion", () => {
    const postIdx = source.indexOf("private postToolEnd(")
    assert.ok(postIdx >= 0, "postToolEnd must exist")
    const blockEnd = source.indexOf("\n  private ", postIdx + 10)
    const block = source.slice(postIdx, blockEnd > postIdx ? blockEnd : postIdx + 2000)
    assert.ok(
      /\.delete\(\s*toolId\s*\)/.test(block) ||
        /\.splice\(/.test(block),
      "postToolEnd must remove the resolved tool ID from the tab's set/array"
    )
  })

  // ── Cleanup: tool maps must not leak across tab lifecycle
  it("cleanupTab clears toolCallCounts and activeToolCallIds entries", () => {
    const cleanupIdx = source.indexOf("cleanupTab(tabId: string): void {")
    assert.ok(cleanupIdx >= 0, "cleanupTab must exist")
    const nextSep = source.indexOf("\n  }", cleanupIdx)
    const block = source.slice(cleanupIdx, nextSep)
    assert.ok(
      block.includes("this.toolCallCounts.delete(tabId)"),
      "cleanupTab must delete toolCallCounts entry"
    )
    assert.ok(
      block.includes("this.activeToolCallIds.delete(tabId)"),
      "cleanupTab must delete activeToolCallIds entry"
    )
  })

  // ── Mid-stream messageId transition must NOT split the bubble.
  // The webview already accumulates all blocks of a turn into one bubble;
  // emitting synthetic stream_end + stream_start tears the bubble in half
  // and leaves text/tool blocks orphaned outside the visual bubble.
  it("appendChunk does not synthesize stream_end/stream_start on messageId transition", () => {
    const fnIdx = source.indexOf("appendChunk(")
    assert.ok(fnIdx >= 0, "appendChunk must exist")
    const blockEnd = source.indexOf("appendToolStart(", fnIdx)
    const block = source.slice(fnIdx, blockEnd > fnIdx ? blockEnd : fnIdx + 2500)
    assert.ok(
      !/type:\s*"stream_end"/.test(block),
      "appendChunk must NOT post stream_end on mid-turn messageId transition"
    )
    assert.ok(
      !/type:\s*"stream_start"/.test(block),
      "appendChunk must NOT post stream_start on mid-turn messageId transition"
    )
  })

  it("cleanupTab clears activeMessageIds so transitions don't leak across turns", () => {
    const cleanupIdx = source.indexOf("cleanupTab(tabId: string): void {")
    assert.ok(cleanupIdx >= 0, "cleanupTab must exist")
    const blockEnd = source.indexOf("\n  }", cleanupIdx)
    const block = source.slice(cleanupIdx, blockEnd)
    assert.ok(
      block.includes("this.activeMessageIds.delete(tabId)"),
      "cleanupTab must clear activeMessageIds entry to prevent stale prevId across turns"
    )
    assert.ok(
      block.includes("this.loggedBubbleMismatches.delete(tabId)"),
      "cleanupTab must clear loggedBubbleMismatches entry so the dedupe set doesn't leak across turns"
    )
  })

  // ── setStreamState must not log spurious "X → X" transitions.
  // appendChunk / appendToolStart re-assert "streaming" on every chunk, so without
  // a no-op guard the log channel gets one "streaming → streaming" line per token.
  it("setStreamState is a no-op (no log) when previous === next state", () => {
    const fnIdx = source.indexOf("private setStreamState(")
    assert.ok(fnIdx >= 0, "setStreamState must exist")
    const blockEnd = source.indexOf("\n  }", fnIdx)
    const block = source.slice(fnIdx, blockEnd)
    assert.ok(
      /if\s*\(\s*previous\s*===\s*state\s*\)\s*return/.test(block),
      "setStreamState must early-return when state is unchanged to avoid log spam"
    )
  })

  // ── The bubble-id mismatch log must fire once per server messageId, not once per chunk.
  // Without a dedupe set, this log emits on every text chunk for the duration of a turn.
  it("appendChunk dedupes the bubble-id mismatch log per server messageId", () => {
    const fnIdx = source.indexOf("appendChunk(")
    assert.ok(fnIdx >= 0, "appendChunk must exist")
    const blockEnd = source.indexOf("appendToolStart(", fnIdx)
    const block = source.slice(fnIdx, blockEnd > fnIdx ? blockEnd : fnIdx + 2500)
    assert.ok(
      block.includes("loggedBubbleMismatches"),
      "appendChunk must consult a dedupe Set (loggedBubbleMismatches) before logging the mismatch"
    )
    assert.ok(
      /loggedBubbleMismatches[\s\S]{0,200}\.has\(/.test(block) ||
        /loggedBubbleMismatches[\s\S]{0,200}\.add\(/.test(block),
      "appendChunk must check and add to the dedupe Set so the log fires once per messageId"
    )
  })

  it("loggedBubbleMismatches field is declared as a per-tab dedupe Map", () => {
    assert.ok(
      /private\s+loggedBubbleMismatches\s*=\s*new\s+Map<string,\s*Set<string>>\(\)/.test(source),
      "loggedBubbleMismatches must be a Map<string, Set<string>> for per-tab per-messageId dedupe"
    )
  })

  // ── Event-stream readiness gates prompt send so the UI can observe output.
  it("blocks prompt send until the event stream is ready", () => {
    const startIdx = source.indexOf("async startPrompt(")
    assert.ok(startIdx >= 0, "startPrompt must exist")
    const blockEnd = source.indexOf("\n  async finalizeStream", startIdx)
    const block = source.slice(startIdx, blockEnd > startIdx ? blockEnd : startIdx + 4000)
    assert.ok(
      block.includes("waitForEventStreamReady"),
      "startPrompt must wait for the event stream before sendPromptAsync"
    )
    assert.ok(
      block.includes("cannot send a prompt until extension communication is connected"),
      "transport readiness failure must produce a transport-specific error"
    )
  })

  it("threads webview prompt identity into prompt_async and recovery messages", () => {
    const startIdx = source.indexOf("async startPrompt(")
    assert.ok(startIdx >= 0, "startPrompt must exist")
    const blockEnd = source.indexOf("\n  private async fetchFinalBlocks", startIdx)
    const block = source.slice(startIdx, blockEnd > startIdx ? blockEnd : startIdx + 14000)

    assert.ok(block.includes("identity: PromptRunIdentity"), "startPrompt must accept prompt identity")
    assert.ok(block.includes("messageID: identity.userMessageId"), "sendPromptAsync must receive the webview user message id")
    assert.ok(block.includes("clientRequestId: identity.clientRequestId"), "sendPromptAsync must receive the client request id")
    assert.ok(block.includes('type: "prompt_accepted"'), "accepted sends must confirm optimistic user bubbles")
    assert.ok(block.includes('type: "prompt_send_failed"'), "failed sends must restore recoverable prompt state")
  })

  it("does not abort accepted backend work on first-byte diagnostics", () => {
    const startIdx = source.indexOf("async startPrompt(")
    assert.ok(startIdx >= 0, "startPrompt must exist")
    const blockEnd = source.indexOf("\n  private async fetchFinalBlocks", startIdx)
    const block = source.slice(startIdx, blockEnd > startIdx ? blockEnd : startIdx + 14000)

    assert.ok(block.includes('acceptedRun?.state === "accepted"'), "TTFB path must detect accepted backend runs")
    assert.ok(block.includes('this.setActiveRunState(tabId, "interrupted"'), "accepted diagnostics must mark the run interrupted, not killed")
    const acceptedBranch = block.slice(block.indexOf('acceptedRun?.state === "accepted"'))
    assert.ok(acceptedBranch.indexOf('return') >= 0 && acceptedBranch.indexOf('abortController.abort("ttfb_timeout")') > acceptedBranch.indexOf('return'),
      "accepted TTFB branch must return before aborting the backend request")
  })

  // ── Feature 5: Per-tab instructions injection ─────────────────────────────

  void it("instructions_injection_tracks_sessions_to_avoid_re_injection", () => {
    assert.ok(
      source.includes("injectedInstructionsSessions") || source.includes("instructionsInjected"),
      "must track sessions that have received instructions to prevent re-injection"
    )
  })

  void it("instructions_prepended_to_parts_on_first_turn", () => {
    const startIdx = source.indexOf("async startPrompt(")
    assert.ok(startIdx >= 0, "startPrompt must exist")
    const block = source.slice(startIdx, startIdx + 14000)
    assert.ok(
      block.includes("tab.instructions"),
      "startPrompt must read tab.instructions before building parts"
    )
    assert.ok(
      (block.includes("injectedInstructionsSessions") || block.includes("instructionsInjected")) &&
        (block.includes(".has(") || block.includes(".add(")),
      "startPrompt must check and update the injection-tracking Set"
    )
  })

  void it("instructions_not_re_injected_on_subsequent_turns", () => {
    const startIdx = source.indexOf("async startPrompt(")
    assert.ok(startIdx >= 0, "startPrompt must exist")
    const block = source.slice(startIdx, startIdx + 14000)
    assert.ok(
      block.includes(".has(cliSessionId)") ||
        /!.*injectedInstructionsSessions/.test(block) ||
        /!this\.injectedInstructionsSessions/.test(block),
      "must guard against re-injection by checking the tracking Set before prepending"
    )
  })

  void it("cleanupTab_removes_session_from_injectedInstructionsSessions", () => {
    const cleanupIdx = source.indexOf("cleanupTab(tabId: string): void {")
    assert.ok(cleanupIdx >= 0, "cleanupTab must exist")
    const blockEnd = source.indexOf("\n  }", cleanupIdx)
    const block = source.slice(cleanupIdx, blockEnd)
    assert.ok(
      block.includes("injectedInstructionsSessions") || block.includes("instructionsInjected"),
      "cleanupTab must remove session from injectedInstructionsSessions to prevent stale injection state"
    )
  })

  // ── B7: appendToolStart must promote a stale tool-call block to a question
  // block when the tool name resolves to "question" on a re-entrant start.
  // Race: the SDK sometimes emits the first message.part.updated with an
  // empty/placeholder tool name, so the host creates a generic tool-call
  // block. A subsequent part.updated with name:"question" hits the
  // duplicate-start branch, which used to only update args/class/name and
  // never promoted the block — so the question bar was never populated and
  // the user could not answer. The fix: when promotion is detected, also
  // post {type:"question_asked"} so the webview's bar handler fires.
  void it("B7: appendToolStart promotes tool-call → question on re-entrant start by posting question_asked", () => {
    const fnIdx = source.indexOf("appendToolStart(tabId:")
    assert.ok(fnIdx >= 0, "appendToolStart must exist")
    const fnEnd = source.indexOf("\n  appendToolUpdate(", fnIdx)
    const fnBody = source.slice(fnIdx, fnEnd > fnIdx ? fnEnd : fnIdx + 12000)

    // Locate the duplicate-start branch (the one that handles existingBlock).
    const dupIdx = fnBody.indexOf("pending.has(stableId) || existingBlock")
    assert.ok(dupIdx >= 0, "must find the duplicate-start branch")
    const dupBlock = fnBody.slice(dupIdx, dupIdx + 4000)

    // The branch must detect the promotion case (existingBlock.type ===
    // "tool-call" AND the new name is question) and post question_asked so
    // the webview's bar handler fires. (We don't pin the exact arg shape —
    // only that the type marker is present in the branch.)
    assert.ok(
      dupBlock.includes('type: "question_asked"'),
      "B7: appendToolStart must post {type:\"question_asked\"} when a stale tool-call block is promoted to a question, so the question bar gets populated",
    )
  })

  // ── Stream latency metrics ──────────────────────────────────────────────
  it("has ActiveRunMetrics type exported from StreamCoordinatorTypes", () => {
    assert.ok(
      typesSource.includes("export interface ActiveRunMetrics"),
      "ActiveRunMetrics must be exported from StreamCoordinatorTypes.ts"
    )
    assert.ok(typesSource.includes("sendTime:"), "ActiveRunMetrics must have sendTime field")
    assert.ok(typesSource.includes("firstResponseTime?:"), "ActiveRunMetrics must have firstResponseTime field")
    assert.ok(typesSource.includes("completeTime?:"), "ActiveRunMetrics must have completeTime field")
    assert.ok(typesSource.includes("finalizeTime?:"), "ActiveRunMetrics must have finalizeTime field")
    assert.ok(typesSource.includes("messageCount:"), "ActiveRunMetrics must have messageCount field")
  })

  it("tracks per-tab ActiveRunMetrics via activeRunMetrics Map", () => {
    assert.ok(
      /private activeRunMetrics\s*=\s*new Map<string,\s*ActiveRunMetrics>\(\)/.test(source),
      "activeRunMetrics must be a Map<string, ActiveRunMetrics>"
    )
  })

  it("records sendTime in initializeRunMetadata", () => {
    const fnIdx = source.indexOf("private initializeRunMetadata(")
    assert.ok(fnIdx >= 0, "initializeRunMetadata must exist")
    const blockEnd = source.indexOf("\n  private async ensureServerRunningForPrompt", fnIdx)
    const block = source.slice(fnIdx, blockEnd > fnIdx ? blockEnd : fnIdx + 1500)
    assert.ok(
      block.includes("activeRunMetrics.set(tabId") && block.includes("sendTime: performance.now()"),
      "initializeRunMetrics must record sendTime via performance.now()"
    )
  })

  it("records firstResponseTime on first chunk/tool in appendChunk and appendToolStart", () => {
    const chunkIdx = source.indexOf("appendChunk(tabId: string,")
    assert.ok(chunkIdx >= 0, "appendChunk must exist")
    const chunkBlock = source.slice(chunkIdx, chunkIdx + 800)
    assert.ok(
      chunkBlock.includes("metrics.firstResponseTime = performance.now()"),
      "appendChunk must record firstResponseTime on first chunk"
    )

    const toolIdx = source.indexOf("appendToolStart(tabId: string,")
    assert.ok(toolIdx >= 0, "appendToolStart must exist")
    const toolBlock = source.slice(toolIdx, toolIdx + 800)
    assert.ok(
      toolBlock.includes("metrics.firstResponseTime = performance.now()"),
      "appendToolStart must record firstResponseTime on first tool call"
    )
  })

  it("records completeTime and finalizeTime in finalizeStream and logs latency breakdown", () => {
    const fnIdx = source.indexOf("async finalizeStream(tabId: string, callbacks: StreamCallbacks)")
    assert.ok(fnIdx >= 0, "finalizeStream must exist")
    const blockEnd = source.indexOf("\n  async maybeFinalizeStream(", fnIdx)
    const block = source.slice(fnIdx, blockEnd > fnIdx ? blockEnd : fnIdx + 2000)
    assert.ok(
      block.includes("metrics.completeTime = performance.now()"),
      "finalizeStream must record completeTime"
    )
    assert.ok(
      block.includes("metrics.finalizeTime = performance.now()"),
      "finalizeStream must record finalizeTime"
    )
    assert.ok(
      block.includes("stream latency: first_chunk="),
      "finalizeStream must log latency breakdown"
    )
    assert.ok(
      block.includes("logStreamTrace(\"stream.latency\""),
      "finalizeStream must emit stream.latency trace"
    )
  })

  it("increments messageCount on appendChunk and appendToolStart", () => {
    const chunkIdx = source.indexOf("appendChunk(tabId: string,")
    const chunkBlock = source.slice(chunkIdx, chunkIdx + 800)
    assert.ok(
      /metrics\.messageCount\+\+/.test(chunkBlock),
      "appendChunk must increment messageCount"
    )

    const toolIdx = source.indexOf("appendToolStart(tabId: string,")
    const toolBlock = source.slice(toolIdx, toolIdx + 800)
    assert.ok(
      /metrics\.messageCount\+\+/.test(toolBlock),
      "appendToolStart must increment messageCount"
    )
  })

  it("cleans up activeRunMetrics in cleanupTab and dispose", () => {
    const cleanupIdx = source.indexOf("cleanupTab(tabId: string): void {")
    assert.ok(cleanupIdx >= 0, "cleanupTab must exist")
    const blockEnd = source.indexOf("\n  }", cleanupIdx)
    const block = source.slice(cleanupIdx, blockEnd)
    assert.ok(
      block.includes("this.activeRunMetrics.delete(tabId)"),
      "cleanupTab must delete activeRunMetrics entry"
    )

    const disposeIdx = source.indexOf("dispose(): void {")
    assert.ok(disposeIdx >= 0, "dispose must exist")
    const disposeBlock = source.slice(disposeIdx, disposeIdx + 1500)
    assert.ok(
      disposeBlock.includes("this.activeRunMetrics.clear()"),
      "dispose must clear activeRunMetrics"
    )
  })

  // ── ADR-010: SessionManagerRegistry integration ───────────────────────────
  it("imports SessionManagerRegistry type", () => {
    assert.ok(
      source.includes('import type { SessionManagerRegistry }') || source.includes('import { SessionManagerRegistry }'),
      "must import SessionManagerRegistry type"
    )
  })

  it("has getSm helper method for per-tab session resolution", () => {
    assert.ok(
      source.includes("private getSm(tabId?: string): SessionManager"),
      "must have getSm helper method"
    )
    assert.ok(
      source.includes("this.sessionManagerRegistry?.getSessionManager(tabId)") ||
        source.includes("this.sessionManagerRegistry.getSessionManager(tabId)"),
      "getSm must delegate to registry.getSessionManager"
    )
    assert.ok(
      source.includes("if (!this.sessionManagerRegistry) return this.sessionManager"),
      "getSm must fall back to default sessionManager when registry is null"
    )
  })

  it("has setSessionManagerRegistry setter", () => {
    assert.ok(
      source.includes("setSessionManagerRegistry(registry: SessionManagerRegistry): void"),
      "must expose setSessionManagerRegistry setter"
    )
    assert.ok(
      source.includes("this.sessionManagerRegistry = registry"),
      "setter must store the registry reference"
    )
  })

  it("routes per-tab session calls through getSm in startPrompt", () => {
    const fnIdx = source.indexOf("async startPrompt(")
    assert.ok(fnIdx >= 0, "startPrompt must exist")
    const blockEnd = source.indexOf("\n  private async fetchFinalBlocks", fnIdx)
    const block = source.slice(fnIdx, blockEnd > fnIdx ? blockEnd : fnIdx + 2000)
    assert.ok(
      block.includes("this.getSm(tabId).ensureSession("),
      "startPrompt must route ensureSession through getSm"
    )
    assert.ok(
      block.includes("this.getSm(tabId).sendPromptAsync("),
      "startPrompt must route sendPromptAsync through getSm"
    )
  })

  it("routes per-tab session calls through getSm in abort", () => {
    const fnIdx = source.indexOf("async abort(tabId: string,")
    assert.ok(fnIdx >= 0, "abort must exist")
    const blockEnd = source.indexOf("\n  private startHeartbeat(", fnIdx)
    const block = source.slice(fnIdx, blockEnd > fnIdx ? blockEnd : fnIdx + 1000)
    assert.ok(
      block.includes("this.getSm(tabId).abortSession("),
      "abort must route abortSession through getSm"
    )
  })

  it("routes getSessionMessages through getSm in fetchFinalBlocks", () => {
    const fnIdx = source.indexOf("private async fetchFinalBlocks(")
    assert.ok(fnIdx >= 0, "fetchFinalBlocks must exist")
    const blockEnd = source.indexOf("\n  private recordFinalUsageFallback", fnIdx)
    const block = source.slice(fnIdx, blockEnd > fnIdx ? blockEnd : fnIdx + 1000)
    assert.ok(
      block.includes("this.getSm(tabId).getSessionMessages("),
      "fetchFinalBlocks must route getSessionMessages through getSm"
    )
  })

  it("notifies registry on tab cleanup via unassignTab", () => {
    const cleanupIdx = source.indexOf("cleanupTab(tabId: string): void {")
    assert.ok(cleanupIdx >= 0, "cleanupTab must exist")
    const blockEnd = source.indexOf("\n  }", cleanupIdx)
    const block = source.slice(cleanupIdx, blockEnd)
    assert.ok(
      block.includes("this.sessionManagerRegistry.unassignTab(tabId)"),
      "cleanupTab must call registry.unassignTab"
    )
  })

  // ── ADR-010: Per-tab auto-spawn in startPrompt ─────────────────────────
  it("auto-spawns per-tab process when strategy is per-tab and no process exists", () => {
    const fnIdx = source.indexOf("async startPrompt(")
    assert.ok(fnIdx >= 0, "startPrompt must exist")
    const blockEnd = source.indexOf("\n  async private?", fnIdx)
    const block = source.slice(fnIdx, fnIdx + 6000)

    assert.ok(
      block.includes('this.sessionManagerRegistry?.processStrategy === "per-tab"') ||
        block.includes('this.sessionManagerRegistry.processStrategy === "per-tab"'),
      "startPrompt must check per-tab strategy before auto-spawn"
    )
    assert.ok(
      block.includes("spawnAndRegisterSession(undefined, tabId") ||
        block.includes("spawnAndRegisterSession(undefined, tabId)"),
      "startPrompt must call spawnAndRegisterSession for tabs without a process"
    )
    assert.ok(
      block.includes("getProcessForTab(tabId)"),
      "startPrompt must check for existing process before spawning"
    )
  })

  it("handles spawn failure gracefully in per-tab auto-spawn", () => {
    const fnIdx = source.indexOf("async startPrompt(")
    assert.ok(fnIdx >= 0, "startPrompt must exist")
    const block = source.slice(fnIdx, fnIdx + 6000)
    assert.ok(
      block.includes("Failed to spawn process") || block.includes("postRequestError("),
      "startPrompt must handle spawn failure with fallback"
    )
  })
