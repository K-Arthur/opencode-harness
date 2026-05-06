# OpenCode Harness Repair Notes

**Created:** 2026-05-05
**Updated:** 2026-05-06
**Status:** V7 — Streaming pipeline, session persistence, and frontend redesigned. 306/307 tests passing.

## Resolved Issues

### V7 Fixes (2026-05-06)

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Streaming never renders (all `stream.handleX is not a function`) | `...stream` spread on `StreamSession` class instance discards prototype methods | `Object.assign(Object.create(proto), stream, overrides)` |
| Extension crash on startup | `sessionStore` passed to `initConnectionStatusBar` before initialization | Reordered initialization |
| Session history loses tool calls, thinking blocks, diffs | `handleStreamEnd` replaced all blocks with server blocks (text+tool only) | Merge server blocks into existing real-time blocks |
| `handleStreamEnd: empty response` errors | `stream_end` messageId (`msg_...`) mismatched `stream_start` ID (`ses_...` prefix) | Normalized both to `resp-{id}` format |
| Duplicate avatar/header per response | `handleStreamStart` had no re-entry guard | Added `if (state.isStreaming) return` |
| Stop button doesn't stop | `sendMessage` called `enqueuePrompt(text)` on streaming instead of `abortStream()` | Changed to call `abortStream()` |
| Edit/revert buttons do nothing | Missing `sessionId` in message payload | Added `sessionId: msg.sessionId` |
| Extension starts on session, not welcome page | Default session auto-created; `init_state` auto-switched | Removed auto-create; always show welcome view |
| Model dropdown empty on welcome page | `get_models` only called when sessions existed | Moved outside session-length check |
| Stale empty sessions restored on startup | `SessionStore.load()` restored active empty sessions | Skip all zero-message sessions |
| Source map CSP violation | Webview source maps blocked by `connect-src 'none'` | `sourcemap: false` for webview build |
| "Unhandled SDK event type" console noise | FallbackHandler warned for events already handled | Removed misleading warning |
| Mode selector: three separate buttons | Original segmented-button design | Unified dropdown with icons + colored backdrops |
| Markdown raw text during streaming | `handleStreamToken` used `textContent` (no markdown parsing) | `innerHTML = sanitizeHtml(renderMarkdown(text))` fallback in `handleStreamEnd` |

### Known Remaining Issues
- 1 test failure: DeltaHandler emits `messageId` in text_chunk events but test expects plain `{ text }`

## Older Hypotheses From Initial Notes

The core "no assistant output" bug had **two likely root causes**:

### Hypothesis A: SessionIdleHandler triggers premature stream completion
- Log shows: first chunk → immediately `sending → completing → idle`
- The opencode server likely emits a session idle event shortly after prompt completion
- If StreamCoordinator treats "session idle" as stream completion, it finalizes before content reaches the webview
- **Files to inspect:** `src/session/eventHandlers/SessionHandlers.ts`, `src/chat/handlers/StreamCoordinator.ts`

### Hypothesis B: Event type mismatch between EventNormalizer output and what the webview expects
- EventNormalizer produces: `text_chunk`, `message_complete`, `session_status`, `tool_start`, `tool_end`, `thinking`, `file_edited`, `permission_request`, `session_compacted`
- MessageRouter.routeSseEvent() expects: `stream_start`, `stream_token`, `stream_chunk`, `stream_end`, `stream_error`, `tool_start`, `tool_update`, `tool_end`, `diff`, `thinking`, `text`, `error`, `session_start`, `session_end`, `model_change`, `compaction`
- These are **completely different vocabularies**. If normalized events are routed through MessageRouter's `routeSseEvent()`, `text_chunk` would hit the default/exhaustive check and be lost.
- The webview stream handler processes `stream_token` type messages
- But EventNormalizer produces `text_chunk`, not `stream_token`
- **This is the most likely root cause**: events are normalized to wrong types that the webview doesn't handle

### Hypothesis C: Both A and B are true
- Stream completes too early AND content never reaches the webview due to type mismatch

## Files Inspected

| File | Key Finding |
|---|---|
| `src/session/EventNormalizer.ts` | Normalizes SDK events; `isAssistantMessage` returns true when role unknown (good) |
| `src/session/eventHandlers/DeltaHandler.ts` | Handles `message.part.delta`; drops if delta empty, non-text part, or non-assistant |
| `src/session/eventHandlers/TextPartHandler.ts` | Handles `message.part.updated`; emits `text_chunk` for text parts |
| `src/session/eventHandlers/MessageUpdateHandler.ts` | Handles `message.updated`; tracks message role; emits `message_complete` |
| `src/chat/handlers/MessageRouter.ts` | Has `routeSseEvent()` with 16 known types: `stream_start`, `stream_token`, etc. Just forwards via postMessage |
| `src/chat/webview/stream.ts` | Webview stream handler - processes messages from extension host |
| `src/chat/ChatProvider.ts` | Main orchestrator; handles webview messages and SSE events |
| `src/session/SessionManager.ts` | Manages opencode server lifecycle |

## Files NOT YET Inspected (Critical)

| File | Why Important |
|---|---|
| `src/session/eventHandlers/SessionHandlers.ts` | SessionIdleHandler - likely causes premature completion |
| `src/chat/handlers/StreamCoordinator.ts` | State machine for stream lifecycle - transitions `sending→completing→idle` |
| `src/chat/ChatProvider.ts` (SSE event handling section) | How normalized events are routed to webview - do they go through MessageRouter? |
| `src/chat/webview/renderer.ts` | DOM update logic for stream tokens |
| `src/session/SessionManager.ts` (sendPromptAsync) | How prompt is sent and how SSE events flow back |

## Root Causes Found

1. **Event type mismatch (HIGH CONFIDENCE)**: EventNormalizer emits `text_chunk` but webview expects `stream_token`. The routing layer may not translate between these.
2. **Premature stream completion (MEDIUM CONFIDENCE)**: SessionIdleHandler or similar may trigger StreamCoordinator to finalize before content renders.
3. **HTTP 401 model refresh (CONFIRMED)**: After server connects, model refresh fails with 401. Doesn't block chat directly but indicates auth inconsistency.
4. **Implicit prompt context injection (CONFIRMED 2026-05-06)**: `StreamCoordinator.startPrompt()` sent `[contextText, userText]` to `sendPromptAsync`. A plain `hello` was not CLI-equivalent and could induce tool use from hidden workspace metadata.
5. **Invalid final message fetch (CONFIRMED 2026-05-06)**: `StreamCoordinator.finalizeStream()` read `session.history` from `SessionManager.getSession()`, but the current `@opencode-ai/sdk` `Session` type has no `history`. The SDK exposes message history through `client.session.messages()`.

## Phase 0 Baseline (NOT YET RUN)

Initial environment captured on 2026-05-06 by Codex:

```bash
node --version -> v22.22.0
npm --version -> 10.9.4
code --version -> 1.118.1
opencode --version -> 1.14.39
```

Package scripts present: `typecheck`, `build`, `test:unit`, `test:integration`, `test:visual`, `lint`.

jCodemunch-MCP note: project instructions require jCodemunch for code navigation, but this Codex runner did not expose any jCodemunch tools through deferred tool discovery. Avoid broad code exploration; use only targeted reads for files about to be edited or verified.

Worktree note: repo is already very dirty with many modified and untracked files from prior repair attempts. Do not revert unrelated changes.

Baseline command results:
- `npm install`: pass; repo already up to date; npm audit reports 2 low-severity vulnerabilities.
- `npm run build`: pass.
- `npm run typecheck`: failed before fixes due `StreamCoordinator.ts` referencing missing `Session.history`.
- `npm run test:unit`: failed before fixes; `ChatProvider.test.ts` false-failed because a comment in the `server_status` block contained `finalizeStream`.

## Changes Made 2026-05-06

- `src/chat/handlers/StreamCoordinator.ts`: `startPrompt()` now sends only `[{ type: "text", text }]` to opencode; context token estimation is fire-and-forget and is not included in the prompt payload.
- `src/session/SessionManager.ts`: added `getSessionMessages()` using `client.session.messages({ path: { id } })`.
- `src/chat/handlers/StreamCoordinator.ts`: `finalizeStream()` now fetches the last assistant message from `getSessionMessages()` and maps SDK parts to webview blocks, falling back to the streaming buffer if needed.
- `src/chat/ChatProvider.ts`: removed the literal `finalizeStream` text from idle-status comments so the source regression test measures code, not comments.
- `src/chat/handlers/StreamCoordinator.test.ts`: added regression coverage that plain prompts are a single user text part without hidden context; updated stale context-builder assertion.
- `src/session/SessionManager.test.ts`: added regression coverage for `getSessionMessages()`.

Targeted verification after these changes:
- `npx tsx --test src/chat/handlers/StreamCoordinator.test.ts`: pass, 21/21.
- `npx tsx --test src/session/SessionManager.test.ts`: pass, 16/16.
- `npx tsx --test src/chat/ChatProvider.test.ts`: pass, 30/30.
- `npm run typecheck`: pass.

Full validation after packaging:
- `npm run test:unit`: pass, 852/852 total tests across both configured runners (`node --test tests/unit/*.test.mjs` reported 307/307; `npx tsx --test "src/**/*.test.ts"` reported 545/545).
- `npm run build`: pass.
- `npm run lint`: pass.
- `npx @vscode/vsce package --no-dependencies --allow-missing-repository --out opencode-harness-repair.vsix`: pass; packaged `opencode-harness-repair.vsix` (249.86 KB).
- `code --install-extension /home/kevinarthur/PersonalProjects/opencode-harness/opencode-harness-repair.vsix --force`: pass.
- `npm run test:visual`: fail, 16 failed / 6 passed. Failures are concentrated around stale visual selectors/snapshots and webview contract expectations (`#mode-toggle`, old prompt placeholder, message/tool/diff selectors, model label update, send button state).
- `npm run test:integration`: hung after launching `.vscode-test` VS Code and reporting an unresponsive extension host. Test runner was manually terminated to avoid leaving `.vscode-test` processes running.

Manual validation still required after reloading VS Code:
1. Send `hello` in a fresh chat and confirm the OpenCode output shows a single text prompt part with no generated context block.
2. Confirm `hello` no longer triggers workspace tool calls unless the selected model independently chooses to do so without hidden extension context.
3. Confirm assistant content appears live in the active tab and remains visible after `message_complete`.

## Phase 2 Fixes (2026-05-06)

### Root Causes Found & Fixed

1. **`model:""` causes TTFB timeout** — When no model was previously selected, `sendMessage` sent `model: ""`. The server received `undefined` model and never responded. Fixed in three places: dropdown now tracks selected model via `getCurrentModel()`, `sendMessage` rejects empty model, `send_prompt` handler falls back to `modelManager.model`, and `ModelManager.refreshModels` auto-selects the first model.

2. **Live response never rendered** — Three compounding bugs:
   - `ensureSession` replaced `existing.messages = session.messages`, orphaning the stream handler's array reference
   - `loadSessions` created entirely new message arrays via `{ ...s }` spread, invalidating ALL active stream handlers
   - `handleStreamEnd` had zero fallback rendering — if `reRenderMessage` failed, the response was silently invisible despite blocks arriving correctly from the server
   
   Fix: in-place mutation for `ensureSession`, preserve existing array in `loadSessions`, add `addMessage()` fallback in `handleStreamEnd` that force-removes empty placeholder and renders blocks unconditionally.

3. **rAF doesn't fire in background** — `requestAnimationFrame` pauses when the webview tab is not focused. Added `setTimeout(50ms)` fallback. (`streamHandlers.ts`)

1. Run Phase 0 baseline commands and record failures.
2. Inspect current prompt construction path in `StreamCoordinator.ts` with targeted file reads.
3. Add/adjust a failing regression test proving plain `hello` is sent without hidden context.
4. Implement the smallest fix to restore CLI-equivalent prompt payloads.
5. Inspect live stream handler path only as needed for the active-session render bug.
6. Add/adjust regression tests for live chunk visibility/finalization.
7. Build/package/install the extension and record exact command outputs.
