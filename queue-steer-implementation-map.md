# Queue & Steer Modes — Implementation Map

> **2026-06-13 update — model simplified to two behaviors.** The three co-equal
> modes below (Interrupt default / Append / Queue) were collapsed to **Queue
> (default) + Interrupt (explicit)**. "Append" was removed (it duplicated Queue with
> no feedback) along with its `appendCallbacks` / `registerAppendCallback` /
> `append_cancelled` plumbing and the dead webview `add_to_queue` handler. While
> streaming: **Enter** queues (safe default, visible/editable, drained after the turn
> via `onQueueDrain`); **⌘/Ctrl+Enter** interrupts-and-sends (one-shot, doesn't change
> the persisted default). The expected `MessageAbortedError` after any intentional
> abort is suppressed by a short-lived intentional-abort window in `StreamCoordinator`
> (`wasIntentionallyAborted`) consulted by `ChatProvider`'s `server_error` handler, so
> interrupting no longer shows "The request was cancelled." Session-mode shortcuts moved
> to **Alt+1/2/3** (work in the composer); the steering `Ctrl+1/2/3` triplet was removed.
> SDK is on **1.17.6** but the prompt path stays on the **v1** API — native v2
> `delivery: "steer" | "queue"` is a tracked future enhancement (a "Steer" third
> behavior maps cleanly onto it). The sections below describe the prior 3-mode design
> for historical context.

## Relevant Files

### Mode Definitions
- `src/chat/modePolicy.ts` — `SESSION_MODES = ["plan", "build", "auto"]`, `DEFAULT_MODE = "build"`, legacy "normal"→"build" mapping
- `src/chat/webview/sendLogic.ts` — `setSteerMode()`, `getSteerMode()`, `syncSteerModeUI()`
- `src/chat/webview/types.ts` — `SessionState.mode`, `SessionState.steerMode`, `SteerPrompt` interface, `SteerMode` type
- `src/chat/webview/state.ts` — `setSessionSteerMode()`, `createSession()`, session state persistence
- `src/chat/webview/ui/modeDropdown.ts` — `MODE_ORDER = ["plan", "build", "auto"]`, mode cycling

### Host-side Queue (single source of truth)
- `src/chat/HostPromptQueue.ts` — `enqueue()`, `dequeue()`, `confirmCompleted()`, `confirmFailed()`, `edit()`, `retry()`, `markStuckSendingAsQueued()`, `persist()`, `restore()`, `drainAfterAbort` setting
- **Dequeue semantics**: marks state="sending" in-place (does NOT shift/remove), item stays in array until `confirmCompleted()` removes or `markFailed()` sets failed. Persists "sending" items so they survive crashes.

### Prompt Submission Flow
- `src/chat/webview/inputHandlers.ts` — `dispatchSendOrSteer()` (Enter → send or steer based on `active.isStreaming`)
- `src/chat/webview/sendLogic.ts` — `sendMessage()`, `sendSteerPrompt()`, `setSteerMode()`, `getSteerMode()`
- `src/chat/webview/composer.ts` — wires sendLogic into UI
- `src/chat/webview/streamOrchestrator.ts` — `handleStreamEnd()`, `sendQueuedPrompt()` (webview-side drain is DISABLED — host-authoritative)
- `src/chat/WebviewEventRouter.ts` — `send_prompt` handler (host queue enqueue on in-flight guard), `send_steer_prompt` handler, `drainQueue()`, `drainQueuedPrompt()`, `postQueueState()`, host handlers for `remove_from_queue`, `edit_queue_item`, `reorder_queue`, `retry_queue_item`, `request_queue_state`, `resume_queue`
- `src/chat/handlers/SteerPromptHandler.ts` — `handleInterrupt()`, `handleAppend()`, `handleQueue()` (enqueues to HostPromptQueue directly)
- `src/chat/handlers/StreamCoordinator.ts` — `startPrompt()`, `finalizeStream()`, `abort()`, `onQueueDrain` callback, `appendCallbacks`, `append_cancelled` notification

### Queue UI (webview = read-only render cache)
- `src/chat/webview/queueRenderer.ts` — queue chips (listbox ARIA pattern, ArrowNav, Delete/Backspace, F2 edit, Alt+Arrow reorder, drag reorder), posts host messages for mutations
- `src/chat/webview/queue.ts` — `PromptQueue` data structure with `syncFromHost()` for host→webview sync
- `src/chat/webview/main.ts` — `promptQueues` Map (render cache), `queue_state` handler (full sync from host), `prompt_queued` handler (log-only), `add_to_queue` handler (backward compat), `append_cancelled` handler

### Steer UI
- `src/chat/webview/index.html` — steer mode buttons (interrupt/append/queue) with role="radio", aria-keyshortcuts, inline `<kbd>` hints
- `src/chat/webview/css/components.css` — steer button styling, `.steer-mode-key` kbd, `.sr-only` live region
- `src/chat/webview/css/layout.css` — input area border accent per steer mode

### Accessibility / Keyboard
- `src/chat/webview/ui/keyboardShortcutsModal.ts` — `SHORTCUT_TABLE` includes queue items section (ArrowNav, Delete, F2, Alt+Arrow reorder)
- `src/chat/webview/index.html` — `#queue-status-region` (`role="status" aria-live="polite"`) for AT announcements

### Session/Stream State
- `src/chat/TabManager.ts` — `canStartStreaming()`, `setStreaming()`, `maxConcurrentStreams`
- `src/chat/handlers/StreamCoordinator.ts` — stream lifecycle, append callbacks, queue drain, `append_cancelled` on abort
- `src/session/SessionClient.ts` — `sendPromptAsync()`, `session.abort()`
- `src/session/SessionManager.ts` — session creation/management

### ChatProvider (DI container)
- `src/chat/ChatProvider.ts` — creates `HostPromptQueue`, `SteerPromptHandler`, `WebviewEventRouter`, wires `onQueueDrain`

## Flow Diagrams

### Normal prompt submission (not streaming)
```
Input Enter → sendMessage() → create tab if needed → postMessage(send_prompt)
  → WebviewEventRouter → promptsInFlight check (empty) → startPrompt()
  → SessionStore.appendMessage(user msg)
  → sendPromptAsync() → OpenCode accepts → stream_start event
  → webview renders message → streaming begins
```

### Queue mode while busy (in-flight guard hits)
```
Input Enter → sendMessage() → active.isStreaming → redirect to sendSteerPrompt()
  → OR: during in-flight → WebviewEventRouter sends send_prompt
  → promptsInFlight has sessionId → HostPromptQueue.enqueue()
  → postMessage(prompt_queued) → webview logs (no system message — chips via queue_state)
  → postMessage(queue_state) → webview renders chips from host data
```

### Steer interrupt while streaming
```
Input Enter → sendSteerPrompt() → postMessage(send_steer_prompt, mode: interrupt)
  → WebviewEventRouter → SteerPromptHandler.handleInterrupt()
  → streamCoordinator.abort() → streamCoordinator.startPrompt()
  → New stream begins with steer text
```

### Steer append while streaming
```
Input Enter → sendSteerPrompt() → postMessage(send_steer_prompt, mode: append)
  → WebviewEventRouter → SteerPromptHandler.handleAppend()
  → streamCoordinator.registerAppendCallback()
  → After stream_end → callback fires → startPrompt() with steer text
```

### Steer queue while streaming
```
Input Enter → sendSteerPrompt() → postMessage(send_steer_prompt, mode: queue)
  → WebviewEventRouter → SteerPromptHandler.handleQueue()
  → HostPromptQueue.enqueue() → postMessage(prompt_queued + queue_state)
```

### Stream end / queue drain (host-authoritative)
```
SDK event "message_complete"
  → StreamCoordinator.finalizeStream()
    → StreamFinalizerService (fetch final blocks, post stream_end)
    → Execute append callbacks
    → onQueueDrain(tabId, "completed") fires
      → WebviewEventRouter.drainQueue()
        → HostPromptQueue.dequeue() (marks state="sending" in-place)
        → SessionStore.appendMessage(user msg) ← FIXED: was missing
        → streamCoordinator.startPrompt() ← bypasses promptsInFlight
        → On success: HostPromptQueue.confirmCompleted()
        → On failure: HostPromptQueue.markFailed() ← NOW WORKS (item still in array)

  Webview receives stream_end:
    → handleStreamEnd → showStreamEndReasonMessage
    → processQueueIfReady is NO-OP (host owns draining)
    → Eventually receives queue_state → updates chip UI from host data
```

### Failure / retry
```
startPrompt() throws → catch in drainQueuedPrompt
  → HostPromptQueue.markFailed(sessionId, id, error) ← FIXED: finds item in array
  → postQueueState → webview shows failed state with retry button
  → User clicks retry → posts retry_queue_item to host
  → HostPromptQueue.retry(sessionId, id) → state="queued"
  → On next drain: dequeues normally
```

### Abort / append cancellation
```
User clicks Stop / Escape → StreamCoordinator.abort()
  → Check appendCallbacks for pending appends
  → If pending: postMessage(append_cancelled, count=N)
    → webview shows: "N append prompt(s) cancelled — stream was aborted."
  → cleanupTab() → appendCallbacks.delete(tabId)
  → onQueueDrain(tabId, "aborted") → drainQueue()
    → If drainAfterAbort=false: skip, postQueueState (preserve items)
    → If drainAfterAbort=true: drain next item
```

### Session reload / reconciliation
```
Webview init → request_queue_state posted to host
  → HostPromptQueue.restore() rehydrates from workspaceState
    → markStuckSendingAsQueued() recovers any "sending" items
  → postQueueState(sessionId) → queue_state to webview
  → Webview syncFromHost() → chips rendered from host data
  → Old webview persistence (vscode.getState.queues) is migrated but deprecated
```

## Architecture: Unified Queue

```
┌──────────────────────────┐     postMessage     ┌──────────────────────────┐
│        Webview           │ ◄──────────────── ► │     Extension Host       │
│  (read-only render cache) │                     │  (single source of truth) │
│                          │                     │                          │
│ promptQueues Map          │ ← queue_state sync │ HostPromptQueue            │
│ (syncFromHost)           │                     │ (persisted workspaceState) │
│ queueRenderer             │ remove/edit/reorder │ → hostQueue.remove/edit    │
│ (chips via queue_state)  │ → host messages     │ → hostQueue.reorder        │
│ sendLogic                 │                     │ SteerPromptHandler         │
│                          │                     │ StreamCoordinator          │
│                          │                     │ WebviewEventRouter         │
│                          │                     │ (drainQueue, drainQueued-  │
│                          │                     │  Prompt, postQueueState)   │
└──────────────────────────┘                     └──────────────────────────┘
                                                          │
                                                          ▼
                                                   OpenCode Server
                                                   (promptAsync)
```

## Failure Boundaries Identified & Fixed

| # | Issue | Status |
|---|---|---|
| 1 | `promptsInFlight` guard silently drops prompts | FIXED: now queues to HostPromptQueue |
| 2 | `appendCallbacks` leak on abort | FIXED: cleanupTab + dispose clear callbacks |
| 3 | Queue in-flight items lost on reload | FIXED: sending→queued mapping on persist |
| 4 | `currentSteerMode` global across tabs | FIXED: per-tab state in SessionState |
| 5 | `add_to_queue` round-trip bounce | FIXED: direct HostPromptQueue enqueue |
| 6 | **Two queue systems** — host and webview | **FIXED**: unified to host-authoritative, webview is read-only render cache |
| 7 | No drain after abort | FIXED: `drainAfterAbort` setting, host pushes `queue_state` on abort |
| 8 | **`drainAfterAbort` disconnected** — router hardcoded `false` | FIXED: reads from `hostQueue.drainAfterAbort` |
| 9 | **`markFailed` silent no-op** — dequeued items shifted out of array | FIXED: in-place dequeue, item stays until `confirmCompleted()` |
| 10 | **Host-drained prompts missing from SessionStore** | FIXED: `drainQueuedPrompt` appends user message before `startPrompt` |
| 11 | **Race condition** — host + webview both drain on stream_end | FIXED: webview drain disabled, host is sole drainer |
| 12 | **`postQueueState` hardcoded position=0** | FIXED: uses correct index |
| 13 | **Tab switch didn't re-render queue** | FIXED: `switchTab()` calls `renderQueue()` + `syncSteerModeUI()` |
| 14 | **No keyboard nav on queue chips** | FIXED: ArrowNav, Delete/Backspace, F2, Alt+Arrow reorder, listbox ARIA |
| 15 | **Steer buttons used `aria-pressed` instead of `role="radio"`** | FIXED: `role="radio"` + `aria-checked` |
| 16 | **No `aria-keyshortcuts` on controls** | FIXED: added to all steer buttons |
| 17 | **No live region for queue state** | FIXED: `#queue-status-region` role="status" |
| 18 | **Help modal omitted queue shortcuts** | FIXED: added 8 queue shortcut rows |
| 19 | **`add_to_queue` handler silently dropped if no queue** | FIXED: creates queue if missing |

## Remaining Gaps (Future Work)

- **Queue auto-drain UI affordance after abort** — no "Resume queued" button yet (host supports `drainAfterAbort`, but no webview toggle)
- **Queue depth limit enforcement in UI** — webview should show "Queue full" when host rejects enqueue
- **Integration tests for host queue drain** — would require mocking OpenCode server
- **Structural tests for new host message types** — `remove_from_queue`, `edit_queue_item`, etc.
- **`queue-panel.css`** — deleted (dead CSS, never rendered by queueRenderer.ts)
- **`queue_drain_complete` message type** — deleted (never sent or handled)
