import type { ChatMessage } from "../../types"
import type { ElementRefs } from "./dom"
import type { ToolCallState } from "./types"
import type { StreamHandlers } from "./stream"
import { timers } from "./timerRegistry"
import type { ToolElapsedTracker } from "./ui/toolElapsed"
import type { PromptQueue } from "./queue"
import type { LiveToolOutput } from "./toolPartialStore"
import { placeholderHasRenderedContent } from "./placeholderContent"
import { finalizeStreamingText } from "./streamHandlers"
import { generateUserMessageId } from "../../session/messageId"
import { hasRecentErrorCard } from "./streamEndErrorPolicy"
import { normalizeIncomingError } from "./errorWire"
import { ErrorStateStore, routeErrorByTier, type ErrorTierDeps } from "./errorTiers"

/**
 * G2: read the `mayStillBeRunning` signal from an opaque errorContext
 * payload. Returns:
 *   - `true`  if the host explicitly says the backend run may still be alive
 *             (the streaming flag must be preserved until a probe reconciles).
 *   - `false` if the host explicitly says the run is gone (safe to clear).
 *   - `undefined` if the payload is absent or doesn't carry the field —
 *             callers should fall back to their own heuristic.
 *
 * The field is set by the host's runErrorMapper for transport timeouts,
 * provider retries, and other transient errors where the model often keeps
 * generating. Bare `show_error`/`webview_request_error` (no context) leave
 * it undefined.
 */
function readMayStillBeRunning(errorContext: unknown): boolean | undefined {
  if (!errorContext || typeof errorContext !== "object") return undefined
  const rec = errorContext as Record<string, unknown>
  const direct = rec.mayStillBeRunning
  if (typeof direct === "boolean") return direct
  // Some payloads nest under `metadata` or `errorContext`; check both.
  const nested = (rec.metadata as Record<string, unknown> | undefined)?.mayStillBeRunning
  if (typeof nested === "boolean") return nested
  return undefined
}

/**
 * Render the user-facing system message (if any) for a stream-end reason.
 *
 * Extracted from `createStreamOrchestrator` so the dense reason → message
 * table + the "don't stack on top of a recent error card" guard are testable
 * in isolation. The orchestrator closure delegates here with its captured
 * `showSystemMessage` / `getSession` callbacks.
 */
function showStreamEndReasonMessage(
  sessionId: string,
  reason: string | undefined,
  partial: boolean | undefined,
  showSystemMessage: (sessionId: string, text: string, retryable?: boolean) => void,
  getSession: (id: string) => { messages: ChatMessage[] } | undefined,
): void {
  if (reason === "ttfb_timeout") {
    showSystemMessage(sessionId, "The model took too long to start responding. Please try again or select a different model.", true)
  } else if (reason === "timeout") {
    showSystemMessage(sessionId, partial
      ? "Response was cut off (timeout). Partial output has been preserved."
      : "Response timed out. Please try again or select a different model.", true)
  } else if (reason === "hard_timeout") {
    showSystemMessage(sessionId, "Stream interrupted after extended run. Partial output preserved.", true)
  } else if (reason === "aborted") {
    showSystemMessage(sessionId, "Generation interrupted by user.", false)
  } else if (reason === "error") {
    // A structured error card (handleServerStatus("error") → handleStreamError)
    // is the canonical surface for a failure and is added to the session
    // messages before this end-of-stream hook. Don't stack a second, generic
    // error card for the same fault — that was the root of "one failure shows
    // as multiple cards". Only show the generic card when no error card exists.
    const existing = getSession(sessionId)?.messages
    if (existing && hasRecentErrorCard(existing)) return
    showSystemMessage(sessionId, "An error occurred while generating the response. Please try again.", true)
  }
}

/**
 * Drop the (now-empty) streaming placeholder for `messageId` and append the
 * server-authoritative assistant message to session history.
 *
 * Extracted from `createStreamOrchestrator`. M7 invariant: a placeholder
 * that already shows tool/diff/skill blocks (a text-less turn) must NOT be
 * removed — `placeholderHasRenderedContent` enforces that. The orchestrator
 * closure delegates here with its captured `getMessageList` / `addMessage`.
 */
function processStreamEndBlocks(
  sessionId: string,
  messageId: string | undefined,
  blocks: unknown,
  getMessageList: (tabId: string) => HTMLDivElement | null,
  addMessage: (sessionId: string, msg: ChatMessage) => void,
): void {
  const blockList = Array.isArray(blocks) ? blocks as ChatMessage["blocks"] : []
  if (blockList.length === 0) return

  const msgList = getMessageList(sessionId)
  if (messageId && msgList) {
    const placeholder = msgList.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null
    if (placeholder && !placeholderHasRenderedContent(placeholder)) {
      placeholder.remove()
    }
  }
  addMessage(sessionId, {
    role: "assistant",
    id: messageId || `resp-${Date.now()}`,
    blocks: blockList,
    timestamp: Date.now(),
  })
}

/**
 * Reflect agent run-state on the always-visible status LED + label.
 *
 * Extracted from `createStreamOrchestrator`. Idle → "SYSTEM READY" label;
 * any other state → uppercased status name. The orchestrator closure
 * delegates here with its captured `els.agentStatusLed` / `els.agentStatusText`.
 */
function renderAgentStatusLed(
  status: "idle" | "thinking" | "executing",
  agentStatusLed: HTMLElement,
  agentStatusText: HTMLElement,
): void {
  agentStatusLed.className = `status-led ${status}`
  agentStatusText.textContent = status === "idle" ? "SYSTEM READY" : status.toUpperCase()
}

/**
 * Show a transient skill-name pill near the composer; auto-removes after 3s.
 *
 * Extracted from `createStreamOrchestrator`. Creates the `.skill-indicators`
 * container on first use, then appends each new pill to it. The orchestrator
 * closure delegates here with its captured `els.inputArea` / `els.inputWrapper`.
 *
 * Note: `sessionId` is part of the public API for telemetry symmetry but the
 * current behavior renders pills globally in the composer (one shared strip).
 */
function appendSkillPill(
  _sessionId: string,
  skillName: string,
  inputArea: HTMLElement,
  inputWrapper: HTMLElement,
): void {
  const indicator = inputArea.querySelector(".skill-indicators")
  const pill = document.createElement("span")
  pill.className = "skill-pill"
  pill.textContent = skillName
  if (!indicator) {
    const container = document.createElement("div")
    container.className = "skill-indicators"
    container.appendChild(pill)
    inputArea.insertBefore(container, inputWrapper)
  } else {
    indicator.appendChild(pill)
  }
  timers.setTimeout(() => pill.remove(), 3000)
}

/** One queued (debounced) tool-update. Keyed `${sessionId}:${toolId}`. */
interface PendingToolUpdate {
  sessionId: string
  toolId: string
  update: { state?: ToolCallState; args?: unknown }
  timer: ReturnType<typeof setTimeout>
}

interface PendingToolPartial {
  sessionId: string
  toolId: string
  live: LiveToolOutput
  timer: ReturnType<typeof setTimeout>
}

/**
 * Debounce a tool-update for 50ms, merging subsequent updates for the same
 * `(sessionId, toolId)` into a single delivery.
 *
 * Extracted from `createStreamOrchestrator`. The orchestrator owns the
 * `pendingToolUpdates` Map (per-instance state) and passes it in; the helper
 * itself is stateless and independently testable.
 */
function scheduleDebouncedToolUpdate(
  pendingToolUpdates: Map<string, PendingToolUpdate>,
  streamHandlers: Map<string, StreamHandlers>,
  sessionId: string,
  toolId: string,
  update: { state?: ToolCallState; args?: unknown },
): void {
  const key = `${sessionId}:${toolId}`
  const pending = pendingToolUpdates.get(key)
  if (pending) {
    pending.update = { ...pending.update, ...update }
    return
  }
  const timer = timers.setTimeout(() => {
    const latest = pendingToolUpdates.get(key)
    pendingToolUpdates.delete(key)
    const stream = streamHandlers.get(sessionId)
    if (latest && stream) stream.handleToolUpdate(toolId, latest.update)
  }, 50)
  pendingToolUpdates.set(key, { sessionId, toolId, update, timer })
}

/**
 * Immediately deliver any pending tool-update for `(sessionId, toolId)`,
 * cancelling its debounce timer. No-op when nothing is pending.
 *
 * Extracted from `createStreamOrchestrator` alongside
 * `scheduleDebouncedToolUpdate`; both share the `pendingToolUpdates` Map.
 */
function flushPendingToolUpdate(
  pendingToolUpdates: Map<string, PendingToolUpdate>,
  streamHandlers: Map<string, StreamHandlers>,
  sessionId: string,
  toolId: string,
): void {
  const key = `${sessionId}:${toolId}`
  const pending = pendingToolUpdates.get(key)
  if (!pending) return
  timers.clearTimeout(pending.timer)
  pendingToolUpdates.delete(key)
  const stream = streamHandlers.get(sessionId)
  if (stream) stream.handleToolUpdate(toolId, pending.update)
}

function scheduleDebouncedToolPartial(
  pendingToolPartials: Map<string, PendingToolPartial>,
  streamHandlers: Map<string, StreamHandlers>,
  sessionId: string,
  toolId: string,
  live: LiveToolOutput,
): void {
  const key = `${sessionId}:${toolId}`
  const pending = pendingToolPartials.get(key)
  if (pending) {
    pending.live = live
    return
  }
  const timer = timers.setTimeout(() => {
    const latest = pendingToolPartials.get(key)
    pendingToolPartials.delete(key)
    const stream = streamHandlers.get(sessionId)
    if (latest && stream) stream.handleToolPartial(sessionId, toolId, latest.live)
  }, 100)
  pendingToolPartials.set(key, { sessionId, toolId, live, timer })
}

function clearPendingToolPartialsForSession(
  pendingToolPartials: Map<string, PendingToolPartial>,
  sessionId: string,
): void {
  for (const [key, pending] of Array.from(pendingToolPartials)) {
    if (pending.sessionId !== sessionId) continue
    timers.clearTimeout(pending.timer)
    pendingToolPartials.delete(key)
  }
}

/**
 * Show a "Tool chain running..." affordance after 900ms of continuous tool
 * activity, unless one is already visible.
 *
 * Extracted from `createStreamOrchestrator`. The orchestrator owns the
 * per-instance `toolChainProgressTimers` Map (one in-flight timer per
 * session) and passes it in.
 */
function armToolChainProgressIndicator(
  toolChainProgressTimers: Map<string, ReturnType<typeof setTimeout>>,
  getMessageList: (tabId: string) => HTMLDivElement | null,
  sessionId: string,
): void {
  if (toolChainProgressTimers.has(sessionId)) return
  const timer = timers.setTimeout(() => {
    toolChainProgressTimers.delete(sessionId)
    const msgList = getMessageList(sessionId)
    if (!msgList || msgList.querySelector(".tool-chain-progress")) return
    const progress = document.createElement("div")
    progress.className = "tool-chain-progress"
    progress.textContent = "Tool chain running..."
    progress.setAttribute("role", "status")
    progress.setAttribute("aria-live", "polite")
    msgList.appendChild(progress)
  }, 900)
  toolChainProgressTimers.set(sessionId, timer)
}

/**
 * Cancel any pending "Tool chain running..." timer for `sessionId` and
 * remove the rendered affordance if present.
 *
 * Extracted from `createStreamOrchestrator` alongside
 * `armToolChainProgressIndicator`; both share the `toolChainProgressTimers` Map.
 */
function clearToolChainProgressIndicator(
  toolChainProgressTimers: Map<string, ReturnType<typeof setTimeout>>,
  getMessageList: (tabId: string) => HTMLDivElement | null,
  sessionId: string,
): void {
  const timer = toolChainProgressTimers.get(sessionId)
  if (timer) timers.clearTimeout(timer)
  toolChainProgressTimers.delete(sessionId)
  getMessageList(sessionId)?.querySelectorAll(".tool-chain-progress").forEach((el) => el.remove())
}

/**
 * Log a stream-chunk line under the established sampling rule: first 3
 * chunks, every 100th chunk thereafter, or any chunk over 1000 chars.
 *
 * Extracted from `createStreamOrchestrator.handleStreamChunk`. The closure
 * still owns the per-orchestrator `chunkLogCounter` (monotonic state) — this
 * helper is a pure function of (counter, text) plus the postMessage channel.
 */
function maybeLogStreamChunk(
  counter: number,
  sessionId: string,
  text: string | undefined,
  streamingMessageId: string | null,
  postMessage: (m: { type: "webview_log"; level: "info"; message: string }) => void,
): void {
  if (counter <= 3 || counter % 100 === 0 || (text !== undefined && text.length > 1000)) {
    postMessage({
      type: "webview_log",
      level: "info",
      message: `handleStreamChunk: chunk #${counter} for ${sessionId} len=${text?.length || 0} streamingMessageId=${streamingMessageId ?? "<null>"}`,
    })
  }
}

/** Deps passed to `recoverAfterStreamEndError`. */
interface StreamEndRecoveryDeps {
  postMessage: (m: Record<string, unknown>) => void
  setStreaming: (sessionId: string, streaming: boolean) => void
  updateTabBar: () => void
  updateModeSelectorStateLocal: () => void
  updateAgentStatus: (status: "idle" | "thinking" | "executing") => void
  showSystemMessage: (sessionId: string, text: string, retryable?: boolean) => void
}

/**
 * Last-resort recovery when something inside `handleStreamEnd`'s try block
 * throws AFTER the inner stream-handler call.
 *
 * Each cleanup step is independently wrapped so a broken step logs and gets
 * out of the way of the next. Extracted from `createStreamOrchestrator` so
 * the dense per-step try/catch + reason→message table is independently
 * testable.
 */
function recoverAfterStreamEndError(
  sessionId: string,
  reason: string | undefined,
  err: unknown,
  deps: StreamEndRecoveryDeps,
): void {
  const { postMessage } = deps
  postMessage({ type: "webview_log", level: "error", message: `handleStreamEnd error: ${err instanceof Error ? err.message : String(err)}` })
  const safe = (fn: () => void, failureLabel: string) => {
    try { fn() } catch (e) {
      postMessage({ type: "webview_log", level: "warn", message: `${failureLabel}: ${e instanceof Error ? e.message : e}` })
    }
  }
  safe(() => deps.setStreaming(sessionId, false), "setStreaming recovery failed")
  safe(() => deps.updateTabBar(), "updateTabBar recovery failed")
  safe(() => deps.updateModeSelectorStateLocal(), "updateModeSelector recovery failed")
  safe(() => deps.updateAgentStatus("idle"), "updateAgentStatus recovery failed")
  const msg = reason === "ttfb_timeout" ? "Model took too long. Try a different model."
    : reason === "timeout" ? "Response timed out."
    : reason === "error" ? "An error occurred."
    : "Unexpected error."
  safe(() => deps.showSystemMessage(sessionId, msg), "showSystemMessage recovery failed")
}

/** Deps passed to `ensureStreamUiReady`. */
interface EnsureStreamUiDeps {
  postMessage: (m: Record<string, unknown>) => void
  getSession: (id: string) => { name: string } | undefined
  ensureSession: (init: { id: string; name: string; model: string; mode: string; messages: ChatMessage[]; isStreaming: boolean }) => { name: string }
  getState: () => { globalModel: string }
  getPendingMode: () => string
  getMessageList: (tabId: string) => HTMLDivElement | null
  createTabUI: (tabId: string, tabName: string) => void
  streamHandlers: Map<string, StreamHandlers>
  createStreamHandlersForTab: (tabId: string) => StreamHandlers
}

/**
 * Guarantee the session/tab/stream trio exists for `sessionId` before
 * `handleStreamStart` runs its main body.
 *
 * Extracted from `createStreamOrchestrator.handleStreamStart`. Returns the
 * ready stream handler, or `null` when the (paranoid) final get still fails
 * — in that case the caller bails out. Each ensure step logs its decision.
 */
function ensureStreamUiReady(sessionId: string, deps: EnsureStreamUiDeps): StreamHandlers | null {
  let session = deps.getSession(sessionId)
  if (!session) {
    deps.postMessage({ type: "webview_log", level: "warn", message: `handleStreamStart: Session ${sessionId} not in state, ensuring it` })
    session = deps.ensureSession({
      id: sessionId,
      name: "New Session",
      model: deps.getState().globalModel || "",
      mode: deps.getPendingMode() || "build",
      messages: [],
      isStreaming: false,
    })
  }

  if (!deps.getMessageList(sessionId)) {
    deps.postMessage({ type: "webview_log", level: "warn", message: `handleStreamStart: No message list for ${sessionId}, creating tab UI` })
    deps.createTabUI(sessionId, session.name || "New Session")
  }

  let stream = deps.streamHandlers.get(sessionId)
  if (!stream) {
    deps.postMessage({ type: "webview_log", level: "warn", message: `handleStreamStart: No stream found for session ${sessionId}, creating...` })
    stream = deps.createStreamHandlersForTab(sessionId)
    deps.streamHandlers.set(sessionId, stream)
  }

  const finalStream = deps.streamHandlers.get(sessionId)
  if (!finalStream) {
    deps.postMessage({ type: "webview_log", level: "error", message: `handleStreamStart: Failed to get/create stream for ${sessionId}` })
    return null
  }
  return finalStream
}

/**
 * Cancel and drop every pending tool-update belonging to `sessionId`.
 *
 * Used by `handleStreamEnd` so a finished run never leaves a stale 50ms
 * debounce timer that would fire `handleToolUpdate` after the stream is
 * finalized. Iterates a snapshot (`Array.from`) because the inner callback
 * mutates the Map. Extracted from `createStreamOrchestrator`.
 */
function clearPendingToolUpdatesForSession(
  pendingToolUpdates: Map<string, PendingToolUpdate>,
  sessionId: string,
): void {
  for (const [key, pending] of Array.from(pendingToolUpdates)) {
    if (pending.sessionId === sessionId) {
      timers.clearTimeout(pending.timer)
      pendingToolUpdates.delete(key)
    }
  }
}

export interface StreamOrchestratorDeps {
  vscode: { postMessage(msg: Record<string, unknown>): void }
  els: ElementRefs
  streamHandlers: Map<string, StreamHandlers>
  getState: () => { activeSessionId: string | null; globalModel: string }
  getPendingMode: () => string
  getSession: (id: string) => { id: string; name: string; model: string; mode: string; messages: ChatMessage[]; isStreaming: boolean; changedFiles?: string[]; [k: string]: unknown } | undefined
  getAllSessions: () => Array<{ id: string; name: string; model: string; mode: string; messages: ChatMessage[]; isStreaming: boolean; [k: string]: unknown }>
  ensureSession: (init: { id: string; name: string; model: string; mode: string; messages: ChatMessage[]; isStreaming: boolean }) => { id: string; name: string; model: string; mode: string; messages: ChatMessage[]; isStreaming: boolean; [k: string]: unknown }
  setStreaming: (sessionId: string, streaming: boolean) => void
  save: () => void
  createWebviewId: (prefix: string) => string
  addMessage: (sessionId: string, msg: ChatMessage) => void
  showSystemMessage: (sessionId: string, text: string, retryable?: boolean) => void
  createTabUI: (tabId: string, tabName: string) => void
  switchTab: (tabId: string, notifyHost?: boolean) => void
  hideWelcomeView: () => void
  updateTabBar: () => void
  updateModeSelectorStateLocal: () => void
  updateSendButtonIcon: (isStreaming?: boolean) => void
  updateSendButton: () => void
  getMessageList: (tabId: string) => HTMLDivElement | null
  createStreamHandlersForTab: (tabId: string) => StreamHandlers
  setupJumpToBottom: (sessionId: string) => void
  debouncedUpdateScrollMarkers: (sessionId: string) => void
  debouncedTimelineRefresh: (sessionId: string) => void
  refreshConversationTimeline: (sessionId: string) => void
  toolElapsedTracker: ToolElapsedTracker
  promptQueues: Map<string, PromptQueue>
  renderQueue: (tabId: string) => void
  syncModeUI: () => void
  renderRecentSessionsList: () => void
  persistQueues: () => void
}

export interface StreamOrchestratorAPI {
  handleStreamStart: (sessionId: string, messageId?: string, opts?: { skipAnchor?: boolean }) => void
  handleStreamChunk: (sessionId: string, text?: string, messageId?: string) => void
  handleStreamEnd: (sessionId: string, messageId?: string, blocks?: unknown, reason?: string, partial?: boolean) => void
  /** Resets the local streaming state for a session after compaction. The server
   *  may continue sending chunks for the pre-compact message; without a reset
   *  those chunks would render into the old bubble instead of the new one. */
  resetStream: (sessionId: string) => void
  handleServerStatus: (sessionId: string, status?: string, errorContext?: unknown) => void
  handleRequestError: (sessionId: string | undefined, message?: string, errorContext?: unknown) => void
  handleDiffResult: (sessionId?: string, blockId?: string, ok?: boolean, message?: string, checkpointCreated?: boolean) => void
  handleHostMessage: (msg: ChatMessage) => void
  handleCostUpdate: (sessionId: string, cost: number) => void
  sendQueuedPrompt: (sessionId: string, text: string, attachments?: Array<{ data: string; mimeType: string }>) => void
  scheduleToolUpdate: (sessionId: string, toolId: string, update: { state?: ToolCallState; args?: unknown }) => void
  scheduleToolPartial: (sessionId: string, toolId: string, live: LiveToolOutput) => void
  flushToolUpdate: (sessionId: string, toolId: string) => void
  markToolChainProgress: (sessionId: string) => void
  clearToolChainProgress: (sessionId: string) => void
  updateAgentStatus: (status: "idle" | "thinking" | "executing") => void
  showSkillIndicator: (sessionId: string, skillName: string) => void
}

export function createStreamOrchestrator(deps: StreamOrchestratorDeps): StreamOrchestratorAPI {
  const {
    vscode,
    els,
    streamHandlers,
    getState,
    getPendingMode,
    getSession,
    getAllSessions,
    ensureSession,
    setStreaming,
    save,
    addMessage,
    showSystemMessage,
    createTabUI,
    switchTab,
    hideWelcomeView,
    updateTabBar,
    updateModeSelectorStateLocal,
    updateSendButtonIcon,
    updateSendButton,
    getMessageList,
    createStreamHandlersForTab,
    setupJumpToBottom,
    debouncedUpdateScrollMarkers,
    debouncedTimelineRefresh,
    refreshConversationTimeline,
    toolElapsedTracker,
    promptQueues,
    renderQueue,
    syncModeUI,
    renderRecentSessionsList,
    persistQueues,
  } = deps

  const pendingToolUpdates = new Map<string, PendingToolUpdate>()
  const pendingToolPartials = new Map<string, PendingToolPartial>()
  const toolChainProgressTimers = new Map<string, ReturnType<typeof setTimeout>>()

  // Spatial error-tier infrastructure. The store holds Tier-A hard blocks so
  // the composer gate survives panel toggle; the deps resolve the live DOM
  // slots lazily (the banner slot is added to index.html). PostMessage forwards
  // recovery CTAs (retry / upgrade_plan / pick_model / …) to the host.
  const errorStateStore = new ErrorStateStore()
  const errorTierDeps: ErrorTierDeps = {
    bannerSlot: () => document.getElementById("global-status-banner"),
    composer: () => document.getElementById("prompt-input"),
    sendButton: () => document.getElementById("send-btn"),
    postMessage: (msg) => vscode.postMessage(msg),
  }

  function scheduleToolUpdate(sessionId: string, toolId: string, update: { state?: ToolCallState; args?: unknown }): void {
    scheduleDebouncedToolUpdate(pendingToolUpdates, streamHandlers, sessionId, toolId, update)
  }

  function scheduleToolPartial(sessionId: string, toolId: string, live: LiveToolOutput): void {
    scheduleDebouncedToolPartial(pendingToolPartials, streamHandlers, sessionId, toolId, live)
  }

  function flushToolUpdate(sessionId: string, toolId: string): void {
    flushPendingToolUpdate(pendingToolUpdates, streamHandlers, sessionId, toolId)
  }

  function markToolChainProgress(sessionId: string): void {
    armToolChainProgressIndicator(toolChainProgressTimers, getMessageList, sessionId)
  }

  function clearToolChainProgress(sessionId: string): void {
    clearToolChainProgressIndicator(toolChainProgressTimers, getMessageList, sessionId)
  }

  function updateAgentStatus(status: "idle" | "thinking" | "executing") {
    renderAgentStatusLed(status, els.agentStatusLed, els.agentStatusText)
  }

  function showSkillIndicator(sessionId: string, skillName: string) {
    appendSkillPill(sessionId, skillName, els.inputArea, els.inputWrapper)
  }

  function handleStreamStart(sessionId: string, messageId?: string, opts?: { skipAnchor?: boolean }) {
    const finalStream = ensureStreamUiReady(sessionId, {
      postMessage: vscode.postMessage,
      getSession,
      ensureSession,
      getState,
      getPendingMode,
      getMessageList,
      createTabUI,
      streamHandlers,
      createStreamHandlersForTab,
    })
    if (!finalStream) return

    if (getState().activeSessionId !== sessionId) {
      vscode.postMessage({ type: "webview_log", level: "info", message: `handleStreamStart: Switching to tab ${sessionId}` })
      switchTab(sessionId)
    }
    hideWelcomeView()
    updateTabBar()

    vscode.postMessage({ type: "webview_log", level: "info", message: `handleStreamStart: Starting stream for ${sessionId} (msgId=${messageId})` })
    finalStream.handleStreamStart(messageId, opts)
    setStreaming(sessionId, true)
    updateTabBar()
    updateModeSelectorStateLocal()
    updateAgentStatus("thinking")
    const activeMsgList = getMessageList(sessionId)
    if (activeMsgList) {
      if (!activeMsgList.querySelector(".jump-to-bottom")) {
        setupJumpToBottom(sessionId)
      }
      debouncedUpdateScrollMarkers(sessionId)
    }
  }

  let chunkLogCounter = 0
  function handleStreamChunk(sessionId: string, text?: string, messageId?: string) {
    if (!getSession(sessionId)) {
      ensureSession({
        id: sessionId,
        name: "New Session",
        model: getState().globalModel || "",
        mode: getPendingMode() || "build",
        messages: [],
        isStreaming: false,
      })
    }
    if (!els.tabPanels.querySelector(`.tab-panel[data-tab-id="${CSS.escape(sessionId)}"]`)) {
      const sess = getSession(sessionId)
      if (sess) {
        createTabUI(sessionId, sess.name)
        updateTabBar()
        hideWelcomeView()
      }
    }
    let stream = streamHandlers.get(sessionId)
    if (!stream) {
      vscode.postMessage({ type: "webview_log", level: "warn", message: `handleStreamChunk: No stream found for session ${sessionId}, creating...` })
      stream = createStreamHandlersForTab(sessionId)
      if (!stream) {
        vscode.postMessage({ type: "webview_log", level: "error", message: `handleStreamChunk: createStreamHandlersForTab returned nothing for session ${sessionId}, dropping chunk` })
        return
      }
      streamHandlers.set(sessionId, stream)
    }
    const s = stream
    chunkLogCounter++
    maybeLogStreamChunk(chunkLogCounter, sessionId, text, s.streamingMessageId, vscode.postMessage)
    s.handleStreamChunk(text, messageId)
  }

  function resetStream(sessionId: string): void {
    const stream = streamHandlers.get(sessionId)
    if (stream) {
      try {
        stream.resetStream()
      } catch (err) {
        vscode.postMessage({ type: "webview_log", level: "warn", message: `resetStream: stream handler threw: ${err instanceof Error ? err.message : err}` })
      }
      streamHandlers.delete(sessionId)
    }
    setStreaming(sessionId, false)
    updateTabBar()
    updateModeSelectorStateLocal()
    updateAgentStatus("idle")
    vscode.postMessage({ type: "webview_log", level: "info", message: `resetStream: cleared streaming state for ${sessionId}` })
  }

  /**
   * Webview-side drain is disabled — host owns all draining via onQueueDrain.
   * The webview queue is a read-only render cache populated from host queue_state.
   */
  function processQueueIfReady(_sessionId: string, _reason?: string): void {
    return
  }

  function handleStreamEnd(sessionId: string, messageId?: string, blocks?: unknown, reason?: string, partial?: boolean) {
    try {
      const stream = streamHandlers.get(sessionId)
      if (!stream) {
        vscode.postMessage({ type: "webview_log", level: "warn", message: `handleStreamEnd: No stream found for session ${sessionId}` })
      } else {
        try {
          stream.handleStreamEnd(messageId, blocks)
        } catch (err) {
          vscode.postMessage({ type: "webview_log", level: "error", message: `handleStreamEnd: stream handler threw: ${err instanceof Error ? err.message : err}` })
        }
      }

      // Catch-all backstop: clear any lingering live-cursor (.streaming-text)
      // for this session so a finished run is never left "streaming" on the
      // frontend, regardless of how the inner finalize resolved (or if it threw
      // above). Runs after the inner handler so it only mops up true orphans.
      const endMsgList = getMessageList(sessionId)
      if (endMsgList) finalizeStreamingText(endMsgList)

      processStreamEndBlocks(sessionId, messageId, blocks, getMessageList, addMessage)

      setStreaming(sessionId, false)
      toolElapsedTracker.clearAll()
      clearToolChainProgress(sessionId)
      clearPendingToolUpdatesForSession(pendingToolUpdates, sessionId)
      clearPendingToolPartialsForSession(pendingToolPartials, sessionId)
      updateTabBar()
      updateModeSelectorStateLocal()
      updateAgentStatus("idle")
      debouncedTimelineRefresh(sessionId)

      showStreamEndReasonMessage(sessionId, reason, partial, showSystemMessage, getSession)

      if (sessionId === getState().activeSessionId) {
        updateSendButtonIcon(false)
        updateSendButton()
      }

      processQueueIfReady(sessionId, reason)
    } catch (err) {
      recoverAfterStreamEndError(sessionId, reason, err, {
        postMessage: vscode.postMessage,
        setStreaming,
        updateTabBar,
        updateModeSelectorStateLocal,
        updateAgentStatus,
        showSystemMessage,
      })
    }
  }

  function sendQueuedPrompt(sessionId: string, text: string, attachments?: Array<{ data: string; mimeType: string }>) {
    const active = getSession(sessionId)
    if (!active) return

    const msgObj: ChatMessage = {
      role: "user",
      // opencode rejects user-message ids not starting with "msg"; this id is reused as
      // both the local optimistic bubble id and the server messageID, so they stay equal.
      id: generateUserMessageId(),
      blocks: [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...(attachments || []).map((a) => ({ type: "image" as const, data: a.data, mimeType: a.mimeType })),
      ],
      timestamp: Date.now(),
      sessionId,
    }

    addMessage(sessionId, msgObj)
    setStreaming(sessionId, true)
    updateTabBar()
    updateModeSelectorStateLocal()
    updateSendButton()
    renderQueue(sessionId)

    const stream = streamHandlers.get(sessionId)
    if (stream) stream.showTypingIndicator("Thinking...")
    updateAgentStatus("thinking")

    vscode.postMessage({
      type: "send_prompt",
      text,
      sessionId,
      messageId: msgObj.id,
      model: active.model,
      mode: active.mode,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    })
  }

  function handleServerStatus(sessionId: string, status?: string, errorContext?: unknown) {
    const stream = streamHandlers.get(sessionId)
    if (!stream) return
    stream.handleServerStatus(status, errorContext)
    if (status === "executing" || status === "running") {
      updateAgentStatus("executing")
    } else if (status === "idle") {
      updateAgentStatus("idle")
      // Server reports the run is idle — clear any leftover live affordance even
      // if no stream_end arrived for this session: the caret + blue backdrop,
      // and any tool still showing a spinner / live elapsed.
      const idleMsgList = getMessageList(sessionId)
      if (idleMsgList) finalizeStreamingText(idleMsgList)
      stream.finalizePendingTools()
    }
  }

  function handleRequestError(sessionId: string | undefined, message?: string, errorContext?: unknown) {
    if (!sessionId) {
      const sessions = getAllSessions()
      const streaming = sessions.find(s => s.isStreaming)
      if (streaming) sessionId = streaming.id
      else return
    }

    // G2: Do NOT unconditionally clear the streaming flag. Many error sources
    // (show_error, provider_error, server_status:"error", rate-limit body
    // from a third-party provider) do NOT actually terminate the active run —
    // the model keeps generating, and clearing the flag would revert the send
    // button to "Send" while the backend is still working. Three cases:
    //   1. errorContext.mayStillBeRunning === true → preserve the flag, post
    //      the error UI, and trigger a probe to reconcile authoritatively.
    //   2. errorContext absent (bare show_error / webview_request_error with
    //      no context) → preserve the flag if currently streaming; only clear
    //      when we get a confirming probe or stream_end.
    //   3. errorContext.mayStillBeRunning === false (or absent and not
    //      streaming) → legacy behavior: clear the flag.
    const currentlyStreaming = Boolean(getSession(sessionId)?.isStreaming)
    const mayStillBeRunning = readMayStillBeRunning(errorContext)
    const shouldPreserveStreaming = currentlyStreaming && mayStillBeRunning !== false
    if (!shouldPreserveStreaming) {
      setStreaming(sessionId, false)
    }
    updateTabBar()
    updateModeSelectorStateLocal()

    // Spatial tier routing: validate the wire payload and route hard-blocks
    // (Tier A → composer gate) and infra faults (Tier B → ambient banner) to
    // dedicated surfaces, bypassing the in-stream bubble. Tier C falls through
    // to the legacy stream handler below unchanged.
    if (errorContext !== undefined && errorContext !== null) {
      const normalized = normalizeIncomingError(errorContext, sessionId)
      const routed = routeErrorByTier(normalized, errorTierDeps, errorStateStore)
      if (routed.handled && normalized.tier !== "C") {
        const errMsgList = getMessageList(sessionId)
        if (errMsgList && !shouldPreserveStreaming) finalizeStreamingText(errMsgList)
        if (sessionId === getState().activeSessionId) {
          updateSendButtonIcon(shouldPreserveStreaming ? true : false)
          updateSendButton()
        }
        // G2: if we preserved the flag, kick a probe to confirm whether the
        // run is really still alive. The probe's reply (run_status_result)
        // will reconcile the flag authoritatively.
        if (shouldPreserveStreaming) {
          vscode.postMessage({ type: "probe_run_status", sessionId, cliSessionId: undefined })
        }
        return
      }
    }

    const stream = streamHandlers.get(sessionId)
    if (stream) {
      stream.handleRequestError(message, errorContext)
    }
    // A failed run also ends streaming — clear any leftover live cursor / blue
    // backdrop, and finalize any tool still spinning. Skip if we're preserving
    // the streaming flag (the run may still be live).
    if (!shouldPreserveStreaming) {
      const errMsgList = getMessageList(sessionId)
      if (errMsgList) finalizeStreamingText(errMsgList)
      stream?.finalizePendingTools()
    }

    if (sessionId === getState().activeSessionId) {
      updateSendButtonIcon(shouldPreserveStreaming ? true : false)
      updateSendButton()
      if (shouldPreserveStreaming) {
        vscode.postMessage({ type: "probe_run_status", sessionId, cliSessionId: undefined })
      }
    }
  }

  function handleDiffResult(sessionId: string | undefined, blockId?: string, ok?: boolean, message?: string, checkpointCreated?: boolean) {
    if (sessionId) {
      const stream = streamHandlers.get(sessionId)
      if (stream) stream.handleDiffResult(blockId, ok, message)
    } else {
      // Fallback: broadcast to all sessions only when sessionId is unknown
      for (const [, stream] of streamHandlers) {
        stream.handleDiffResult(blockId, ok, message)
      }
    }
    if (ok && checkpointCreated) {
      const activeId = getState().activeSessionId
      if (activeId) {
        showSystemMessage(activeId, "Checkpoint saved — you can revert via OpenCode: Rollback Changes")
      }
    }
  }

  function handleHostMessage(msg: ChatMessage) {
    if (!msg.sessionId) return
    const stream = streamHandlers.get(msg.sessionId)
    const isFinalAssistantMessage = msg.role === "assistant" &&
      !hasPendingQuestionBlock(msg)
    if (stream && isFinalAssistantMessage) {
      stream.hideTypingIndicator()
    }
    addMessage(msg.sessionId, msg)
    if (isFinalAssistantMessage) {
      setStreaming(msg.sessionId, false)
      updateTabBar()
      updateModeSelectorStateLocal()
      updateSendButton()
      updateAgentStatus("idle")
    }
    syncModeUI()
  }

  /**
   * Detect whether an assistant message is carrying an *unanswered* question
   * block. Such messages are rendered as a transcript pointer card whose
   * interactive surface lives in the question bar; the agent is still
   * suspended waiting for the answer, so the stream MUST NOT terminate and
   * the composer MUST NOT flip to idle. (B5 fix.)
   *
   * Once the question has been answered (`answered: true` or a non-empty
   * `answer`), the message is a normal finalized record and the stream may
   * end normally.
   */
  function hasPendingQuestionBlock(msg: ChatMessage): boolean {
    if (!msg.blocks || msg.blocks.length === 0) return false
    return msg.blocks.some((b) => {
      const rec = b as Record<string, unknown>
      if (rec.type !== "question") return false
      const answered = rec.answered
      const answer = rec.answer
      return answered !== true && (answer === undefined || answer === null || answer === "")
    })
  }

  function handleCostUpdate(sessionId: string, cost: number) {
    if (!Number.isFinite(cost)) return
    const session = getSession(sessionId)
    if (session) {
      (session as any).cost = cost
      save()
      renderRecentSessionsList()
    }
  }

  return {
    handleStreamStart,
    handleStreamChunk,
    handleStreamEnd,
    resetStream,
    handleServerStatus,
    handleRequestError,
    handleDiffResult,
    handleHostMessage,
    handleCostUpdate,
    sendQueuedPrompt,
    scheduleToolUpdate,
    scheduleToolPartial,
    flushToolUpdate,
    markToolChainProgress,
    clearToolChainProgress,
    updateAgentStatus,
    showSkillIndicator,
  }
}
