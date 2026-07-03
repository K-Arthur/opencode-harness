# Changelog

All notable changes to the **OpenCode Harness** extension will be documented in this file.

> **OpenCode Harness** is an **independent, unofficial, beta** VS Code client
> for the [opencode](https://opencode.ai) CLI agent. It is **not developed by,
> affiliated with, or endorsed by the OpenCode team.** See
> [`docs/limitations.md`](docs/limitations.md) for SDK constraints and beta
> status.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note:** This changelog is maintained manually. When releasing a new version,
> move items from `[Unreleased]` to the new version section and update the date.
> Never leave features marked as "unreleased" after they are shipped.

## [Unreleased]

### Fixed — Context Usage Counter Cross-Tab Bleed

- **Multiple tabs showed identical context-usage figures**: `ContextMonitor`'s
  sessionless getters (`percent`, `tokensUsed`, `limit`) hold whichever session
  updated last, but `StreamCoordinator`'s stream-start/end boundary emits read
  them and stamped the result with the streaming tab's `sessionId`. The
  webview's higher-estimated-wins guard then let the busiest tab's count
  overwrite every other tab's persisted bar. Boundary emits now use the new
  `ContextMonitor.emitLatestForSession(tabId)`, which re-emits the tab's OWN
  stored snapshot (own tokens, own window, `source` preserved) and emits
  nothing when the tab has no recorded usage.
- **Bogus 100% despite auto-compaction at ≤80%**: `setTokenLimit(limit,
  sessionId)` also refreshed the shared sessionless default, so a session
  without its own resolved window computed `tokens_A / limit_B` against
  whichever tab's model resolved last — a ratio that clamps to 100%. The
  per-session branch no longer touches the shared default.
- **Auto-compaction gated on the wrong tab's usage**: `AutoCompactor` read the
  global `percent`/`tokensUsed`/`limit`, so a busy background tab could trigger
  or mask compaction of the active tab. It now gates on
  `getCurrentUsage(activeTab.id)` and does nothing when the active tab has no
  snapshot; the banner payload and the remind-later snooze baseline also use
  the tab's own figures.
- **Unattributed usage painted the viewed tab**: `ChatProvider` forwarded
  sessionless `context_usage` emits to the webview, whose handler falls back to
  the *active* session and persists the value. Sessionless emits are now
  dropped at the host with a debug log.
- **`get_context_usage` fallback used the sessionless window**: the
  no-usage-data branch now resolves `limitFor(targetId)`.
- **Compaction erased the session's context window**: `resetSession` dropped
  `limitBySession` too, leaving the next update to compute against
  `maxTokens: 0` ("set limit" flicker) until the model re-resolved. It now
  keeps the window; the new `clearSession` (called on session deletion) removes
  everything so the monitor's maps don't accumulate dead sessions.

### Fixed — Network Failure Handling

- **Stale Tier-B banners persist after reconnect (Issue 1)**: The host now
  posts `error_cleared` on `event_stream_reconnected` and `server_connected`
  so the webview dismisses stale disconnect banners. The webview
  `streamOrchestrator` wires `handleErrorCleared` → `applyErrorCleared` to
  clear the `ErrorStateStore`.
- **Disconnect error silently dropped when no active tab (Issue 2)**:
  `handleRequestError` in the webview no longer returns early when no
  streaming session can be resolved — it routes the error through the
  tier system (`routeErrorByTier`) with `sessionId = undefined` so a global
  banner shows.
- **Stuck streams after server disconnect (Issue 3)**: Added a 60s
  disconnect grace timeout (`DISCONNECT_GRACE_MS`) in `StreamCoordinator`.
  On `server_disconnected`, streaming tabs arm the timer instead of being
  immediately cleaned up. If the event stream reconnects within 60s,
  `reconcileAfterReconnect` cancels the timer and normal finalization takes
  over. If not, the timeout force-finalizes the stream with unresolved
  tools/subagents so the UI doesn't stay stuck with a live cursor.
- **Max-reconnect failure shows generic error (Issue 4)**: The host now
  detects "max reconnect attempts reached" and maps it to a structured
  `EVENT_STREAM_FAILED` error context with actionable guidance ("restart
  the OpenCode server, then reload the window"). The renderer labels the
  code "Event stream failed". `isEventStreamTransportError` excludes this
  terminal failure so streaming state is properly cleaned up.
- **Stale 90000ms literal in idle timeout log (Issue 5)**: The log message
  now interpolates `SseSubscriber.IDLE_WATCHDOG_TIMEOUT_MS` (300000ms)
  instead of a hardcoded 90000ms that was stale from a previous timeout
  value.
- **Heartbeat missed pings not surfaced to user (Issue 6)**:
  `HeartbeatService` now posts a soft `request_error` notice after 5+
  consecutive missed pings, informing the user the panel may be
  unresponsive and suggesting a window reload. Deduped per heartbeat
  session via `heartbeatNoticePosted` set.
- **PendingEventBuffer TTL expiry logs at warn level (Issue 7)**:
  Downgraded to `info` level — subagent sessions routinely exceed the 10s
  TTL, and the warn-level log was noise rather than a problem indicator.
- **Streaming state not cleaned up on event stream failure (Issue 8)**:
  The max-reconnect handler now explicitly calls `cleanupTab`,
  `setStreaming(false)`, and `clearCompletionTimeout` so the
  `StreamCoordinator`'s per-tab maps don't keep stale entries.

## [0.4.45] — 2026-07-02

### Fixed

- **Test suite blind spot — 174 deep-path TypeScript tests never ran**: `npm run
  test:unit` used `npx tsx --test src/**/*.test.ts` without quoting the glob.
  Shells without `globstar` (the default for `/bin/sh`, which npm uses to run
  scripts) expand `**` as a single directory level, so every test file inside
  `src/chat/handlers/`, `src/chat/webview/`, `src/chat/diff/`, and
  `src/session/eventHandlers/` was silently skipped. Fixed by quoting the
  pattern so Node 26's built-in glob engine handles the recursion:
  `'src/**/*.test.ts'`. Also added `'tests/unit/*.test.ts'` (five TypeScript
  behavioural tests for input handlers, send logic, webview helpers, etc.) that
  were likewise missing from the pipeline.
- **Test harness drift in `tests/unit/*.test.ts`** — three divergences
  accumulated while these files were not running:
  - `input-handlers-behavioral`: max-height cap expectation updated 200px → 160px
    to match the production constant in `inputHandlers.ts`.
  - `send-logic-behavioral`: `els.welcomeView` added to the JSDOM fixture —
    `sendMessage.ts` accesses it when creating a tab panel that doesn't yet
    exist in the DOM.
  - `send-logic-behavioral`: `sessions: {}` added to the `getState` overrides in
    both model-validation tests — the `isServerStreaming` helper accesses
    `stateManager.getState().sessions[id]` unconditionally; a partial override
    that omitted `sessions` threw `TypeError: Cannot read properties of undefined
    (reading 's1')` before reaching the model-check assertion.
  - `send-logic-behavioral`: `attachmentManager.getContextItems / isActiveFileIncluded
    / getActiveFile / getActiveFileSelection / clearSentContextItems` added to the
    test harness — `sendMessage.ts` calls these on every send path, so the harness
    was missing required stubs.

## [0.4.44] — 2026-07-02

### Fixed

- **Finalize deadlock — streams stuck "running" forever**: the G5 quiet-period
  defer timer re-entered the public `maybeFinalizeStream`, which found its own
  still-pending promise in `finalizePromises` and chained onto it — a circular
  wait. The log signature was "deferring status finalize …" followed by silence
  while the tab replayed an empty live stream indefinitely. The timer now calls
  the internal `runMaybeFinalizeStream` directly, and cancelled defers settle
  their promise (new `pendingStatusFinalizeResolvers`) so a cancelled-but-
  unsettled defer can no longer block every future finalize for the tab.
- **Output replaced by a previous turn's message at stream end**: the server's
  `session.messages` endpoint returns NEWEST-first with `limit` but oldest-first
  without. `fetchFinalBlocks`' `reverse().find()` picked the oldest assistant in
  the window — the previous turn — overwriting just-streamed output with stale
  content. New order-independent `pickLatestAssistant` (selects by
  `time.created`, id tiebreak) applied to `fetchFinalBlocks`,
  `reconcileAfterReconnect`, and the run-status probe; the latter two also
  converted from full-history fetches to the O(1) `limit=5` path.
- **Stream-start focus stealing**: the webview force-switched the active tab to
  any session that started or replayed a stream — the source of "generation
  appearing before the prompt" and tabs yanking away mid-read. Streams now
  render into their own background tab; switching only happens when nothing
  valid is in focus (v0.4.36 no-auto-switch policy).
- **"Send Now" on queued prompts only worked for the first item**: any other
  item was silently ignored by the host while the webview removed it locally —
  the prompt then ghost-sent on the next drain or reappeared after reload. The
  host now promotes the requested item via `HostPromptQueue.moveToFront`; on a
  busy tab it becomes next-to-drain (instead of failing against the stream
  slot), on an idle tab it sends immediately. Every path re-posts `queue_state`.
- **Keyboard queue reorder silently reverted**: Alt+Arrow/Home/End posted
  `reorder_queue` with `fromIndex === toIndex` (both computed after the local
  move) — a host no-op, so the order snapped back on the next sync. Real
  indices are now sent.
- **Stale queue chips after drain**: the `queue_state` empty branch queried a
  non-existent element id (`tab-panel-*`; panels are `panel-*`), leaving
  drained chips in the input area; background sessions could also render into
  the shared input area. Queue state now syncs always but renders only for the
  active session.
- **Paused queue dead-end**: after an abort (with `queue.drainAfterAbort`
  false) or a reload, queued prompts sat forever under a hint claiming they
  "auto-send". Idle sessions now show "N queued — paused" with a **Send next**
  button (posts the existing `resume_queue` host command, which previously had
  no UI trigger).

### Internal

- Repaired stale deep-path tests (`SteerPromptHandler`, `attachmentStorage`,
  `streamOrchestrator` harness) that never run under `npm run test` because the
  `src/**/*.test.ts` glob does not recurse in `sh`. New test suites:
  `StreamCoordinator.finalizeIntegrity.test.ts`, `HostPromptQueue.sendNow.test.ts`,
  `queueRenderer.test.ts` (JSDOM behavioral).

## [0.4.42] — 2026-07-01

### Added

- **Elapsed time in streaming indicator**: The "Thinking…" / "Running tool…"
  indicator now shows elapsed seconds (`• 12s`) that tick live during generation.
  The timer starts when `handleStreamStart` fires and clears automatically when
  the indicator is hidden — no StreamState coupling required.
- **Generation outcome notifications**: Completion and failure events now fire
  both a VS Code native notification (when the webview is hidden) and an
  in-webview toast (always, except for intentional user aborts).
  - Success: green 3-second auto-dismiss toast; info notification with session name.
  - Failure: red persistent toast with dismiss button and failure reason label
    ("response timeout", "stream timeout", "an error occurred"); VS Code error
    notification with session name.
- **`EventDeduplicator`** (Fix 4): TTL-based dedup that survives SSE reconnects.
  Server-replayed events after reconnect no longer cause duplicate state updates.
  The deduplicator is NOT reset on reconnect (unlike `EventNormalizer`) so it
  catches replayed event IDs across connection boundaries.
- **`pendingStream` restoration state** (Fix 2): `TabManager.captureStreamingSnapshot`
  now persists tabs in the finalizing phase (`waitingForCompletion === true` but
  `isStreaming === false`). On VS Code reload, `getPendingStreamTabs()` includes
  these tabs in the `reconcileAfterReconnect` candidate set, so runs that
  completed during a reload have their dropped `stream_end` correctly emitted.

### Fixed

- **Status-triggered premature finalization** (Fix 1 — G5 race): The 1500ms
  quiet-period guard was raced by a tool event arriving at 1501ms, causing
  completed sessions to show as "running" and running sessions as "done".
  Replaced with an activity-sequence microtask guard: a sequence number is
  bumped by every activity event; `runMaybeFinalizeStream` captures the sequence
  before scheduling the finalize, then checks it in a `queueMicrotask` — any
  interleaved activity cancels the finalize atomically.
- **Second concurrent finalize trigger lost** (Fix 3): When two finalize triggers
  fired concurrently, the second returned the same in-flight promise and its
  result was silently lost. Now the second trigger chains `.then()` on the
  in-flight promise and re-runs finalization if the first attempt returned `false`.
- **O(n) finalization fetch** (Fix 5): `getSessionMessages` fetched the full
  session history on every stream completion, causing visible lag for long sessions.
  Replaced with `getMessages(limit=5)` — O(1) network I/O regardless of session
  length.
- **GC pressure on heartbeat fingerprint** (Fix 7): `JSON.stringify(slim)` was
  called on the full activity snapshot every heartbeat tick. Replaced with a
  field-level hash string joining `runId`, tool `id:status:updatedAt`, and
  subagent `id:status:updatedAt` — much cheaper to compute and GC-friendly.
- **Idle watchdog too short for thinking models** (Fix 6): The 90-second idle
  watchdog fired on DeepSeek-R1/Qwen-QwQ long reasoning silences, triggering
  spurious reconnects. Raised to 300 seconds via `IDLE_WATCHDOG_TIMEOUT_MS`.

## [0.4.40] — 2026-06-30

### Added

- **Automatic provider switching on quota exhaustion**: When a provider's quota
  is exhausted (HTTP 402) and the user clicks "Switch Provider", the webview
  now auto-selects a fallback model from a different provider, updates the
  session model, and triggers a seamless retry via `regenerate_with_model`.
  A system notification shows "Auto-switched from {provider} to {model}."
  Fallback selection prioritizes favorites, then enabled models from non-exhausted
  providers (alphabetical by provider then model ID).
  ([`f552db9`](https://github.com/K-Arthur/opencode-harness/commit/f552db9))
- **Clickable markdown file-path links**: File paths rendered in markdown code
  fences (e.g. `` `src/foo.ts` ``) are now clickable — clicking opens the file
  in the VS Code editor via `opencode-diff://` content provider.
  ([`896c5bb`](https://github.com/K-Arthur/opencode-harness/commit/896c5bb))

### Fixed

- **Provider errors carry structured context**: `provider_error` messages now
  include the provider ID in their error context, enabling richer action
  suggestions and integration with the auto-provider-switching feature.
  Previously they passed only a bare string and lost the provider identity.
  ([`bf602e8`](https://github.com/K-Arthur/opencode-harness/commit/bf602e8))
- **Error dedup uses `correlationId`**: Duplicate error cards are now coalesced
  using `correlationId` (more precise) in addition to user-message text,
  preventing two distinct errors with the same display text from being
  incorrectly suppressed. `createErrorBlock` now accepts and stores
  `correlationId`.
  ([`bf602e8`](https://github.com/K-Arthur/opencode-harness/commit/bf602e8))
- **Tier A/B error banner CTAs reach the host**: "Switch Provider", "Retry",
  and "Upgrade Plan" buttons on hard-block (Tier A) and infrastructure (Tier B)
  error banners were silently dropped as "Unknown webview message type:
  error_action". Added a handler in `WebviewEventRouter` that dispatches
  retry/switch_model/upgrade_plan to the existing host flows.
  ([`361b119`](https://github.com/K-Arthur/opencode-harness/commit/361b119))
- **Provider ID threaded through error wire boundary**: The provider ID
  (e.g. `"openai"`) is now carried through the entire error pipeline —
  `ErrorContext` → `BaseErrorPayload` → `toWebviewErrorPayload` →
  `normalizeIncomingError` → `toErrorContext` — so the webview can identify
  which provider caused the error. Previously it was lost during serialization.
  ([`361b119`](https://github.com/K-Arthur/opencode-harness/commit/361b119))
- **`ImageDecodeError` mapping and pre-validation**: Images attached to prompts
  are now pre-validated on the client side with magic-byte checks. SVG files
  are detected and excluded from image processing. Proper error mapping with
  user-facing messages for unsupported or corrupted image formats.
  ([`33b8923`](https://github.com/K-Arthur/opencode-harness/commit/33b8923))
- **SVG restored as document attachment**: `image/svg+xml` files are now
  treated as document attachments (injected as XML text) instead of being
  rejected as unsupported images. This restores the ability to attach SVG icons
  and diagrams to prompts.
  ([`c2e1639`](https://github.com/K-Arthur/opencode-harness/commit/c2e1639))
- **Queued/interrupted prompts no longer vanish**: Prompts queued via the steer
  queue, or interrupted mid-stream before any output arrived, were silently
  removed from the conversation history. They now remain in the conversation as
  user messages so the user can re-send or edit them.
  ([`8bf74eb`](https://github.com/K-Arthur/opencode-harness/commit/8bf74eb))
- **Mode persistence: five root causes fixed**:
  1. `SessionState.pendingMode` was not persisted on tab switch; now stored via
     `setSessionMode` before switching.
  2. `init_state` for resumed sessions used `model` or `"build"` hardcoded;
     now reads `pendingMode` for the correct mode.
  3. `onModeChanged` backstop added to `SessionStore` — fires when the server
     pushes a mode update, ensuring the webview stays in sync.
  4. `fork_created` session messages now carry the parent session's `mode`
     field, so forked conversations inherit the correct mode.
  5. `streamOrchestrator`'s auto-created fallback sessions used hardcoded
     `"build"`; now reads `tab.mode` or `stateManager.getPendingMode()`.
  ([`000f2e5`](https://github.com/K-Arthur/opencode-harness/commit/000f2e5),
  [`c432142`](https://github.com/K-Arthur/opencode-harness/commit/c432142),
  [`8d55f30`](https://github.com/K-Arthur/opencode-harness/commit/8d55f30))
- **Oversized `workspace_files` payload drop**: Large workspaces (>256KB file
  list) were silently dropped by the `HostMessageBatcher` size guard. Added
  `workspace_files` to `IMMEDIATE_TYPES` so it bypasses the guard — the webview
  needs the full file list for `@file:` mentions.
- **`PendingEventBuffer` repeated drops for child sessions**: Once a session's
  TTL expired without a tab mapping, new events were re-buffered and re-dropped
  on every event, producing repeated warnings. Added an `expiredSessions`
  denylist — new events for expired sessions are silently discarded. `drain()`
  clears the denylist so a later-discovered session can buffer again.
- **`run_activity_update` duplicate drops**: Every heartbeat/tool/subagent
  event triggered a redundant `postRunActivitySnapshot` with an identical
  payload, flooding the `HostMessageBatcher`'s dedup guard. Added a JSON
  fingerprint dirty-check to skip posting when the slim snapshot hasn't changed.
- **Question bar resurrection on tab switch**: Answered questions were re-added
  to the question bar by `repopulateFromMessages` on every tab switch, causing
  the bar to pop back up when the user closed it. Answered questions are already
  visible in the transcript — the bar now only shows interactive (unanswered)
  questions.
- **Sessionless `file_edited` cross-session contamination**: When multiple
  sessions were streaming, sessionless `file_edited` events were dropped
  unconditionally. Now the active tab is preferred if it's one of the streaming
  tabs. If the active tab isn't streaming, the event is dropped rather than
  guessed.
- **Stuck `maybeFinalizeStream` after grace timeout**:
  `markUnresolvedPendingToolCalls` marked tools as unresolved but didn't remove
  them from `activeToolCallIds`, so the stream never finalized. Unresolved tool
  IDs are now removed from `activeToolCallIds`.
- **Live-stream replay deduplication**: Concurrent `handleStreamStart` calls
  or repeated `streaming_state` pushes could replay the same live stream
  multiple times, duplicating output and corrupting tool state. Added
  `replayDedup` Map keyed by message ID — replays for an already-seen message
  are skipped. The dedup is cleared on `webview_ready` and on visibility
  changes so a genuine reconnection replays correctly.
  ([`2622a9a`](https://github.com/K-Arthur/opencode-harness/commit/2622a9a),
  [`f85299a`](https://github.com/K-Arthur/opencode-harness/commit/f85299a),
  [`fce2830`](https://github.com/K-Arthur/opencode-harness/commit/fce2830))
- **`init_state` no longer follows host active session when prior tab is lost**:
  When the webview reloaded and the host pushed its active session, the
  `init_state` handler would auto-switch to it even if the user was viewing a
  different session before the reload. Now it preserves the user's last tab
  from local state.
  ([`74aba19`](https://github.com/K-Arthur/opencode-harness/commit/74aba19))
- **Question-bar session attribution hardened**: The question bar's
  `getQuestionItem` now correctly maps questions to sessions by server
  session ID, preventing questions from one session appearing in another.
  The "stop recovery auto-switch" guard prevents a background session's
  recovery from stealing focus.
  ([`93ded58`](https://github.com/K-Arthur/opencode-harness/commit/93ded58))

## [0.4.36] — 2026-06-29

### Fixed

- **Tab auto-switching disabled entirely**: `shouldForceFocusOnSend` and
  `shouldHonorActiveSessionChange` no longer yank focus to a different tab
  during sends or host-driven `active_session_changed` events. Users must
  explicitly click tabs to switch. The only exceptions are no-ops (already
  on the target) and safety cases (welcome screen, invalid current tab).
- **Prompt character limit raised from 50,000 to 1,000,000**: The hardcoded
  50k limit rejected legitimate long prompts with a generic "invalid payload"
  error. The new limit accommodates large context windows, and the error
  message now suggests using file attachments for very large content.
- **Cold-start health timeout raised from 10s to 30s**: The OpenCode CLI
  (v1.17.8) sometimes exceeded the 10-second health check window on slower
  machines or large workspaces, leaving the extension in a broken state.
  The timeout is now 30 seconds, giving the server ample time to start.
- **Scroll auto-anchor race condition during streaming**: The
  `IntersectionObserver` sentinel and `onScroll` handler both set
  `anchored=false` when new content pushed the sentinel below the viewport
  during streaming — before the programmatic scroll could catch up. This
  caused auto-scroll to stop mid-stream ("scroll resets on new content")
  and the view to jump when switching tabs. Both handlers now only set
  `anchored=true` when at the bottom; the `onWheel`/`onTouchMove` handlers
  remain responsible for detecting user-initiated scroll-up.
- **Edit card "Open file" button broken after scroll**: The
  `VirtualMessageList` prune/restore cycle passed a no-op `postMessage` to
  `renderMessage` when restoring pruned messages from placeholders. After
  scrolling caused a message with an edit card to be pruned and then
  restored, the "Open file" button's click handler was bound to the no-op
  instead of the real `vscode.postMessage`. The real `postMessage` is now
  threaded through the `VirtualMessageList` constructor and used during
  restoration.
- **Scroll jumps on virtual list restore**: When a pruned message was
  restored from a placeholder, the restored element's height often differed
  from the placeholder's fixed height, causing the viewport to jump. The
  `restoreOne` method now measures the height difference and adjusts
  `scrollTop` to keep the user's viewport stable.

## [0.4.34] — 2026-06-29

### Added

- **Theme customizer rework**: Complete redesign of the `Customize theme` modal
  with a modular, accessible architecture. The modal now uses the native
  `<dialog>` element for focus trapping, ESC handling, and backdrop; preset
  cards are terminal-window thumbnails with slim swatch strips and
  `role="radiogroup"` roving tabindex keyboard navigation; color override
  sections use native `<details>` accordion (no CSS Grid animation); a live
  preview strip shows message bubbles and a code block with the current overrides.
  New modules: `themeOrchestrator`, `themeModal`, `presetGrid`, `cliSearch`,
  `colorSections`, `previewStrip`, `themeState`, `themeUtils`, `themeBridge`,
  `themeConstants`. All new modules have co-located tests (60+ new test cases).
  `RESEARCH.md` documents findings from VS Code docs, WAI-ARIA APG, MDN, and
  accessibility blogs.
- **Hybrid workbench theme toggle**: New `opencode.theme.switchWorkbenchTheme`
  setting (default `false`) controls whether switching the OpenCode chat preset
  also switches the VS Code workbench color theme. When enabled,
  `ThemeController` calls `themeManager.activateTheme()` to apply the matching
  VS Code workbench theme. A checkbox toggle labeled "Also switch VS Code theme"
  in the theme customizer modal sends `update_switch_workbench_theme` messages
  to the host. When disabled, only the chat webview appearance changes.

### Fixed

- **Session deletion: server-side delete never fired.** `delete_session`
  captured `cliSessionId` AFTER `sessionStore.delete()`, so it was always
  `undefined`. The server session was never deleted, only the local copy.
  Fix: capture `cliId` before delete and call `sessionManager.deleteSession`
  directly. Also explicitly close the tab before deleting so it doesn't
  depend on `onDidChangeSession` handler registration order.
- **Session deletion: orphaned tab after `delete_server_session`.** The
  handler deleted the local store entry but never called `closeTab()`,
  leaving an orphaned tab pointing at a non-existent session. Fix: close
  the tab before deleting from the store.
- **Session history: cross-workspace sessions silently pruned.**
  `chooseHistorySession` filtered server sessions by workspace BEFORE
  passing to `importServerSessions`. The prune step inside
  `importServerSessions` deleted any `needsBackfill` session not in the
  passed list, nuking sessions from other workspaces. Fix: pass ALL
  non-subagent sessions to `importServerSessions`, filter for display only.
- **Session history: prune on empty server list.** When the server returned
  0 sessions (fresh server, different workspace, transient issue), the
  prune step deleted all cached `needsBackfill` sessions. Fix: guard the
  prune loop with `serverSessions.length > 0`.
- **Session history: path normalization.** `isInCurrentWorkspace` used
  exact string match. Symlinks, trailing slashes, and relative segments
  caused sessions to be filtered out. Fix: use `path.resolve()` on both
  paths. Applied to `list_server_sessions` `isCurrentWorkspace` flag and
  the display filter in `chooseHistorySession`.
- **Load more messages: wrong slicing in server fallback.** After
  refreshing from server, `request_more_messages` sliced from `newStart`
  to the end of the array instead of to `beforeIndex`, duplicating
  messages the user already had. Fix: slice from `newStart` to
  `min(beforeIndex, refreshed.messages.length)`.
- **Archive: now syncs to server.** Archiving was local-only. The v2 SDK
  supports server-side archiving via `session.update({ time: { archived } })`.
  Added `SessionClient.archiveSession()`, wired `archive_session` and new
  `unarchive_session` handlers to propagate to the server. The
  `session.updated` SSE event now syncs archive state back locally.
- **Duplicate fallback finalization log.** Both `session_status` and
  `server_status` handlers logged "triggering fallback finalization"
  before calling `maybeFinalizeStream`, which deduplicates via
  `pendingStatusFinalizeTimers`. Moved the log inside
  `maybeFinalizeStream` so it fires only once per tab.
- **Missing webview message validators.** Added validators for 20 message
  types that were logging "has no validator" warnings: `get_voice_settings`,
  `request_queue_state`, `webview_ready`, `list_commands`, `get_models`,
  `init_ack`, `list_providers`, `panel_visibility_state`,
  `request_state_sync`, `get_theme_config`, `list_sessions`,
  `list_server_sessions`, `get_todos`, `get_changed_files`,
  `probe_run_status`, `resume_session`, `create_tab`, `switch_tab`,
  `webview_log`, `unarchive_session`.
- **Oversized `run_activity_update` payloads silently dropped.** The
  `RunActivitySnapshot` included `tool.input`, `tool.result` (full bash/file
  output, can be 500KB+), and `subagent.inputPrompt` (full prompt text) —
  fields the webview never reads. The serialized payload exceeded the
  `HostMessageBatcher`'s 256KB `maxPayloadBytes` limit and was silently
  dropped on every tick, so the webview never saw any run activity updates.
  Fix: `postRunActivitySnapshot` now strips those fields before posting.
- **Remaining missing webview message validators.** Added validators for
  ~75 additional message types that were logging "has no validator"
  warnings: `close_tab`, `stream_ack`, `get_subagent_activities`,
  `setup_voice_input`, `question_answer`, `set_instructions`,
  `abort`, `retry_stream`, `resume_stream`, `new_session`, `open_settings`,
  `compact_session`, `export_chat`, `get_skills`, `revert_message`,
  `revert_hunk`, `attach_image`, `reorder_queue`, and many more. Each
  uses `() => true` for no-payload types or `requiredStringValidator`
  for types with required fields.
- **Session history picker now shows all workspaces.** The
  `chooseHistorySession` command filtered displayed sessions to the
  current workspace only, hiding sessions created in other workspaces.
  Fix: removed the workspace filter; all sessions are now shown.
  Cross-workspace sessions are badged with `📁 folder-name` in the
  detail line for identification.
- **Tab close not firing on SVG clicks**: `tabs.ts` used
  `target.classList.contains("tab-close")` which missed clicks on the inner
  SVG `<path>`. Fixed by using `target.closest(".tab-close")` so any descendant
  of `.tab-close` triggers the close callback.
- **Generic "subagent" titles ignoring task description**: When the agent name
  was the generic "subagent" fallback, the activity panel and tool cards showed
  the useless literal "subagent" instead of the task description. Added shared
  `resolveSubagentDisplayName` / `resolveSubagentActivityName` helpers in
  `toolClassifier.ts`; both `subagentCard.ts` and `subagentsModule.ts` now use
  them. The card title also drops the noisy `Subagent: ` prefix when the name
  is already descriptive.
- **Stale `isLive` flag causing running/done status drift**: The
  `{...existing, ...incoming}` merge preserved a stale `isLive=true` from the
  previous running state when the incoming message omitted `isLive`. Added
  `computeIsLive` and `recomputeActivityLiveness` helpers in
  `subagentReconciler.ts`; both `reconcileSubagentStatuses` and
  `mergeSubagentActivities` now recompute `isLive` from the normalized status
  after every merge. `completedAt` is also set on terminal transitions.
- **Theme customizer blinking**: Two causes were fixed. (1) The CSS used
  `.theme-accordion--open` to animate the accordion, but the JavaScript only
  toggled the native `<details>` `open` attribute, so the CSS Grid animation
  (`grid-template-rows: 0fr → 1fr`) conflicted with the browser's native
  `<details>` rendering. Fixed by switching the CSS selectors to `details[open]`
  and then removing the CSS Grid animation entirely, letting the native
  `<details>` element handle open/close. (2) `presetGrid.setSelected()` called
  the same `selectPreset()` function used for user clicks, which fired
  `onSelect` and sent `update_theme_config` back to the host. During hydration
  the host responded with another `theme_config`, creating a webview-host
  message loop. Fixed by splitting the selection into `updateSelection()`
  (programmatic) and `selectPreset()` (user-initiated), so `setSelected()` no
  longer fires the callback.
- **CSS hardcoding audit and fixes**: Created
  `scripts/check-css-hardcoding.mjs` to detect hardcoded hex colors, rgba/hsl
  values, and px values outside design tokens. Fixed remaining hardcoded values
  in theme customizer (close button size, color picker dimensions, touch target
  sizes now use `--size-target-*` tokens), context usage bar (`min-width` now
  derives from `--ctx-track-width`), and question bar (hardcoded
  `rgba(0,120,212,...)` replaced with `--oc-accent-subtle` /
  `--oc-accent-border` / `color-mix`).
- **High-contrast mode visual noise**: Added `.vscode-high-contrast` /
  `.vscode-high-contrast-light` overrides in theme customizer CSS to remove
  decorative borders (preset card titlebar, preview strip, color picker) and
  reduce border weight on structural elements (dialog, header, actions). This
  eliminates the overstated yellow/red lines that appeared when `--oc-border`
  became a high-contrast color.
- **Light-mode theme tokens staying dark**: All CSS files now use
  `var(--oc-*, var(--vscode-*))` ordering — OpenCode tokens are primary, VS
  Code native theme variables are fallbacks. Previously, many CSS rules used
  `--vscode-*` as primary, causing the chat webview to stay dark when the
  OpenCode preset was set to light. Flipped token priority across 11 CSS
  files: `tokens.css`, `theme-customizer.css`, `blocks.css`, `layout.css`,
  `components.css`, `messages.css`, `terminal.css`, `question-bar.css`,
  `voice-input.css`, `dragDrop.css`. Also fixed `.vscode-light` overrides in
  `tokens.css` to use OC tokens as primary for `--bg-code`, `--user-message-bg`,
  and `--oc-tool-bg`.
- **Missing theme tokens**: Expanded `OpencodeTheme` interface and
  `CSS_VAR_MAP` with `listHoverBg`, `buttonSecondaryBg`, `buttonSecondaryHover`,
  `buttonSecondaryFg`, `listActiveBg`, `listActiveFg`, and `userMessageBg`.
  Updated all six built-in presets (`cli-default`, `light`, `dark`,
  `high-contrast`, `high-contrast-dark`, `high-contrast-light`) with values
  for the new tokens.
- **Theme update timing bug**: `ThemeController.handleUpdateThemeConfig` now
  calls `loadConfig()` and `emitUpdate()` after writing the theme config,
  ensuring the webview receives the updated CSS variables immediately.

### Changed

- **Theme customizer modal is now built dynamically**: The static
  `#theme-customizer-panel` markup in `index.html` has been removed. The
  orchestrator builds the `<dialog>` DOM dynamically and appends it to
  `document.body`. Old element refs in `dom.ts` have been removed. The legacy
  `themeCustomizer.ts` is now a thin re-export shim.
- **Theme customizer CSS**: New `theme-customizer.css` imported under
  `@layer components` in `styles.css`. Uses `:focus-visible` only (never
  `:focus`), dashed focus rings, `prefers-reduced-motion` overrides, and
  44×44px minimum tap targets on touch devices.
- **Theme customizer styling consistency**: The live preview strip now uses the
  correct message role tokens (`--oc-user-msg-bg`, `--oc-user-msg-fg`,
  `--oc-assistant-msg-bg`, `--oc-assistant-msg-fg`) instead of generic
  foreground colors, and the fake code lines now use the real syntax color
  tokens (`--oc-syn-keyword`, `--oc-syn-string`, `--oc-syn-function`). Removed
  unused component tokens (`--theme-customizer-input-height`,
  `--theme-customizer-header-border`) and switched the modal shadow to the
  shared `var(--shadow-xl)` token. The native `<details>` marker is now hidden
  so only the custom chevron is visible.

<!-- MAINTENANCE NOTE: Keep this section empty unless it describes work that has
     NOT shipped in any version bump. When `npm version` / `npm run
     reinstall` bumps the version, move all accumulated entries below into a
     new `## [x.y.z] - yyyy-mm-dd` section. Never leave shipped work under
     [Unreleased] — that creates documentation drift. See the release
     workflow in docs/development/rebuild-and-reinstall.md. -->

## [0.4.29] - 2026-06-28

### Fixed

- **Tool card buttons broken for absolute paths** — 7 handlers used
  `vscode.Uri.joinPath(vscode.Uri.file(wsRoot), filePath)` which assumes
  `filePath` is relative. When `filePath` is absolute (common from opencode
  tools), this creates a broken path like `/wsRoot//absolute/path`, causing
  the following buttons to fail: Open file, Reveal in Explorer, Reject hunk,
  Revert hunk, Undo file, Reject diff, Revert diff, and Get file diff. Fix:
  add `resolveWorkspaceUri(filePath, wsRoot)` helper that uses absolute paths
  directly (with realpath resolution) and joins relative paths with wsRoot.
- **`reveal_in_explorer` and `open_folder` broken for relative paths** — these
  handlers used `vscode.Uri.file(rawPath)` directly, which only works for
  absolute paths. Fix: resolve relative paths against the workspace root.
- **`get_file_diff` not cross-platform** — used `path.startsWith("/")` instead
  of `path.isAbsolute()` to detect absolute paths. Fix: use `path.isAbsolute()`
  via the new `resolveWorkspaceUri` helper.

## [0.4.28] - 2026-06-28

### Fixed

- **Recovery auto-send deduplication strengthened** — the
  `expired_question_recovery_failed` handler's 100ms guard window was too
  short: the host sends multiple recovery messages 400-900ms apart, each
  pasting the answer into the prompt input and calling `sendMessage()`,
  which routed to `sendSteerPrompt()` in queue mode, enqueuing dozens of
  duplicate prompts. Fix: track both the session ID and a hash of the answer
  text (`sessionId:answerLength:answerPrefix`) with a 5-second secondary
  guard window to deduplicate all recovery messages for the same answer.
- **Session close cleanup** — `closeTab` now clears `recoverySendInFlight`
  entries for the closed tab to prevent stale recovery guards from blocking
  future legitimate recoveries for a re-used session ID.
- **Lint warning** — `addDocumentAttachment`'s unused `filename` parameter
  prefixed with underscore to satisfy the `/^_/u` linter rule.

## [0.4.27] - 2026-06-28

### Fixed

- **Document attachments not showing filename** — document attachment chips
  only showed an icon, making it impossible to identify which file was which
  when multiple were attached. Fix: add a filename label next to the icon in
  `.attachment-chip--document` chips, with ellipsis truncation at 120px.
- **`'media type: text/markdown' functionality not supported`** — the opencode
  server only supports image/* media types as file attachments. Document files
  (text/markdown, text/plain, application/pdf, etc.) were being sent as base64
  file parts, which the server rejected. Fix: decode document attachments in the
  webview and inject their content into the prompt text as fenced code blocks.
  Only image attachments are now sent as base64 to the server. Updated the
  host-side `ATTACHMENT_MIME_ALLOWLIST` to remove non-image MIME types.
- **Question bar answers sent multiple times** — the `submitAllAnswers`
  function had no re-entry guard, so duplicate click listeners (from webview
  re-init) or rapid double-clicks could submit the same answer twice. Fix: add
  a `_submitting` flag with try/finally to prevent re-entry.
- **Question bar answers pasted into prompt input and auto-sent multiple times**
  — the `expired_question_recovery_failed` handler pasted the answer text into
  the main prompt input and auto-sent it, but the host could send this message
  multiple times (expired path + resume-in-flight path + resume-failed path),
  causing duplicate prompts and queued messages. Fix: add a
  `recoverySendInFlight` Set to guard against duplicate recovery auto-sends.
- **`initQuestionBar` accumulating duplicate event listeners** — calling
  `initQuestionBar` multiple times (e.g., on webview re-init) added a new click
  listener to the submit button each time without removing old ones. Fix:
  clone the submit button on re-init to drop old listeners, and add an
  `_initialized` flag guard.

## [0.4.26] - 2026-06-28

### Fixed

- **Diff editor fails for out-of-workspace files** — `getBaselineContent` passed
  absolute paths to `git show` without converting to workspace-relative, causing
  diffs to fail for files outside the session workspace. Fix: convert absolute
  paths to workspace-relative before `git show`; skip git strategies entirely for
  out-of-workspace files (treat as new files with empty baseline).
- **Drag-drop overlay persists after file added** — `stopPropagation()` on the
  input area's dragover/dragleave/drop handlers prevented the global drop handler
  from hiding the overlay. Fix: remove `stopPropagation()` from input area
  handlers; add `inputArea.contains(e.target)` check in the global drop handler
  to skip double-processing while still hiding the overlay.
- **Question bar stacks all questions instead of one-by-one** — multiple
  simultaneous questions rendered all at once instead of showing one at a time.
  Fix: add `refreshQuestionVisibility()` that hides queued questions via
  `.question-bar-item--queued { display: none }` and reveals the next one when
  the current question is answered.
- **Question bar free-text answers not submitted** — when the "Ready" button was
  used, free-text answers were dropped because the `useReady` branch skipped the
  free-text append. Fix: always append free-text as a final answer group when it
  has content, regardless of `cardReady` state.
- **Document attachments show as broken image thumbnails** — the CSS
  `:not(:has(img))` selector for document chip styling was unreliable. Fix:
  use explicit `.attachment-chip--image` / `.attachment-chip--document` classes
  instead of `:has()`; also fix `attachFileBlob` to call
  `addDocumentAttachment` instead of `addImageAttachment` so context items are
  typed correctly.
- **Attachment chip emoji and oversized layout** — the `📎` emoji in the
  `::after` pseudo-element violated the zero-emoji policy and the 56px chip size
  was too large. Fix: replace with SVG data-URI paperclip; reduce to 48px via
  `--attachment-size` token; use token-driven styling throughout.
- **Scroll position lost after history condensation on long sessions** — when
  a session had > 140 messages, the chunked loader restored scroll position
  after 20 messages rendered, but `applyHistoryCondensation` then replaced
  groups of 20 old messages with ~30px summary buttons, shrinking
  `scrollHeight` by thousands of pixels. The browser clamped `scrollTop` to
  the new (smaller) `scrollHeight`, dumping the user at the bottom. Fix:
  re-restore scroll position in `onAllDone` after condensation, on both the
  `resume_session` and `init_state` load paths.
- **Scroll-save timer leak on tab close** — `closeTab` disposed the scroll
  anchor and virtual list but did not clear the pending `scrollSaveTimers`
  entry. The timer callback safely no-op'd (deleted session), but the `Map`
  entry leaked one timer per closed tab. Fix: clear the timer in `closeTab`.
- **"Load earlier" during streaming could yank scroll to bottom** — if a
  streaming chunk's `scrollIfAnchored()` fired in the same frame as
  `prependMessagesPreservingScroll`, it could undo the scroll compensation
  and jump the user back to the bottom. Fix: call `pauseForReflow(200)` on
  the scroll anchor before prepending, so `scrollIfAnchored` is a no-op
  during the prepend window. The sentinel/scroll listeners correctly set
  `anchored=false` after the prepend since the user is no longer at the
  bottom.

### Added

- **Copy file path button in changed files dropdown** — each file row now has a
  copy-path button that copies the full file path to the clipboard via
  `navigator.clipboard.writeText`, with a brief "Copied!" confirmation. Especially
  useful for out-of-workspace files that aren't tied to the session.
- **UI Methodology Standards codified** — `CONVENTIONS.md` now includes a
  comprehensive "UI Methodology Standards" section covering design-system tokens
  first, zero emoji policy, WCAG 2.2 AA minimum, icon usage standards, TDD-first,
  and cascade review checkpoints. Cross-references added to `AGENTS.md`,
  `CLAUDE.md`, `GEMINI.md`, and `.windsurfrules`.
- **INFO_SVG icon** — new icon added to `icons.ts` for info-severity error tiers.

### Changed

- **Zero emoji policy enforced** — all Unicode glyphs and Codicon font references
  replaced with inline SVG icons from `icons.ts`: `📎` → SVG paperclip data-URI,
  `×`/`&times;` → `REMOVE_SVG`, `✗` → `STATE_FAILED_SVG`, `⏳` →
  `STATE_TIMEOUT_SVG`, `✕` → `STATE_CANCELLED_SVG`, `✓` → `STATE_SUCCESS_SVG` /
  `CHECK_SVG`, `◉` → `STATE_RUNNING_SVG`, `↓` → `CHEVRON_DOWN_SVG`, `★`/`☆` →
  `PIN_FILLED_SVG` / `PIN_SVG`, `•` → CSS-drawn dot, `codicon-add` → inline SVG
  plus, `codicon-sync` → `SPINNER_SVG`.
- **Attachment chip tokens** — new `--attachment-size`, `--attachment-icon-size`,
  and `--attachment-remove-size` tokens in `tokens.css` for consistent sizing.

## [0.4.24] - 2026-06-27

### Fixed

- **Question-answer recovery crash and empty bar persistence** — when a server
  side question expired or failed, the webview's "Question from model" bar
  crashed on questions with empty `groups` (`Cannot read properties of undefined
  (reading 'header')`). The crash blocked the `expired_question_recovery_failed`
  auto-send path, so the frontend showed no confirmation and the answer seemed
  to vanish. Fixed `questionBar.ts` to guard missing groups, render the question
  text from `block.text`, skip empty tool-start payloads, and repopulate answered
  transcript records as read-only cards. Fixed `QuestionHandler.ts` to parse
  flat `question`/`prompt`/`message`/`text` fields when the server does not send a
  `questions` array. Updated stale structural tests to point at the files where
  the logic now lives.

- **Added providers not showing until extension restart** — when a user
  connected a provider via "Add Key" (`connect_provider_key`), the provider's
  models didn't appear in the model picker until the extension was restarted.
  Root cause: the host's `get_models` handler (`MessageRouter.getModelList`)
  only read from the cached model list and only triggered `refreshModels()`
  if the cache was empty. Fix: added a `refreshModels` callback to
  `ProviderManagementServiceDeps` and call it after successful provider
  add/key-connect/OAuth-completion. The existing `onModelsRefreshed`
  listener in `ChatProvider` then pushes the fresh model list to the webview
  automatically. Also added the missing `get_models` post to the
  `provider_oauth_completed` webview handler.

## [0.4.23] - 2026-06-27

### Fixed

- **SVG icons rendered as literal text** — `textContent` on an SVG string
  displays the raw markup (`<svg>...</svg>`) instead of the icon. Switched to
  `innerHTML` for live-command-card icons (initial render + status update) and
  task-panel status icons. Regression from the emoji-to-SVG conversion.
- **Auto-tab-switch on background resumes** — background sessions with pending
  questions or permissions no longer steal focus. A pulsing attention
  indicator (`data-needs-attention`) marks tabs needing user input. The user
  clicks the tab when ready. Scroll restoration on streaming tabs now anchors
  to bottom instead of restoring a stale saved position (prevents scroll jump).
- **CSS preset design tokens** — context-chip, context-chip-toggle, and
  live-command-card styles now use `--oc-*` semantic variables instead of raw
  `--vscode-*` variables, ensuring correct preset/theme switching.
- **Diff display compact mode** — `buildDiffPreview` in `fileEditCard.ts` only
  capped context lines at 5; added/removed lines were unbounded, showing the
  full diff. Now all preview lines count toward `MAX_PREVIEW_LINES` (5).
  Reduced `MAX_DIFF_LINES` from 40 to 15 for the inline diff view.
- **v2 SDK error messages** — `throwOnV2Error` produced `Command failed: {}`
  when the server returned an empty error object. New `v2ErrorDetail` helper
  extracts the error message, falls back to field JSON, then to HTTP status
  code. Applied to all `SessionClient` and `PtyService` error paths.
- **`file.read` shape mismatch** — `readFile` passed `messageID` to
  `client.file.read`, but the v2 SDK signature does not accept it. Removed
  the dead parameter.

### Added

- **Tab attention indicator** — `markTabNeedsAttention` /
  `clearTabNeedsAttention` functions in `main.ts` with a `needsAttention` set.
  Wired to `permission_request`, `question_asked`, and `switchTab` events.
  CSS pulse animation in `layout.css` (respects `prefers-reduced-motion`).
- **Focused-Change Discipline (Anti-Regression Protocol)** in `AGENTS.md` —
  rules for focused commits, no auto-switching, CSS token usage, SVG via
  `innerHTML`, and CSS coverage testing.

## [0.4.21] - 2026-06-27

### Fixed

- **Emoji → SVG icon replacement** — all emoji/Unicode symbols in webview UI,
  HTML, CSS, extension host files, and dead code replaced with SVG icons from
  `icons.ts` for consistent rendering. CSS pseudo-elements now use CSS-drawn
  shapes (checkmarks) instead of emoji. VS Code status bar items use codicon
  syntax (`$(warning)`) instead of emoji.
- **Active file context toggle** — moved `#context-bar` inside `#input-area` in
  `index.html` for proper placement. Propagated `reason` field in active_file
  handler for suppressed files (binary/too large). Removed dead
  `toggle_active_file` postMessage. Re-posted active file on tab switch.
- **File edit cards stuck as running** — added branch in `handleToolEnd` to
  resolve file edit cards from "running" to completed/error/stale state.
- **Changed files dropdown** — updated dropdown immediately on `file_edited`
  message. Added changed files toolbar button back to HTML with SVG icon.
- **ActiveFileTracker crash on no editor** — `bestEditor()` now safely handles
  undefined `visibleTextEditors` array. Test mock updated to provide
  `visibleTextEditors` getter.
- **Subagent panel CSS regression** — state-specific classes
  (`.subagent-item--running/completed/failed`), TDD-layout variant classes
  (`.subagent-header`, `.subagent-status`), and detail-view badge colors were
  missing from `components.css` after an ephemeral-tree wipe. Restored
  left-border accent colors, fixed `.subagent-item-progress-bar` (removed
  `width: 100%` conflicting with `scaleX`), and fixed
  `.subagent-detail-status-badge--running` (accent color instead of
  success-green).
- **File-edit card CSS gaps** — added missing `.file-edit-card__duration`,
  `.file-edit-card__open-btn`, `.file-edit-card__diff-btn`,
  `.file-edit-card__diff-content`, `.file-edit-card__preview-content` CSS
  rules that were only styled via shared base classes.

### Added

- **File mention search with WorkspaceFileIndex** — `MessageRouter` now uses
  `WorkspaceFileIndex` as primary source for file mention search, with
  `vscode.workspace.findFiles` as fallback. Results from both sources are
  deduplicated. This provides cached, filtered results that include
  directories.
- **WorkspaceFileIndex refresh on webview_ready** — the file index is refreshed
  when the webview becomes ready, ensuring the cache is up-to-date before the
  webview requests files.
- **Proactive workspace file request on mention trigger** — the webview now
  posts `get_workspace_files` when the user types `@`, ensuring the mention
  dropdown has the latest file list.
- **CSS coverage structural test** (`src/chat/webview/css/cssCoverage.test.ts`)
  — asserts every class emitted by `subagentCard.ts` and `fileEditCard.ts` has
  at least one matching CSS rule. Catches the exact failure mode (renderer
  emits a class, CSS was wiped by ephemeral-tree reset) that caused the
  subagent tool card regression. Runs as part of `npm run test:unit`.
- **Ephemeral-tree hardening scripts:**
  - `scripts/detect-wiped-work.mjs` — detects if uncommitted work was wiped
    by the checkpoint process via stash/reflog inspection
  - `scripts/check-workspace-state.mjs` — session-start recovery + CSS
    coverage check
  - `.opencode/hooks/pre-commit-css-coverage.sh` — pre-commit hook blocking
    commits with renderer/CSS class mismatches
- **CSS regression prevention guide** (`docs/development/css-regression-prevention.md`)
  — documents why CSS regressions happen in this repo, the recovery path via
  `git stash list`, and the prevention path via the automated guards.
- **AGENTS.md** — new "CSS / Styling Work" subsection in the coordination
  protocol with rules for committing CSS, running the coverage test, and
  adding computed-style assertions to visual tests.
- **Visual test computed-style assertions** — `subagent-panel.spec.ts` now
  asserts state border colors and progress bar transform, not just text
  content. Progress bar fixture updated to use `--p` custom property.

## [0.4.20] - 2026-06-26

### Fixed

- **Active-file context pill stays visible while typing** — the pill that shows
  the currently-open editor above the composer kept disappearing the moment the
  user clicked into the chat input. Clicking the webview fires
  `onDidChangeActiveTextEditor(undefined)` because the sidebar is not a text
  editor, and the old handler posted `active_file: null`, hiding the pill.
  `ActiveFileTracker` now caches the last real editor (`lastKnownEditor`) and a
  new `bestEditor()` helper resolves through `lastKnownEditor → activeTextEditor
  → visibleTextEditors[0]`. The pill is only cleared when *all* visible text
  editors are gone (user closed every file). `repost()` (called on
  `webview_ready`) uses the same helper, so the pill also appears on first open
  even when the sidebar itself triggered `resolveWebviewView`.
- **File mentions render as chips on insert** — selecting a file from the `@`
  mention dropdown inserted raw `@file:path` text with no styled chip. The
  insertion path dispatches `oc-input-changed`, but that listener only resized
  the textarea and refreshed the send button. It now also calls
  `updatePromptContextChips()` and `syncContextItemsWithPrompt()`, so the chip
  renders immediately (manual typing of `@file:` was already covered by
  `onInputChange`).
- **Mention dropdown / indicators use SVG icons, not broken emoji** — the file
  row in the mention dropdown rendered the literal text `U0001F4C4` (an invalid
  capital-`\U` JS escape) instead of a file glyph. All emoji across the webview
  (mention dropdown file icon, context-chip eye/eye-off toggle, recent-session
  bug/sparkle/refresh/message indicators) were replaced with inline SVG from
  `icons.ts`, which render consistently regardless of platform emoji support.
- **Mention/command dropdown positions correctly** — `positionDropdown()` ran
  before the result rows were appended, so it measured a zero-height container
  and fell back to a 260px estimate, opening the dropdown far above the input.
  It now runs after all rows (including the `+N more` row) are in the DOM.
- **`.context-chip-remove` styling** — the chip `×` button had no visual CSS
  (only accessibility hit-area sizing), so it rendered with default native
  button chrome. It now mirrors `.context-chip-toggle`: transparent background,
  no border, muted inherited color, hover opacity feedback.
- **Estimated usage no longer overwrites a higher actual reading** — a late
  heuristic `estimated` `context_usage` event could clobber an exact `actual`
  token count with a lower value, making the bar jump backwards.

## [0.4.15] - 2026-06-26

### Fixed

- **Tool cards now show file paths and diffs** — file-edit cards were using
  `data-tool-id` instead of `data-block-id`, so `handleToolUpdate`'s
  `querySelector('[data-block-id="..."]')` never found them and state updates
  (Running → Done) were silently dropped. Changed to `data-block-id` to match
  the generic card convention. Also fixed the upgrade path: when
  `stream_tool_start` arrives with empty args `{}` (pending state), a generic
  `<details>` card renders with `data-tool-name` and `data-tool-class`; the
  subsequent `stream_tool_update` with real args now replaces it with a proper
  file-edit card showing the file path and inline diff.
- **Diff preview size capped** — the inline preview is limited to 5 visible
  lines (was 50) and the "Show diff" expanded view to 40 (was 200), keeping
  the card compact for fast-paced coding. A `+N / -M` stats chip in the card
  header shows scope at a glance without opening the diff.
- **Context bar resets correctly after compaction** — after `session_compacted`
  fires, the pre-compaction token count was retained in `ContextMonitor`,
  `SessionStore`, and the webview session state, so the bar kept showing the
  old (high) fill level. All three layers now clear their cached usage on
  compaction; the bar hides until the first real token count arrives from the
  resumed session.
- **Context breakdown copy** — "No breakdown available" changed to "Token
  breakdown not reported by model" to accurately describe why the section is
  empty (the server simply does not emit per-category breakdown for most
  models, which is normal, not an error).
- **Source pill labels** — the `ESTIMATED` / `ACTUAL` pills now read `approx`
  and `exact` with descriptive tooltips, reducing confusion about why the
  count is labeled as approximate.
- **ARIA/WCAG: toggle button state** — the eye-icon toggle on context chips
  now carries `aria-pressed` (true = included, false = excluded) so screen
  readers announce the on/off state correctly.
- **ARIA/WCAG: button types** — explicit `type="button"` added to context chip
  remove/toggle buttons and file-edit card "Open file" / "Show diff" buttons,
  preventing accidental `submit` semantics in edge cases.
- **ARIA/WCAG: focus-visible on chip buttons** — `.context-chip-toggle` and
  `.context-chip-remove` now have `:focus-visible` outlines using the accent
  token, making keyboard navigation visible.

## [0.4.14] - 2026-06-26

### Added

- **Active file safety guards** — `ActiveFileTracker` now skips binary files
  (by language ID) and files larger than 1 MB, posting `active_file: null`
  with a `reason` field (`"binary_file"` or `"file_too_large"`) so the webview
  can show an appropriate empty state instead of attaching unusable content.
- **Folder context type** — added `picked_folder` to `ContextItemType` and
  indexed directories in `WorkspaceFileIndex.refresh()` so `@folder:`
  references can resolve.
- **XML and YAML document icons** — new `DOC_XML_SVG` and `DOC_YAML_SVG`
  icons with MIME-type and extension-based fallback in `getIconForFile()`.
- **Toggleable context chips** — `ContextChip` now supports `onToggle` and
  `isIncluded` fields for chips that have an on/off state (e.g., active file
  inclusion). The chip renders an eye/eye-off toggle button.
- **Pill-style document attachments** — non-image attachment chips now use a
  compact pill layout with an inline icon, matching the context chip style.
- **Drag-and-drop overlay reliability** — `forceHideOverlay()` plus a 3 s
  emergency hide timeout, a window-exit fallback, and a symmetric
  enter/leave counter so the "Drop files here" overlay dismisses correctly
  on drop and when the cursor leaves the panel. `setupDragDrop()` is now
  idempotent to avoid stacked, competing listeners.
- **Activity-bar running indicator** — the OpenCode activity-bar icon shows a
  badge while any session is streaming (`WebviewView.badge`, driven by
  `TabManager.onStreamingStateChanged`) and clears when all runs finish.

### Fixed

- **Active-file context pill never appeared** — `ActiveFileTracker.start()`
  posts the current file during `resolveWebviewView`, before the webview has
  registered its message handlers, and `active_file` is a passthrough message
  (not queued), so the only post was dropped. The host now re-posts via
  `ActiveFileTracker.repost()` from the `webview_ready` handler, so the pill +
  eye toggle render on first open (and after reconnect), not just after
  switching editors.
- **Drag overlay could stick on screen** — `dragenter` incremented the counter
  on every child element entered while `dragleave` only decremented when
  leaving the app bounds, so the counter leaked upward and never reached zero.
  Replaced with a canonical symmetric counter; the overlay now hides reliably
  when the drag leaves the panel or completes.
- **Context chip remove (×) button unstyled** — `.context-chip-remove` had no
  visual CSS (only accessibility sizing) and rendered with native button
  chrome. It now matches `.context-chip-toggle` (transparent, muted, hover
  feedback) using theme tokens.
- **"Send to OpenCode" from a problem never showed** — the action was
  contributed to `problems/context`, which is not a valid VS Code menu point
  (markers have no extensible context menu), so it was silently dropped. It is
  now surfaced as a Quick Fix via a `CodeActionProvider` on diagnostics —
  reachable from the editor lightbulb and the Problems-panel "Quick Fix…"
  affordance — invoking the existing `sendProblemToOpencode` command.
- **Active-file inclusion single-sourced** — removed the unused host-side
  inclusion API (`includeState`, `handleToggleActiveFile`, `isIncluded`,
  `getActiveFileContent`) and the parallel `contextTray` toggle that posted an
  empty `sessionId`. Inclusion is gated solely in the webview via the `@file:`
  mention, which the opencode server resolves into file content.

- **Status bar preserves "running" on reconnect** — the
  `event_stream_reconnected` handler no longer unconditionally overwrites the
  running indicator with "Connected". `wireRunningIndicator` now subscribes
  to reconnect events and re-evaluates the streaming count, so "N running"
  is preserved when sessions are still active.
- **Stale per-tab status badge after reconnect** — `reconcileAfterReconnect`
  now pushes `server_status: "idle"` (if run completed) or `"thinking"` (if
  still active) for reconciled tabs; non-candidate tabs get `"idle"` from
  the reconnect handler.
- **CLI session IDs not restored on reconnect** — `server_disconnected`
  invalidates `SessionStore` CLI session IDs, but for an event-stream-only
  reconnect the server is still running and the IDs are still valid. The
  reconnect handler now re-registers them from `TabManager` so `get_todos`
  and other server-fetch handlers don't silently fail.
- **Stale streaming state after reconnect** — non-streaming tabs now get a
  re-pushed `streaming_state: false` in case the webview missed the
  `server_disconnected` clear (message could be queued/dropped).
- **Stale pending permissions after reconnect** — the `reconnect_sync`
  webview handler now clears `pendingPermissionBySession` entries and hides
  the permission bar for the active session.
- **Stale question bar after reconnect** — `reconnect_sync` now calls
  `questionBar.repopulateFromMessages()` and `reconcileBar()` for each
  session, mirroring the tab-switch pattern.
- **Diff line numbers starting from 0** — `getFileHunks` now exposes
  `oldStart` and `newStart` from the hunk summary, and
  `WebviewEventRouter` initializes line counters from these values instead
  of 0, producing correct line numbers in diff views.
- **Edit/patch/apply tool cards not showing diffs** — `isEditLikeTool` now
  detects tools by name (`edit`, `write`, `patch`, `apply`) in addition to
  `class: "write"`, so tools arriving with `class: "read"` but an edit-like
  name render as file-edit cards with the file path and inline diff.

## [0.4.13] - 2026-06-25

### Added

- **OpenCode SDK v1.17.11 alignment** — bumped `@opencode-ai/sdk` from `^1.17.9` to `^1.17.11` to align with the June 2026 OpenCode core updates. New features now supported:
  - **"Max" thinking variant** — the variant selector now includes "Max" alongside "Default", "Low", "Medium", and "High" for GLM-5.2 and other reasoning backends that support extended thinking levels (v1.17.9).
  - **MCP server cwd, timeout, and OAuth configuration** — extended `McpServerConfig` interface and sanitizer to validate `cwd` (working directory for local servers, v1.17.4), `timeout` (operation timeout in milliseconds, v1.17.4+), and `oauth` (OAuth configuration for remote servers with `clientId`, `clientSecret`, `scope`, `callbackPort`, `redirectUri` fields, v1.15.9/v1.17.4). Updated `package.json` schema for `opencode.mcpServers` to include these fields.
  - **Provider custom headers** — added `headers` and `headerTimeout` fields to `ProviderConfig` interface and `ProviderConfigManager` to support per-provider custom headers (v1.17.9 Copilot headers) and header timeout configuration (v1.15.11). New accessors `getHeaders()` and `getHeaderTimeout()`.
- **Diff review / accept / reject** — changed-file rows in the
  changed-files dropdown now carry accept (✓) and reject (✕) buttons.
  Accept writes the current working-tree content to disk; reject reverts
  the file to git HEAD via `git checkout HEAD -- <path>`. The existing
  "Open diff" button opens a VS Code diff editor (HEAD → Working Tree)
  in the active column. Backed by new commands
  `opencode-harness.reviewFileChanges`, `acceptFileChanges`, and
  `rejectFileChanges`.
- **Send Problem to OpenCode** — right-click a diagnostic in the VS Code
  Problems panel and choose "OpenCode: Send Problem to OpenCode" to
  insert a formatted markdown snippet (file path, line/column, severity,
  source, message) into the chat composer. Registered as
  `opencode-harness.sendProblemToOpencode` in the `problems/context` menu.
- **Robust diff stats for WSL2/Docker** — new `fileDiffStats.ts` module
  with path normalization (backslashes, UNC prefixes, container path
  suffix matching), `git diff --numstat` fast path, fallback to
  `git show HEAD` + hunk computation, disk read when the file isn't open
  in an editor, and CRLF→LF normalization before diffing. Fixes the
  "+0 -0" bug in WSL2/Docker environments.
- **Session-aware diff review** — diff review, accept, and reject now operate
  on the file state when the session started, not the current git HEAD.
  Captures a git baseline SHA at the first file edit; resolves via
  `SessionBaselineResolver` with fallback to current HEAD for legacy sessions.
  Works even when the VS Code window has no workspace folder open (debug panel).
- **Undoable accept/reject** — accept and reject actions create a pre-action
  checkpoint and show an "Undo" notification that restores the file state.
- **Session directory resolution** — file operations now use the session's
  `workspacePath` (from the opencode server directory) instead of the
  VS Code window's first workspace folder. Fixes diff stats and diff loading
  in debug panels and multi-root workspaces.
- **Inline diff in file-edit cards** — the "Show diff" button on file-edit
  cards now renders a unified diff inline from the tool arguments
  (`oldString`/`newString` or `content`) instead of relying on a host
  round-trip that only updated the changed-files dropdown. The diff is
  shown/hidden in place with a toggle button.
- **Theme engine overhaul** — refactored `ThemeManager` into a modular,
  high-availability theme system. New subagent modules:
  - `ThemeAnalyzer` — reads VS Code active color theme kind, resolves preset
    mappings, and checks whether market themes are installed.
  - `ThemeStateMutator` — safely merges OpenCode color/token overrides under
    the `workbench.colorCustomizations.opencodeHarness` namespace, preserving
    unrelated user settings and supporting both workspace and global targets.
  - `ThemeWebviewBridge` — listens for VS Code theme/configuration changes and
    pushes live CSS variable updates to the chat webview.
  - Added `ThemeManager.activateTheme()`, `applyOverrides()`, and
    `resetToDefault()` for explicit theme control.
  - Added integration tests for merge preservation, invalid market-theme
    fallback, and workspace-scoped isolation.
  - Extension now returns `{ themeManager }` as its public API so integration
    tests can verify theme behavior.
- **Theme customizer UX refresh** — reorganized the webview theme customizer
  with a prominent "Common" section, collapsed advanced sections by default,
  a "Cancel" button, and clearer "Apply"/"Restore defaults" labels. Color
  pickers now show the current theme color when no override is set, and
  preset cards render hardcoded color swatches instead of unreliable CSS
  variables.

### Changed

- **V2Event format normalization** — the SDK v1.17.11 server emits events in V2Event format (with a `data` field) instead of the legacy Event format (with a `properties` field). All event handlers read `event.properties`, so V2Event-formatted question events arrived with empty properties — no `sessionID`, `requestID`, or `questions` — silently breaking the entire question flow (no question bar rendered, no answer routing). Fixed by normalizing `data` → `properties` at the SSE parser layer (`sseParser.ts:normalizeEventFormat`) and in `EventNormalizer.unwrapSyncEvent`. `QuestionHandler` now falls back to `event.id` for the request ID when `properties.id` and `properties.requestID` are both absent. `SdkEventLike` extended with `data` and `id` fields. Regression tests added in `session-event-normalizer.test.mjs`.
- **Event coverage updated** — added SDK v1.17.11 new event types to `SAFE_IGNORED_EVENT_TYPES`: `integration.connection.updated` and `session.next.revert.*` (cleared, committed, staged). These are server-side state management events that the extension does not need to handle directly.
- **Fixed path normalization suffix matching** — `fileDiffStats.ts` now correctly
  returns the relative path after the matched workspace-root suffix instead of
  concatenating the unmatched prefix. Fixes container path resolution.

### Fixed

- **File-edit card diffs not showing** — the "Show diff" button on file-edit
  cards previously sent a `get_file_diff` message to the host, but the
  response only updated the changed-files dropdown, not the card itself.
  The card now renders an inline unified diff directly from the tool
  arguments, eliminating the host round-trip dependency.
- **Events displayed out of order after session compaction** — after a
  session compaction, server chunks that arrived before the resumed
  session was ready would render into the pre-compaction bubble, making
  post-compaction events appear before the compaction notice. The
  webview now resets the per-session stream state on `session_compacted`
  before resuming, so new chunks render in the correct post-compaction
  bubble.
- **Sessionless file_edited attribution after compaction** —
  `file.edited` events with no session ID were dropped during the
  transient non-streaming gap after compaction (the local streaming flag
  is briefly false). The attribution logic now falls back to the active
  tab when it has an active CLI session, preserving edit visibility
  while still guarding against idle-tab attribution for external tools.

## [0.4.12] - 2026-06-24

### Added

- **Workspace config (`opencode.jsonc`) support** — the extension now discovers,
  parses, and hot-reloads `opencode.jsonc` (or `opencode.json`) files in the
  workspace root. Supported keys: `model`, `small_model`, `modelOverrides`,
  `ignore`/`exclude` (glob patterns for workspace file indexing), `rules`, and
  `instructions`. JSONC syntax (comments + trailing commas) is handled by the
  `jsonc-parser` library. A status bar indicator shows config load state
  (loaded / parse error / not found), and the webview displays workspace rules
  in the instructions editor. Invalid configs fall back to global VS Code
  settings gracefully. See [Configuration Reference](docs/configuration.md).
- **Attached context item model** — every context item sent with a prompt is now
  tracked as an `AttachedContextItem` with `type`, `path`, `languageId`,
  `lineCount`, `selection`, `isActive`, and `tokenEstimate`. `send_prompt` now
  includes a `contextItems` array alongside `attachments`. (`attachments.ts`,
  `sendMessage.ts`, `types.ts`)
- **Local fuzzy `@file` search** — typing `@` in the composer shows fuzzy file
  suggestions with basename, directory, and file-kind icons. (`mentions.ts`,
  `WorkspaceFileIndex.ts`)
- **Context tray UI** — a collapsible tray above the composer shows active file,
  image, and document chips with a 128K token budget bar, plus a unified
  `getAttachmentsForPayload()` helper. (`ui/contextTray.ts`, `ui/attachments.ts`)
- **Expandable command detail panels** — every row in the `/commands` palette can
  expand to show skill documentation, usage examples, and command metadata.
  (`commands-modal.ts`, `CommandExecutionService.ts`)
- **File status classification** — changed files are now classified as Added,
  Modified, or Deleted via `git status --porcelain` with a content-inference
  fallback, and the changed-files panel reflects the status. (`fileStatusClassifier.ts`)
- **CI screenshot baseline workflow** — `.github/workflows/screenshots-update.yml`
  lets CI regenerate and commit visual screenshot baselines on demand.

### Changed

- Consolidated hand-rolled JSONC parsing in `McpServerManager`,
  `OllamaConfigService`, and `check-architecture.mjs` into a shared
  `parseJsonc` utility (`src/utils/jsonc.ts`).
- `ModelManager.getModeModel` now consults workspace `modelOverrides` first,
  then VS Code `opencode.modeModels` settings, then the fallback/current model.
- `WorkspaceFileIndex` now filters files against `ignore`/`exclude` glob
  patterns from workspace config (via `minimatch`), in addition to the
  hardcoded `node_modules` exclusion.
- **Refactored webview modules** — extracted `todosModule.ts`,
  `subagentsModule.ts`, and `PtyRouter.ts` from `main.ts` to reduce file size and
  break dependency cycles. Also broke the `sendButton`↔`sendLogic`↔`sendMessage`↔
  `steerMode` cycle. (`src/chat/webview/ui/`, `src/chat/WebviewEventRouter.ts`)
- **Replaced emoji document icons with inline SVGs** so attachment chips look
  consistent across themes and platforms. (`icons.ts`, `ui/attachments.ts`)
- **Responsive composer** — the input bar and model selector now scale and
  truncate correctly at narrow widths (down to 280px). (`input.spec.ts`,
  `css/layout.css`, `model-dropdown.ts`)
- **Changed-files surface is now an inline panel** — the strip opens
  `#changed-files-panel` directly below the composer; fixed dropdowns were moved
  to a root-level `#dropdown-portal` so the strip can sit above the composer
  while dropdowns still render above the strip. (`changed-files-dropdown.ts`,
  `index.html`, `css/context-usage.css`, `css/layout.css`)
- **Re-baselined bundle size limits** — host limit raised to 725KB and webview
  to 790KB to account for legitimate first-party growth; paydown levers
  (SDK-gen tree-shaking, moving highlight.js off the main webview bundle) are
  documented. (`scripts/check-bundle-size.mjs`)
- **Split CI visual job** into separate `visual` and `webview` jobs to avoid the
  combined Playwright suite timing out and to isolate failure domains.
  (`.github/workflows/ci.yml`)

### Fixed

- **Changed-files strip was unclickable** because it was layered underneath the
  sticky composer. The strip now has its own z-index above the composer and the
  dropdown portal keeps model/mode/mention/slash dropdowns above the strip.
- **Restored document MIME type validation and icons** for file attachments,
  with `ALLOWED_DOCUMENT_MIMES` and `DOCUMENT_ICONS` validation. (`attachments.ts`)
- **Resolved failing visual regression tests** across activity panel,
  context-usage, compact tool blocks, and subagent panel fixtures. (`tests/visual/`)
- **Fixed webview E2E selectors** for the compact changed-files strip, inline
  changed-files panel, error-tier routing (Tier A/B/C surfaces), and question-bar
  fallback controls. (`tests/webview/`)
- **Wired stream callbacks through `handleToolStart`** so live question-tool blocks
  can post answers back to the host during streaming. (`src/chat/webview/stream.ts`)
- **Prefer ESM entry over UMD for node bundling** to avoid duplicate module
  evaluation and smaller host bundle. (`esbuild.js`)
- **Resolved lint and structural test failures** across `main.ts`,
  `MessageRouter.ts`, `tabSwitcher.ts`, `ModelManager`, and mode-dropdown tests.

## [0.4.11] - 2026-06-21

### Fixed

- **StreamCoordinator activation crash fixed.** The constructor called `resolveTtfbTimeoutMs()` before `StreamTimeoutManager` was initialized, causing `TypeError: Cannot read properties of undefined` on extension activation. `StreamTimeoutManager` is now constructed first, and its TTFB timeout dependency is a dynamic getter so it reflects the resolved workspace-config value and test overrides. (`StreamCoordinator.ts`, `StreamTimeoutManager.ts`)
- **TTFB/restore-points structural tests realigned** with the refactored `StreamTimeoutManager` and `VALID_WEBVIEW_TYPES` layout. (`StreamCoordinator.test.ts`, `WebviewEventRouter.restorePoints.test.ts`)

## [0.4.10] - 2026-06-21

### Fixed

- **Six dead-wired webview messages revived.** Their host handlers existed but the types were missing from the inbound `VALID_WEBVIEW_TYPES` gate, so the messages were rejected before dispatch and the features silently no-op'd: the entire prompt-template feature (`save_template` / `list_templates` / `delete_template`, used by the `/template` slash command), `save_message_as_template`, the changed-files dropdown's **undo file** button (`undo_file`), and `revert_all_files`. A regression guard now asserts that every handler-mapped type is allowlisted so this class of bug cannot recur. (`WebviewEventRouter.ts`, `WebviewEventRouter.test.ts`)
- **Tool-call "compact mode" toggle now applies to newly-rendered cards.** `messageRenderer` read a static `compactMode: false` baseline (so tool blocks rendered after the toggle ignored it) and persisted via a dead `update_collapse_config` host message. It now reads/writes the live `displayPrefs` pref (`getCompactMode`/`setCompactMode`). (`messageRenderer.ts`, `displayPrefs.ts`)
- **Context-usage modal actions no longer silently no-op.** The floating context-usage panel's *Compact context* button posted `compact_context` (never registered on the host) and *Switch model* posted `open_model_selector` (no handler). Compact now posts `compact_session`, and a new `open_model_selector` host handler re-posts `open_model_manager`. (`context-usage-dropdown.ts`, `WebviewEventRouter.ts`)
- **Context bar stays accurate across per-session model switches.** The bar and dropdown now recompute the percentage from `tokens / maxTokens` instead of trusting a stored percent that lags after the context window changes with the model. (`ui/tokenCostDisplay.ts`, `context-usage-dropdown.ts`)
- **Provider usage counter no longer stuck at "0 tok"** for proxy providers (e.g. `opencode-proxy`/mimo) that emit no rate-limit headers — the quota bar falls back to the active session's cumulative `tokenUsage.total`. (`ui/tokenCostDisplay.ts`)
- **Live bash/command cards were stuck on "RUNNING" showing the tool name.** Exec/shell cards set `data-block-id` so the streaming layer can find them, and `handleToolUpdate`/`handleToolPartial`/`handleToolEnd` now route `.live-command-card` through a dedicated `applyLiveCommandCardUpdate` that updates the card's own command/output/status/footer in place (the generic `.tool-status`/`.tool-result-panel` selectors never matched it). (`liveCommandCard.ts`, `streamHandlers.ts`)
- **Tool cards now actually respond to viewport/console width.** The responsive breakpoints targeted non-existent `.tool-card`/`.tool-args`/`.tool-result` classes; they now target the real `.tool-call`/`.live-command-card`/`.tool-args-panel`/`.tool-result-panel`/`.live-command-card__output`. On narrow consoles the command wraps instead of being ellipsis-clipped, and live output uses `overflow-wrap: anywhere`. (`css/messages-responsive.css`, `css/blocks.css`)
- **Sidebar panel pin buttons are pins, not stars.** All three side-panel pin buttons (Todos & Files / Activity / Commands) use a pin icon that fills when pinned. (`index.html`, `css/components.css`)
- **Todos & Files panel spacing fixed.** The empty in-progress status container added a phantom left-indent to every row (now collapsed when empty), and rows top-align so multi-line todos keep the checkbox and priority badge on the first line. Added leading section icons to the panel headers. (`css/components.css`, `css/layout.css`, `index.html`)

### Added

- **Styled, differentiated composer mention chips.** Typed `@file:`/`@folder:`/`@url:`/`@problems:`/`@terminal:` mentions render as per-kind chips (basename/hostname labels, distinct image-vs-file icons, full path/URL in the hover tooltip) and refresh live on every edit instead of staying as raw `@file:…` text. (`inputHandlers.ts`, `ui/attachments.ts`, `theme.ts`, `types.ts`, `css/components.css`)

- **Windows: binary resolution now always prefers `.exe` over `.cmd`/`.ps1` wrappers.** When `opencode-ai` is installed globally via npm on Windows, `where opencode` returns `.cmd` and `.ps1` wrapper scripts that Node.js cannot spawn with `shell: false` (causing `EFTYPE`/`EINVAL` errors). All binary lookup paths now filter `where` output to prefer `.exe` and reject `.cmd`/`.ps1`, known install directories probe only `.exe` files (including `%APPDATA%\npm\node_modules\opencode-ai\bin\opencode.exe`), and `opencode.binaryPath` values ending in `.cmd`/`.ps1` trigger a warning + fallback instead of crashing. Also fixed `LocalSessionProcessManager` which hardcoded `spawn("opencode", ...)` — it now resolves the binary via `binaryPath` config + known locations + PATH lookup like `ServerLifecycle`. New pure helper `preferExeOnWindows()` in `installPlan.ts`. Tests: `installPlan.test.ts`, `ServerLifecycle.test.ts`, `OpencodeInstaller.test.ts`, `CliDiagnostics.test.ts`, `ADR010.test.ts`.

## [0.4.8] - 2026-06-20

### Fixed

- **MCP commands now appear under the MCP filter in the commands palette (2026-06-20).** `SessionClient.listCommands()` hard-coded `source: "server"` for every command, discarding the server's real `source` (`"command" | "mcp" | "skill"`), so MCP-provided commands — though executable — never matched the **MCP** chip in the commands modal. It also read `.data` off a response the SDK types as a bare `Array<Command>` (yielding an empty list). Now preserves the reported source and accepts both the bare-array and legacy `{ location, data }` shapes. TDD: `tests/unit/session-client-list-commands.test.mjs`. (`src/session/SessionClient.ts`)
- **Command-created sessions no longer all titled "Tab session-" (2026-06-20).** Webview tab IDs are `session-<id>` and `"session-"` is exactly 8 characters, so `Tab ${sessionId.slice(0, 8)}` produced the identical title "Tab session-" for every tab. `CommandExecutionService` now mirrors the normal send path: use the tab's own name, otherwise defer to the server's auto-title. TDD: `tests/unit/command-exec-session-title.test.mjs`. (`src/chat/CommandExecutionService.ts`)
- **Test suite restored to fully green (2026-06-20).** Realigned 16 stale source-inspection / behavioural assertions across 9 files with the refactored module boundaries (the `StartPromptConfig` object, `setupTerminalPanel` / `MarkdownWorkerClient` extraction, exec→live-command-card rendering, changed-files floating-modal → inline panel). No source changes in that pass. Full unit suite: tsx 4237 pass / 0 fail, mjs 1004 pass / 0 fail.
- **IDE warning cleanup (2026-06-20).** Cleared ESLint warnings across the chat send-flow, webview renderers, and host wiring: unused imports and destructured dependencies in `ChatProvider.ts`, `SessionManager.ts`, `StreamCoordinator.ts`, `composer.ts`, `sendLogic.ts`, `sendButton.ts`, and `renderer.ts`; `require()` style imports in `ChatProvider.ts` and `WebviewEventRouter.ts`; broad `any` casts in `composer.ts`, `sendLogic.ts`, `sendMessage.ts`, `streamHandlers.ts`, `renderer.ts`, and `toolCallRenderer.ts`. Added a typed `getVsCodeApi()` helper in `renderer.ts` and relaxed `renderToolGroupBadge` to accept the minimal `{ state?, error? }` shape.
- **Small-webview overflow fixes (2026-06-20).** Prevented the conversation-history search box on the welcome screen from overflowing narrow containers (`welcome.css`) and added responsive composer breakpoints for `<=320px` / `<=280px` webviews so the send button and mode/model selectors stay on screen (`layout.css`).

### Added

- **Session SDK method coverage gaps closed (2026-06-20).** Wired three previously-unwired SDK v2 session endpoints:
  - `session.shell()` → `SessionClient.runShell(sessionId, command, opts?)` — execute a shell command in session context; returns `{ messageId, text }`. `shell.started`/`shell.ended` events already fire via `SessionNextHandler` for live terminal visibility (P1.4).
  - `session.share()` → `SessionClient.shareSession(sessionId)` — create a shareable link; returns the updated `Session` with `share.url` (P3.2).
  - `session.unshare()` → `SessionClient.unshareSession(sessionId)` — remove the shareable link; returns the updated `Session` with `share` cleared (P3.2).
  All three are delegated through `SessionManager`. TDD: 7 new tests in `session-client-v2-domain.test.mjs`. (`src/session/SessionClient.ts`, `SessionManager.ts`)

- **Session import from JSON (2026-06-20).** New `SessionImporter` module mirrors the export format from `SessionExporter.json()`. The pure `parseSessionExport()` function maps the export JSON to an `OpenCodeSession`, minting a fresh session id (imports are local copies, not server sessions). Unknown block types pass through unchanged (forward-compatible). Registered as `opencode-harness.importConversationJson` command in `package.json`. TDD: 12 tests in `SessionImporter.test.ts`. (`src/session/SessionImporter.ts`, `src/commands/export.ts`, `src/extension.ts`, `package.json`)

### Changed

- **main.ts god-module decomposition (2026-06-20).** Extracted three high-complexity functions from `src/chat/webview/main.ts` (~5100 lines) into dedicated modules using an explicit deps-object pattern to thread IIFE-local dependencies without closure capture:
  - `setupGlobalKeyboardShortcuts` → `ui/keyboardShortcuts.ts` (`setupGlobalKeyboardShortcutsImpl`, `KeyboardShortcutDeps`) — document-level keyboard shortcuts for tab management, command palette, search, and panel toggles.
  - `setupTodoSkillAndSubagentPanels` → `todoSubagentSetup.ts` (`setupTodoSubagentPanelsImpl`, `TodoSubagentSetupDeps`) — todos/activity/tasks/terminal/skills/subagent panel setup and toggle button wiring.
  - `switchTab` → `tabSwitcher.ts` (`switchTabImpl`, `TabSwitcherDeps`) — tab switching: scroll anchors, model/cost/token displays, permission bar, question bar, todos/activity sync.
  Each extracted function is called from a thin one-liner delegation in `main.ts` that passes the deps object, following the existing `SendLogicDeps` / `ComposerDeps` precedent. No behavior changes; all 1853 unit tests pass. Updated `main.test.ts` and `streaming-state-stability.test.mjs` to search the new source files for string-pattern assertions.

- **Extension host bundle size fix (2026-06-20).** Extracted `groupMessagesIntoTurns` + `extractSnippet` from `renderer.ts` into a new dependency-free `turnGrouper.ts` module. The host (`WebviewEventRouter`) was importing these functions from `renderer.ts`, which transitively pulled markdown-it, dompurify, entities, linkify-it, and diff-match-patch (~173kb of webview-only deps) into the extension host bundle. The extension bundle dropped from 860.7kb to 658.8kb (limit: 660kb). `renderer.ts` re-exports from `turnGrouper.ts` so existing webview imports are unchanged. TDD: `turnGrouper.test.ts` (11 tests) enforces the no-heavy-deps contract. (`src/chat/webview/turnGrouper.ts`, `renderer.ts`, `WebviewEventRouter.ts`)

- **Streaming UX motion budget overhaul — "Approach A" (2026-06-17).** Stripped every peripheral animation from the streaming surface so it reads like the integrated terminal / Copilot Chat — one signal, never three. Concurrent infinite animations during a 5-stream session dropped from 15+ (including box-shadow glows) to 5 caret blinks (opacity-only, GPU-composited). Removed: `thinking-pulse`, `tool-border-pulse`, `badge-pulse`, `tool-elapsed-pulse`, `tool-live-spin`, `tool-group-active-pulse`, `error-shake-in`, `subagent-badge-pulse`, `subagent-highlight-pulse`, `stagger-children`, and the entrance animation that re-fired on every token flush. Replaced with static border-left / colour state changes. Added `contain: layout` on `.message-content` and `contain: layout paint` on `.diff-block` to isolate streaming reflow from ancestors. Caret slowed from 1s `step-end` to 1.2s `ease-in-out`. Full design doc: `docs/design/2026-06-17-streaming-ux-motion-budget.md`. (`src/chat/webview/css/messages.css`, `blocks.css`, `animations.css`, `tokens.css`, `messageRenderer.ts`, `renderer.ts`)

- **UI redesign: unified design system + layout fixes (2026-06-18).**
  - **Text overflow fix**: Replaced `contain: layout` on `.message-content` with `overflow: hidden` + `word-break: break-word` to prevent assistant message text from exceeding container boundaries. Added `min-width: 0` on `.message.assistant .message-bubble`.
  - **Streaming backdrop**: Removed blue tint from `#input-area.input-area--streaming` (was `color-mix(accent 4%)`). Now uses neutral border emphasis only. Streaming assistant bubble border changed from accent blue to green (`--oc-success`). Model badge streaming dot uses success green.
  - **Files changed dropdown z-index fix**: `.cf-strip` had `z-index: calc(sticky+20)=120` which blocked `#input-area` dropdowns (mode/model selectors) at `z-index: calc(sticky+10)=110` due to `#input-area`'s `isolation: isolate`. Lowered to `z-index: var(--z-sticky)`.
  - **File status inference**: `_inferStatus()` now infers Added/Deleted from line-count stats (`added>0 && removed===0` → "A", `removed>0 && added===0` → "D") instead of defaulting all files to "M".
  - **Files changed dropdown redesign**: Added mini change-bar visualization (green/red ratio bar), directory path column with abbreviation, proper stat chips with subtle backgrounds.
  - **Sidebar panel headers**: Added missing CSS for `.todos-panel-header`, `.activity-panel-header`, `.tasks-panel-header`, `.subagent-panel-header` with uppercase tracked titles, flex layout, and scrollable content areas. These were missing after the accordion→individual-panels revert.

### Added

- **Stream latency tracking (2026-06-17).** StreamCoordinator now tracks P50/P95 timing: `sendTime`, `firstResponseTime`, `completeTime`, `finalizeTime` via `ActiveRunMetrics`. Logs `stream latency: first_chunk=Xms, total=Yms, finalize=Zms, messages=N` on every stream completion. Data available for `/metrics` debug surface. (`src/chat/handlers/StreamCoordinator.ts`, `StreamCoordinatorTypes.ts`)
- **Server pre-warm on activation (2026-06-17).** The opencode server now starts asynchronously during extension activation instead of deferring to first webview resolve. Fire-and-forget with error logging; falls back to lazy start on failure; skipped when remote-attach mode is configured. First-prompt latency reduced by 1-3s. (`src/extension.ts`)
- **Per-tab process isolation — ADR-010 Phase 3 (2026-06-17).** Full horizontal scaling infrastructure:
  - `LocalSessionProcessManager` manages per-tab `opencode serve` processes with `PortPool` allocation, crash detection, and SIGTERM→SIGKILL shutdown.
  - `SessionManagerRegistry` routes `getSessionManager(tabId)` to per-process `SessionManager` instances via `registerProcess`/`assignTab`/`unassignTab`.
  - `spawnAndRegisterSession()` spawns a process, creates a `SessionManager` connected via health-check, registers it, and optionally assigns a tab.
  - Crash resilience: `onProcessCrash` fires `TabRestorationState` entries for affected tabs.
  - `OPENCODE_DATA_DIR` isolation: each spawned process gets a unique temp directory to prevent SQLite contention.
  - LRU eviction: idle processes (0 tabs for N minutes) are automatically killed via `processIdleTimeoutMinutes` config.

### Fixed

- **Interrupt timeline logging — "Generation interrupted by user." marker now appears (2026-06-17).** When a user interrupted a stream (Stop button, Ctrl+Enter, or hotkey), `StreamCoordinator.abort()` correctly posted `stream_end` with `reason: "aborted"`, but `showStreamEndReasonMessage()` in `streamOrchestrator.ts` only handled `ttfb_timeout`, `timeout`, `hard_timeout`, and `error` — never `"aborted"`. This left no trace of the interruption in the conversation timeline. Added the missing `else if (reason === "aborted")` branch that calls `showSystemMessage(sessionId, "Generation interrupted by user.", false)`. The marker renders as a system message with the existing left-border accent styling. (`src/chat/webview/streamOrchestrator.ts`)
  - `StreamCoordinator.startPrompt` auto-spawns a per-tab process when `processStrategy` is `"per-tab"`.
  - Config: `opencode.sessions.processStrategy` (`"shared"` default, `"per-tab"` experimental).
  - Config: `opencode.sessions.processIdleTimeoutMinutes` (default 5, range 1-60).
  - New files: `src/session/LocalSessionProcessManager.ts`, `SessionManagerRegistry.ts`, `SessionProcessManager.ts` interface update.
  - 133 structural tests cover all subsystems. (`src/session/*`, `src/chat/handlers/StreamCoordinator.ts`, `src/extension.ts`, `package.json`)

### Fixed

- **Two pre-existing test failures from titleExtractor migration (2026-06-18).**
  1. `session-title-propagation.test.mjs`: `rename_session` test used `indexOf('"rename_session"')` which matched the message-type allowlist array (line 170) instead of the handler (line 942). Changed to `indexOf('["rename_session"')` to target the handler specifically.
  2. `sessionUtils.test.ts`: `generateTitleFromMessage` test expected ASCII `"..."` but `extractTitle` correctly uses Unicode ellipsis `"…"` (U+2026) per `titleExtractor.ts` spec. Updated assertion to match.

- **Chat keyboard shortcuts still fired VS Code editor actions (2026-06-14).** The suppressor keybindings (`Alt+1/2/3`, `Alt+Shift+Tab`, `Ctrl+Shift+M`, `Ctrl+Shift+T`, `Ctrl+T`, `Ctrl+W`, `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+K`) were gated *only* on the `opencodeHarness.chatFocused` context key, which is driven by the webview iframe's `window.focus`/`blur`. That event never fires when the chat view is focused *without* a click inside the iframe (activity-bar reveal, the `toggleFocus` command, view-header click) — so the suppressor was inactive and VS Code's default for the chord won (e.g. `Alt+1` → `workbench.action.openEditorAtIndex1` → "opened groups in the editor view"). There is no host-side focus API for `WebviewView` (`focused`/`onDidChangeViewState` exist only on `WebviewPanel`), so the suppressors now also OR in `focusedView == 'opencode-harness.chat'`, the signal VS Code sets the moment the view is focused regardless of iframe state. This mirrors how Copilot Chat / Continue / Cody gate their webview-shortcut overrides. (`package.json`, `tests/unit/keybindings-contract.test.mjs`)
- **Plan/Build/Auto dropdown was unusable mid-run ("stuck on build").** `updateModeSelectorState` hard-disabled the selector button and all three options whenever the active session was streaming, and `toggleDropdown`/`requestMode`/`cycleModeForward` early-returned on `isStreaming`. But mode is a per-session label consumed by the **next** prompt — host-side `change_mode` has no idle requirement — so locking it was a pure UX choice that blocked switching modes for the entire duration of a run. The selector is now fully interactive at all times. (`src/chat/webview/ui/modeDropdown.ts`, `src/chat/webview/ui/modeDropdown.test.ts`, `src/chat/webview/main.test.ts`)

### Performance

- **Two-session lag fixed (2026-06-11).** Root cause was persistence amplification, not rendering: every small update (scroll save, stream block boundary, token update) re-serialized **all** transcripts in both processes. The webview now persists a bounded snapshot via `vscode.setState` (last 50 messages/session — payload 2.9 MB → 289 KB at 2×500 messages) and the extension host persists at most 200 messages/session to `globalState` (flush serialize 170 ms → 16 ms at 10×1000 messages); in-memory transcripts are untouched and the opencode server remains the source of truth for older history. (`src/chat/webview/state.ts`, `src/session/SessionStore.ts`, `src/session/sessionUtils.ts`)
- **Session switching no longer re-fetches open tabs.** Clicking an already-open session in the recent list or history modal now switches locally instead of posting `resume_session`, which made the host re-fetch the entire server transcript, rewrite the store, and re-push a 50-message payload. Post-compaction refresh keeps the full re-fetch. (`src/chat/webview/main.ts`)
- **Virtual list no longer re-renders the detached backlog at switch/close time.** Resuming a session reuses the existing list when the transcript DOM is unchanged; tab close / session delete / transcript rebuild dispose without the `restoreAll()` render. (`src/chat/webview/virtualList.ts`, `src/chat/webview/main.ts`)

### Added

- **Source badges + result cap in the inline `/` dropdown (2026-06-13).** Each slash suggestion now shows a `Built-in` / `Server` / `MCP` / `Skill` / `Custom` origin chip (matching the commands-palette taxonomy, with a per-source icon and accent) so you can tell a built-in command apart from a server/MCP/skill/custom one without opening the palette. The dropdown also caps at 50 fuzzy-ranked rows with a non-interactive "+N more — keep typing to narrow" hint, so a short query against a large MCP/skill command set can't produce a runaway list. (`src/chat/webview/mentions.ts`, `types.ts`, `css/components.css`)

### Changed

- **Steering / queueing redesign — Queue is the safe default, Interrupt is explicit (2026-06-13).** Submitting a message while the AI is responding no longer aborts by default (which surfaced a red **"Stream error — The request was cancelled. Aborted"** card). The three confusing co-equal steer modes (Interrupt / Append / Queue) collapse to **two clear behaviors**: **Queue** (the new default — adds a visible, editable follow-up that runs after the current turn; absorbs the old silent "Append") and **Interrupt** (explicit — stop and run now). The streaming-only selector is now a compact **Queue | Interrupt** segmented toggle (text labels, no digit badges) and re-appears correctly when switching to an already-streaming tab. Composer submit: **Enter** = send (idle) / queue (streaming); **⌘/Ctrl+Enter** = send (idle) / interrupt-and-send (streaming, a one-shot that doesn't change your default); **Shift+Enter** = newline. The expected `MessageAbortedError` that the server emits a beat after any intentional abort (Stop or interrupt) is now suppressed via a short-lived intentional-abort window in `StreamCoordinator` consulted by the `server_error` handler — so an interrupt no longer shows an error or tears down its replacement run. Removed dead plumbing (`appendCallbacks`/`registerAppendCallback`/`append_cancelled`, the webview `add_to_queue` handler). (`src/chat/handlers/StreamCoordinator.ts`, `src/chat/ChatProvider.ts`, `src/chat/handlers/SteerPromptHandler.ts`, `src/chat/chatUtils.ts`, `src/chat/webview/{inputHandlers,sendLogic,main,types}.ts`, `index.html`, `css/{components,layout}.css`)
- **Keyboard shortcuts de-conflicted (2026-06-13).** Session modes moved to **Alt+1 / Alt+2 / Alt+3** (Plan / Build / Auto) and now fire **while typing in the composer** (the old `Ctrl+Alt+1/2/3` binding was gated behind a text-input guard, so it never worked from the prompt; matching is on `e.code` so macOS Option+digit characters resolve). The steering `Ctrl+1/2/3` triplet — which clashed with the mode shortcuts — was removed in favor of the Enter / ⌘Enter send-time modifiers above. The in-app shortcuts help (`?`) was updated to match. (`src/chat/webview/ui/modeDropdown.ts`, `src/chat/webview/index.html`, `src/chat/webview/ui/keyboardShortcutsModal.ts`)
- **SDK bumped to `@opencode-ai/sdk` 1.17.6 (2026-06-13).** Matches the latest opencode CLI server; the v1 `promptAsync`/`abort` signatures the streaming path uses are unchanged. The bump introduced three new v2 SSE event types (`session.next.interrupt.requested`, `integration.updated`, `reference.updated`) now classified in the event-coverage contract. (No v2 prompt-`delivery` migration in this change — the streaming/event pipeline stays on v1.) (`package.json`, `src/session/eventCoverage.ts`)

### Fixed

- **Mode shortcuts (and other chat keys) triggered VS Code editor actions instead of acting in the chat (2026-06-13).** Alt+1/2/3 (set mode) collide with VS Code's `workbench.action.openEditorAtIndex1/2/3` on Linux/Windows — so pressing them "opened groups in the editor view" instead of switching mode. This is systemic: a webview can't stop the workbench from also running its keybinding for a forwarded key ([vscode#241801](https://github.com/microsoft/vscode/issues/241801)), and `focusedView` is unreliable for webview views ([vscode#234683](https://github.com/microsoft/vscode/issues/234683), [#181667](https://github.com/microsoft/vscode/issues/181667)). Fix: (1) a reliable `opencodeHarness.chatFocused` context key mirrored from the iframe's focus/blur; (2) contributed **suppressor** keybindings that claim every conflicting chord while the chat is focused (`alt+1/2/3`, `alt+shift+tab`, `ctrl+shift+m` = Problems, `ctrl+shift+t` = Reopen Closed Editor, `ctrl+t` = Go to Symbol, `ctrl+w` = Close Editor, `ctrl+tab`/`ctrl+shift+tab` = editor nav, `ctrl+k` = chord) so the webview's own handler performs the action and the workbench does not also act; (3) removed the double-bound `cycleMode` keybinding (the webview owns the cycle keystroke; it was firing twice) and migrated the chat command keybindings (`stop`, `openCommandsPalette`, `nextTab`, `prevTab`, `retryLast`) to also accept the reliable context key. Suppressors are no-ops if the context key is ever unset, so worst case is unchanged behaviour. (`package.json`, `src/extension.ts`, `src/chat/ChatProvider.ts`, `src/chat/webview/main.ts`, `tests/unit/keybindings-contract.test.mjs`)
- **Switching to Auto mode froze VS Code and never switched (2026-06-13).** Selecting Auto posted `change_mode`, and the host handler gated the switch behind `vscode.window.showWarningMessage(..., { modal: true })` (`AutoModeService.showAutoModeConfirmation`). On Linux that native modal dims/disables the whole workbench and the mode switch waits on its (often unfocused/unrendered) response, so VS Code appeared frozen and the mode never changed. A purpose-built in-webview replacement (`modeWarning.ts` + HTML/DOM refs) had been left orphaned by the post-reinstall restore while the blocking native modal stayed live — contradicting the documented decision (this CHANGELOG) that the auto-mode confirmation modal was an anti-pattern to be removed. Switching to Auto is now treated as the user's consent: it applies immediately with no modal. Removed `AutoModeService`, the orphaned `modeWarning.ts` module + its `mode-warning-*` HTML/DOM refs/`settingsMenu` coupling, the now-unused `update_setting` message plumbing, and the stale tests requiring the modal. (`src/chat/WebviewEventRouter.ts`, `src/chat/ChatProvider.ts`, `src/chat/AutoModeService.ts` (deleted), `src/chat/webview/ui/modeWarning.ts` (deleted), `src/chat/webview/dom.ts`, `src/chat/webview/index.html`, `src/chat/webview/ui/settingsMenu.ts`, `src/chat/WebviewMessageValidator.ts`, `src/chat/webview/types.ts`)
- **Custom/MCP/skill commands looked "missing" and search wasn't fuzzy (2026-06-13).** The inline `/` dropdown filtered command suggestions with `startsWith`, and the commands palette + skills search used `includes` — so any command whose *name* didn't begin with the typed characters never appeared. Typing `/review` would not surface a custom `/code-review` command; `/cr` found nothing. New shared, pure `fuzzyMatch.ts` (`fuzzyScore` / `scoreCommandMatch` / `rankByFuzzy`) matches names by subsequence and descriptions by substring, ranked best-first (exact › contiguous prefix › word-boundary › scattered; name matches tier above description-only). Wired into all three surfaces: the inline `/` dropdown (`mentions.ts`), the commands palette (`commands-modal.ts`, including stash search), and host-side skill search (`WebviewEventRouter.ts`). Server-discovered custom commands (from `.opencode/commands/*.md`) now surface and are findable by any non-prefix or scattered query. (`src/chat/webview/fuzzyMatch.ts`, `mentions.ts`, `commands-modal.ts`, `src/chat/WebviewEventRouter.ts`)
- **Tool left spinning after a turn ended (2026-06-13).** A tool's whole live look (spinner badge, ticking elapsed, `.tool-call--running`) is derived from its block `state`, and `finishUnresolvedToolCalls` only finalized the single message resolved at `stream_end` — so a tool in an orphan message (a restart, or a prior turn that never received its tool-end event) could spin forever. New `finalizeAllPendingTools()` flips every non-terminal tool block across the transcript to terminal and re-renders (reusing the normal renderer, no DOM surgery), wired on every run-end path: the `stream_end` handler plus the server-`idle` and request-error backstops (via a new `StreamHandlers.finalizePendingTools()`). The host side was already covered (`StreamFinalizerService` emits `stream_end` with server-authoritative terminal blocks). (`src/chat/webview/streamHandlers.ts`, `streamEndHandler.ts`, `stream.ts`, `streamOrchestrator.ts`)
- **Blue streaming backdrop persisted after the turn ended (2026-06-13).** The message-level `.message.assistant.streaming` class (blue bubble fill + pulsing left border + pulsing header dot) was added on stream start but `classList.remove("streaming")` existed nowhere — only a full element re-render cleared it, so an orphan message kept a permanent blue glow. The end-of-turn `finalizeStreamingText()` sweep now also strips `.streaming` from any lingering `.message.streaming` element (purely visual; `state.streamingMessageId` remains the source of truth). (`src/chat/webview/streamHandlers.ts`)
- **Streaming never recognised as complete — trailing blinking cursor after the turn ended (2026-06-13).** A `.streaming-text` element could survive a finished turn, leaving a blinking caret (`.streaming-text::after`) in the transcript while the agent showed "SYSTEM READY". Two causes: `finalizeCurrentTextBlock` early-returned on an empty buffer (leaving an empty inter-tool/trailing streaming element live), and there was no guaranteed end-of-turn cleanup if `stream_end` re-rendered a different node. New `finalizeStreamingText()` sweep demotes **every** lingering `.streaming-text` (removing empty ones) and runs after every `stream_end` — before the idle status, with `currentBlockEl` already nulled, so it only ever touches true orphans. (`src/chat/webview/streamHandlers.ts`, `src/chat/webview/streamEndHandler.ts`)
- **Streaming never recognised as complete — empty bubble + stuck "live" dot (2026-06-13).** A stream restart for a new message id (e.g. after an agent/model switch mid-turn) finalized the prior bubble's tool calls but never removed the orphaned empty assistant placeholder, leaving an empty bubble whose pulsing `.message.assistant.streaming` dot never cleared. `handleStreamStart` now drops an empty prior placeholder from both the messages array and the DOM, or re-renders a non-empty prior as finalized so its live dot stops. (`src/chat/webview/streamHandlers.ts`)
- **Agent/Model "switched" events rendered as heavy verbose cards (2026-06-13).** The normalizer stores the FULL event type (`session.next.agent.switched`) but the renderers compared against the bare `agent.switched`, so the compact-pill path never triggered and the raw `session.next.*` meta leaked into a large activity card. Extracted `isSwitchEventType()` (matches bare + prefixed) into a shared module so both renderers paint the intended compact `switch-badge`. (`src/chat/webview/switchEvent.ts`, `src/session/activityCoalesce.ts`, `renderer.ts`, `messageRenderer.ts`)
- **Switch markers stacked at the bottom of the transcript instead of before the generation they configure (2026-06-13).** `session.next.*` switch events arrive at turn-end, so a naive append dropped them below the assistant message they belong to. New pure `switchInsertIndex()` / `decideSwitchPlacement()` place the marker before the trailing assistant turn (preserving ×N coalescing), applied on both the host (`SessionStore.appendOrCoalesceActivity`) and the webview (`main.ts addMessage`) so live view, re-render and reload all agree. (`src/session/activityCoalesce.ts`, `src/session/SessionStore.ts`, `src/chat/webview/main.ts`)
- **Modal focus not managed for Model Manager & Tool Permissions (2026-06-13).** Model Manager never captured/restored the invoker and let Tab escape behind the dialog; Tool Permissions never moved focus into the dialog at all (keyboard focus stayed on the settings menu behind the modal). New `mountModalFocus()` (capture invoker → focus in → trap Tab → restore on release) wired into both. Fixes WCAG 2.4.3 / 2.1.2 gaps. (`src/chat/webview/focus-trap.ts`, `model-manager.ts`, `permissionConfig.ts`)
- **Two identical cog icons for different functions (2026-06-13).** The input-bar "Edit tab instructions" button used the same gear icon as the header "More options" button; it now uses a distinct notes/document icon so the cog uniquely means "More options". (`src/chat/webview/index.html`)
- **Welcome "Shortcuts" button was a focusable control inside an `aria-hidden` container (2026-06-13).** Exposed-but-hidden (WCAG 4.1.2); removed the `aria-hidden` so screen-reader users get the button. (`src/chat/webview/index.html`)
- **Welcome model chip was not keyboard-operable (2026-06-13).** `#welcome-model-ctx` (the "workspace · model" chip) opens the model manager on click but was a `<span>` with no keyboard path (WCAG 2.1.1). It is now `role="button"` + `tabindex="0"` + `aria-haspopup="dialog"` with an Enter/Space handler mirroring the click. Audit confirmed every other focusable custom widget (`#context-usage`, `#changed-files-strip`, the sidebar resize separator) is already keyboard-operable. (`src/chat/webview/index.html`, `src/chat/webview/ui/welcomeView.ts`)
- **Incorrect ARIA roles on the context-usage trigger and mode dropdown (2026-06-13).** `#context-usage` was `role="progressbar"` despite having no `aria-valuenow` and being a focusable control that opens a details dropdown — a non-interactive role made interactive (WCAG 4.1.2). It is now `role="button"` (disclosure), with the decorative fill bar `aria-hidden`. `#mode-dropdown` was `role="radiogroup"` but wraps a button + `role="listbox"`/`option` combobox with no radio children — the mismatched role was removed (inner listbox semantics unchanged; the separate `#steer-mode-selector` remains a real radiogroup). (`src/chat/webview/index.html`)
- **Scroll-back over pruned history showed permanent empty boxes.** The virtual list never observed its placeholders, so a pruned message could not restore when scrolled back into view; it only reappeared when a resume happened to rebuild everything. Placeholders are now observed and messages re-render on scroll-back. (`src/chat/webview/virtualList.ts`)
- **`TimestampUpdater` retained every removed message element forever.** Its element-keyed map is now pruned on tick when elements leave the DOM — bounded memory and tick cost over long sessions. (`src/chat/webview/timestampUpdater.ts`)
- **Completed subagents still showing "Running".** `normalizeSubagentStatus()` in both the webview (`main.ts`) and the host (`RunActivityTracker.ts`, `ChatProvider.ts`) mapped unknown status strings to `"pending"` or `"running"` — both treated as live. Now maps to `"unknown"` (not live). The reconciler correctly transitions `"unknown"` subagents to `"completed"` when the server drops them. (`src/chat/webview/main.ts`, `src/chat/handlers/RunActivityTracker.ts`, `src/chat/ChatProvider.ts`)
- **`activeSubagentCount` counting `"unknown"` as active.** The tracker's `activeSubagentCount()` excluded unknown statuses, preventing run finalization when subagents had unparseable status strings. (`src/chat/handlers/RunActivityTracker.ts`)
- **"Open in editor" button for subagent detail was a no-op.** The webview now tracks the active subagent id (`activeSubagentId`) and sends both `sessionId` and `subagentId` in the `open_subagent_detail` message. The host creates a new `vscode.WebviewPanel` in popout mode (`window.__OC_POPOUT__`), fetches the detail, and renders it in a dedicated editor panel. (`src/chat/webview/main.ts`, `src/chat/ChatProvider.ts`, `src/chat/WebviewEventRouter.ts`, `src/chat/WebviewContent.ts`)
- **Tab streaming label showed `X/undefined`.** `sendLogic.getStreamCapacityState()` omitted `maxStreams` from the return object; `tabs.ts` read `undefined`. Now returns `maxStreams: getMaxConcurrentStreams()`. (`src/chat/webview/sendLogic.ts`)
- **Tool group header badge frozen at initial render.** `updateToolGroupHeader` only updated the count text, never refreshed the parent group `.tool-status` badge on child state changes. New `renderToolGroupBadge()` extracted into `toolCallRenderer.ts`, called from the streaming update path. (`src/chat/webview/toolCallRenderer.ts`, `src/chat/webview/streamHandlers.ts`)
- **State vocabulary mismatch between individual badge and group counter.** `appendToolStatusBadge` treated unknown states (e.g. `"success"`) as "Done" but group counter only counted `"result"`/`"completed"`. New shared `isTerminalState()` in `toolState.ts`. (`src/chat/webview/toolState.ts`)
- **`resetStreamState` left `isStreaming = true`.** Explicitly set `state.isStreaming = false`. (`src/chat/webview/streamHandlers.ts`)
- **`handleRunActivityUpdate` could set streaming without a `streamingMessageId`.** Added guard. (`src/chat/webview/streamHandlers.ts`)
- **Duplicate `max-height` on `.tool-group-child` panels.** Removed dead declaration. (`src/chat/webview/css/blocks.css`)
- **Question block pointer hint pointed to non-existent input bar.** Changed to "Answer in the question bar below". (`src/chat/webview/renderer.ts`)
- **MCP slash commands failed when typed as `/server tool` or `/server:tool` (2026-06-13).** Users naturally type `/jcodemunch:triage` or `/jcodemunch triage` but the opencode server registers every command (MCP tool, skill, built-in) as a flat top-level name (`/triage`), so the namespaced form was forwarded as-is and rejected with "Command not found: jcodemunch:triage". The slash dispatcher now detects both namespace patterns (`resolveMcpNamespace` in `slash-commands.ts`) and rewrites to the flat command before forwarding. Colon syntax (`/prefix:command`) uses a two-tier match: exact MCP origin+tool first, then broad suffix match against any remote command. Space syntax (`/server tool`) requires a known MCP origin to avoid ambiguity with argument-taking commands. (`src/chat/webview/slash-commands.ts`, `slashCommands.ts`, `composer.ts`, `main.ts`)
- **Unknown slash commands silently forwarded with no guidance (2026-06-13).** Typing an unrecognised command (`/totally-unknown`) forwarded it to the server which returned an opaque error. The dispatcher now shows a non-blocking tip pointing to `/commands` when the command is neither local, nor a namespace match, nor in the cached server list — the command is still forwarded (server cache may be stale), but the user gets immediate guidance. (`src/chat/webview/slashCommands.ts`)
- **MCP `http`/`sse`/`remote` servers accepted without a URL (2026-06-13).** `sanitizeMcpServerConfig` only required a `command` for `stdio` servers but did not enforce a `url` for remote types, so an HTTP/SSE server with no endpoint was silently accepted and failed at runtime. The validator now throws `MCP <type> server must include a url` for non-stdio types missing a URL. (`src/mcp/McpServerManager.ts`)
- **Local skills silently dropped when a server agent had the same name (2026-06-13).** `resolveAllSkills` deduplicated by display name, so a local `~/.agents/skills` skill with the same name as a server agent was never shown. Dedup now uses a composite key (`server:<name>` vs `local:<id>`), so both appear with independent toggle state. (`src/chat/WebviewEventRouter.ts`)
- **Command-list fetch failures invisible to the user (2026-06-13).** When the opencode server was unreachable, `handleListCommands` fell back to custom-prompt-only with no indication that server/MCP commands were missing. The `command_list` message now carries `partial: true` on failure, and the webview surfaces a system message explaining the incomplete list. (`src/chat/StatePushService.ts`, `WebviewEventRouter.ts`, `ChatProvider.ts`, `main.ts`)
- **`CommandEntry.run` used an `any` cast, bypassing type safety (2026-06-13).** `runCommandEntry` accessed `entry.run` via `(entry as any).run()`. The optional `run?: () => void` is now declared on `CommandEntry` and the cast removed. (`src/chat/webview/commands-modal.ts`, `slashCommands.ts`)
- **Slash command output appeared with no echo of the command itself (2026-06-13).** When a server/MCP/skill command was executed, the transcript showed only the assistant output — the user's typed command (e.g. `/triage`) was cleared from the input bar and never echoed, unlike the CLI where the command prompt provides context. `executeRemoteCommand` now posts a user message echoing `/<command> <args>` before the server call, persisted to the session store so it survives reloads. (`src/chat/CommandExecutionService.ts`)

### Changed

- **"More options" menu grouped into labelled sections (2026-06-13).** The settings overflow menu was a flat 11-item list mixing side-panel toggles, view overlays, a display toggle and config actions. It is now three semantically-grouped, labelled sections — **Panels** (Todos/Activity/Tasks/Subagents), **View** (Checkpoints/Conversation Timeline/Show thinking), **Configure** (MCP/Tool Permissions/Customize theme/Keyboard Shortcuts) — using `role="group"` + `aria-label` (visible label `aria-hidden`). All button ids/roles preserved; arrow-key traversal still covers every item in DOM order. (`src/chat/webview/index.html`, `src/chat/webview/css/layout.css`)
- **Welcome view leads with the primary action, not history search (2026-06-13).** The "Search your conversation history" box previously sat above the New/Continue buttons. It now sits directly above the recent-sessions list it filters, below the primary CTA — so the main call-to-action leads and the search is grouped with its results. (`src/chat/webview/index.html`)
- **Question bar finally wired up.** `questionBar.ts` and `#question-bar` HTML/CSS existed (added by `ebc0f0e`) but no production code called them. Now wired: `initQuestionBar` at boot, `onQuestionBlock` in stream handlers, `question_asked`/`question_acknowledged` message handlers, `setActiveSession` on tab switch, `repopulateFromMessages` on init_state. (`src/chat/webview/main.ts`, `src/chat/webview/questionBar.ts`)
- **Terminal command display polished.** CSS added for `.tool-command-output` (stdout/stderr split), `.tool-exit-code` badges, scroll-bound terminal output, and overflow protection on headers. (`src/chat/webview/css/blocks.css`)
- **Streaming-vs-done visual differentiation.** Animated left-border pulse on streaming bubbles and running tool calls; static green border on completed; pulsing dot in assistant header during streaming; composer background tints when active. All gated on `prefers-reduced-motion`. (`src/chat/webview/css/messages.css`, `blocks.css`, `layout.css`)
- **Model and variant selector overflow protection.** `max-width: 14rem` on `.model-selector-btn`, `max-width: 10rem` on `.variant-selector-btn`. (`src/chat/webview/css/layout.css`)
- **`.stream-frozen` / `.stream-tail` CSS added.** Previously unstyled inline elements from `liveTextRenderer.ts`. (`src/chat/webview/css/messages.css`)

- **Subagent panel constantly auto-opening on activity churn.** Panel now only auto-opens when a NEW subagent ID appears (not on every `run_activity_update` with `activeSubagentCount > 0`). Tracks known IDs per session; dismissal persists for the session until a new subagent arrives. (`src/chat/webview/subagentReconciler.ts`, `src/chat/webview/main.ts`)
- **Completed subagents stuck showing "Running" status.** Server drops subagents from snapshots once they finish; the webview now reconciles by transitioning dropped live subagents to "completed" instead of keeping stale "running" entries. (`src/chat/webview/subagentReconciler.ts`)
- **Subagent detail view overlapping all tab panes (todos/activity/tasks).** `#subagent-detail-view` moved from sibling to child of `#subagent-panel`. Uses `data-view="list"|"detail"` attribute switching instead of absolute overlay. (`src/chat/webview/index.html`, `src/chat/webview/subagentDetailView.ts`, `src/chat/webview/css/components.css`)
- **`mark_subagent_read` never sent by webview.** Panel item clicks and detail-view opens now post `mark_subagent_read` to reset the unread count badge. (`src/chat/webview/subagent-panel.ts`, `src/chat/webview/main.ts`)
- **Permission bar sending wrong message type.** Webview sent `permission_response` but host expected `accept_permission`; host rejected with "Unknown webview message type" error and the opencode server timed out the permission mid-stream. (commit `27aa1ea`, `src/chat/webview/main.ts`)

### Changed

- **Completed subagents are collapsed by default in the panel.** Shows only name + status badge + expand toggle. Click to expand for progress/output/timing details. (`src/chat/webview/subagent-panel.ts`)
- **Completed subagents capped at 10 most-recent in the panel.** Oldest are evicted; a "Clear completed" button appears when completed items exist. (`src/chat/webview/subagent-panel.ts`)
- **Auto-open policy: new subagent only.** Panel auto-opens only when a subagent ID not previously seen in the current run appears. Activity churn on existing subagents no longer triggers the panel. (`src/chat/webview/main.ts`, `src/chat/webview/subagentReconciler.ts`)

- **Subagent events for 30-45 minute sessions no longer dropped by PendingEventBuffer.** TTL-based event expiry completely removed — events now persist until explicitly drained (Event Sourcing / Claim-Check pattern). Child session events route directly to parent tab via `childSessionToTab` mapping registered by heartbeat on first discovery (using SDK `parentID` field). Child session streaming events (`text_chunk`, `tool_start`) are NOT dispatched to parent tab — they would corrupt parent state, and all needed subagent info arrives via `subagent_update` on the parent stream (State Watch pattern) + heartbeat polling (HeartBeat pattern). (`src/chat/PendingEventBuffer.ts`, `src/chat/handlers/SubagentHeartbeat.ts`, `src/chat/ChatProvider.ts`)
- **Stream watchdog increased to 45 minutes.** `STREAM_STUCK_MS` raised from 10min to 45min to accommodate long-running models (Minimax, DeepSeek, etc.). `sweep()` orphan threshold increased from 10min to 30min. (`src/chat/handlers/StreamCoordinator.ts`)
- **Subagent "completed" shown as "running".** `RunActivityTracker.recordSubagent` now guards against overwriting terminal status (`completed`/`failed`/`cancelled`) with non-terminal (`running`/`queued`). (`src/chat/handlers/RunActivityTracker.ts`)
- **HostMessageBatcher logging cascade.** Dedup drop messages now log the first drop then every 100th (not every single), preventing thousands of log lines per second during subagent-heavy streams. (`src/chat/HostMessageBatcher.ts`)
- **Chat session state not cleaned up on server error/disconnect.** Both `server_error` and `server_disconnected` handlers now call `streamCoordinator.cleanupTab(tabId)` alongside TabManager resets, preventing stale coordinator state from corrupting the next prompt. (`src/chat/ChatProvider.ts`)
- **`message_complete` silently dropped when no tab match.** Falls back to the active tab if the event's session ID does not match any known tab. (`src/chat/ChatProvider.ts`)
- **`maybeFinalizeStream` deferral log spamming.** Deferral reasons now logged at most once per 5s per tab, not on every poll iteration during long subagent waits. (`src/chat/handlers/StreamCoordinator.ts`)
- **Side region tabs blank when not opened from subagent.** `onTabChange` callback now refreshes panel content on tab switch. (`src/chat/webview/main.ts`)
- **Subagent detail view overlapping with other tab panes.** Detail view closes on any tab switch; subagent tab is activated before showing detail. (`src/chat/webview/main.ts`)
- **Missing `slideIn` keyframe animation.** Added `@keyframes slideIn` definition for subagent detail view entrance. (`src/chat/webview/css/components.css`)

### Changed

- **Pin button icon replaced.** Star icon changed to map-pin icon for standard UI affordance. (`src/chat/webview/index.html`)
- **Stream prematurely stopping on permission/question/rate-limit.** Three fixes in `StreamCoordinator.ts`: `reconcilePendingToolCallsFromServer` now skips removal of `question` type tool calls from `activeToolCallIds` unless `answered === true`; `getFinalizeDeferReason` scans for unanswered `question` blocks and defers finalization; new `markQuestionAnswered(tabId, toolCallId)` method marks the question as answered and removes it from `activeToolCallIds`, called from both `WebviewEventRouter.ts` question_answer paths and `postToolEnd`. (`src/chat/handlers/StreamCoordinator.ts`, `src/chat/WebviewEventRouter.ts`)
- **Rate-limit card appearing mid-stream.** `rate_limit_exhausted` handler in `main.ts` now checks `isStreaming` — during active streams, only the non-intrusive bar notice is shown, no inline error card. (`src/chat/webview/main.ts`)
- **Session-history "More actions" (⋯) menu did nothing.** The body-portaled menu used `z-index: var(--z-dropdown)` (50), below the modal backdrop (200)/content (300), so it rendered invisibly behind the modal. Added a dedicated `--z-modal-menu` (350) token. (`tokens.css`, `blocks.css`, `sessionListRenderer.ts`)
- **Context-usage bar leaking onto the welcome screen.** `updateContextBarFromSession` removed the `hidden` class unconditionally; it now respects an `isWelcomeVisible` guard threaded through `TokenCostDeps`, matching the sibling reveal paths. The usage bar must never appear on the welcome/empty screen. (`tokenCostDisplay.ts`, `main.ts`)
- **Duplicate info/error cards.** A single fault no longer renders as multiple cards.
  - Activity notices ("Model switched", "Agent switched", compaction, provider retry) used to stack duplicates because `ChatProvider.appendActivityBlock` minted a random id per delivery and always appended — a re-delivered event (SSE reconnect / `PendingEventBuffer` replay) produced a second card. New pure `activitySignature` + `decideActivityCoalesce` (`src/session/activityCoalesce.ts`) collapse an immediately-repeated identical activity into the previous card and bump a `repeatCount` (rendered as a `×N` badge); `SessionStore.appendOrCoalesceActivity` applies it and the webview upserts in place.
  - One generation failure used to surface three times: the structured error card, a generic "An error occurred while generating the response" end-of-stream card, and the raw error echoed in the bottom typing indicator. The structured card is now canonical — `hasRecentErrorCard` (`streamEndErrorPolicy.ts`) suppresses the generic end-of-stream card when an error card already exists, and `handleRunActivityUpdate` no longer echoes raw errors into the status indicator. (`streamOrchestrator.ts`, `streamHandlers.ts`)

### Changed

- **Permission/question/rate-limit UI relocated from message stream to dedicated bars.** Interactive controls now live in `#question-bar`, `#permission-bar`, and `#rate-limit-bar` above/below the input area. The stream shows compact read-only pointers with a hint directing users to the bars. Permission requests are no longer persisted in the session transcript (ephemeral). (`src/chat/webview/index.html`, `src/chat/webview/main.ts`, `src/chat/webview/renderer.ts`, `src/chat/webview/theme.ts`, `src/chat/webview/css/question-bar.css`)
- **System messages redesigned.** Replaced `.message.system .system-bubble` orange gradient/emoji/shadow with a subtle transparent layout container: thin left border accent, `background: color-mix(in srgb, var(--oc-fg) 3%, transparent)`, no animation/filter. (`src/chat/webview/css/messages.css`, `src/chat/webview/css/messages-responsive.css`)
- **Question/permission block transcript pointers.** Pending questions show a compact header + question text + "Answer in the input bar above" hint; answered questions show a read-only record. Permission block follows the same pattern with header + text + hint. (`src/chat/webview/renderer.ts`, `src/chat/webview/css/blocks.css`, `src/chat/webview/css/messages.css`)
- **Welcome-screen context bar guard.** `hideStatusStrip()` now always hides the quota bar first, then conditionally re-shows it only when not on the welcome screen (`isWelcomeVisible()`). (`src/chat/webview/main.ts`)
- **Compact, theme-driven card system.** New shared `.oc-card` model (`src/chat/webview/css/cards.css`, imported by `styles.css`) with severity modifiers (info/success/warning/error/critical/permission): thin severity left border + theme-token icon colour, ~8–10px padding, 12px text, no gradients/shadows/shake. `ErrorDisplay` (`errorComponents.ts`) rewritten to emit `.oc-card` with zero inline styles, theme SVG severity icons (no more emoji), technical details collapsed by default with a **Copy** action and an in-place **Details** toggle. `.msg-error` compacted to match. See `docs/design/cards.md`.

### Tests

- `question-block.test.ts` (rewritten for pointer rendering, 12 tests), `question-refresh.test.ts` (3 tests), `main.test.ts` (welcome strip guard), `theme.test.ts` (rate-limit bar reference), `renderer.test.ts` (permission source check moved to `main.ts`), `PendingEventBuffer.test.ts` (sweep + no-TTL tests). Total: 3124 pass, 0 fail.
- `activityCoalesce.test.ts` (11), `streamEndErrorPolicy.test.ts` (7), `errorComponents.dom.test.ts` (8), welcome-guard cases in `tokenCostDisplay.context.test.ts`, and a z-index regression in `sessionListRenderer.moreMenu.test.ts`.

### Docs

- `docs/design/cards.md` — severity model, card anatomy, lifecycle/disclosure, and the deduplication strategy.

## [0.3.12] - 2026-06-07

### Fixed

- **Welcome screen "cannot send prompts" bug.** Root cause: model resolution happened AFTER the welcome view was hidden and textarea cleared, so a missing model silently created an empty tab with a destroyed prompt and no way to recover. (`sendLogic.ts`, `welcomeView.ts`)
  - Model check moved BEFORE `hideWelcomeView()` and textarea clear — no prompt text is lost on validation failure.
  - Send button now gates on model availability — disabled + "Select a model first" tooltip when no model is resolved.
  - Pressing Enter/Send with no model opens the model manager and preserves the prompt text in the textarea.
  - New `.welcome-model-empty-banner` warning banner with "pick a model" link on the welcome screen.
  - Prompt-starter cards now one-click submit (Shift+click for fill-only).
  - `pick_model` error action type added — error blocks on "No model selected" now have a "Pick model" button that opens the model manager.
  - `NO_MODEL_SELECTED` pattern added to `opencodeErrorMapper.ts`.
- **`steer_prompt` type mismatch (B1).** The webview posted `type: "steer_prompt"` but the host only accepted `"send_steer_prompt"` — steer-while-streaming (Ctrl+1/2/3) was silently dropped. (`sendLogic.ts:179`)
- **Type drift in `send_prompt` message.** The `WebviewMessage.send_prompt` discriminated union now declares all runtime fields (`messageId`, `model`, `mode`, `variant`). (`types.ts`)

### Backend

- **Lazy model resolution in `StreamCoordinator.startPrompt()`.** If both `tab.model` and `modelManager.model` are empty at prompt time, awaits `refreshModels()` with a 3s timeout before sending. Catches the init-race where the model list hasn't arrived yet. (`StreamCoordinator.ts`)
- **Deferred `init_state` until model list fetch.** `ChatProvider.pushAllStateToWebview()` now awaits `modelManager.refreshModels()` (2s timeout) before pushing `init_state` to the webview. Eliminates the `globalModel: ""` flash on the welcome screen. (`ChatProvider.ts`)

### Docs

- `welcome-screen-research-notes.md` — Full research document: OpenCode SDK expectations, comparable tools (Cursor/Cline/Windsurf/Claude Code), bug inventory, extracted requirements.
- `CHANGELOG.md` — This entry.
- `AGENTS.md` — `pick_model` action type documented in Error Handling section.
- `docs/frontend-ux-audit.md` — Welcome-screen audit findings in §14.

## [0.3.2] - 2026-06-06

### Changed

- **Header chrome reduced by 62%.** Removed 5 always-visible icon buttons (Checkpoints, Todos, Activity, Tasks, Timeline) from the header toolbar. All moved into the extended Settings overflow menu (`⋮`). Header now shows only History, Skills, and Settings. (`index.html`, `buttonSetup.ts`)
- **Keyboard shortcut reference now accessible.** The `?` / `Shift+/` shortcut opens a keyboard shortcuts modal with 48 shortcuts. Also accessible from the Settings overflow menu and Welcome screen. (`keyboardShortcutsModal.ts`, `main.ts`, `index.html`)
- **Diff action bar consolidated.** Secondary diff actions (Review Changes, Open File) moved into a `⋮` overflow menu on each diff block. Primary Accept/Reject remain visible. (`renderer.ts`, `blocks.css`)
- **Session modal streamlined.** Replaced 5 separate action buttons per session row (Pin, Rename, Tags, Archive, Delete) with a single `⋮` context menu. (`sessionListRenderer.ts`, `sessionListRenderer.pin.test.ts`)
- **Input area simplified.** Moved commands palette button to keyboard shortcut only. Moved instructions editor to settings overflow. Variant selector kept compact (only visible when model supports variants). (`index.html`, `inputHandlers.ts`, `dom.ts`)
- **Queue count badge added.** Shows a numbered badge on the send button when prompts are queued. (`queueRenderer.ts`, `layout.css`, `index.html`)
- **Message search shortcut added.** `Ctrl+F` / `Cmd+F` toggles the message search bar. (`main.ts`)
- **Contextual panel auto-show.** Todos panel auto-opens when pending todos arrive. Subagent panel auto-opens when subagents start running. (`main.ts`)
- **Session model context menu accessible.** Menu items now have proper ARIA labels for screen readers. (`sessionListRenderer.ts`)
- **`isSubagentToolName` accepts `delegate`.** The tool classifier now recognizes the `delegate` tool name as a subagent-spawning task. `parseSubagentInvocation` now handles string-encoded JSON and bare-string prompts. (`toolClassifier.ts`)
- **Status strip compacted.** Cost, token count, and quota bar hidden by default. Model name and context usage bar remain visible. Click context bar to expand details. (`index.html`, `layout.css`)

### Fixed

- **Settings overflow menu auto-closes** when any menu item is clicked.
- **Keyboard shortcut table rendering** fixed for composite shortcuts like `Ctrl/Cmd+Alt+1`.
- **Pre-existing test failures fixed:** `question-bar` CSS contract tests, `subagent-card` CSS contract tests, `subagentCard` detection tests, `tooltips` map tests, `types` export tests, `main.ts` RED structural tests, `error-display` visual test, `messages` visual test narrow-width failures.
- **Streaming/switch lag that worsened the longer a session ran (forced layout).** `VirtualMessageList.pruneOffScreen` no longer calls `getBoundingClientRect()` on every message on each scroll; the visible window is derived from the IntersectionObserver's own intersection state (`visibleIds`) — **241 → 0 forced-layout reads per prune** for a 240-message transcript. Streaming hot-path message lookup uses a reverse-scan `findMessageById` (O(1)). (`virtualList.ts`, `streamHandlers.ts`, `virtualList.prune-perf.test.ts`)
- **Session identity (ADR-014): the local session map key is immutable.** `mergeServerSessions`/`migrateLocalIdsToServerIds` reaffirm `cliSessionId` without rekeying — fixes "messages appear only after reopening" and duplicate sessions on server reconnect/reload. (`sessionMigration.ts`)
- **Context-window override dialog wired** (`open_context_window_override_dialog` → `opencode-harness.setContextWindowOverride`). Subagent/progress activity parts normalized via `ActivityPartHandler`. Plan-mode permissions auto-rejected / auto-mode auto-approved on the host before reaching the webview. (`WebviewEventRouter.ts`, `EventNormalizer.ts`, `ChatProvider.ts`)

### Tooling / Docs

- **`main.ts` `no-explicit-any` reduced to 0** — typed where safe (panel-API handles via `ReturnType`, render opts via `Parameters`, debug global); remaining deps-interface bridges and loose webview-message payloads documented + `eslint-disable`d with justification, per the repo's "no-explicit-any needs review, not blind-fix" policy.
- **`npm run reinstall`** (`scripts/reinstall-extension.mjs`): version-bump → uninstall → build → install → prune stale extension dirs, to stop stale-build / lingering-`.vsix` issues. New agent docs (`AGENTS.md`, `docs/development/rebuild-and-reinstall.md`, `docs/development/concurrent-agents.md`) document the ephemeral-working-tree / **commit-to-preserve** rule and the multi-agent (Claude/Codex/OpenCode) git-worktree workflow.

## [0.3.1] - 2026-06-06

### Changed

- **`formatTokenCount` consolidated to one canonical implementation.** The three independent copies in `context-usage-service.ts` (locale-aware), `tokenCostDisplay.ts` (compact lowercase `k`, **buggy at ≥1M**), and `queueRenderer.ts` (compact uppercase `K`) were unified into a single `formatTokenCount(n, { compact?: boolean })` in `context-usage-service.ts`. The old `tokenCostDisplay.ts` version returned `"1234.6k"` for 1.2M inputs (a real bug) and is now dead code. The dead import in `main.ts:59` and the dead `formatTokenCount` wrapper at `main.ts:1615` were removed. (`src/chat/webview/context-usage-service.ts`, `src/chat/webview/queueRenderer.ts`, `src/chat/webview/composer.ts`, `src/chat/webview/main.ts`, `src/chat/webview/ui/tokenCostDisplay.ts`)
- **`quotaMonitor.ts` reduced from 527 lines to 90.** The class was a 30-second-interval timer with threshold-based warning generation and a callback subscription API, but **no consumer ever subscribed to `onQuotaWarning`** — the entire callback infrastructure, `EnhancedQuotaState` historical-usage fields, `createQuotaError`, `formatTimeUntilReset`, `getQuotaBarColor`, `getQuotaState`, `getWarnings`, `updateConfig`, `getConfig`, `clearState`, and `destroy` were dead. Replaced with a simple state holder that retains the same public API (`updateQuotaState`, `startMonitoring`, `stopMonitoring`, `getState`, `destroy`) for the two callers in `main.ts` that actually use it. The dead import in `streamHandlers.ts:21` was removed. (`src/chat/webview/quotaMonitor.ts`, `src/chat/webview/main.ts`, `src/chat/webview/streamHandlers.ts`)
- **Bundle size documented in `AGENTS.md` now matches the authoritative `scripts/check-bundle-size.mjs`.** The old line `extension.js < 500KB, main.js < 600KB` predated the 2026-06-02 re-baseline; corrected to `extension.js ≤ 510KB, main.js ≤ 680KB (paydown target: 600KB)`. (`AGENTS.md`, `docs/performance-audit.md`, `docs/performance-research-notes.md`, `docs/adrs/ADR-011-tooltip-system.md`)

### Fixed

- **`formatTokenCount` ≥1M regression bug.** The old `tokenCostDisplay.ts::formatTokenCount` returned `"1234.6k"` for inputs of 1,234,567 instead of the expected `"1.2M"` — it capped at the thousands tier and never graduated. The new canonical implementation in `context-usage-service.ts` correctly handles K/M/B tiers. (`src/chat/webview/context-usage-service.ts`)
- **Quota monitor `formatTimeUntilReset` displayed wrong hour/minute breakdown.** The old code computed `seconds = ms/1000`, `minutes = seconds/60`, `hours = minutes/60` and then displayed `${hours}h ${minutes % 60}m` using the *un-modular* `minutes` — so for a 90-minute duration it would have shown `1h 90m`. (Only relevant in the new QuotaMonitor API if a future caller formats a reset countdown.) (`src/chat/webview/quotaMonitor.ts`)
- **Quota monitor `updateQuotaState` rejected invalid `resetAt` dates by storing `NaN`.** The old code passed the raw `new Date(invalidString)` (which is a `Date` whose `getTime()` is `NaN`) into `calculateTimeUntilReset`, which only checked `isNaN(state.resetAt.getTime())` — but the `EnhancedQuotaState` stored it in `timeUntilReset: 0` and persisted the broken `Date`. The new version coerces to `null` and defends in tests. (`src/chat/webview/quotaMonitor.ts`)
- **Streaming/switch lag that worsened the longer a session ran (forced layout in the virtual list).** `VirtualMessageList.pruneOffScreen` recomputed the visible window by calling `getBoundingClientRect()` on **every** message element — detached placeholders included, since they keep `data-message-id` — on **every** `IntersectionObserver` callback. That callback fires on each auto-scroll during streaming and on the scroll-restore when switching into a session, so it ran an O(total-transcript) synchronous layout flush many times a second; it grew with accumulated history. It now derives the visible window from the observer's own intersection state (`visibleIds`) plus a single `clientHeight` read: **241 → 0 `getBoundingClientRect` reads per prune** for a 240-message transcript. (`src/chat/webview/virtualList.ts`, regression test `src/chat/webview/virtualList.prune-perf.test.ts`)
- **Streaming hot-path message lookup no longer scans the whole transcript.** The render-flush / tool / diff / skill handlers used `Array.find` (front-scan) to locate the streaming message, which is always the *last* element — an O(N) walk on every render flush that grew with the conversation. Extracted `findMessageById` (reverse scan, O(1) for the common case). (`src/chat/webview/streamHandlers.ts`, test `src/chat/webview/findMessageById.test.ts`)

### Removed

- **Dead code files (7 total).** `planDetector.ts` (stale duplicate; live copy inlined in `toolCallRenderer.ts`), `tooltipHelpers.ts` (never wired to any DOM element), `subagentTypes.ts` (completely orphaned type definitions), `questionModel.ts` (unused re-export shim), and their associated test files were deleted. (`src/chat/webview/planDetector.ts`, `src/chat/webview/tooltipHelpers.ts`, `src/chat/webview/subagentTypes.ts`, `src/chat/webview/questionModel.ts`)
- **Auto-mode warning modal (anti-pattern).** Research showed no competitor (Cursor, Cline, Kilo Code, Windsurf) uses a confirmation modal when switching to auto/autonomous mode — users explicitly choose Auto mode, treat that as consent. The modal HTML, CSS (~90 lines), component module, and its test were deleted. (`src/chat/webview/ui/modeWarning.ts`, `src/chat/webview/css/layout.css`, `src/chat/webview/index.html`)
- **Dead HTML comments.** Three stale comments referencing old panel locations (`#context-usage-panel`, `#context-monitor-panel`, `#changed-files-list`) were removed from `index.html`. (`src/chat/webview/index.html`)
- **Dead wrapper `resetContextUsagePanel()` inlined.** The function was a no-op wrapper around `resetContextUsageDropdown()` after its underlying `context-usage-panel.ts` was removed. Calls replaced with inline code. (`src/chat/webview/main.ts`)
- **Dead imports cleaned up in `main.ts`.** `removePromptToken` and `parsePromptMentions` were imported from `./ui/attachments` but never used in that file. (`src/chat/webview/main.ts`)
- **Dead `formatTokenCount` from `tokenCostDisplay.ts`.** Zero production callers; only imported into `main.ts` where it was then re-wrapped but never called. (`src/chat/webview/ui/tokenCostDisplay.ts`)
- **Dead `formatTokenCount` wrapper in `main.ts`.** Function defined at `main.ts:1615` was never invoked. (`src/chat/webview/main.ts`)
- **Dead `getQuotaMonitor` import in `streamHandlers.ts`.** Imported but never used. (`src/chat/webview/streamHandlers.ts`)

### Tests

- **8 new tests for `formatTokenCount` compact mode** in `context-usage-service.test.ts`. Cover K/M/B tiers, sign preservation, ≥1M regression test (the bug that motivated the consolidation), and NaN/Infinity/string defenses.
- **Rewrote `quotaMonitor.test.ts` for the simplified API.** 7 tests covering empty initial state, snapshot persistence, invalid date coercion to `null`, no-op `startMonitoring`/`stopMonitoring` idempotency, `destroy` reset, singleton behavior, and `resetQuotaMonitor` instance replacement.

### Build

- `dist/extension.js` reduced by **40.9 KB** (907.7 → 866.8 KB) from the `quotaMonitor.ts` simplification.
- `dist/chat/webview/styles.css` reduced by **~22 KB** (320 → 309 KB) from the dead mode-warning CSS removal.

## [0.3.0] - 2026-06-02

### Added

- **Input-area question dock (`questionBar.ts`).** The interactive question-answering surface (options, free-text, submit) now lives in the input bar instead of inline in the message transcript. When the model asks a `question` tool call, the input bar shows the question with option buttons and a Submit button. The transcript shows either a pending chip ("Answer in input bar") or an answered record. (`src/chat/webview/index.html`, `src/chat/webview/questionBar.ts`, `src/chat/webview/css/components.css`, wiring in `main.ts`)
- **Question answer persistence.** Answers are stored on the `QuestionBlock` as `answered`/`answer`/`answerSource` fields, persisted in the session's message array so returning to a session shows what was chosen. (`src/chat/webview/types.ts`)
- **`onQuestionBlock` callback on `StreamCallbacks`.** Main.ts wires this into the input-area question dock whenever a question tool block is created or refreshed mid-stream. (`src/chat/webview/streamHandlers.ts`)
- **Session-switch question bar re-hydration.** `switchTab()` now clears the question bar and re-populates it from the switched session's unanswered question blocks. (`src/chat/webview/main.ts`)
- **Speech-to-text prompt input.** The composer now has a microphone button with browser SpeechRecognition support and opt-in OpenAI transcription. Transcripts insert into the prompt for review and never auto-send. OpenAI keys are stored in VS Code SecretStorage. (`src/chat/webview/voiceInput.ts`, `src/chat/VoiceInputService.ts`, `src/chat/voiceInputCore.ts`, `package.json`)

### Changed

- **Steer-mode selector now uses correct CSS class.** The old `setSteerMode` queried `.steer-option` (nonexistent) on an undefined element ref, so previously-active buttons were never deselected and several modes appeared selected at once. Fixed with `applySteerModeUI()` that queries `.steer-mode-btn` and syncs both `active` class and `aria-pressed`. (`src/chat/webview/sendLogic.ts`)
- **`syncSteerModeUI()` exposed on `ComposerAPI`.** Re-asserts the current steer mode's visual state when the selector reappears mid-stream. (`src/chat/webview/composer.ts`)
- **Question block in transcript is now a non-interactive record.** The `renderQuestionBlock` function no longer renders option buttons, textarea, or submit. Pending questions show a "Answer in input bar" chip; answered questions show an echo card with the question text and user's answer. (`src/chat/webview/renderer.ts`)
- **`renderer.ts` `RenderOptions` now has an `onAnswered` callback** for persisting answer state on the block. (`src/chat/webview/renderer.ts`)
- **`refreshQuestionBlock` guarded against overwriting answered blocks.** A mid-stream refresh after the user answered no longer wipes the answer. (`src/chat/webview/streamHandlers.ts`)

### Fixed

- **Activity and Tasks panels are now actually wired.** Their toolbar buttons, panel roots, `ElementRefs`, CSS imports, initialization, active-session refresh, and unload disposal are all connected. This fixes both strict type failures and the runtime no-op where the modules existed but the bundled HTML had no matching nodes. (`src/chat/webview/index.html`, `src/chat/webview/dom.ts`, `src/chat/webview/main.ts`, `src/chat/webview/css/styles.css`)
- **Rate-limit exhausted messages preserve structured reset time.** The webview now reads `rate_limit_exhausted.info.resetAt` and passes it to both the input-area banner and in-stream error text. (`src/chat/webview/main.ts`)
- **Unified session list pin/rename/tags completed end-to-end.** Pinned sessions sort first, render a marker, pin buttons post `pin_session`, inline rename posts `rename_session`, tags post `set_session_tags`, and the host persists pin/tag metadata in `SessionStore`. (`src/chat/webview/sessionListRenderer.ts`, `src/session/SessionStore.ts`, `src/chat/WebviewEventRouter.ts`, `src/chat/WebviewMessageValidator.ts`)
- **Provider config commands no longer call a nonexistent `SessionManager.updateConfig`.** Local config writes still refresh models; when a local server is already running, the user gets a restart/reconnect warning instead of an impossible live patch attempt. (`src/commands/addProvider.ts`, `src/commands/ollama.ts`)

### Tests

- Added regression coverage for Activity/Tasks HTML wiring, `rate_limit_exhausted.info.resetAt`, provider command config boundaries, steer-mode UI sync, and session pin/rename/tag behavior. (`src/chat/webview/main.test.ts`, `src/commands/providerConfigCommands.test.ts`, `src/chat/webview/steerMode.test.ts`, `src/chat/webview/sessionListRenderer.pin.test.ts`)
- Added STT coverage for settings normalization, state transitions, MIME/base64/size validation, stale request handling, missing API key errors, disabled-provider errors, transcript cleanup, unsupported browser fallback, and message contracts. (`src/chat/voiceInputCore.test.ts`, `src/chat/VoiceInputService.test.ts`, `src/chat/WebviewMessageValidator.voiceInput.test.ts`, `src/chat/webview/voiceInput.test.ts`, `tests/webview/message-contract.test.ts`)

## [0.2.23] - 2026-05-31

### Fixed

- **Model variant selector now actually sends the variant with prompts.** The variant was stored in session state but silently dropped when building the `send_prompt` message — no variant was ever passed to the server. The message now reads the variant from the active session (falling back to `globalVariant`) and includes it in the payload. (`src/chat/webview/sendLogic.ts`)
- **Variant selection persisted locally before host roundtrip.** The `onSelect` callback only posted a `set_variant` message to the host without updating local state, creating a window where the webview state was inconsistent until the host echoed back. Selection now calls `setSessionVariant` and `setGlobalVariant` synchronously before posting. (`src/chat/webview/main.ts`)
- **Variant selector restored on tab switch.** Switching tabs synced the model dropdown but left the variant selector showing the previous tab's value. `switchTab()` now restores the variant from the active session (falling back to global, then "Default"). (`src/chat/webview/main.ts`)
- **New sessions inherit global variant.** `createSession()` now spreads `globalVariant` into new sessions, matching the pattern already used for `globalModel`. (`src/chat/webview/state.ts`)

## [0.2.22] - 2026-05-30

### Added

- **Crash resilience (ADR-010 Phase 1.5):** Tabs survive CLI crashes. On server disconnect, streaming tab state is captured as `TabRestorationState` and persisted to `globalState`. On reconnect, interrupted tabs receive `stream_interrupted` messages with "Resume Stream" / "Dismiss" buttons. (`src/session/sessionTypes.ts`, `src/chat/TabManager.ts`, `src/chat/ChatProvider.ts`, `src/chat/webview/main.ts`, `src/chat/webview/types.ts`, `src/chat/webview/css/messages.css`)
- **Multi-process infrastructure (ADR-010 Phase 2):** `LocalSessionProcessManager` wraps N `ServerLifecycle` instances with crash detection. `SessionManagerRegistry` provides tab→process routing. `PortPool` allocates ports atomically without TOCTOU races. (`src/session/LocalSessionProcessManager.ts`, `src/session/SessionManagerRegistry.ts`, `src/utils/portPool.ts`)
- **Configurable stream cap:** `opencode.sessions.maxConcurrentStreams` setting (default 5, range 1-10). Replaces hardcoded 3-stream limit. Webview receives value via `init_state` and updates at runtime. (`package.json`, `src/chat/TabManager.ts`, `src/chat/webview/sendLogic.ts`, `src/chat/webview/main.ts`)

### Changed

- **ADR-010 status updated** from "Proposed" to "Partially implemented" with detailed Phase 1.5 and Phase 2 documentation. (`docs/adrs/ADR-010-horizontal-scaling.md`)
- **SessionProcessManager interface aligned** with ADR: added `onCrash` events, `Disposable` compliance, `isolatedDataDir` config. (`src/session/SessionProcessManager.ts`)

### Fixed

- 5 pre-existing structural test failures resolved (DOMPurify check, mention button, StreamLifecycleState, TabManager stream cap, TTFB signal property). (`tests/unit/hardening-sweep.test.mjs`, `tests/unit/regression-smoke.test.mjs`, `tests/unit/stream-coordinator-timeout.test.mjs`, `tests/unit/tab-manager.test.mjs`, `tests/unit/ttfb-abort.test.mjs`)

## [0.2.21] - 2026-05-30

### Security

- Hardened remote attach and MCP configuration: non-loopback remote server URLs now require HTTPS, legacy plaintext remote auth settings migrate into SecretStorage and are cleared, MCP server names/configs/tool names are validated, and prompt-injection scanning now covers full file contents with basic homoglyph normalization. (`src/utils/security.ts`, `src/migrations/authTokenMigration.ts`, `src/mcp/McpServerManager.ts`, `src/chat/WebviewMessageValidator.ts`)
- Documented the already-enforced nonce-based webview CSP and updated configuration guidance for remote auth and MCP validation. (`docs/configuration.md`, `docs/TechSpec.md`, `README.md`)

### Fixed

- **Changed-files diff expansion now works, and large diffs no longer freeze the webview.** The webview asked for per-file diffs (`get_file_diff`) but the host never answered (`file_diff_response` was never emitted), so expanding a changed file showed nothing. The host now reads the file from the opencode server (`client.file.read`, which returns the authoritative server-computed `patch.hunks`/unified `diff`) and normalizes it into `DiffLine[]` via a new pure converter. Separately, the in-chat diff renderer rendered one DOM row per line synchronously with no cap — a latent freeze on whole-file changes; it now caps eager rows at 500 with a one-click "Show all changes" expander, mirroring the dropdown's 60-line cap. See `docs/specs/2026-05-30-diff-handling-architecture.md` for the full review and proposed Phase 2–4 work (off-thread normalization, virtualization, "Open in editor", decommissioning the dead inline-apply pipeline). (`src/chat/diff/sdkFileContentToDiffLines.ts`, `src/chat/WebviewEventRouter.ts`, `src/session/SessionManager.ts`, `src/session/SessionClient.ts`, `src/chat/webview/renderer.ts`)
- **"Question from model" block now renders and works mid-stream.** The model's question and its answer options were silently dropped (the block showed an empty textarea + a dead Submit) because the block was built once from often-empty `stream_tool_start` args, never refreshed when the input finished streaming, and rendered without a `postMessage` callback. Question-tool args are now normalized defensively (flat `{question,options}` **and** Claude-style nested `{questions:[…]}`) via the pure `parseQuestionArgs`; the block is refreshed in place on `stream_tool_update`; `postMessage` is threaded into the streaming render path so options/Submit are interactive immediately; the question is persisted as a real `question` block (host `blocksBuffer` + SDK backfill) and merged at `stream_end` instead of being clobbered into a tool card. Multiple question groups and multi-select are now supported. (`src/chat/webview/questionModel.ts`, `src/chat/webview/renderer.ts`, `src/chat/webview/streamHandlers.ts`, `src/chat/webview/stream.ts`, `src/chat/webview/streamEndHandler.ts`, `src/chat/webview/main.ts`, `src/chat/handlers/StreamCoordinator.ts`, `src/session/sdkMessageConverter.ts`)
- Activation now explicitly declares `onStartupFinished`/chat-view activation, and unhandled promise rejections are counted, logged with diagnostics, and detached on dispose instead of being only one-off log lines. (`package.json`, `src/extension.ts`)
- Workspace-folder changes now handle all folders added in a single event instead of only the first. (`src/extension.ts`)
- Inline completions no longer register for every file or display a placeholder TODO ghost text; they are limited to code document selectors and disabled by default until server-backed completions are wired end-to-end. (`src/extension.ts`, `src/inline/InlineCompletionProvider.ts`, `package.json`)
- Rate-limit observed token/cost usage now persists across extension reloads, preserving the quota/cost picture for the active provider. (`src/monitor/RateLimitMonitor.ts`)
- Subagent cancellation now reports an explicit unsupported request error instead of carrying TODO stubs. (`src/chat/WebviewEventRouter.ts`)

### Build / Tooling

- Removed tracked local scratch/repair artifacts and expanded ignore rules for generated VSIX files, reports, scratch output, typecheck dumps, and local agent configuration directories. (`.gitignore`)
- Tightened Playwright screenshot thresholds to catch smaller visual regressions. (`playwright.config.ts`)

## [0.2.20] - 2026-05-30

### Changed

- **Plan / Build / Auto mode policy centralized** — mode normalization, Plan-mode permission decisions, and legacy `"normal"` handling now flow through a shared policy module so the webview, router, and host stay aligned. Build is the documented standard approval mode; Auto remains the local UX mode that auto-approves permissions after confirmation. (`src/chat/modePolicy.ts`, `src/chat/WebviewEventRouter.ts`, `src/chat/webview/ui/modeDropdown.ts`)
- **Permission mode UX** — the mode selector now exposes tooltips/ARIA labels and keyboard shortcuts (`Ctrl/Cmd+Alt+1` Plan, `Ctrl/Cmd+Alt+2` Build, `Ctrl/Cmd+Alt+3` Auto). Webview mode switches wait for host acknowledgement before updating visible state. (`src/chat/webview/ui/modeDropdown.ts`, `src/chat/webview/main.ts`)
- **`RateLimitMonitor` extracted into `rateLimitCore.ts`** — pure functions (`safeParseInt`, `parseDuration`) and all three adapters (`OPENAI_ADAPTER`, `ANTHROPIC_ADAPTER`, `GENERIC_ADAPTER`) now live in `src/monitor/rateLimitCore.ts`, testable without the `vscode` module. `RateLimitMonitor.ts` re-exports them for zero-impact on callers. (`src/monitor/rateLimitCore.ts`, `src/monitor/RateLimitMonitor.ts`)
- **`QuotaMonitor` division-by-zero** now returns `undefined` instead of 100% — previously, when limits were unknown/zero, `calculateTokenPercentage` and `calculateRequestPercentage` returned 100% (looked perfectly healthy) or `NaN` (silently propagated). Both now return `undefined`; `generateWarnings()` and `getCurrentWarningLevel()` filter out `undefined` values. (`src/chat/webview/quotaMonitor.ts`)

### Performance

- **Changed-Files dropdown no longer freezes the webview during streaming** — rapid `changed_files_update` messages are coalesced into a single `requestAnimationFrame` render instead of a full-tree `innerHTML` rebuild per message; expand/collapse mutates only the affected row; the bottom strip is skipped when its file set is unchanged and binds its click handler once; the resize→reposition handler is rAF-throttled; and diff-line previews build via a `DocumentFragment`. (`src/chat/webview/changed-files-dropdown.ts`)

### Fixed

- **User prompts no longer render as `PROPOSED PLAN`** — plan-prose formatting is now assistant-only, so a user's plan-shaped request in Plan mode stays a normal user message while assistant planning output still receives the proposed-plan treatment. (`src/chat/webview/renderer.ts`, `src/chat/webview/messageRenderer.ts`)
- **Plan-mode permission exception narrowed** — Plan mode only auto-approves direct file mutations for `.opencode/plans/*.md`; shell/external-directory requests that merely mention a plan path are rejected like other mutating permissions. (`src/chat/modePolicy.ts`, `src/chat/WebviewEventRouter.ts`, `src/chat/ChatProvider.ts`)
- **Auto-mode confirmation state** — the webview "Don't show again" checkbox now persists the same `opencode.autoModeConfirmed` flag used by the host, and confirming the warning closes the modal through the normal focus-cleanup path. (`src/chat/webview/ui/modeWarning.ts`, `src/chat/WebviewEventRouter.ts`, `src/chat/ChatProvider.ts`)
- **Invalid `change_mode` payloads rejected** — missing or unknown mode values no longer pass validation; cancelled or invalid host-side mode changes emit `mode_change_result` so the webview can keep the previous mode visible. (`src/chat/WebviewMessageValidator.ts`, `src/chat/WebviewEventRouter.ts`, `src/chat/webview/types.ts`)
- **`ErrorHandler.retryWithBackoff` jitter compounding** — jitter was applied to the running `currentDelay` variable, so the randomised value was multiplied by the backoff factor in subsequent attempts, producing unpredictable (sometimes tiny) delays. Jitter is now applied to a *copy* of `currentDelay` so exponential backoff always compounds the clean value. (`src/chat/webview/errorHandler.ts`)
- **`ErrorHandler` correlation ID generation** — previously used `Date.now().toString(36) + Math.random().toString(36).slice(2)`, which was predictable under rapid succession. Now uses `crypto.randomUUID()` when available, with the old `Date.now()`-based approach as a fallback. (`src/chat/webview/errorHandler.ts`)
- **`acquireVsCodeApi()` called once** — `ErrorHandler.logError()` called `acquireVsCodeApi()` on every invocation. Now called once in the constructor, cached in `this.vscodeApi`. (`src/chat/webview/errorHandler.ts`)
- **`shouldUseOpencodeMapper` whitelist** — previously matched any error with a truthy `name` property, which incorrectly routed plain `Error` objects (which have `name = "Error"`) away from `classifyError()`'s message-based logic. Now excludes `name === "Error"` and only routes known SDK error names or objects with `statusCode`/`isRetryable` flags. (`src/chat/webview/errorHandler.ts`)
- **`RateLimitMonitor` sliding-window data loss** — `recordTokenUsage()` had a 60-second local-clock check that silently discarded cross-boundary usage data. Removed the elapsed-based reset block and the now-dead `lastResetTime` field. Resets now occur only on provider switch or `updateFromHeaders()` (driven by server headers). (`src/monitor/RateLimitMonitor.ts`)
- **`parseDuration` silent fallback** — when the format was unrecognised (e.g. `"10x"`), it fell back to `new Date(Date.now() + 60000)` without warning. Now logs a warning and returns `undefined`. (`src/monitor/RateLimitMonitor.ts`)
- **`safeParseInt` NaN propagation** — `parseInt()` of non-numeric headers (`"abc"`, `""`, `null`) returned `NaN`, which flowed through to the UI as `NaN%`. New `safeParseInt()` helper checks `Number.isFinite(n)`, logs a warning, and returns `undefined` instead. Applied to all three adapters. (`src/monitor/RateLimitMonitor.ts`)
- **Todos streaming cross-tab leak** — server-side todos were stored in a single module-scoped `currentTodosList` in `main.ts`, so a background tab's `todos.updated` event poisoned the active tab's next render. Promoted to `serverTodosBySession: Map<sid, Todo[]>`; `todos_update` now writes per-session and only renders when the message belongs to the active tab. `closeTab` drops the entry. Unknown/missing `sessionId` updates are logged + dropped instead of silently rewriting active-tab state. (`src/chat/webview/main.ts`)
- **Todos status drift between SSE and REST** — the REST path normalized `in_progress → in-progress`; the SSE path did not, so live status updates fell out of the `applyTodoFilter("in-progress")` / `"active"` filters and `calculateProgress` mis-counted. Normalization moved into `TodoUpdatedHandler` (`normalizeTodoStatus` / `normalizeTodoList`) so both ingress paths emit canonical strings. `WebviewEventRouter.get_todos` shares the helper. (`src/session/eventHandlers/TodoUpdatedHandler.ts`, `src/chat/WebviewEventRouter.ts`)
- **Server todos no longer toggled-then-denied** — the webview optimistically wrote `session.todoOverrides[todoId]` and persisted before posting `toggle_todo`; the host always replied `todo_operation_denied`, but the override stayed in `globalState` and kept winning the merge across restarts. Server todos are now read-only at the UI (`todo-checkbox--readonly`, no delete button, no `tabindex`); `toggle_todo`, `delete_todo`, and the `todo_operation_denied` handler/route are removed from the protocol. User-created todos (id prefix `todo-`) remain fully interactive. (`src/chat/webview/main.ts`, `src/chat/webview/todos-panel.ts`, `src/chat/WebviewEventRouter.ts`)
- **`todos-panel.ts` initialization silently broken** — the setup function checked `els.changedFilesPanelList`, a property that never existed in `ElementRefs`. The check always failed, the panel logged `"Todos panel elements not found"`, and returned early — leaving the panel dead at runtime. Dead reference removed; `els: any` replaced with `Pick<ElementRefs, …>` so the next missing key is a compile error. Same `els: any` removed from `subagent-panel.ts`. (`src/chat/webview/todos-panel.ts`, `src/chat/webview/subagent-panel.ts`)
- **Focus-preserving todo list reset every render** — `renderFilteredTodos` called `container.innerHTML = ""` then `updateTodoList(null, …)`, recreating the `<ul>` on every render and defeating the diff's stable-node intent. Now reuses the existing `<ul>`, only rebuilding the progress + filter bar; the diff updates items in place. (`src/chat/webview/todos-panel.ts`)
- **Subagent panel hardening** — status string now whitelisted before being interpolated into a class token; streaming stdout has ANSI/C0 control bytes stripped before `textContent` assignment. Document-level Escape listeners on both panels are now removable via `dispose()` (called from `beforeunload`) so HMR/test reset can't pile up handlers. (`src/chat/webview/subagent-panel.ts`, `src/chat/webview/todos-panel.ts`, `src/chat/webview/main.ts`)
- **`addUserTodo` duplicate check** — compared raw `.toLowerCase()` strings, so NFC vs NFD Unicode variants of the same visible content slipped through. Both sides of the comparison now go through `.normalize("NFC")`. (`src/chat/webview/main.ts`)

### Tests

- **New mode regression tests** — `modePolicy.test.ts`, `WebviewMessageValidator.mode.test.ts`, `messageRenderer.planMode.test.ts`, `modeDropdown.test.ts`, and `modeWarning.test.ts` cover Plan permission policy, invalid mode rejection, user-vs-assistant plan rendering, host-acknowledged mode changes, tooltips/shortcuts, and Auto warning persistence/focus cleanup.
- **New `src/monitor/RateLimitMonitor.test.ts`** — 17 tests covering `safeParseInt` (undefined/null/non-numeric/valid), `parseDuration` (s/m/h + malformed), all three adapters (valid headers, null returns, NaN-rejection, empty headers), and adapter priority semantics.
- **New `src/chat/webview/errorHandler.test.ts`** — 24 tests covering `classifyError` (7 categories + fallback + string/null/undefined), `handleError` (opencode mapper routing, session/message IDs, suppressed actions), `retryWithBackoff` (first-attempt success, max-attempts, jitter cap, disabled retry), `generateCorrelationId` uniqueness, error history (tracking, handled/recovery markers, size limit), `getErrorStats`, and runtime config updates.
- **Restored Changed-Files dropdown features required by `todos-panel.test.ts`** — the consolidated dropdown regained its summary bar (`.cf-summary-bar` with file count + total added/removed), directory grouping (`.cf-dir-group`), collapse-all control (`.cf-collapse-all-btn`), and per-row open button (`.cf-open-btn`), which an in-progress rewrite had dropped, breaking 8 committed assertions. (`src/chat/webview/changed-files-dropdown.ts`)
- **New `changed-files-perf.test.ts`** — guards the freeze fix: rapid updates coalesce into one `requestAnimationFrame` render, and expanding a row mutates only that row instead of rebuilding the tree.
- **New `src/session/eventHandlers/TodoUpdatedHandler.test.ts`** — 12 contract tests pinning the canonical status set (`pending` / `in-progress` / `completed`), malformed-todo filtering, and missing-properties tolerance so the SSE and REST paths cannot diverge again.
- **New `src/chat/webview/todos-panel.dom.test.ts`** — 11 JSDOM tests covering progress gauge `--p` setting, filter-tab rendering and click filtering, read-only server todos (no toggle/delete affordance), `updateTodoList` DOM-node stability across renders, toast lifecycle, and `dispose()` Escape-listener removal. Replaces the pre-existing `todos-panel.test.ts` which actually tested `changed-files-dropdown` and has been renamed accordingly.
- **`main.test.ts` regression guards** — five new source-grep assertions pin the per-session todos map, `todos_update` unknown-`sessionId` warn-and-drop, `closeTab` cleanup of `serverTodosBySession`, and confirm the dead `toggle_todo` / `delete_todo` / `todo_operation_denied` routes are gone from both webview and `WebviewEventRouter`.

### Notes

- **Diff-handling review finding** — the inline "Diff → Review → Apply" pipeline (`DiffHandler.register`, `DiffApplier.parseCodeBlocks/acceptEdit/applyHunks/showSideBySideDiff`, the webview `handleDiff` block and accept/reject/hunk handlers) is currently **unreachable**: nothing emits a `type:"diff"` event or registers a `ProposedEdit`. File edits are applied by the opencode server itself and surfaced through the (now-performant) Changed-Files reflection path. The pipeline was left in place pending a decision to wire it end-to-end or remove it; its internal diff-format inconsistencies (`computeUnifiedDiff` emits no `@@` headers, so `parseUnifiedDiff` returns `[]`) and `applyHunks` range clamping remain documented but untouched while the path is dead.

## [0.2.19] - 2026-05-29

### Fixed

- **Methodology module: audit-log memory leak** — `CascadeRouter` audit log now capped at `MAX_AUDIT_ENTRIES = 1000` entries, preventing unbounded memory growth in long-lived sessions. (`src/methodology/CascadeRouter.ts`)
- **Methodology module: `compiles` metric accepted markdown-fenced non-code** — `QualityEvaluator.compiles` now requires `looksSyntacticallyValid()` (balanced-brace heuristic) instead of only checking for markdown code fences. (`src/methodology/QualityEvaluator.ts`)
- **Methodology module: non-deterministic task-type detection on ties** — `TaskClassifier.detectTaskType()` now uses a `TASK_TYPE_PRIORITY` map for deterministic tie-breaking when multiple task types score equally. (`src/methodology/TaskClassifier.ts`)
- **Methodology module: specificity scoring inflated by raw threshold values** — `MethodologyCatalog.ruleSpecificity()` now counts constraint *presence* only, not raw `minComplexity`/`minFileScope` threshold values. (`src/methodology/MethodologyCatalog.ts`)
- **Methodology module: low-complexity generate tasks matched over-broad rules** — Added a dedicated low-complexity generate rule (`direct-execution`, tier B) and reordered `bmad-full` before `bmad-lite` so the more restrictive rule matches first. (`src/methodology/MethodologyCatalog.ts`)
- **Methodology module: duplicated chain-building logic in CascadeRouter** — Extracted shared `buildChain()` helper, removing ~40 lines of duplicated logic from `buildRecommendationChain`/`buildEscalationChain`. (`src/methodology/CascadeRouter.ts`)
- **Methodology module: unnecessary async on PlanValidator.validate()** — `PlanValidator.validate()` is now synchronous; removed all `async`/`Promise` wrappers. (`src/methodology/PlanValidator.ts`)
- **Methodology module: sub-question count inflated by code blocks** — `TaskClassifier` now strips code blocks before counting semicolons for sub-question estimation. (`src/methodology/TaskClassifier.ts`)

### Changed

- Streaming "minors" cleanup: centralized the tool-call state → CSS-class / badge-text map (`setToolStateClass` + `toolBadgeText`) so `handleToolUpdate` and `handleToolEnd` share one source of truth; tool-block dedup at `stream_end` is now id-authoritative (`sameToolBlock` — two distinct calls with identical args no longer merge, and the `JSON.stringify(args)` comparison is skipped when ids are present); the server-status `error` path now persists onto the real session messages instead of an empty array + no-op save; typed the webview log API handle (removed an `any`); added an observability warning when a stream bubble is unexpectedly absent.

## [0.2.18] - 2026-05-29

### Added

- **Stable-tail streaming renderer** (`LiveTextRenderer` + `streamTail.splitAtStableBoundary`): freezes closed markdown blocks and re-parses only the unstable tail, replacing the per-flush full-buffer re-parse (O(N·k) → near-linear). Frozen blocks are cache- and worker-eligible; text selection and `<details>` open-state survive mid-stream. ADR: `docs/adrs/2026-05-29-stable-tail-streaming-render.md`.
- Pure modules with unit/property/bench tests: `streamTail`, `liveTextRenderer`, `messageUpsert`, `placeholderContent`, `backfillPlanner` (+ shared `streamHarness`, `streamBench`).

### Fixed

- **Streaming correctness**: no more duplicate persisted assistant message at `stream_end` (upsert-by-id); `stream_start` is restartable for a new message id; inter-tool streamed text is no longer dropped at tool boundaries; `stream_end` placeholder removal preserves tool-only turns.
- **Backfill**: concurrent history fetches deduped by `cliSessionId` via a single `hydrate()` single-flight; all pending sessions processed instead of `slice(0, 10)`.
- **Repository consolidation**: resolved leftover merge-conflict markers committed by an earlier botched `fix/show-thinking-and-compact-tools` merge (`ModelManager.ts`, `main.ts`, `toolGrouping.test.ts`), restoring a typecheckable tree; fixed a stale renderer streaming-markdown test to match the corrected single-pass fence/inline-code scanner.

### Merged

- `fix/commands-palette-routing` (command-palette slash routing). Other feature branches (`markdown-renderer-correctness`, `conversation-history-live-search`, `context-usage-counter`, `show-thinking-and-compact-tools`, `chat-webview-performance`) were already absorbed into `master`.

### Performance

- Streaming markdown: `stripContextFromText` skips the lazy strip regex when no `<context>` marker is present; `mergeStreamText` overlap probe bounded to 256 chars; `seenEventIds` trimmed per stream; live buffer soft-cap diagnostics.

## [0.2.15] - 2026-05-23

### Fixed

- **Context window now resolves for models the opencode server doesn't report `limit.context` for** — the 0.2.13 fix only papered over the bug. The `opencode.contextWindowOverride` setting was only consulted inside an `if (ctxWindow)` guard, so when the server returned no window (kimi-k2.5, deepseek-v4-flash-free, most OSS / free-tier models) the override was silently ignored. `ChatProvider.applyContextWindowFor` now applies the override regardless, plus reacts live to `onDidChangeConfiguration` so a new override value takes effect without an extension reload. (`src/chat/ChatProvider.ts`)

### Added

- **Cross-provider context-window fallback via OpenRouter's `/api/v1/models`** — when the opencode server doesn't report `limit.context` for a model, `resolveContextWindow` now consults a cached catalogue from OpenRouter. Same model weights typically share the same window regardless of which provider hosts them, so kimi-k2.5 served by any host hits OpenRouter's canonical `200_000` entry. The catalogue is fetched on first model-refresh, persisted to `globalState` with a 24h TTL, and refreshed in the background. Resolution order: server → OpenRouter → user override → unknown. No hand-curated tables; no provider drift.
- **Clickable "set limit ⚙" affordance on the per-tab context monitor** — when both the server and OpenRouter come up empty, the monitor row now reads `N tok · set limit ⚙` and clicking it opens the `Set Context Window Override` dialog directly. Previously the user got a tooltip that told them to find the command in the palette.
- **`open_context_window_override_dialog` webview message type** — routes the click above through the established webview-event-router validation path.

### Tests

- New `src/model/openRouterMetadata.test.ts` — 9 behavioral tests covering payload parsing, short-id cross-provider lookup, case-insensitive matching, cache-freshness TTL, and graceful degradation on missing/junk data.
- Extended `src/model/contextWindowResolver.test.ts` with 5 tests pinning the OpenRouter fallback path: cache consultation, short-id fallback, server-still-wins, miss-then-log behaviour, happy-path silence.
- Updated `src/chat/webview/theme.test.ts` to assert the new "set limit" hint and `needs-override` click marker.

## [0.2.14] - 2026-05-23

### Fixed

- **Tool calls now actually group into a single codex-style row** — the 0.2.12 CSS work shrank each tool row but consecutive tool calls still stacked one per line. Two root causes:
  1. `groupConsecutiveToolCalls` treated every non-tool block as a group-breaker, so SDK lifecycle blocks (`step-start`, normal `step-finish`) split runs of tools into single-element groups. The grouper now treats these silent lifecycle blocks as transparent: they don't break tool runs and don't reset the last tool name/class. Visible non-tool blocks (text, diffs, errors, abnormal step-finish) still legitimately break grouping.
  2. The live-streaming append path (`handleToolStart`) was bypassing the grouper entirely — every new tool was appended directly to the bubble. A new helper `appendOrFoldToolDOM` now folds the new tool into the prior `details.tool-group` (or wraps the prior single tool + the new tool into a fresh group) at append time, so the codex-style grouped view shows live, not just after stream end. The previous tool's live DOM is moved into the group rather than re-rendered, preserving runtime state (args panel, result panel, duration, error class) that `handleToolUpdate` / `handleToolEnd` write directly without updating `msg.blocks`.

### Tests

- New `src/chat/webview/toolGrouping.test.ts` — 8 behavioral tests for the grouper covering: three consecutive tools across step-finish blocks → one group of 3; step-start transparency; hyphenated normal-finish reasons; text breaks grouping; abnormal step-finish breaks grouping; lifecycle blocks preserved in output; tools-then-lifecycle-tail.
- Extended `tests/visual/compact-tool-blocks.spec.ts` with a "three consecutive tools render as ONE folded tool-group" assertion that pins the visible DOM shape so a future regression in `appendOrFoldToolDOM` is caught in the browser layer.
- Updated `src/chat/webview/stream.test.ts` to accept either the direct `renderBlock(toolBlock)` call or the new `appendOrFoldToolDOM` indirection.

## [0.2.13] - 2026-05-22

### Fixed

- **Redundant "Step finished (tool-calls) — in:N out:N reasoning:N" chip rendered after every assistant step** — `NORMAL_FINISH_REASONS` listed the OpenAI-style underscore forms (`tool_calls`, `end_turn`, …) but the opencode SDK actually emits hyphenated variants (`tool-calls`, `end-turn`, …), so the normal-completion short-circuit never matched and every step rendered a clutter chip beneath each tool row. `renderStepFinishBlock` now normalizes the reason by replacing `-` with `_` before the set lookup, so both shapes suppress the chip. The chip still renders for genuinely unusual finishes (`length`, `content_filter`, `abort`, errors). (`src/chat/webview/renderer.ts`)

## [0.2.12] - 2026-05-22

### Fixed

- **Show-thinking toggle did not actually hide thinking blocks** — Unchecking *Settings → Show thinking* previously only flipped each `<details>` element closed, which still left the summary chip in the layout. The toggle now drives a `hide-thinking` body class that CSS uses to `display: none` every `.thinking-block` outright. `setupThinkingToggle()` also applies the persisted preference at boot, so a user's prior choice takes effect immediately instead of after a double-click. (`src/chat/webview/dom.ts`, `src/chat/webview/main.ts`, `src/chat/webview/css/components.css`)

### Changed

- **Codex-style compact tool blocks** — `.tool-call` no longer renders as a bordered card; only the left accent stripe remains so tool class is still color-coded at a glance. `.tool-header` is a single-line row at `min-height: var(--size-target-min)` (24 px) with `text-xs` font. Multi-tool turns that previously rendered as a wall of cards now stack tightly as a one-line log. Expanded args/result panels still get their full styling on click. (`src/chat/webview/css/blocks.css`)

### Tests

- 6 new source-string assertions across `dom.test.ts`, `messages-css.test.ts`, `main.test.ts`. Updated `tests/visual/thinking-toggle.spec.ts` to assert full block invisibility (not just body collapse) and the `hide-thinking` body class. New `tests/visual/compact-tool-blocks.spec.ts` pins row height ≤ 28 px and the flat-not-card border shape.

### Fixed

- **Context usage counter hidden when server doesn't report limit.context** — The extension previously hid the context usage bar entirely when the opencode server didn't provide a context window limit. Now shows tokens-only display with a helpful tooltip when the limit is unknown, and users can manually set an override via the new `opencode.contextWindowOverride` setting or `OpenCode: Set Context Window Override` command. The root cause was CLI auto-fetch on startup which couldn't extract context windows; this was removed so models are now only fetched from the server (which provides full metadata). (`src/extension.ts`, `src/chat/webview/theme.ts`, `src/chat/webview/context-usage-panel.ts`, `package.json`, `src/commands/model.ts`)
- **Duplicate context usage display surfaces** — Removed the status-strip `#context-usage` element, leaving only the per-tab `.context-monitor` element to avoid duplicate displays. (`src/chat/webview/index.html`, `src/chat/webview/context-usage-panel.ts`)
- **Context monitor panel had no way to open it** — The per-tab context-monitor element is now clickable (with keyboard support) to open the full context monitor panel with history graph and cost summary. (`src/chat/webview/tabs.ts`, `src/chat/webview/main.ts`)

### Added

- **`opencode.contextWindowOverride` configuration** — Users can now manually set a context window override via Settings UI when the server doesn't report one. (`package.json`)
- **`OpenCode: Set Context Window Override` command** — Quick command palette access to set or clear the context window override. (`src/commands/model.ts`, `package.json`)

### Performance

- **Parallelized session restoration backfill** — `backfillRecoveredSessions` previously fetched recent session message histories from the local opencode server one at a time via a serial `for...await` loop, taking ~50s to restore 10 sessions on cold start (initial sweep ~9s + four retry rounds for slow lazy-loaded sessions). The loop now runs in chunks of `BACKFILL_CONCURRENCY=5` via `Promise.allSettled`, dropping cold-start restoration to ~15-20s while keeping local-server load bounded. Per-session writes are keyed by `session.id` and the `backfillInProgress` Set is concurrency-safe, so no shared state mutates unsafely. (`src/chat/ChatProvider.ts`)

### Build / Tooling

- **Modern on-demand activation** — `package.json` now declares `"activationEvents": []`, the modern empty-array form that lets VS Code infer activation from `contributes.commands`/`contributes.views` rather than relying on legacy `onCommand:` strings. Without this field, activation behavior is undefined under recent VS Code versions. (`package.json`)
- **`.vscode/extensions.json`** — Recommends `dbaeumer.vscode-eslint` and `connor4312.esbuild-problem-matchers` for contributors so the watch task surfaces esbuild errors in the Problems panel correctly. (`.vscode/extensions.json`)

### Fixed

- **First prompt from welcome created a blank tab and never sent** — The prompt input's context-chip refresh was wired with attachment-only element refs and then cast to full `ElementRefs`, so typing or clearing a prompt could throw inside `updateContextChips` before `send_prompt` was posted. The attachment manager now renders chips through the full webview refs, and `updateContextChips` safely skips rendering if the chip container is unavailable. (`src/chat/webview/main.ts`, `src/chat/webview/theme.ts`)
- **Welcome-page model choice did not reliably reach first prompt** — Existing pending tabs now refresh their model/mode in both `ChatProvider.ensureLocalTab` and `SessionLifecycleService.ensureLocalTab` before prompt streaming starts. (`src/chat/ChatProvider.ts`, `src/chat/SessionLifecycleService.ts`)
- **Empty local placeholder sessions could survive reload/close** — Empty `pendingServerLink` sessions are no longer persisted, restored, or exempt from close cleanup. Only server-imported sessions waiting for backfill (`needsBackfill`) remain exempt while empty. (`src/session/SessionStore.ts`)
- **Recent-session delete used the wrong webview contract** — The welcome recent-session delete action now posts `targetSessionId`, matching `WebviewEventRouter` validation. (`src/chat/webview/main.ts`, `src/chat/webview/types.ts`)
- **Changed-files UI leaked stale state across tabs** — Changed-file chip/todos rendering is now scoped to the active session and clears when switching to a session with no changed files. (`src/chat/webview/main.ts`, `src/chat/webview/ui/fileTracking.ts`)
- **Session messages permanently stale after resume** — Six interrelated bugs caused messages to remain stale after resuming a session:
  - **Fix A**: `handleResumeSession` now always fetches fresh messages from the server on resume, regardless of local message count. Previously skipped backfill if `messages.length > 0`. (`src/chat/SessionLifecycleService.ts`)
  - **Fix C**: Increased `BACKFILL_RETRY_DELAYS_MS` from `[1500, 4000]` to `[1500, 4000, 8000, 16000]` (4 retries over ~30s) to accommodate slow server lazy-loading. (`src/chat/ChatProvider.ts`)
  - **Fix D**: Removed destructive `closeTab()` + `applyBackfilledMessages(id, [])` on empty backfill response. Now logs and preserves state for retry. (`src/chat/SessionLifecycleService.ts`)
  - **Fix E**: `request_more_messages` handler now falls through to server fetch when local messages are exhausted, instead of returning an empty slice. (`src/chat/WebviewEventRouter.ts`)
  - **Fix F**: Added `refresh_session_messages` message handler for explicit webview-triggered message refresh, with `session_messages_refreshed` response. (`src/chat/WebviewEventRouter.ts`, `src/chat/webview/main.ts`)
- **`backfillTabIfNeeded` skipped stale sessions** — The method returned early if `session.messages.length > 0`, preventing re-backfill of stale sessions. Now only skips when `needsBackfill !== true`. (`src/chat/ChatProvider.ts`)
- **Inline slash dropdown transparency** — The mention/commands dropdown background was 94% opaque (`color-mix`), causing text behind it to bleed through. Changed to fully opaque `var(--oc-editor-bg)`. (`src/chat/webview/css/components.css`)
- **Commands modal z-index inconsistency** — `.commands-modal` used fallback `1000` while the `--z-modal` token is `300`. Fixed fallback to `300` for consistency with other modals. (`src/chat/webview/css/components.css`)
- **Slash commands not available on first load** — Server and skill/prompt commands were only loaded when the user typed `/commands`. Now `list_commands` is sent on boot, pre-populating the inline dropdown and commands modal immediately. (`src/chat/webview/main.ts`)
- **Command execution fails with "Session not found"** — Running a server command on a freshly created tab (no server session yet) caused `NotFoundError` because `tab.cliSessionId` was undefined. `CommandExecutionService.handleExecuteCommand` now calls `sessionManager.ensureSession()` to create a server session on-demand before executing remote commands. (`src/chat/CommandExecutionService.ts`)
- **`push_all_state` / `push_visible_state` unhandled** — These host messages were logged as "unknown host message type" and dropped. The webview now handles them by triggering a debounced state sync. (`src/chat/webview/main.ts`)
- **Commands modal and inline dropdown can both be visible** — Opening the commands modal now hides the inline mention dropdown. (`src/chat/webview/commands-modal.ts`)

### Added

- **Browser-level send-flow regression** — Playwright now covers welcome → type prompt → click send → local user message render → typing indicator → `send_prompt` posted with selected model, with browser/page error capture around the flow. (`tests/visual/webview-contract.spec.ts`)
- **Commands palette button** — A `>_` terminal-style button in the input bottom bar (left of the `@` button) opens the commands palette modal with one click. (`src/chat/webview/index.html`, `src/chat/webview/dom.ts`, `src/chat/webview/main.ts`)
- **`Ctrl+Shift+/` keybinding** — Opens the commands palette when the chat view is focused. (`package.json`)
- **`CommandExecutionService` test suite** — 7 source-inspection tests covering class export, handleExecuteCommand method, server session ensure flow, cliSessionId persistence, error handling, and custom prompt routing. (`src/chat/CommandExecutionService.test.ts`)
- **Session message freshness test suite** — 6 regression tests covering: handleResumeSession always refreshes, backfillTabIfNeeded respects needsBackfill, retry budget has 4 delays, no destructive closeTab on empty backfill, request_more_messages server fallback, and refresh_session_messages handler. (`src/chat/ChatProvider.test.ts`, `src/chat/SessionLifecycleService.test.ts`)

### Added

- **Canonical changed-file sync** — `SessionStore.addChangedFiles()` now normalizes, deduplicates, persists, and replays changed files from both `file.edited` and `session.diff` SDK events. The webview treats `changed_files_update` as the canonical state message for the chip bar and todos panel, while `file_edited` remains a live incremental event. (`src/session/SessionStore.ts`, `src/session/eventHandlers/*`, `src/chat/ChatProvider.ts`, `src/chat/webview/main.ts`)
- **VS Code-safe diff checkpoints** — Extension-managed diff accepts now capture explicit file snapshots before applying the edit. Snapshots are restored with `WorkspaceEdit` and VS Code filesystem APIs instead of git branches/stashes. (`src/checkpoint/CheckpointManager.ts`, `src/chat/SessionLifecycleService.ts`, `src/chat/handlers/DiffHandler.ts`)
- **Session-aware file opener** — Changed-file chips, todo-panel file buttons, diff open actions, and direct `open_file` webview messages now route through one extension-host resolver that handles `#L12`, prefers the session workspace, checks workspace containment, and reports clear missing-file errors. (`src/chat/WebviewEventRouter.ts`)
- **Back button and modal focus management** — A back button appears in the header when any modal is open (model manager, theme customizer, mode warning, MCP config, session modal). All modals now have proper focus trapping (Tab/Shift+Tab cycle within) with return-focus-to-trigger-element on close. (`src/chat/webview/index.html`, `src/chat/webview/dom.ts`, `src/chat/webview/main.ts`)
- **Settings menu keyboard navigation** — ArrowUp/Down, Home, End, and Escape navigation within the settings overflow menu. (`src/chat/webview/main.ts`)
- **Theme customizer undo/redo snapshots** — Save and reset actions push the current theme state onto an undo stack for potential undo/redo support. (`src/chat/webview/main.ts`)
- **`sessions_recovered` event handling** — `ChatProvider` re-pushes init state to the webview when session recovery completes, ensuring the webview reflects all restored sessions. (`src/chat/ChatProvider.ts`)

### Added

- **True High Contrast presets (`high-contrast-dark` / `high-contrast-light`)** — Replaced the fake HC preset (which was structurally identical to `cli-default`) with two fully hardcoded presets: black/white/yellow for dark HC and white/black/red-blue for light HC. Auto-resolved from `vscode.window.activeColorTheme.kind` via the new `resolveEffectivePreset()` method. Users with existing `opencode.theme.preset = "high-contrast"` settings keep working via the alias. (`src/theme/ThemeManager.ts`)
- **Adaptive RenderQueue** — New `RenderQueue` class buffers streaming text chunks and flushes via `requestAnimationFrame` (primary) with a 50ms `setTimeout` fallback for hidden webview contexts where rAF pauses. Prevents per-chunk DOM writes from causing layout thrashing during high-token-rate streams. (`src/chat/webview/renderQueue.ts`)
- **Webview heartbeat (`stream_ping`/`stream_ack`)** — Extension host sends a sequenced ping every 5s during active streams; webview replies with `stream_ack` including the last rendered chunk sequence. If 2+ pings are missed, `force_rerender` is sent with the full accumulated text snapshot. (`src/chat/handlers/StreamCoordinator.ts`, `src/chat/ChatProvider.ts`, `src/chat/webview/main.ts`)
- **Event stream liveness tracking** — `SessionManager` records `lastRawEventAt`, `lastNormalizedEventAt`, `lastRawEventType`, and `lastNormalizedEventType` on every SDK event. On unexpected stream close, logs the last seen event and schedules reconnection with exponential backoff (1s→2s→4s→8s→16s→30s). Fires `event_stream_reconnected` to trigger session reconciliation. (`src/session/SessionManager.ts`)
- **`reconcileAfterReconnect`** — On `event_stream_reconnected`, `ChatProvider` iterates active streaming tabs and calls `StreamCoordinator.reconcileAfterReconnect`, which fetches the latest server-side messages and posts `force_rerender` to restore UI state. (`src/chat/ChatProvider.ts`, `src/chat/handlers/StreamCoordinator.ts`)
- **Chunk batching** — `appendToolStart` and `appendChunk` batch small text chunks for 50ms before posting to the webview, reducing `postMessage` overhead for fast-token streams. (`src/chat/handlers/StreamCoordinator.ts`)
- **"Retry from here" button** — When a stream ends with `retryable: true` (timeout, hard_timeout, error), a "Retry from here" button appears below the partial output. Clicking it sends `retry_stream` to the extension host, which sends a continuation prompt preserving partial context. (`src/chat/webview/main.ts`, `src/chat/handlers/StreamCoordinator.ts`)
- **Tool group collapsing** — Consecutive tool calls with the same name are grouped into a single expandable row (e.g., "read 12 files · all done"). Expands to show individual tool rows with full details. (`src/chat/webview/renderer.ts`, `src/chat/webview/css/blocks.css`)
- **Tool elapsed timer** — Running/pending tools display a live elapsed-time counter (updated every 1s). Completed tools show duration and output size (chars/KB, line count). (`src/chat/webview/renderer.ts`, `src/chat/webview/main.ts`, `src/chat/webview/css/blocks.css`)
- **Tool keyboard navigation** — Arrow keys navigate between tool rows, Home/End jump to first/last tool within a message list. (`src/chat/webview/streamHandlers.ts`)
- **`deriveExtendedTheme` static method** — Derives all 51 `OpencodeTheme` fields from the CLI's compact 16-field schema (`palette` + `overrides`) using deterministic `color-mix()` formulas. Called automatically when `applyThemeContent` detects a `palette` key in the theme block. Enables all CLI themes (tokyonight, catppuccin, gruvbox, dracula, …) to render correctly in the webview. (`src/theme/ThemeManager.ts`)
- **Consolidated advanced theme modal** — Replaced the minimal 7-field customizer with a single advanced modal featuring: 4 preset cards with color swatches, searchable CLI theme list (populated via `list_cli_themes` message), 6 collapsible sections (Messages, Syntax, Diff, Tools, Markdown, Advanced covering 44 fields), live preview swatch that updates per-keystroke without mutating the chat, and bidirectional color picker ↔ text input sync. (`src/chat/webview/index.html`, `src/chat/webview/main.ts`, `src/chat/webview/dom.ts`, `src/chat/webview/css/layout.css`)
- **`list_cli_themes` message handler** — Webview can request the discovered CLI theme list; `ChatProvider` responds with `{ type: "cli_themes_list", themes }` via the public `discoverCliThemes()` method. (`src/chat/ChatProvider.ts`, `src/theme/ThemeManager.ts`)
- **HC CSS tokens** — `tokens.css` now declares `.vscode-high-contrast` (dark) and `.vscode-high-contrast-light` (light) body-level overrides with the same hardcoded values as the new TS presets, ensuring CSS fallback matches the injected variables. (`src/chat/webview/css/tokens.css`)

### Changed

- **Diff preview and revert contract** — Diff preview now uses a registered read-only virtual document provider plus `vscode.diff`; accepted diff metadata is retained so `revert_diff` restores the exact accepted edit instead of relying on an empty backup path. (`src/diff/DiffApplier.ts`, `src/chat/handlers/DiffHandler.ts`, `src/chat/WebviewEventRouter.ts`)
- **`ThemePreset` union extended** — Added `"high-contrast-dark"` and `"high-contrast-light"` to the union type and `BUILT_IN_PRESETS` record. Both `loadConfig` (ThemeManager) and `normalizeThemeConfig` (ChatProvider) accept the new IDs. (`src/theme/ThemeManager.ts`, `src/chat/ChatProvider.ts`)
- **Tool lifecycle deduplication** — `ToolPartHandler` now generates stable tool IDs (preferring `part.id` > `part.callID` > `messageID:tool`) and emits `tool_start` only once per stable ID. Pending→running transitions produce `tool_update`, not a second `tool_start`. Redundant events when nothing changed are suppressed. (`src/session/eventHandlers/ToolPartHandler.ts`)
- **StreamCoordinator tool tracking** — `appendToolStart` deduplicates by stable tool ID; `maybeFinalizeStream` reconciles pending tools from server state before deciding to finalize; stale pending tools are closed with a `stale` status after a 2-second grace window. (`src/chat/handlers/StreamCoordinator.ts`)
- **Settings menu: "Quick-pick preset" entry removed** — The VS Code QuickPick preset switcher button was removed from the settings overflow menu (Command Palette `opencode-harness.previewTheme` command remains). The consolidated modal is now the single entry point. (`src/chat/webview/index.html`, `src/chat/webview/dom.ts`, `src/chat/webview/main.ts`)
- **`ThemeManager.discoverCliThemes()` made public** — Was `private`; now accessible to `ChatProvider` for the `list_cli_themes` response. (`src/theme/ThemeManager.ts`)
- **`ThemeManager` CSS_VAR_MAP: `--bg-secondary` and `--bg-tertiary` removed** — These tokens were mapped to the flat `panelBg` value, overriding the `color-mix()` depth layering that `tokens.css` computes for visual hierarchy. They are now owned entirely by the CSS layer. (`src/theme/ThemeManager.ts`)

### Fixed

- **OpenCode SDK file event normalization** — `file.edited` now reads `properties.file`; `session.diff` reads `properties.diff[].file` with additions/deletions and forwards normalized file-change data even after stream state changes. (`src/session/eventHandlers/FileEditHandler.ts`, `src/session/eventHandlers/SessionDiffHandler.ts`, `src/chat/ChatProvider.ts`)
- **Frontend changed-file registration drift** — `changed_files_update` now feeds the same dedupe path used by live `file_edited` events and updates the todos panel's changed-files view alongside the chip bar. (`src/chat/webview/main.ts`, `src/chat/webview/types.ts`)
- **`handleUpdateThemeConfig` fails without workspace** — Was always writing to `ConfigurationTarget.Workspace`, throwing when no workspace folder is open. Now falls back to `ConfigurationTarget.Global` when `vscode.workspace.workspaceFolders` is `undefined`. (`src/chat/ChatProvider.ts`)
- **Light-theme user message bubble rendered dark** — Added a comprehensive `.vscode-light` body override block to `tokens.css` for `--user-message-bg`, `--oc-user-msg-bg`, `--bg-code`, `--oc-tool-bg`, diff background opacities, and all shadow tokens. (`src/chat/webview/css/tokens.css`)
- **Duplicate tool calls** — The first tool call no longer appears as an empty JSON object placeholder. `ToolPartHandler` uses stable tool IDs and suppresses redundant `tool_start` emission for already-started tools. (`src/session/eventHandlers/ToolPartHandler.ts`)
- **Streaming completion for long tasks** — Added event stream reconnection with reconciliation, chunk inactivity timeout routed through `maybeFinalizeStream`, hard watchdog (10 min), and `force_rerender` heartbeat recovery. The stream no longer stops mid-generation for long-running coding tasks. (`src/session/SessionManager.ts`, `src/chat/handlers/StreamCoordinator.ts`)
- **Streaming glitches** — Replaced per-chunk DOM writes with an adaptive `RenderQueue` that batches via `requestAnimationFrame` + 50ms `setTimeout` fallback, preventing layout thrashing during high-token-rate streams. (`src/chat/webview/renderQueue.ts`, `src/chat/webview/streamHandlers.ts`)

### Welcome dashboard

- **Welcome dashboard** — Welcome screen now shows workspace folder name + current model in a context row, a "Continue last session" quick-action button (hidden when no sessions exist), and a "New session" button. Recent sessions sorted by last-activity time (not message count) and capped at 3. Prompt starters displayed in a 2-column grid. (`src/chat/webview/index.html`, `src/chat/webview/main.ts`, `src/chat/webview/css/messages.css`, `src/chat/ChatProvider.ts`)
- **Status strip** — A thin strip below the tab bar shows the active session's model name, token count, and cost. Populated on `model_update`, `token_usage`, and `cost_update` events; hidden when the welcome view is displayed. (`src/chat/webview/index.html`, `src/chat/webview/main.ts`, `src/chat/webview/css/layout.css`)
- **Settings overflow menu** — The settings button now opens a popover menu (`#settings-menu`, `role="menu"`) containing "Manage MCP servers" and "Preview theme". Closes on Escape, outside click, or item selection. (`src/chat/webview/index.html`, `src/chat/webview/main.ts`, `src/chat/webview/css/layout.css`)
- **Workspace name in `init_state`** — `ChatProvider.pushInitStateToWebview` now includes `workspaceName` (the first VS Code workspace folder name), consumed by the webview to populate the welcome context row. (`src/chat/ChatProvider.ts`)

### Changed

- **Single conversation timeline** — Removed the `#turn-nav` Prev/Next + dropdown turn navigator. The right-sidebar `.conversation-timeline` is now the sole navigation aid. Timeline items have WCAG keyboard navigation (ArrowUp/Down/Home/End) and a `role="navigation"` + `aria-label` outer element. (`src/chat/webview/index.html`, `src/chat/webview/main.ts`, `src/chat/webview/css/messages.css`)
- **Header streamlined** — `cost-display` and `token-display` moved out of the header into the new status strip. `files-toggle-btn` is now hidden (changed-files panel auto-shows). `mcp-btn` moved into the settings overflow menu. Header retains four buttons: history, checkpoint toggle, timeline toggle, settings. (`src/chat/webview/index.html`)
- **`recoverSessions` no longer workspace-scoped** — Previously filtered out sessions not in the current workspace directory. Now shows sessions from all workspaces so CLI-created sessions are visible on reconnect. (`src/session/SessionManager.ts`)

### Fixed

- **Model selector silent no-op on welcome screen** — `onSelect` callback previously wrapped all state updates inside `if (active)`, so selecting a model before any session existed was silently dropped. Global state updates (`setGlobalModel`, `setCurrentModel`, `syncModelViews`) now run unconditionally; the `postMessage` with `sessionId` only fires when a session is active. (`src/chat/webview/main.ts`)
- **CLI sessions invisible to extension** — Extension's spawned `opencode serve` excluded `OPENCODE_DATA_DIR` and `XDG_DATA_HOME` from its env-var allowlist, causing the server to use a different data directory than the CLI. Both vars are now passed through. (`src/session/SessionManager.ts`)

### Added

- **Unified session modal** — Replaced LOCAL/SERVER two-tab session picker with a single list that merges local and server sessions. All sessions are clickable; server-only sessions are imported on demand via the new `resume_server_session` webview message. (`src/chat/webview/main.ts`, `src/chat/ChatProvider.ts`)
- **`SessionStore.importOneServerSession(serverId, title?, directory?)`** — Idempotent method that creates a local session entry from a server session ID with `needsBackfill: true` and `workspacePath` from the server session's directory. Returns the existing entry if already imported. (`src/session/SessionStore.ts`)
- **`resume_server_session` handler** — `ChatProvider` now handles webview requests to resume a server-only session. Calls `importOneServerSession`, resumes the session, and offers "Open Folder" if the session directory differs from the current VS Code workspace. (`src/chat/ChatProvider.ts`)
- **Workspace folder change listener** — When VS Code adds a workspace folder while the server is running, an information message offers to restart the server in the new workspace directory. (`src/extension.ts`)
- **Changed-files chip bar now populates** — Frontend accumulates individual `file_edited` events into `session.changedFiles` with deduplication, re-rendering the chip bar live for the active tab. (`src/chat/webview/main.ts`)
- **Token & cost display wiring** — `StreamCoordinator.finalizeStream` now posts `cost_update` and `token_usage` messages to the webview after fetching the finalized server message, using `AssistantMessage.cost` and `.tokens` from the `@opencode-ai/sdk`. (`src/chat/handlers/StreamCoordinator.ts`)
- **`list_server_sessions` shows all workspaces** — Removed the current-workspace filter so CLI-created sessions from other projects are visible in the session modal. Sessions include an `isCurrentWorkspace` flag for UI badging. (`src/chat/ChatProvider.ts`)
- **Workspace badges** — Session modal items show a filled dot (current workspace), hollow dot (other workspace), or dimmed dot (local-only) next to the session title. (`src/chat/webview/main.ts`, `src/chat/webview/css/layout.css`)

### Fixed

- **`restore_checkpoint` always returned `ok: true`** — Handler now captures the boolean return value from `CheckpointManager.restore()` and posts `ok: false` on failure. Duplicate success toast removed. (`src/chat/ChatProvider.ts`)

### Added

- **Unified session identity (ADR-007)** — Server-issued session IDs are now the canonical key for sessions in `SessionStore`. CLI-created sessions are imported automatically when the extension connects to the server, so the chat panel and the `opencode` CLI no longer maintain parallel session pools. Pre-existing local sessions with a `cliSessionId` are rekeyed in place by a one-shot, idempotent migrator on `SessionStore.load`. (`src/session/SessionStore.ts`, `src/session/sessionMigration.ts`, `src/extension.ts`)
- **Continue Last Session command** — `opencode-harness.continueLastSession` activates the most-recent session and opens the chat panel. Falls back to `newSession` when no sessions exist. (`src/commands/session.ts`)
- **Choose History Session command** — `opencode-harness.chooseHistorySession` shows a quick-pick over the union of local + server sessions. Selecting an unbacked server session triggers a `withProgress` backfill of full message history before activation. (`src/commands/session.ts`)
- **Attach to Remote Server command + settings** — `opencode-harness.attachRemote` prompts for a URL and optional bearer token, persists them to `opencode.serverUrl` / `opencode.serverAuthToken`, and reconnects `SessionManager` against the remote endpoint without spawning a local binary. (`src/commands/session.ts`, `src/session/SessionManager.ts`, `package.json`)
- **Session-start baseline hook** — Fresh sessions still call `CheckpointManager.snapshot(sessionId, "baseline")`, but extension-local checkpoints now require explicit file paths; baseline-without-files is a no-op rather than a git ref. (`src/extension.ts`, `src/checkpoint/CheckpointManager.ts`)
- **`SessionStore.onSessionCreated` event** — Decouples the baseline-checkpoint hook from the store. (`src/session/SessionStore.ts`)
- **`SessionStore.importServerSessions` / `migrateLocalIdsToServerIds` / `promotePendingServerLink` / `applyBackfilledMessages`** — Public API for the unified-identity flow, exercised by 15 new behavioral tests in `src/session/sessionMigration.test.ts`.
- **`SessionManager.setRemoteServer` / `isRemote`** — Switch between local-spawn and remote-attach without restarting the extension. Bearer auth supersedes the local Basic-auth path in `authHeader`. (`src/session/SessionManager.ts`)

### Changed

- **`sessions_recovered` handler now imports** — Previously only re-linked already-known sessions on reconnect. Now imports any server session the local store does not yet know about, surfacing CLI-only sessions in the picker. (`src/extension.ts`)
- **`SessionStore.create(name, opts)`** — Second argument is now `CreateSessionOptions` (`{ id?, cliSessionId?, pendingServerLink? }`); the legacy `create(name, idString)` signature is preserved for backward compatibility.
- **Empty-session pruning exemptions** — Only sessions marked `needsBackfill` (imported from server, history not yet fetched) are exempt from empty-session filtering and stale-session pruning. Empty local placeholders marked `pendingServerLink` are transient until they receive a user message.

### Fixed

- **Plan mode now prevents edits** — Replaced `mode` parameter with `tools` field in server API calls. Plan mode sets `tools: { file_edit: false }` to disable file edits (server uses tool permissions via `tools` field, not `mode` parameter). Build/auto modes pass `tools: undefined` (server default enables file edits). Updated `StreamCoordinator.ts` (tools config), `SessionManager.ts` (`sendPrompt()` and `sendPromptAsync()` accept `tools?` parameter), `ChatProvider.ts` (maps server tools config to extension modes). All 578 tests pass.
- **Critical: Stream handler methods lost on object spread** — `createStreamHandlersForTab` used `...stream` spread on a `StreamSession` class instance. JavaScript class methods live on the **prototype**, not as own properties, so spread silently discarded all handler methods (`handleStreamStart`, `handleStreamChunk`, `handleStreamEnd`, `handleServerStatus`). Replaced with `Object.assign(Object.create(Object.getPrototypeOf(stream)), stream, { overrides })` to preserve the prototype chain. (`src/chat/webview/main.ts`)
- **Critical: Extension crash on startup (`sessionStore.list() on undefined`)** — `initConnectionStatusBar` was called at line 80 with `sessionStore` as a parameter, but `sessionStore = new SessionStore(...)` wasn't created until line 83. Moved `initConnectionStatusBar` after session store creation. (`src/extension.ts`)
- **Critical: Session/chat history lost tool calls and special blocks** — `handleStreamEnd` replaced the entire `msgObj.blocks` array with blocks from `finalizeStream`'s `partsToBlocks`, which only handles `text` and `tool` types. Thinking blocks, diffs, permission requests, and other non-text/tool content were silently dropped on finalization. Changed to **merge** server blocks into existing real-time blocks: text content is updated, tool-call blocks are added/updated, all other block types are preserved. (`src/chat/webview/streamHandlers.ts`)
- **Critical: Streaming response never rendered live** — Three compounding bugs fixed:
  1. **`ensureSession` replaced messages array mid-stream** — `existing.messages = session.messages` orbanned the stream handler's array reference. Changed to in-place mutation (`length = 0; push(...)`) so both the handler and state manager share the same array. (`src/chat/webview/state.ts`)
  2. **`loadSessions` created entirely new arrays** — `{ ...s }` spread created new `messages` arrays for all sessions on `init_state`, invalidating every active stream handler. Added `messages: existing ? existing.messages : s.messages` to preserve the reference. (`src/chat/webview/state.ts`)
  3. **`handleStreamEnd` had no fallback rendering** — If the stream handler's `reRenderMessage` failed (due to the above array mismatch or missing DOM element), the response blocks traveled all the way from the server to the webview but were never inserted into the DOM. Added `addMessage()` fallback that force-removes the empty streaming placeholder and renders blocks unconditionally. (`src/chat/webview/main.ts`)
- **Critical: Empty model `""` sent to server** — When no model was previously selected, `sendMessage` sent `model: ""`. The server received `undefined` model and timed out (TTFB timeout) instead of responding. Three-part fix: added `getCurrentModel()` to model dropdown for reliable model tracking, `sendMessage` now rejects if no model is selected, `send_prompt` handler falls back to `modelManager.model`. (`src/chat/webview/model-dropdown.ts`, `src/chat/webview/main.ts`, `src/chat/ChatProvider.ts`)
- **Critical: `ModelManager._current` never auto-selected** — Defaulted to `""` and only changed on explicit `setModel()`. Added auto-select of the first available model after `refreshModels`. (`src/model/ModelManager.ts`)
- **rAF-only streaming update didn't fire in background** — `requestAnimationFrame` pauses when the webview tab isn't focused. Added `setTimeout(50ms)` fallback so streaming text always updates even in background panels. (`src/chat/webview/streamHandlers.ts`)
- **ChunkBatcher flush logs invisible** — Used `console.log` (developer console only) instead of the output channel. Added optional `log` callback. (`src/chat/ChunkBatcher.ts`)
- **DeltaHandler silent drops** — Added diagnostics that log when `message.part.delta` is dropped and why, including all known `messageRoles` for debugging event ordering issues. (`src/session/eventHandlers/DeltaHandler.ts`, `src/session/eventHandlers/TextPartHandler.ts`)
- **Stream messageId mismatch between stream_start and stream_end** — Initial `stream_start` used the SDK session ID (`ses_...`) as the messageId prefix, but the message-transition `stream_end` used the raw SDK message ID (`msg_...`) without the `resp-` prefix. This caused `handleStreamEnd` to fail finding the stored message, leaving the streaming buffer unconsumed and logging "empty response". Fixed by adding `resp-${prevId}` prefix to match. (`src/chat/handlers/StreamCoordinator.ts`)
- **handleStreamEnd ID fallback for message lookup** — When `messageId` from `stream_end` doesn't match any stored message AND `state.streamingMessageId` has a different value (due to the initial stream_start using a different ID format), both `handleStreamEnd` and `reRenderMessage` now fall back to `state.streamingMessageId` for DOM and message lookups. (`src/chat/webview/streamHandlers.ts`)

### Security

- **FallbackHandler noisy `console.warn` removed** — The `FallbackHandler` at the end of the handler chain logged `"Unhandled SDK event type"` for events like `message.part.updated` that were already handled by preceding handlers (TextPartHandler, ToolPartHandler). Since the normalizer loop intentionally doesn't break for `message.part.updated`, the FallbackHandler always matched and warned. Removed the misleading warning. (`src/session/eventHandlers/FallbackHandler.ts`)
- **Webview source maps disabled** — `sourcemap: false` in webview esbuild config to prevent CSP violation (`connect-src 'none'` blocks source map loading). Extension host source maps retained for debugging. (`esbuild.js`)
- **PII scrubbing** — All output channel messages are now redacted for sensitive patterns (Bearer tokens, API keys, passwords, GitHub tokens, Slack tokens, AWS access keys) before being written to the log. Implemented via `OutputChannelService.scrub()`.
- **`process.env` allowlist extended** — `CliDiagnostics.ts` and `ModelManager.ts` now use the same allowlist pattern as `SessionManager.ts` (PATH, HOME, USERPROFILE, etc.) instead of passing the full environment. Prevents API key leakage to spawned child processes.
- **Explicit `shell: false`** — Added to remaining `spawn()` calls in `SessionManager.ts` (server process) and `ModelManager.ts` (CLI fetch) that were relying on the default. Eliminates regression risk.
- **`.vscodeignore` exclusions** — Added `.env*` and `package-lock.json` to prevent secret leakage in the packaged VSIX.
- **Auto-generated `OPENCODE_SERVER_PASSWORD`** — Server now generates a cryptographically random password per start, passed as `--password` flag + `OPENCODE_SERVER_PASSWORD` env var + `Authorization: Bearer` header on all SDK client requests. (P04)
- **Idempotency keys** — Every `sendPromptAsync` and `sendPrompt` call now includes an `Idempotency-Key` header to prevent duplicate processing on retry. (P04)
- **Narrowed retry policy** — `isRetryableError` regex tightened to remove overly broad `/socket/i` pattern, added `/enotfound/i`, `/enetunreach/i`. (P04)
- **Server session auth verification** — Stored-port reuse now verifies authentication via an SDK API call before reconnecting. (P04)
- **Respect user-configured `OPENCODE_SERVER_PASSWORD`** — If set in the parent environment, it's used instead of generating one. (P04)
- **Perf debug logging gated** — `console.debug` render timing now guarded behind `window.__opencodeDebug` flag. (P10)

### Streaming & Performance

- **TTFB timeout** — Separate 30-second time-to-first-byte timeout added; emits user-actionable `stream_end` with `reason: "ttfb_timeout"`. (P02)
- **Completion timeout reset on chunk** — 60-second completion timeout resets on each chunk to prevent false timeouts during active streaming. (P02)
- **`stream_end` reason field** — `reason` and `partial` fields now forwarded to webview; user sees "Response was cut off (timeout)" or "Model took too long to start" instead of silent placeholder removal. (P02, P07)
- **rAF-batched streaming** — `handleStreamToken` now batches DOM `textContent` updates via `requestAnimationFrame` to avoid per-token layout thrashing. (P09)
- **content-visibility: auto** — Added to `.message` elements for virtual rendering; off-screen messages skip layout/paint. (P09)
- **DocumentFragment batching** — `resume_session_data` builds message list via `DocumentFragment` instead of calling `appendChild` per message. (P09)
- **Scroll markers** — Positioned marker dots in the message list scrollbar gutter for user messages; click-to-jump with flash animation. (P09)
- **Jump-to-bottom button** — Sticky button appears when user scrolls >300px from bottom; wired to stream start, tab switch, and session resume. (P09)
- **Jump-to-bottom button fix** — Removed duplicate CSS that forced `display: flex` (button was always visible). Button now correctly defaults to `display: none` and only shows via `.visible` class. Added initial scroll-position evaluation so the button isn't shown when already at bottom on chat start. (P09)

### Session Management

- **Always start on welcome page** — `init_state` handler no longer auto-switches to an active session. Tab UI is created for restored sessions but welcome view is always shown, letting the user pick a session from the recent sessions list. (`src/chat/webview/main.ts`)
- **`pushInitStateToWebview` skips empty sessions** — Only sends sessions with at least one message to the webview on init. Previously sent the active session even if empty (e.g., a stale "Default" session), which caused the welcome page to be suppressed. (`src/chat/ChatProvider.ts`)
- **`SessionStore.load()` skips all empty sessions on restore** — Previously restored empty sessions that were marked as active. Now skips ALL sessions with zero messages regardless of active status. Previously baked "Default" session creation removed from `extension.ts`. (`src/session/SessionStore.ts`, `src/extension.ts`)
- **Archive/unarchive** — Sessions can be archived (hidden from default list view) and unarchived. `list()` now takes `includeArchived` parameter. (P03)
- **Typed `onDidChangeSession` events** — `SessionChangeEvent` with `kind` discriminator (`deleted`, `renamed`, `archived`, etc.). ChatProvider subscribes to keep webview + server in sync. (P03)
- **Server-side delete on local delete** — Deleting an extension session now also calls `sessionManager.deleteSession(cliSessionId)` to clean up server state. (P03)
- **Cross-layer cleanup** — `clearAll()` now supports dry-run with per-category counts (empty, test-named, orphaned, archived, corrupted). Produces JSON backup log before deletion. (P03)
- **Resume re-attaches server session** — `handleResumeSession` is now async and calls `ensureSession(cliSessionId)` to re-attach without creating duplicate server sessions. (P03)
- **`session_deleted` message handling** — Webview handler removes DOM tab/panel and updates state. (P03)
- **MAX_SESSIONS prune fix** — Prune loop no longer breaks on active session; sorts once, iterates correctly. (P03)

### UI & Controls

- **Edit message state consistency** — `edit_message_prefill` now also truncates webview state's `messages` array via `.splice()`, keeping it consistent with the session store. (P07)
- **Revert button** — Assistant messages now have a revert button (undo icon) that calls `sessionManager.revertMessage()`. (P07)
- **Checkpoint created indicator** — `diff_result` includes `checkpointCreated` flag; webview shows "Checkpoint saved" system message. (P07)
- **Edit button uses cached vscode API** — Instead of calling `acquireVsCodeApi()` on every click, uses `opts?.postMessage` from `RenderOptions`. (P07)
- **Avatars removed from messages** — Both user and assistant avatars removed. User/model differentiation uses distinct background colors, bubble styles, and role label coloring (user gets accent, model gets foreground). Cleaned up `OC_LOGO_SVG` and `USER_AVATAR_SVG` imports.
- **Unified mode dropdown replaces three separate buttons** — `Plan`, `Auto`, `Build` modes now in a single dropdown with per-mode SVG icons, colored backdrops using VS Code theme tokens (`--vscode-debugIcon-startForeground`, `--vscode-testing-iconPassed`, `--vscode-debugIcon-continueForeground`). WCAG AA compliant with proper `aria-haspopup`, `aria-expanded`, `role="listbox"`, keyboard navigation, and forced-colors support.
- **Mode sizing consistency** — `.mode-dropdown-btn` updated to match `.model-selector-btn` dimensions (`min-height: var(--size-target-comfortable)`, matching padding, border-radius, and font-size).
- **Auto mode warning improved, Build warning removed** — Warning modal now only shows when switching from Plan to Auto. Build mode switches immediately. Warning modal UI improved with accent-colored checkbox and danger-colored confirm button.
- **Context chip styling enhanced** — Stronger backdrop using `var(--vscode-badge-background/foreground)` tokens, paperclip indicator, subtle shadow, larger touch target (`min-height: 26px`).
- **Mention chip styling enhanced** — Per-kind colors using theme variables, subtle shadows, bold weight, `@` prefix via `::before` pseudo-element.
- **Attachment chip styling enhanced** — Larger thumbnails (56×56), hover scale effect, accent border on hover, paperclip indicator, layered remove button with red hover.
- **Stop button fixed** — `sendMessage()` now correctly calls `abortStream()` when streaming instead of `enqueuePrompt(text)`, so the stop button actually aborts generation.
- **Edit message button fixed** — Added missing `sessionId: msg.sessionId` to `edit_message` payload so `ChatProvider` handler can route it.
- **Revert message button fixed** — Added missing `sessionId: msg.sessionId` to `revert_message` payload.
- **Manage models modal close button** — Moved from absolute-positioned overlay into the modal header as part of a flex row alongside the connect button, eliminating overlap.
- **Markdown rendering safeguard** — `handleStreamEnd` now renders markdown directly into the streaming text element via `innerHTML = sanitizeHtml(renderMarkdown(text))` before calling `reRenderMessage`, ensuring `**bold**` never appears literally even if the re-render lookup fails.
- **`.markdown-content strong`** — Increased from `font-weight: 600` to `700` for more visible bold rendering.

### Prompt Queue (P08)

- **Per-tab queue** — Each tab gets its own `PromptQueue` instance. Items auto-advance on `stream_end` (unless aborted).
- **Queue states** — `queued → sending → streaming → completed | failed`
- **Image attachments in queue** — `QueueItem` includes `attachments: Attachment[]`; queued prompts preserve pasted images.
- **Queue UI** — Chips with state badges, click-to-edit on queued items, retry on failed items, clear-all when >1 queued, hint text below input.
- **Tab-close cleanup** — Queue cleared on tab close.
- **Slash command** — `/queue` shows queue status.

### Slash Commands (P06)

- **Duplicate implementation removed** — `SLASH_COMMANDS` array, `renderSlashAutocomplete`, `updateSlashAutocomplete`, `hideSlashAutocomplete`, `selectSlashItem` all removed from `main.ts`.
- **Single source of truth** — `LOCAL_COMMANDS` in `mentions.ts` is the sole slash command registry.
- **SVG icons** — All command icons use SVG constants from `icons.ts` (COMMAND_SVG, BRAIN_SVG, etc.) instead of emoji codepoints.
- **Server commands use GEAR_SVG** — `updateServerCommands` now uses `GEAR_SVG` instead of `\u2699` emoji.

### Accessibility (P05, P10)

- **Aria-labels on all controls** — Added `aria-label` to `model-selector-btn` and `variant-selector-btn`.
- **Focus trap** — Session modal now traps Tab cycling and restores focus on close.
- **Reduced motion** — `prefers-reduced-motion` media query disables all animations.
- **High contrast** — `forced-colors` media query with CanvasText/ButtonText system keywords.

### Regression Testing (P11)

- **14 regression suites** covering all 22 main user flows: activation, streaming, persistence, tabs, slash commands, edit, diff/checkpoint, archive/delete, security, performance, queue, accessibility, packaging.
- **Test data builders** — `buildMessage()`, `buildSession()`, `buildQueueItem()`, `buildServerEvent()` for use in tests.
- **Streaming timeout regression suite** (P02-fix) — 19 new behavioral tests verifying TTFB timeout, completion timeout, double-finalize guard, session-scoped error routing, placeholder cleanup, and concurrency-limit state reset.

### Fixed

- **Critical: EventNormalizer silently dropped all chunks when `message.part.delta` arrived before `message.updated`** — The normalizer required `messageRoles.get(messageId) === "assistant"`, but the role is only set by `message.updated`. If the server sent chunks before the role event (common in fast responses), all chunks were silently discarded and the user saw "no output of any sort". Changed `isAssistantMessage` to assume unknown message IDs are assistant messages (the SSE stream only carries assistant parts). (P02-fix)
- **Critical: Double `finalizeStream` race** — Both `message_complete` and `server_status idle` could call `finalizeStream()` concurrently, causing duplicate assistant messages and DOM corruption. Added `finalizingTabs` Set atomic guard. (P02-fix)
- **Critical: `postRequestError` missing sessionId** — Errors were routed to the first streaming tab, breaking multi-tab error attribution. `postRequestError` now accepts and forwards `sessionId`. (P02-fix)
- **Critical: Unknown session `server_error` silently dropped** — If a server event arrived for an unmapped `cliSessionId`, the error was logged but never shown to the user. Now falls back to the active tab. (P02-fix)
- **Critical: Assistant placeholder orphaned on early error** — If `sendPromptAsync` threw before the first chunk, the empty assistant placeholder persisted forever in the DOM and message array. `startPrompt` now emits `stream_end` with `reason: "error"` before `postRequestError`, and the webview removes empty placeholders. (P02-fix)
- **Critical: Concurrency limit leaves webview stuck** — When `canStartStreaming()` rejected, the webview stayed in `isStreaming = true` with a disabled send button. Now emits `prompt_rejected` to reset webview state. (P02-fix)
- **Critical: `attach_image` handler was a no-op** — The webview message handler for image attachments only called `log.info()` and never invoked `handleAttachImage()`. Pasted/screenshot images were silently dropped. Now correctly attached as user messages with base64 data.
- **Critical: `tab!` non-null assertion in server events** — `handleServerEvent()` used `tab!` which would crash if a server event arrived for an unknown CLI session (e.g., after manual server restart). Changed to `tab ?? undefined` with safe optional dispatch.
- **Critical: Checkpoints never created (rollback broken)** — `CheckpointManager.snapshotBeforeAction()` was never called from any production code path. The rollback command always showed "No checkpoints available." Now wired into `ChatProvider.handleAcceptDiff()` so every accepted diff creates a pre-action checkpoint.
- **Unhandled promise rejections** — Added `process.on("unhandledRejection")` handler to the extension host. Added `.catch()` to 4 void promise call sites: `extension.ts` model refresh on connect, `ChatProvider.ts` abort on close, `StreamCoordinator.ts` watchdog finalize, `StreamCoordinator.ts` timeout finalize.
- **Activation failure handling** — Wrapped `activate()` in a top-level try/catch. Shows a user-facing error message with "Reload Window" action if activation fails.
- **Inline code action handlers** — Wrapped `explainCode`/`refactorCode`/`generateTests` handlers in try/catch with user-friendly error messages. Added missing `await` on `executeCommand` and `sendPromptToWebview`.
- **Active streams not aborted on panel close** — `onDidDispose` now iterates all streaming tabs and calls `streamCoordinator.abort()` for each. Previously, closing the chat panel left server-side sessions running, consuming compute and tokens.
- **`ChatProvider.dispose()` completeness** — Added disposal of `MessageRouter`, `ChatCommands`, `AutoCompactor`, `ChatFileOps`, `DiffApplier`, and `WebviewContent` with `?.dispose()` stubs.
- **ESLint config dependency** — `eslint-config-prettier` was referenced in `.eslintrc.json` but not installed. Installed as dev dependency.

### Changed

- **Paste listener scoped to input** — Changed from `document.addEventListener("paste", ...)` to `els.promptInput.addEventListener("paste", ...)`. Prevents intercepting paste operations in search input, modals, and other elements.
- **`activate()` error resilience** — Now uses top-level try/catch with user-facing error message and "Reload Window" option. Previously, any constructor throw would show a generic VS Code activation error.
- **`sendPromptAsync` timeout finalize** — Now explicitly caught with `.catch()` instead of fire-and-forget `void`.
- **`finalizeStream` watchdog/timeout calls** — Now explicitly caught with `.catch()` for safe error logging.

### Added

- **`opencode.debugLogging` setting** — New boolean configuration (default: false) gates debug output in the extension channel. When enabled, `debug()` messages appear alongside info/warn/error output.
- **`docs/approved-packages.md`** — Dependency registry documenting all approved runtime and dev dependencies with their purposes.
- **`docs/configuration.md` documentation** — Added `opencode.debugLogging` setting reference.
- **Tab panel ARIA roles** — Dynamically created tab panels now get `role="tabpanel"`, `id="panel-{id}"`, and `aria-labelledby="tab-{id}"`. Tab buttons get `aria-controls="panel-{id}"` and `id="tab-{id}"`.
- **`aria-label` on chip remove buttons** — Added to `.context-chip-remove` ("Remove context chip") and `.attachment-chip-remove` ("Remove attachment").
- **`aria-label` on model manager close** — All icon buttons now have proper `aria-label` attributes.
- **`FileReader.onerror` handler** — Added to image paste handler in webview. Reports failure to console.
- **Model dropdown sync on tab switch** — `switchTab()` now updates the model dropdown to reflect the active session's model.
- **Global unhandledRejection handler** — Registered at activation to catch any unhandled promise rejections in the extension host.

### Accessibility

- **`mode-btn:focus-visible` standardized** — Changed from `1px solid var(--vscode-focusBorder)` with `-2px` offset to `2px solid var(--color-accent)` with `2px` offset, matching the global focus-visible ring standard.
- **Touch target sizes** — Enlarged `.attachment-chip-remove` from 18×18px to 24×24px, `.model-manager-toggle` height from 20px to 24px, `.context-chip-remove` pseudo-element inset from -4px to -5px. All now meet WCAG 2.5.5 minimum.
- **Tab `tabpanel` ARIA** — Added `role="tabpanel"` to all dynamically created tab content panels with proper `aria-labelledby` linking back to the controlling tab.
- **Custom property validation** — `applyThemeVars` logs warnings for non-`--` prefixed keys and blocked CSS values (cats already existed, warnings added for debugging).

### Webview

- **Init failure handling** — `webview_ready` message is now only posted when `init()` succeeds. On failure, a `webview_error` message is sent to the extension host so it can show a reload prompt.

## [0.2.0] - 2026-05-04

### Added

- **Premium 12-Phase UI Redesign** — Complete visual overhaul of the webview chat interface:
  - **Design System** (`tokens.css`): Unified `--color-accent`, tool-specific colors (read/write/exec/error/meta), background layers (92%/84% steps), shadow/z-index tokens
  - **Message Bubbles**: User bubbles with tail accent, assistant full-width with left border, turn spacing (8px consecutive / 20px role change), avatars on first message only, relative timestamps ("just now", "5 min ago")
  - **Tool Calls**: Class-colored cards with summary rows (icon + name + key argument + status pill + duration), expandable input/output panels with syntax-highlighted JSON
  - **Input Area**: Clean container with `:focus-within` accent glow, `field-sizing: content` textarea (44px–168px), send/stop button crossfade, mention chips with overflow ellipsis
  - **Connected Tab Bar**: Active tab bleeds into panel, streaming indicator with pulsing dot, APG keyboard navigation (Arrow/Home/End/Tab)
  - **Welcome Screen**: Real `opencode-wordmark-dark.svg` (120px), tagline "Your intelligent coding assistant", vertical prompt starter cards with hover lift
  - **Diff Blocks**: Sticky action bar with backdrop blur, Accept (filled primary) / Discard (ghost error) / Open File (ghost tertiary), accepted/discarded state chips with auto-collapse
  - **Motion Design**: Single-source `animations.css` — `message-enter`, `cursor-blink`, `streaming-pulse`, `badge-pop`, `press-effect`, stagger utilities
  - **Accessibility**: `focus-visible` rings (2px solid, offset 2px), 24×24 touch targets, `prefers-reduced-motion` blanket override, `forced-colors: active` Highlight override, skip link
  - **Colour Contrast**: WCAG 2.2 AA verified across all token combinations
  - **Responsive Layout**: Message bubbles `min(82%, 520px)`, tab bar horizontal scroll, graceful collapses at 220px sidebar
- **Model Manager Panel** (`model-manager.ts`): Modal overlay with search, provider grouping, toggle switches per model, "Connect provider" button. Filters dropdown to enabled models only. Keyboard support (Escape to close).
- **Premium Icon Set** (`icons.ts`): Centralized 30+ SVG icons with consistent 1.5px stroke, rounded caps/joins, `viewBox="0 0 24 24"`. Imported by `renderer.ts`, `stream.ts`, `main.ts`, `model-dropdown.ts`.
- **61 real behavioral tests** — replacing text-grep pattern. Covers SessionStore, EventNormalizer, DiffApplier, mode normalization, and map size limiting with actual function calls and assertions.
- **Empty session filtering** — `SessionStore.flush()` now skips sessions with zero messages. Sessions without interactions are no longer persisted to `globalState`.

### Fixed (continued)

- **All buttons stopped working** — `requireElement("recent-sessions")` threw because the element was removed from the static HTML template during `vscode-tabs` replacement. Changed to `optionalElement` with null guards. The crash prevented `setupButtons()` from ever running.
- **Empty sessions persisted** — `create()` called `save()` immediately, writing empty sessions to `globalState`. Now `flush()` filters sessions with no messages before persisting.

### Breaking

- **All `@vscode-elements/elements` components removed** — replaced with plain HTML elements:
  - `vscode-tabs` → custom `<div id="tab-bar">` + `<div id="tab-panels">`
  - `vscode-tab-header` / `vscode-tab-panel` → `.tab-btn` / `.tab-panel`
  - `vscode-button` → `<button class="icon-btn">`, `<button class="send-btn">`, `<button class="abort-btn">`, `<button class="suggestion-card">`
  - `vscode-progress-ring` → CSS `.typing-spinner` with `@keyframes spin`
  - `bundled.js` (vscode-elements bundle) removed from build
  - `TOOLKIT_BASE_CSS` updated to reference plain HTML selectors
  - esbuild no longer copies `bundled.js` to dist

### Fixed

- **Tab bar layout** — replaced `vscode-tabs` (Shadow DOM, unstyleable) with custom tab bar using plain `<button>` elements. Tabs render left-to-right at the top of the webview. Newest/active tab is leftmost.
- **No tabs on startup** — welcome screen shown first; tabs created only on user action (send, new, resume)
- **Tab close button** — event delegation on custom tab bar, all close buttons work including dynamically created ones
- **Welcome screen never removed** — `stream.ts` was looking for `.welcome-message` (wrong class); fixed to `.welcome-container`
- **Model response not shown** — `sendMessage()` now calls `createTabUI()` to ensure a tab panel exists before sending a prompt
- **Skill badge spam** — `skill_load` events changed from full chat messages to compact `skill_indicator` pills that auto-remove after 3 seconds
- **Mention dropdown out of bounds** — positioned above the textarea (`bottom: calc(100% + 4px)`) instead of below
- **Model dropdown out of bounds** — `position: absolute` with `max-height: 320px` and `overflow-y: auto`
- **Mode toggle styling** — plain `<button>` elements with `.active` class, VS Code theme color variables, proper `role="radio"` ARIA
- **Send button styling** — plain `<button>` with VS Code theme colors, streaming spinner via CSS `::after`
- **Abort button styling** — plain `<button>` with error color, proper hover states
- **Toolkit imports** — removed dead `import "./toolkit"` from main.ts
- **Test files** — updated all text-grep tests to match new code
- **Abort button merged into send button** — removed separate `#abort-btn` element; stop functionality toggles via `.stopping` class on send button. Fixes crash from `requireElement("abort-btn")` throwing when element didn't exist.

### Added

- **Session history modal** — proper overlay with backdrop blur, click-outside-to-close, Escape key support. Lists all saved sessions with name, message count, date, and cost. Click to resume.
- **Custom tab bar** — horizontal flex layout, active tab has accent-colored bottom border, streaming tab has animated green pulsing dot, close button fades in on hover
- **Typing spinner animation** — CSS-only spinner replaces `vscode-progress-ring`
- **`switchToTab()` and `removeTabContent()`** — added to tabs.ts for managing plain HTML tab panels
- **`setupSessionModal()`** — modal lifecycle management in main.ts

### Removed

- `@vscode-elements/elements` `bundled.js` from esbuild copy step
- `bundled.js` `<script>` tag from index.html
- `vscode-button`, `vscode-tab-header`, `vscode-tab-panel`, `vscode-progress-ring` from HTML/CSS/JS
- `TOOLKIT_BASE_CSS` vscode component references
- Dead `import "./toolkit"` from main.ts
- `bundled.js` URI resolution from WebviewContent.ts

### Security

- `.env` and `coverage/` added to `.gitignore` to prevent accidental secret commits
- `process.env` filtered to allowlist (PATH, HOME, LANG, etc.) before passing to child processes — prevents API key leakage
- CSS custom property injection blocked: `applyThemeVars` validates keys start with `--` and blocks `url()`/`expression()` values
- CSP nonces now use `crypto.randomBytes(32)` instead of `Math.random()` (non-cryptographic)
- Binary path validation added to `ModelManager.fetchModelsFromCli()` — matches `CliDiagnostics.resolveBinaryPath()` pattern

### Fixed

- **Critical: Circular self-import** in `SessionRepository.ts` — imported `OpenCodeSession` from itself instead of `SessionStore`
- **Critical: Dead code** `ChatService.ts` removed — never called server, zero consumers, caused compilation error
- **Critical: Global `promptInFlight` lock** replaced with per-tab `promptsInFlight Set` — multi-tab concurrent streaming now works
- **Critical: `EventNormalizer` unbounded memory** — 7 internal Maps now trimmed at 10,000 entries each
- **Critical: `sendPromptAsync` retried ALL exceptions** — now only retries network/timeout errors, business logic errors fail immediately
- **Critical: `DiffHandler.accept()` double-apply race** — atomic `acceptingDiffs` Set prevents concurrent accept on same diff
- **Critical: Webview HTML template crash** — fallback error page rendered when `index.html` is missing or corrupted
- **Critical: Floating promises** — `.catch()` added to 6 `void this.finalizeStream(...)` calls
- **Critical: Stream limit race condition** — streaming slot reserved synchronously before async context gathering
- **Critical: Orphaned placeholder messages** — `handleRequestError` removes placeholder created by `handleStreamStart`
- **Critical: `SessionStore` memento corruption** — schema validation (`isValidSession`) added on `globalState` load
- **Critical: `noUncheckedIndexedAccess` enabled** — fixed 40 potential `undefined` access crashes across 20 files
- **Build/Plan mode buttons** — incorrectly used `setAttribute("appearance", ...)` which is ignored by `<vscode-button>`; now uses `.secondary = boolean` property and proper `--vscode-button-*` CSS custom properties
- **RateLimitMonitor config listener** — now stored as `configListener` and properly disposed
- **CheckpointManager concurrency** — `snapshotLock` prevents concurrent snapshot/restore operations without mutating git branches or stashes
- **TabManager max tabs** — capped at 20 to prevent unbounded memory growth
- **NaN cost values** — validated with `Number.isFinite()` in `update_cost` handler
- **`StreamCoordinator.buildContextText`** — typed from `any` to proper `ContextShape` interface

### Added

- Behavioral unit tests for mode normalization (13 tests, actual function-calling)
- Enhanced integration tests covering mode validation, webview payload format, send button rules, extension lifecycle
- CI workflow expanded to 3 jobs (typecheck+unit, integration with xvfb, visual with Playwright)
- `ContextShape` interface for type-safe context package processing

### Changed

- Unit test count: 363 (was 372 — ChatService test removed with dead code)
- Type check: zero errors (was 3 compilation + 40 noUncheckedIndexedAccess)

## [0.1.0] - 2026-05-04

### Added

- Slash commands: /clear, /model, /cost, /new, /export, /compact, /continue, /help
- Export conversation as Markdown (via command palette or /export slash command)
- Compact conversation support (/compact - sends summarization prompt)
- Continue from last message (/continue - re-sends last user message)
- Activation events for lazy loading (extension no longer activates on startup)
- Defensive null guards in DOM element lookup (optionalElement helper)

### Changed

- User messages are now persisted to SessionStore immediately on send (no more lost messages on webview reload)
- Plan/Build mode toggle redesigned as proper button group with visual active state
- Status bar cleaned up: removed duplicate Model, Context Monitor, and CLI Diagnostics items
- Marketplace category "AI" changed to "Machine Learning" for compliance
- Version bumped to 0.1.0

### Removed

- Speculative diff detection (code fences no longer create phantom "edited file" banners)
- SessionTreeProvider (dead code - never registered)
- SkillManager instantiation (dead code - never wired up)
- Duplicate webview element references (newChatBtn, recentList, viewAllSessionsBtn)
- Old session picker HTML section (replaced by dynamic renderRecentSessions)

### Fixed

- Webview initialization crash: `viewAllSessionsBtn` element ID missing from HTML
- webview_ready not being posted on init failure (now guarded with try/catch)
- SessionStore.save() now wrapped in try/catch to prevent silent failures
- Mode toggle CSS now uses .mode-toggle-group div for reliable layout

## [0.0.1] - 2026-05-03

### Added

- Initial release of the OpenCode VS Code extension harness
- Chat sidebar with streaming AI responses via OpenCode CLI
- Multi-tab session management with persistent history
- Model picker with provider/model selection (no server restart needed)
- Agent mode toggle (Normal / Plan / Build)
- Inline CodeLens actions (Explain, Refactor, Generate Tests)
- `@mention` context system for files, symbols, and terminals
- Diff preview with accept/reject in chat
- Permission request handling for CLI tool calls
- Theme integration with VS Code (dark, light, high-contrast)
- CLI theme file discovery (`~/.config/opencode/themes/`)
- Session tree view for browsing saved conversations
- Context usage monitoring with progress bar
- Rate limit monitoring and warnings
- Checkpoint/rollback support
- URI handler for deep links (`vscode://opencode-harness?prompt=...`)
- Keyboard shortcuts for common actions
- Configurable settings (binary path, theme, model, context options)

### Security

- Binary path validation (absolute paths only, shell metacharacters rejected)
- `shell: false` on all `child_process.spawn` calls
- Path traversal protection in CLI theme name resolution
- Input validation on all webview messages
- Content Security Policy configured in webview
- No hardcoded secrets or credentials

### Fixed

- Missing commands in Command Palette (`openChat`, `toggleFocus`, `insertMention`, `showRateLimits`)
- CSS theming fallbacks for all 19 custom properties
- ThemeManager synchronous file system reads replaced with 30s TTL cache
- Undefined CSS value filtering to prevent literal "undefined" injection
- Error boundaries on all command handlers to prevent unhandled promise rejections
- Race condition guard on concurrent `SessionManager.start()` calls
- Graceful server shutdown with SIGTERM → SIGKILL fallback
