# Queue & Steer Modes — Audit

## Bugs Found & Fixed (Phase 1 + Phase 2)

### Critical

| Bug | File | What Changed |
|---|---|---|
| **Silent prompt drops** — `promptsInFlight` guard dropped `send_prompt` without notifying webview | `WebviewEventRouter.ts` | Replaced `return` with `HostPromptQueue.enqueue()` + `postMessage(prompt_queued)` |
| **`appendCallbacks` leak on abort** — stale callbacks survived `cleanupTab()` | `StreamCoordinator.ts` | Added `appendCallbacks.delete(tabId)` in `cleanupTab()` and `appendCallbacks.clear()` in `dispose()` |
| **Queue in-flight items lost on reload** — "sending" items filtered out by `persistQueues()` | `queueRenderer.ts` | Changed filter to map "sending" → "queued" before saving; added `HostPromptQueue` with `workspaceState` persistence |
| **`markFailed` silent no-op** — `dequeue()` shifted items out, so `markFailed()` couldn't find them | `HostPromptQueue.ts` | In-place dequeue: items stay in array with `state="sending"`, removed only on `confirmCompleted()`. `markFailed()`, `edit()`, `retry()` now find items by ID. |
| **Host-drained prompts missing from SessionStore** — `drainQueuedPrompt` called `startPrompt` directly without recording the user message | `WebviewEventRouter.ts` | `drainQueuedPrompt` now appends user message to `SessionStore` and posts `add_message` to webview before sending |
| **Dual-drain race condition** — host and webview both drained on stream_end, risking concurrent prompts | `streamOrchestrator.ts` | `processQueueIfReady()` is now a no-op. Host owns all draining via `onQueueDrain`. |

### High

| Bug | File | What Changed |
|---|---|---|
| **`currentSteerMode` was global** — wrong-mode dispatch on tab switch | `sendLogic.ts` | Per-tab state via `SessionState.steerMode` + `stateManager.setSessionSteerMode()` |
| **`add_to_queue` round-trip** — queue mode bounced through host back to webview | `SteerPromptHandler.ts` | Direct enqueue to `HostPromptQueue` + `queue_state` push |
| **No host queue persistence** — webview-only queue lost items on VS Code reload | `HostPromptQueue.ts` (NEW) | Added `HostPromptQueue` persisted to `workspaceState` |
| **`drainAfterAbort` disconnected** — router hardcoded `false`, ignoring `HostPromptQueue` field | `WebviewEventRouter.ts` | Router getter reads `hostQueue.drainAfterAbort` |
| **No `append_cancelled` notification** — pending append callbacks silently discarded on abort | `StreamCoordinator.ts` | Posts `{ type: "append_cancelled", count: N }` before `cleanupTab()` |
| **Steer buttons used wrong ARIA** — `aria-pressed` instead of `role="radio"` + `aria-checked` | `index.html`, `sendLogic.ts` | Changed to `role="radio"`/`aria-checked` |
| **No `aria-keyshortcuts`** — AT couldn't discover keyboard shortcuts | `index.html` | Added `aria-keyshortcuts` to all steer buttons |
| **No queue keyboard navigation** — ArrowUp/Down, Delete, F2, Home/End didn't work | `queueRenderer.ts` | Added `listbox` pattern with `aria-activedescendant`, ArrowNav, Delete/Backspace, F2 edit |
| **Queue shortcuts missing from help modal** — 8 queue shortcuts undocumented | `keyboardShortcutsModal.ts` | Added queue section to `SHORTCUT_TABLE` |
| **Tab switch didn't re-render queue** — stale chips from previous tab | `main.ts` | `switchTab()` calls `renderQueue()` + `syncSteerModeUI()` |
| **`postQueueState` hardcoded position=0** | `WebviewEventRouter.ts` | Uses correct index from `map(..., index)` |
| **`getAll()` returned live array reference** — consumers could mutate internal state | `HostPromptQueue.ts` | Returns `Array.from(...)` copy |

### Medium

| Bug | File | What Changed |
|---|---|---|
| **No per-tab steer mode** — `steerMode` wasn't in `SessionState` | `types.ts`, `state.ts`, `sendLogic.ts` | Added `steerMode` field, per-tab read/write |
| **Queue drain after abort** — queued items stall after cancel | `StreamCoordinator.ts` | `onQueueDrain` callback in abort path pushes `queue_state`; `drainAfterAbort` setting |
| **`add_to_queue` handler silently dropped if queue missing** | `main.ts` | Creates queue if it doesn't exist |
| **Webview push agenda** — webview request queue state on init | `main.ts` | Posts `request_queue_state` in `finishWebviewInitialization()` |
| **No live region for queue state** — screen readers don't announce queue changes | `index.html` | Added `#queue-status-region` (`role="status" aria-live="polite"`) |
| **`prompt_queued` showed system message bubble** — redundant with chips | `main.ts` | Replaced with log (chips render via `queue_state`) |
| **`syncSteerModeUI()` never called after tab switch** | `main.ts` | Called in `switchTab()` after `syncModeUI()` |

## Frontend Issues

- **Steer mode selector visibility tied to active tab only** — if tab A is streaming but user is viewing tab B, selector stays hidden (mitigated by per-tab mode state — correct mode when selector appears)
- **Input placeholder changes on streaming state** — already working correctly, no change needed

## Backend / Integration Issues

- **v1 SDK doesn't expose `delivery` parameter** — awaiting v2 SDK for native queue delivery
- **`SessionClient.sendPromptAsync()` uses `Idempotency-Key` header** — prevents duplicate sends on retry

## Dead Code Removed

| Item | Reason |
|---|---|
| `queue_drain_complete` from HostMessage union | Never sent or handled |
| `add_to_queue` from WebviewMessage union | No longer sent from webview (replaced by specific host messages) |
| `add_to_queue` from VALID_WEBVIEW_TYPES | Same |
| `queue-panel.css` import from styles.css | Classes never used by renderer (queue chips use `queue-chip-*` from layout.css) |
| Old `add_to_queue` host handler | Replaced by `remove_from_queue`, `edit_queue_item`, `reorder_queue`, `retry_queue_item`, `request_queue_state`, `resume_queue` |

## Testing Gaps Closed

- **SteerPromptHandler queue mode test** — updated to check `prompt_queued` + `queue_state` instead of old `add_to_queue` bounce
- **SteerPromptHandler queue-full error test** — new test for queue capacity rejection
- **Regression smoke tests** — updated "steer queue appends to per-tab queue" and "handleStreamEnd processes next queue item" to reflect queue unification

## Remaining Gaps (Future Work)

- **Queue auto-drain UI affordance after abort** — no "Resume queued" button yet (host supports `drainAfterAbort` flag, needs webview toggle or banner)
- **Queue depth limit enforcement in UI** — webview should show "Queue full" when host rejects enqueue
- **Integration tests for host queue drain** — would require mocking OpenCode server
- **Structural tests for new host message types** — `remove_from_queue`, `edit_queue_item`, etc.
- **Contextual shortcut teaching (NN/g "push revelation")** — one-time hints after first action (e.g., "Tip: Press Ctrl+1/2/3 to switch modes")
