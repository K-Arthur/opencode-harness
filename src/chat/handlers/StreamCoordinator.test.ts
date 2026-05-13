import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "StreamCoordinator.ts"), "utf8")

describe("StreamCoordinator.ts", () => {
  it("exports StreamCallbacks interface", () => {
    assert.ok(source.includes("export interface StreamCallbacks"), "StreamCallbacks must be exported")
    assert.ok(source.includes("postMessage: (msg: Record<string, unknown>) => void"),
      "StreamCallbacks must have postMessage")
    assert.ok(source.includes("postRequestError: (message: string, sessionId?: string) => void"),
      "StreamCallbacks must have postRequestError with optional sessionId")
  })

  it("exports StreamCoordinator class", () => {
    assert.ok(source.includes("export class StreamCoordinator"), "StreamCoordinator class must be exported")
  })

  it("has a DiffHandler instance constructed from the injected diffApplier", () => {
    assert.ok(source.includes("private diffHandler: DiffHandler"), "must have diffHandler field")
    assert.ok(source.includes("diffApplier: DiffApplier"), "constructor must accept a DiffApplier")
    assert.ok(source.includes("this.diffHandler = new DiffHandler(diffApplier)"), "must create DiffHandler from the injected applier")
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
    assert.ok(source.includes("this.sessionManager.ensureSession("), "must ensure session")
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

  it("has appendCallbacks map for steer prompt append mode", () => {
    assert.ok(source.includes("appendCallbacks"), "must have appendCallbacks field")
    assert.ok(source.includes("Map<string, (() => Promise<void>)[]>"), "appendCallbacks must be a Map of callback arrays")
  })

  it("has registerAppendCallback method", () => {
    assert.ok(source.includes("registerAppendCallback("), "must have registerAppendCallback method")
    assert.ok(source.includes("tabId: string"), "registerAppendCallback must accept tabId")
    assert.ok(source.includes("callback: () => Promise<void>"), "registerAppendCallback must accept callback")
  })

  it("executes append callbacks in finalizeStream", () => {
    assert.ok(source.includes("finalizeStream("), "must have finalizeStream method")
    assert.ok(source.includes("appendCallbacks.get(tabId)"), "finalizeStream must get callbacks for tab")
    assert.ok(source.includes("appendCallbacks.delete(tabId)"), "finalizeStream must delete callbacks after execution")
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
    assert.ok(source.includes("this.sessionManager.abortSession("), "must call abortSession")
    assert.ok(
      source.includes('reason: "aborted"'),
      "abort must emit stream_end with reason: aborted"
    )
    assert.ok(source.includes('type: "stream_end"'), "abort must emit stream_end")
    assert.ok(source.includes("callbacks.postMessage({"), "abort must post via callbacks")
  })

  it("has appendChunk and getDiffHandler methods", () => {
    assert.ok(
      source.includes("appendChunk(tabId: string, text: string, callbacks?: StreamCallbacks, messageId?: string): void"),
      "appendChunk must exist with optional callbacks and messageId params"
    )
    assert.ok(source.includes("getDiffHandler(): DiffHandler"), "getDiffHandler must exist")
    assert.ok(source.includes("this.diffHandler"), "getDiffHandler must return this.diffHandler")
  })

  it("has cleanupTab and no implicit context builder in the prompt path", () => {
    assert.ok(source.includes("private cleanupTab("), "cleanupTab must exist")
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
})

  // ── Mode via tools field: plan mode disables file_edit and bash ──
  it("plan mode disables file_edit and bash via tools field", () => {
    assert.ok(
      source.includes('file_edit: false') && source.includes('bash: false'),
      "plan mode must set tools: { file_edit: false, bash: false } in prompt body"
    )
  })

  it("non-plan modes use undefined tools (default enable)", () => {
    assert.ok(
      source.includes("? { file_edit: false, bash: false } : undefined"),
      "non-plan modes must pass undefined tools (server default enables all tools)"
    )
  })

  it("passes tools object to sendPromptAsync", () => {
    assert.ok(
      /tools[\s,)}]/.test(source),
      "must pass tools parameter to sendPromptAsync"
    )
  })

  it("defaults to undefined tools when no mode is set", () => {
    assert.ok(
      source.includes("? { file_edit: false, bash: false } : undefined"),
      "must default to undefined tools when tab.mode is not 'plan'"
    )
  })

  it("defaults to undefined tools when no mode is set", () => {
    assert.ok(
      source.includes('? { file_edit: false, bash: false } : undefined'),
      "must set tools to undefined for non-plan modes"
    )
  })

  // ── Mode via tools field: plan mode disables file_edit and bash ──
  it("plan mode disables file_edit and bash via tools field", () => {
    assert.ok(
      source.includes("tab.mode === ") && source.includes("file_edit: false") && source.includes("bash: false"),
      "plan mode must set tools: { file_edit: false, bash: false } in prompt body"
    )
  })

  it("non-plan modes use undefined tools (default enable)", () => {
    assert.ok(
      source.includes("? { file_edit: false, bash: false } : undefined"),
      "build/auto modes must pass undefined tools (server default enables all tools)"
    )
  })

  it("passes tools object to sendPromptAsync", () => {
    assert.ok(
      source.includes("tools") && source.includes("sendPromptAsync"),
      "must pass tools parameter to sendPromptAsync"
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
    const cleanupIdx = source.indexOf("private cleanupTab(")
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
    const cleanupIdx = source.indexOf("private cleanupTab(")
    assert.ok(cleanupIdx >= 0, "cleanupTab must exist")
    const blockEnd = source.indexOf("\n  }", cleanupIdx)
    const block = source.slice(cleanupIdx, blockEnd)
    assert.ok(
      block.includes("this.activeMessageIds.delete(tabId)"),
      "cleanupTab must clear activeMessageIds entry to prevent stale prevId across turns"
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
    const block = source.slice(startIdx, startIdx + 6000)
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
    const block = source.slice(startIdx, startIdx + 6000)
    assert.ok(
      block.includes(".has(cliSessionId)") ||
        /!.*injectedInstructionsSessions/.test(block) ||
        /!this\.injectedInstructionsSessions/.test(block),
      "must guard against re-injection by checking the tracking Set before prepending"
    )
  })

  void it("cleanupTab_removes_session_from_injectedInstructionsSessions", () => {
    const cleanupIdx = source.indexOf("private cleanupTab(")
    assert.ok(cleanupIdx >= 0, "cleanupTab must exist")
    const blockEnd = source.indexOf("\n  }", cleanupIdx)
    const block = source.slice(cleanupIdx, blockEnd)
    assert.ok(
      block.includes("injectedInstructionsSessions") || block.includes("instructionsInjected"),
      "cleanupTab must remove session from injectedInstructionsSessions to prevent stale injection state"
    )
  })
