/**
 * Behavioral + structural tests for the streaming-state stability hardening.
 *
 * Coverage map (each gap from the diagnostic has at least one test):
 *   G1  — TTFB timeout must probe before unilaterally clearing (host)
 *   G2  — handleRequestError must not clear streaming for non-terminal errors (webview)
 *   G3  — server_disconnected posts streaming_state with source="reconnect"
 *   G4  — event_stream_reconnected reconciles snapshot tabs, not just isStreaming tabs
 *   G5  — maybeFinalizeStream defers status-triggered finalize until a quiet period
 *   G6  — reconcileAfterReconnect emits stream_end when the run completed during outage
 *   G7  — streaming_state handler writes isServerStreaming (the authoritative flag)
 *   G8  — sendLogic arms an ack-watchdog that probes if the host never acks
 *   G9  — switchTab derives the button from isStreaming OR isServerStreaming
 *   G10 — onProcessCrash calls ChatProvider.handleProcessCrash for tab cleanup
 *   Wire — streaming_state payload carries source/cliSessionId/messageId/runId
 *   Wire — probe_run_status (webview→host) and run_status_result (host→webview) exist
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "../..")

function readSrc(rel) {
  return readFileSync(resolve(root, rel), "utf8")
}

const STREAM_COORDINATOR = readSrc("src/chat/handlers/StreamCoordinator.ts")
const STREAM_TIMEOUT_MANAGER = readSrc("src/chat/handlers/StreamTimeoutManager.ts")
const TAB_MANAGER = readSrc("src/chat/TabManager.ts")
const CHAT_PROVIDER = readSrc("src/chat/ChatProvider.ts")
const SEND_LOGIC = readSrc("src/chat/webview/sendMessage.ts")
const STREAM_ORCHESTRATOR = readSrc("src/chat/webview/streamOrchestrator.ts")
const WEBVIEW_TYPES = readSrc("src/chat/webview/types.ts")
const MAIN_TS = readSrc("src/chat/webview/main.ts")
const TAB_SWITCHER = readSrc("src/chat/webview/tabSwitcher.ts")
const EXTENSION_TS = readSrc("src/extension.ts")
const WEBVIEW_EVENT_ROUTER = readSrc("src/chat/WebviewEventRouter.ts")

void describe("streaming-state stability: wire format (Phase A)", () => {
  void it("streaming_state HostMessage carries source/cliSessionId/messageId/runId", () => {
    const idx = WEBVIEW_TYPES.indexOf('"streaming_state"')
    assert.ok(idx >= 0, "streaming_state type must exist")
    const block = WEBVIEW_TYPES.slice(idx, idx + 400)
    assert.ok(block.includes("source?:"), "streaming_state must carry source")
    assert.ok(block.includes("cliSessionId?:"), "streaming_state must carry cliSessionId")
    assert.ok(block.includes("messageId?:"), "streaming_state must carry messageId")
    assert.ok(block.includes("runId?:"), "streaming_state must carry runId")
  })

  void it("adds run_status_result (host→webview) message type", () => {
    assert.ok(
      WEBVIEW_TYPES.includes('"run_status_result"'),
      "HostMessage union must include run_status_result",
    )
    assert.ok(
      WEBVIEW_TYPES.includes("active: boolean") && WEBVIEW_TYPES.includes("serverReachable: boolean"),
      "run_status_result must carry active + serverReachable booleans",
    )
  })

  void it("adds probe_run_status (webview→host) message type", () => {
    assert.ok(
      WEBVIEW_TYPES.includes('"probe_run_status"'),
      "WebviewMessage union must include probe_run_status",
    )
  })

  void it("adds stream_end.source discriminator for terminator attribution", () => {
    const idx = WEBVIEW_TYPES.indexOf('"stream_end"')
    assert.ok(idx >= 0)
    const block = WEBVIEW_TYPES.slice(idx, idx + 300)
    assert.ok(
      block.includes('source?: "host" | "watchdog" | "abort" | "finalize" | "ttfb" | "reconcile"'),
      "stream_end must carry a source discriminator covering the gap categories",
    )
  })

  void it("SessionState has activeServerMessageId + activeRunId for run identity", () => {
    assert.ok(WEBVIEW_TYPES.includes("activeServerMessageId?"), "SessionState must carry activeServerMessageId")
    assert.ok(WEBVIEW_TYPES.includes("activeRunId?"), "SessionState must carry activeRunId")
  })
})

void describe("streaming-state stability: host authority (Phase C)", () => {
  void it("TabManager.setStreaming accepts a payload with source/run identity", () => {
    // Find the method declaration (not the interface signature). Look for the
    // class method by anchoring on the multi-line signature.
    const methodIdx = TAB_MANAGER.indexOf("setStreaming(\n    id: string,\n    isStreaming: boolean,\n    payload?")
    const altIdx = TAB_MANAGER.indexOf("setStreaming(\n    id: string,\n    isStreaming: boolean,")
    const idx = methodIdx >= 0 ? methodIdx : altIdx
    assert.ok(idx >= 0, "setStreaming class method must exist")
    const sig = TAB_MANAGER.slice(idx, idx + 600)
    assert.ok(sig.includes("payload?:"), "setStreaming must accept a payload argument")
    assert.ok(sig.includes("source?:"), "payload must include source")
    assert.ok(sig.includes("cliSessionId?:"), "payload must include cliSessionId")
    assert.ok(sig.includes("messageId?:"), "payload must include messageId")
    assert.ok(sig.includes("runId?:"), "payload must include runId")
  })

  void it("TabManager fires StreamingStateChange with extended fields", () => {
    assert.ok(
      TAB_MANAGER.includes("interface StreamingStateChange"),
      "StreamingStateChange interface must be declared",
    )
    assert.ok(
      TAB_MANAGER.includes('_onStreamingStateChanged = new vscode.EventEmitter<StreamingStateChange>()'),
      "emitter must be typed against StreamingStateChange",
    )
  })

  void it("StreamCoordinator exposes probeActiveRun", () => {
    assert.ok(
      STREAM_COORDINATOR.includes("async probeActiveRun("),
      "probeActiveRun method must exist on StreamCoordinator",
    )
    // The probe must always reply (even on server failure) so the webview
    // never hangs waiting.
    const idx = STREAM_TIMEOUT_MANAGER.indexOf("async probeActiveRun(")
    const body = STREAM_TIMEOUT_MANAGER.slice(idx, idx + 6000)
    assert.ok(body.includes("run_status_result"), "probe must reply via run_status_result")
    assert.ok(body.includes("serverReachable"), "probe reply must include serverReachable")
    assert.ok(
      body.includes("time.completed") || body.includes("completed?: number"),
      "probe must consult time.completed to detect finished runs",
    )
  })

  void it("ChatProvider.onStreamingStateChanged forwards the extended payload", () => {
    const idx = CHAT_PROVIDER.indexOf("onStreamingStateChanged((")
    assert.ok(idx >= 0)
    const block = CHAT_PROVIDER.slice(idx, idx + 400)
    assert.ok(block.includes("source"), "forwarder must destructure source")
    assert.ok(block.includes("cliSessionId"), "forwarder must destructure cliSessionId")
    assert.ok(block.includes("messageId"), "forwarder must destructure messageId")
    assert.ok(block.includes("runId"), "forwarder must destructure runId")
  })

  void it("WebviewEventRouter routes probe_run_status to StreamCoordinator", () => {
    assert.ok(
      WEBVIEW_EVENT_ROUTER.includes('"probe_run_status"'),
      "probe_run_status must be in VALID_WEBVIEW_TYPES",
    )
    const idx = WEBVIEW_EVENT_ROUTER.indexOf('["probe_run_status"')
    assert.ok(idx >= 0, "probe_run_status handler must be registered")
    const block = WEBVIEW_EVENT_ROUTER.slice(idx, idx + 1200)
    assert.ok(block.includes("probeActiveRun"), "handler must call streamCoordinator.probeActiveRun")
  })
})

void describe("streaming-state stability: G1 TTFB/idle race (host)", () => {
  void it("TTFB handler probes before unilaterally clearing when SSE is connected", () => {
    const idx = STREAM_TIMEOUT_MANAGER.indexOf("setupTtfbTimeout(tabId: string, callbacks: StreamCallbacks)")
    assert.ok(idx >= 0)
    const body = STREAM_TIMEOUT_MANAGER.slice(idx, idx + 8000)
    // G1: when eventStream is connected, probe before clearing.
    // The TTFB path dispatches through probeActiveRunWithRetry, which wraps
    // probeActiveRun with backoff. Either name satisfies the contract.
    assert.ok(
      (body.includes("probeActiveRunWithRetry(tabId, callbacks)") || body.includes("probeActiveRun(tabId, callbacks)")) && body.includes("suppressing stream_end"),
      "TTFB must probe the server before posting stream_end when SSE is connected",
    )
    // The probe reply reconciles the streaming flags; if the run is still
    // active, the stream_end is suppressed.
    assert.ok(
      body.includes('source: "ttfb"'),
      "TTFB-emitted stream_end must carry source: 'ttfb' for attribution",
    )
  })
})

void describe("streaming-state stability: G2 handleRequestError scoping (webview)", () => {
  void it("readMayStillBeRunning helper extracts the field from errorContext", () => {
    assert.ok(
      STREAM_ORCHESTRATOR.includes("function readMayStillBeRunning("),
      "readMayStillBeRunning helper must exist",
    )
    const idx = STREAM_ORCHESTRATOR.indexOf("function readMayStillBeRunning(")
    const body = STREAM_ORCHESTRATOR.slice(idx, idx + 800)
    assert.ok(body.includes("mayStillBeRunning"), "helper must read mayStillBeRunning")
    assert.ok(body.includes("metadata"), "helper must also check nested metadata.mayStillBeRunning")
  })

  void it("handleRequestError preserves streaming flag when mayStillBeRunning is true", () => {
    const idx = STREAM_ORCHESTRATOR.indexOf("function handleRequestError(sessionId")
    assert.ok(idx >= 0)
    const body = STREAM_ORCHESTRATOR.slice(idx, idx + 4000)
    assert.ok(body.includes("readMayStillBeRunning"), "must call readMayStillBeRunning")
    assert.ok(body.includes("shouldPreserveStreaming"), "must compute shouldPreserveStreaming")
    assert.ok(
      body.includes("probe_run_status"),
      "must kick probe_run_status when preserving (so host can confirm)",
    )
    // The actual clearing of affordances must be gated behind !shouldPreserveStreaming.
    assert.ok(
      body.includes("if (!shouldPreserveStreaming)") && body.includes("finalizeStreamingText(errMsgList)"),
      "finalizeStreamingText must be skipped when preserving streaming",
    )
  })
})

void describe("streaming-state stability: G3 server_disconnected source tagging (host)", () => {
  void it("server_disconnected handler calls setStreaming with source: 'reconnect'", () => {
    const idx = CHAT_PROVIDER.indexOf('["server_disconnected"')
    assert.ok(idx >= 0)
    const block = CHAT_PROVIDER.slice(idx, idx + 1200)
    assert.ok(
      block.includes('source: "reconnect"'),
      "server_disconnected must tag streaming_state with source: 'reconnect'",
    )
    // No double-post: must NOT call postMessage streaming_state directly
    // (the emitter already does it).
    assert.ok(
      !block.includes('postMessage({ type: "streaming_state"'),
      "server_disconnected must NOT double-post streaming_state (the emitter handles it)",
    )
  })
})

void describe("streaming-state stability: G4 reconcile also covers interrupted snapshot (host)", () => {
  void it("event_stream_reconnected reconciles both isStreaming tabs and snapshot interrupted tabs", () => {
    const idx = CHAT_PROVIDER.indexOf('["event_stream_reconnected"')
    assert.ok(idx >= 0)
    const block = CHAT_PROVIDER.slice(idx, idx + 2200)
    assert.ok(
      block.includes("candidateTabIds") && block.includes("getInterruptedTabs()"),
      "reconcile must consider both isStreaming tabs and getInterruptedTabs snapshot",
    )
    assert.ok(
      block.includes("reconcileAfterReconnect(tabId"),
      "each candidate must be passed to reconcileAfterReconnect",
    )
  })
})

void describe("streaming-state stability: G5 premature session.idle guard (host)", () => {
  void it("STATUS_FINALIZE_QUIET_MS constant exists", () => {
    assert.ok(
      STREAM_COORDINATOR.includes("STATUS_FINALIZE_QUIET_MS"),
      "must declare the quiet-period constant",
    )
  })

  void it("maybeFinalizeStream defers status-triggered finalizes within the quiet window", () => {
    // The guard logic lives in runMaybeFinalizeStream (the actual execution path);
    // maybeFinalizeStream is the dedup-entry wrapper. Search both methods.
    const runIdx = STREAM_COORDINATOR.indexOf("private async runMaybeFinalizeStream(")
    assert.ok(runIdx >= 0, "runMaybeFinalizeStream must exist")
    const runBody = STREAM_COORDINATOR.slice(runIdx, runIdx + 4000)
    assert.ok(
      runBody.includes('trigger === "status"') && runBody.includes("STATUS_FINALIZE_QUIET_MS"),
      "status-triggered finalizes must check the quiet period in runMaybeFinalizeStream",
    )
    assert.ok(
      runBody.includes("pendingStatusFinalizeTimers"),
      "must arm a timer that defers the finalize",
    )
    // Fix 1: activity-sequence guard (microtask-based, race-free)
    assert.ok(
      runBody.includes("activitySeq") || runBody.includes("queueMicrotask"),
      "must also check activity sequence for race-free guard (Fix 1)",
    )
  })

  void it("appendChunk and appendToolStart cancel pending status finalizes", () => {
    const chunkIdx = STREAM_COORDINATOR.indexOf("appendChunk(tabId: string, text: string")
    assert.ok(chunkIdx >= 0)
    const chunkBody = STREAM_COORDINATOR.slice(chunkIdx, chunkIdx + 400)
    assert.ok(chunkBody.includes("cancelPendingStatusFinalize"), "appendChunk must cancel pending status finalize")
    const toolIdx = STREAM_COORDINATOR.indexOf("appendToolStart(tabId: string, toolCall: { id")
    assert.ok(toolIdx >= 0)
    const toolBody = STREAM_COORDINATOR.slice(toolIdx, toolIdx + 400)
    assert.ok(toolBody.includes("cancelPendingStatusFinalize"), "appendToolStart must cancel pending status finalize")
  })

  void it("cleanupTab and dispose clear pending status-finalize timers", () => {
    const cleanupIdx = STREAM_COORDINATOR.indexOf("cleanupTab(tabId: string): void")
    assert.ok(cleanupIdx >= 0)
    const cleanupBody = STREAM_COORDINATOR.slice(cleanupIdx, cleanupIdx + 1500)
    assert.ok(cleanupBody.includes("cancelPendingStatusFinalize"), "cleanupTab must clear the pending status finalize")
    assert.ok(
      STREAM_COORDINATOR.includes("pendingStatusFinalizeTimers.clear()"),
      "dispose must clear all pending status-finalize timers",
    )
  })
})

void describe("streaming-state stability: G6 reconcile emits stream_end for completed run (host)", () => {
  void it("reconcileAfterReconnect emits stream_end when last assistant has time.completed", () => {
    const idx = STREAM_COORDINATOR.indexOf("async reconcileAfterReconnect(tabId: string, callbacks: StreamCallbacks)")
    assert.ok(idx >= 0)
    const body = STREAM_COORDINATOR.slice(idx, idx + 3500)
    assert.ok(
      body.includes("completedAt") && body.includes("emitting dropped stream_end"),
      "must detect time.completed and emit a dropped stream_end",
    )
    assert.ok(
      body.includes('reason: "reconnect_completed"'),
      "stream_end reason must be 'reconnect_completed' for attribution",
    )
    assert.ok(
      body.includes('source: "reconcile"'),
      "stream_end source must be 'reconcile' for attribution",
    )
  })
})

void describe("streaming-state stability: G7 streaming_state writes authoritative flag (webview)", () => {
  void it("streaming_state handler writes both isServerStreaming and isStreaming", () => {
    const idx = MAIN_TS.indexOf('["streaming_state"')
    assert.ok(idx >= 0)
    const block = MAIN_TS.slice(idx, idx + 1800)
    assert.ok(block.includes("setServerStreaming(sid, isStreaming)"), "must write isServerStreaming (authoritative)")
    assert.ok(block.includes("activeServerMessageId"), "must stash activeServerMessageId on start")
    assert.ok(block.includes("activeRunId"), "must stash activeRunId on start")
    // On stop, run identity must be cleared so a stale push can't revive it.
    assert.ok(
      /sess\.activeServerMessageId = undefined/.test(block),
      "must clear activeServerMessageId on streaming_state:false",
    )
  })

  void it("run_status_result handler exists and reconciles both flags", () => {
    const idx = MAIN_TS.indexOf('["run_status_result"')
    assert.ok(idx >= 0, "run_status_result handler must be registered")
    const block = MAIN_TS.slice(idx, idx + 1500)
    assert.ok(block.includes("setServerStreaming(sid, active)"), "must write isServerStreaming from probe reply")
    assert.ok(block.includes("setStreaming(sid, active)"), "must write isStreaming from probe reply")
    assert.ok(block.includes("finalizeStreamingText"), "must clear streaming affordances when probe says run is gone")
  })
})

void describe("streaming-state stability: G8 optimistic-local watchdog (webview)", () => {
  void it("sendLogic arms an ack watchdog that probes if the host never acks", () => {
    assert.ok(
      SEND_LOGIC.includes("SEND_ACK_WATCHDOG_MS"),
      "must declare the watchdog constant",
    )
    // The watchdog must check both flags before probing — only fire if we
    // still believe we're streaming AND the host hasn't pushed
    // isServerStreaming=true yet. Search the whole file (the watchdog may
    // be inside sendMessage, far from the constant).
    assert.ok(
      SEND_LOGIC.includes("ackWatchdog") && SEND_LOGIC.includes("probe_run_status"),
      "must arm a watchdog that posts probe_run_status",
    )
    assert.ok(
      SEND_LOGIC.includes("isServerStreaming === true"),
      "watchdog must short-circuit if the host already pushed isServerStreaming=true",
    )
  })
})

void describe("streaming-state stability: G9 switchTab reads both flags (webview)", () => {
  void it("switchTab derives streaming state from isStreaming OR isServerStreaming", () => {
    // The switchTab derivation must consider both flags so a tab whose local
    // optimistic flag was cleared (by an error/reconnect) but whose backend
    // is still running still shows Stop.
    const candidates = [
      /activeSession\?\.isStreaming === true \|\| activeSession\?\.isServerStreaming === true/,
      /activeSession\?\.isServerStreaming === true \|\| activeSession\?\.isStreaming === true/,
    ]
    assert.ok(
      candidates.some((re) => re.test(MAIN_TS) || re.test(TAB_SWITCHER)),
      "switchTab must OR isStreaming and isServerStreaming",
    )
    // And must kick a probe to reconcile.
    assert.ok(
      MAIN_TS.includes("probeActiveRun") || TAB_SWITCHER.includes("probeActiveRun"),
      "switchTab must call composer.probeActiveRun to reconcile",
    )
  })
})

void describe("streaming-state stability: G10 per-tab process crash wiring (host)", () => {
  void it("ChatProvider exposes handleProcessCrash for per-tab crash cleanup", () => {
    assert.ok(
      CHAT_PROVIDER.includes("handleProcessCrash(processId: string, tabIds: string[], timestamp: number)"),
      "ChatProvider must expose handleProcessCrash with the crash signature",
    )
    const idx = CHAT_PROVIDER.indexOf("handleProcessCrash(processId")
    const body = CHAT_PROVIDER.slice(idx, idx + 2500)
    assert.ok(body.includes("cleanupTab"), "must call streamCoordinator.cleanupTab")
    assert.ok(body.includes('source: "reconnect"'), "must tag streaming_state with source: 'reconnect'")
    assert.ok(body.includes("stream_interrupted"), "must post stream_interrupted so user gets Resume/Dismiss")
  })

  void it("extension.ts onProcessCrash handler invokes chatProviderInstance.handleProcessCrash", () => {
    const idx = EXTENSION_TS.indexOf("onProcessCrash(")
    assert.ok(idx >= 0)
    const body = EXTENSION_TS.slice(idx, idx + 1200)
    assert.ok(body.includes("chatProviderInstance.handleProcessCrash"), "must call chatProviderInstance.handleProcessCrash")
    assert.ok(body.includes("G10"), "must include the G10 reference comment")
  })
})

void describe("streaming-state stability: state reload clears new identity fields (webview)", () => {
  void it("restore() resets activeServerMessageId + activeRunId", () => {
    // The reload sweep must clear the new fields so a stale run identity
    // from a prior page session can't survive.
    const idx = MAIN_TS.indexOf("// Run identity is per-run") // state.ts restore comment
    // The actual implementation is in state.ts; check it directly.
    const stateSrc = readSrc("src/chat/webview/state.ts")
    const restoreIdx = stateSrc.indexOf("function restore()")
    assert.ok(restoreIdx >= 0)
    const body = stateSrc.slice(restoreIdx, restoreIdx + 1500)
    assert.ok(body.includes("activeServerMessageId = undefined"), "restore must clear activeServerMessageId")
    assert.ok(body.includes("activeRunId = undefined"), "restore must clear activeRunId")
  })
})
