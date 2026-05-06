# OpenCode Harness — Repository Baseline Audit

**Date:** 2026-05-05
**Auditor:** Automated first-principles audit
**Scope:** Full repo health, failure map, test-session cleanup, highest-risk cascades
**Commit:** a78b316ec8c76ccbe04a453ad7c3a12a5f215a36

---

## 1. Repo Health Summary

### Stats
- **12,772 lines of TypeScript** across 67 non-test source files
- **Architecture:** Extension entry → SessionManager (server process) → SessionStore (VS Code globalState) → ChatProvider (webview bridge) → StreamCoordinator (prompt/stream lifecycle)
- **Indexed repo:** `local/opencode-harness-52362aad`

### Module Inventory

| Subsystem | Primary Files | Lines (approx) | Test Coverage |
|-----------|--------------|----------------|---------------|
| Extension activation | `src/extension.ts` | 319 | `src/extension.test.ts` |
| Server lifecycle | `src/session/SessionManager.ts` | ~580 | `SessionManager.test.ts` |
| Session persistence | `src/session/SessionStore.ts` | ~150 | `SessionStore.test.ts`, behavioral tests |
| Webview provider | `src/chat/ChatProvider.ts` | ~925 | `ChatProvider.test.ts` |
| Message routing | `src/chat/handlers/MessageRouter.ts` | ~200 | `MessageRouter.test.ts` |
| Stream coordination | `src/chat/handlers/StreamCoordinator.ts` | ~300 | `StreamCoordinator.test.ts` |
| Chunk batching | `src/chat/ChunkBatcher.ts` | ~100 | `ChunkBatcher.test.ts` |
| Event normalization | `src/session/EventNormalizer.ts` | ~350 | `EventNormalizer.test.ts`, behavioral |
| Webview entry | `src/chat/webview/main.ts` | ~1100 | Limited |
| UI renderer | `src/chat/webview/renderer.ts` | ~700 | `renderer.test.ts` |
| Tab management | `src/chat/webview/tabs.ts` | ~400 | `TabManager.test.ts` |
| Diff handling | `src/diff/DiffApplier.ts`, `DiffHandler.ts` | ~250+ | `DiffHandler.test.ts` |
| Checkpoint/revert | `src/checkpoint/CheckpointManager.ts` | ~200 | `CheckpointManager.test.ts` |
| Slash commands | `src/chat/ChatCommands.ts` | ~180 | `ChatCommands.test.ts` |
| Model management | `src/model/ModelManager.ts` | ~200 | `ModelManager.test.ts` |
| Theme/CSS | `src/theme/ThemeManager.ts`, 7 CSS files | ~800 total | `ThemeManager.test.ts` |
| Context engine | `src/context/ContextEngine.ts` | ~200 | `ContextEngine.test.ts` |
| Terminal bridge | `src/terminal/TerminalBridge.ts` | ~150 | `TerminalBridge.test.ts` |
| Port finder | `src/utils/portFinder.ts` | ~80 | `portFinder.test.ts` |

### Build & CI Status
- TypeScript strict mode + `noUncheckedIndexedAccess` enabled ✅
- ESLint configured ✅
- CI pipeline: `.github/workflows/ci.yml` present
- Test runner: Vitest (Jest-compatible API)
- Bundler: esbuild

---

## 2. Failure Map — Grouped by Subsystem

### 2.1 Server Lifecycle & Connection

#### ISSUE SLC-01: Stored port health check failure
- **Log:** `Stored port 36047 health check failed, starting new server`
- **Root cause:** `SessionManager.startServer()` in `src/session/SessionManager.ts` stores the port in `globalState['opencode-server-port']`. On next activation, it probes the stored port. If the opencode process died between sessions, the health check fails and a new server starts on a random port.
- **Risk:** LOW — fallback is correct behavior. However, the old port is not cleaned up, and rapid restarts may accumulate zombie port entries.
- **Evidence:** Lines 53–56 in `src/extension.ts` restore stored port; `SessionManager.startServer()` runs health check.
- **Reproduction:** Stop extension, kill opencode process, restart extension.
- **Test to write:** Unit test for stored-port-failure → new-server-start path.

#### ISSUE SLC-02: OPENCODE_SERVER_PASSWORD not set
- **Log:** `Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.`
- **Root cause:** The opencode CLI server starts without authentication. No code in the extension sets `OPENCODE_SERVER_PASSWORD` env var before spawning the server.
- **Risk:** HIGH — any local process can connect to the opencode server HTTP endpoint on localhost.
- **Evidence:** `SessionManager.startServer()` spawns opencode without setting `OPENCODE_SERVER_PASSWORD`.
- **Reproduction:** Start extension, observe server log output.
- **Test to write:** Integration test verifying password env var is passed to child process.

#### ISSUE SLC-03: Async prompt 60-second timeout
- **Log:** `Sending async prompt to session ses_...` → 60s later → `Message completion timeout for tab session-...`
- **Root cause:** `StreamCoordinator.startPrompt()` has a hardcoded 60-second timeout (`MESSAGE_COMPLETION_TIMEOUT`). If the server does not emit a completion event within 60s, the prompt times out. The timeout fires even when streaming is actively receiving chunks — it only checks for the final `message_complete` event.
- **Risk:** HIGH — long-running model responses (especially with large context or slow models like `glm-5`) will timeout even when working correctly.
- **Evidence:** `src/chat/handlers/StreamCoordinator.ts` — timeout constant and `Promise.race` pattern.
- **Reproduction:** Send a complex prompt to a slow model.
- **Files likely touched:** `src/chat/handlers/StreamCoordinator.ts`
- **Test to write:** Unit test verifying timeout resets on chunk receipt, not just on completion.

### 2.2 Session Persistence

#### ISSUE SES-01: Persisted sessions fail to show
- **Symptom:** Server reports 55 persisted sessions, but they don't appear in the UI.
- **Root cause (suspected):** `SessionStore` uses `globalState['opencode-harness.sessions']` keyed by extension-generated session IDs. The server's sessions use different IDs (`ses_...`). The `SessionManager.listServerSessions()` fetches server sessions but the mapping between extension sessions and server sessions is fragile — `cliSessionId` may not be populated for sessions created in previous runs.
- **Evidence:** `SessionStore` stores `OpenCodeSession[]` with `cliSessionId?: string` (optional). If the server was restarted, old `cliSessionId` values may be stale.
- **Risk:** HIGH — users lose access to conversation history.
- **Reproduction:** Create sessions, restart extension, observe if sessions reappear.
- **Files likely touched:** `src/session/SessionStore.ts`, `src/session/SessionManager.ts`, `src/chat/webview/tabs.ts`
- **Test to write:** Integration test for session restoration after server restart.

#### ISSUE SES-02: Model-generated messages fail to show
- **Symptom:** AI responses don't appear in the chat UI, even though the server processes them.
- **Root cause (suspected):** The `EventNormalizer` handler chain may not correctly map all server event types to UI-renderable events. If the model uses `opencode-go/glm-5` or `opencode/big-pickle` (seen in logs), they may emit event structures the normalizer doesn't handle. Additionally, the `StreamCoordinator` timeout (SLC-03) kills the stream before completion.
- **Evidence:** `src/session/EventNormalizer.ts` has a handler chain for specific event types. Unknown types may be silently dropped.
- **Risk:** HIGH — core functionality broken.
- **Reproduction:** Switch to `glm-5` model, send a prompt, observe if response renders.
- **Files likely touched:** `src/session/EventNormalizer.ts`, `src/chat/handlers/StreamCoordinator.ts`
- **Test to write:** Unit test for EventNormalizer with unknown/edge-case event types.

#### ISSUE SES-03: Archive/delete sessions unreliable
- **Symptom:** Archiving and deleting sessions don't work reliably.
- **Root cause (suspected):** `src/commands/session.ts` has archive/delete commands, but the delete operation may only remove from `SessionStore` (extension side) without deleting from the opencode server. Server-side sessions accumulate independently.
- **Evidence:** `SessionStore.deleteSession()` removes from globalState but no corresponding server API call is visible in the outline.
- **Risk:** MEDIUM — orphaned server sessions consume resources.
- **Reproduction:** Create and delete a session, check if it still exists on the server.
- **Files likely touched:** `src/session/SessionStore.ts`, `src/commands/session.ts`

### 2.3 Streaming Performance

#### ISSUE STR-01: Slow time-to-first-byte and streaming responsiveness
- **Symptom:** Streaming feels slow.
- **Root cause (multi-factor):**
  1. **50ms chunk batching** (`ChunkBatcher`) adds latency to every chunk.
  2. **Event normalization chain** processes every event through multiple handlers before dispatch.
  3. **Webview postMessage serialization** — every chunk crosses the extension↔webview boundary via JSON serialization.
  4. **No streaming progress indicator** — user sees nothing until the first chunk renders.
- **Evidence:** `src/chat/ChunkBatcher.ts` uses `BATCH_INTERVAL = 50`. `StreamCoordinator` routes through `EventNormalizer` → `ChatProvider` → `postMessage` → webview.
- **Risk:** MEDIUM — UX degradation.
- **Files likely touched:** `src/chat/ChunkBatcher.ts`, `src/chat/webview/stream.ts`
- **Test to write:** Performance test measuring chunk-to-render latency.

### 2.4 Slash Commands

#### ISSUE CMD-01: Two clashing slash command implementations
- **Symptom:** `/` triggers two competing UI surfaces.
- **Root cause:** There are **three layers** of slash command handling:
  1. **Webview autocomplete** (`src/chat/webview/main.ts` ~line 476): Static `SLASH_COMMANDS` array, renders `<ul class="slash-autocomplete-list">`.
  2. **Webview dispatch** (`src/chat/webview/main.ts` `sendMessage()`): Switch/case that postMessages back to extension.
  3. **Extension-side** (`src/chat/ChatCommands.ts`): Server-discovered commands via mentions/skills system.
  - The mentions system (`src/chat/webview/mentions.ts`) provides a **separate** autocomplete dropdown (`#mention-dropdown`) for server-side commands accessed via `@`.
  - Both fire on `/` input, potentially conflicting.
- **Risk:** HIGH — confused UX, commands may not dispatch correctly.
- **Reproduction:** Type `/` in chat input.
- **Files likely touched:** `src/chat/webview/main.ts`, `src/chat/webview/mentions.ts`, `src/chat/ChatCommands.ts`

#### ISSUE CMD-02: Slash command icons use emojis
- **Symptom:** Special slash-command icons should use proper SVG/icons, not emojis.
- **Root cause:** The static `SLASH_COMMANDS` array in `main.ts` likely uses emoji strings for icons.
- **Risk:** LOW — cosmetic but unprofessional.
- **Files likely touched:** `src/chat/webview/main.ts`

### 2.5 UI & Rendering

#### ISSUE UI-01: Fonts not loading correctly
- **Symptom:** Correct fonts are not loading in the webview.
- **Root cause (suspected):** Webview CSS files reference font families but the webview may not have access to the font files. VS Code webviews are sandboxed and can only load resources explicitly added via `webview.asWebviewUri()`. The CSS in `src/chat/webview/css/base.css` or `tokens.css` may reference fonts not bundled or not using the webview URI scheme.
- **Evidence:** Font references in CSS files need verification against what's bundled via `WebviewContent.ts`.
- **Risk:** MEDIUM — visual inconsistency.
- **Reproduction:** Open chat panel, inspect computed font-family in dev tools.
- **Files likely touched:** `src/chat/WebviewContent.ts`, `src/chat/webview/css/tokens.css`

#### ISSUE UI-02: Add context/content button broken
- **Symptom:** Add context button and modal have broken functionality, styling, and referenced item handling.
- **Root cause (suspected):** The context modal in the webview handles file/content attachment but may not properly serialize and send context items to the extension host, or the `MessageRouter` may not handle `attach_context` messages.
- **Risk:** HIGH — core feature broken.
- **Files likely touched:** `src/chat/webview/main.ts`, `src/chat/handlers/MessageRouter.ts`, `src/context/ContextEngine.ts`

#### ISSUE UI-03: User message styling inconsistent
- **Symptom:** User messages render with inconsistent styling.
- **Root cause (suspected):** The `renderer.ts` applies different CSS classes based on message role, but user messages may not have a consistent class applied, or the CSS tokens may not correctly differentiate user vs assistant messages.
- **Risk:** LOW — cosmetic.
- **Files likely touched:** `src/chat/webview/renderer.ts`, `src/chat/webview/css/messages.css`

#### ISSUE UI-04: No infinite scroll / scroll tracking
- **Symptom:** Need DeepSeek-style scroll tracking with hover-reveal of sent messages.
- **Root cause:** Feature not implemented. Current chat has basic auto-scroll but no scroll-position-preserving navigation.
- **Risk:** LOW — enhancement request.
- **Files likely touched:** `src/chat/webview/main.ts`, `src/chat/webview/dom.ts`

#### ISSUE UI-05: No timestamps on messages
- **Symptom:** Messages lack timestamps.
- **Root cause:** The `ChatMessage` type may include timestamps but the renderer may not display them.
- **Risk:** LOW — enhancement.
- **Files likely touched:** `src/chat/webview/renderer.ts`

### 2.6 Diff/Revert/Checkpoint

#### ISSUE DIF-01: Revert flow needs review
- **Symptom:** Reverting messages/code changes is unreliable.
- **Root cause (suspected):** `CheckpointManager` creates checkpoints before edits, and `DiffApplier` applies diffs using VS Code's `WorkspaceEdit` API. The revert path may not correctly undo multi-file changes or may lose the undo stack.
- **Evidence:** `src/checkpoint/CheckpointManager.ts` manages checkpoints; `src/diff/DiffApplier.ts` applies diffs. Need to verify undo stack preservation.
- **Risk:** HIGH — code changes could be lost.
- **Reproduction:** Apply a diff via chat, then attempt to revert.
- **Files likely touched:** `src/checkpoint/CheckpointManager.ts`, `src/diff/DiffApplier.ts`

### 2.7 Edit Message & Clear All

#### ISSUE EDT-01: Edit message button broken/incomplete
- **Symptom:** Edit message button doesn't work.
- **Root cause (suspected):** The edit-message flow requires re-sending a modified prompt, but the implementation may not correctly cancel the current stream, update the message in SessionStore, and re-prompt the server.
- **Risk:** MEDIUM — useful feature not working.
- **Files likely touched:** `src/chat/webview/main.ts`, `src/chat/handlers/MessageRouter.ts`

#### ISSUE EDT-02: Clear all sessions button broken/unsafe
- **Symptom:** Clear all sessions button is broken or unsafe.
- **Root cause (suspected):** The clear-all command may iterate and delete sessions without proper confirmation or without distinguishing real vs test sessions.
- **Risk:** HIGH — data loss risk.
- **Files likely touched:** `src/commands/session.ts`, `src/session/SessionStore.ts`

### 2.8 Skills Manager

#### ISSUE SKL-01: Skills manager incomplete
- **Symptom:** Skills manager needs review, completion, and hardening.
- **Root cause:** The skills system relies on server-discovered commands exposed through the mentions system (`mentions.ts`). The webview-side skill rendering and invocation may be incomplete.
- **Risk:** MEDIUM — feature incomplete.
- **Files likely touched:** `src/chat/webview/mentions.ts`, `src/chat/ChatCommands.ts`

### 2.9 Network Resilience

#### ISSUE NET-01: Connection failures and retry handling inadequate
- **Symptom:** Network connection failures and retry failures need robust handling.
- **Root cause (suspected):** The `SessionManager.subscribeToEvents()` uses an async iterable (SSE stream). If the connection drops, the reconnection logic may not be robust — the stream may end silently without retry.
- **Evidence:** Need to verify error handling in the SSE subscription loop.
- **Risk:** HIGH — streaming stops silently on network issues.
- **Files likely touched:** `src/session/SessionManager.ts`

---

## 3. Storage Locations Inventory

| Key | Location | Data Shape | Size Risk |
|-----|----------|------------|-----------|
| `opencode-harness.sessions` | VS Code `globalState` | `Record<string, OpenCodeSession>` — full message history | **HIGH** — grows unbounded with 55+ sessions |
| `opencode-harness.modelCache` | VS Code `globalState` | `ModelInfo[]` — 61 models | LOW — bounded, small |
| `opencode-server-port` | VS Code `globalState` | `number \| undefined` | LOW — single value |
| `opencode.autoModeConfirmed` | VS Code `globalState` | `boolean` | LOW — single flag |
| Server sessions | opencode server process | Server-managed, fetched via HTTP | MEDIUM — 55 sessions |

### Session Data Shape
```typescript
interface OpenCodeSession {
  id: string;
  name: string;              // "Default", "Session 1", "New session ...", "Tab session ..."
  createdAt: number;         // epoch ms
  lastActiveAt: number;      // epoch ms
  model: string;
  mode: string;
  cliSessionId?: string;     // link to CLI server session
  archived?: boolean;
  messages: ChatMessage[];   // { role, id?, blocks... }
}
```

---

## 4. Safe Test-Session Cleanup Plan

### 4.1 Session Classification Criteria

| Category | Criteria | Action |
|----------|----------|--------|
| **Empty** | `messages.length === 0` | Safe to delete |
| **Test** | `name` matches `/^(Test|Tab session|New session|Default)$/` AND `messages.length < 5` | Safe to delete after review |
| **Orphaned** | `cliSessionId` is set but server no longer has that session | Safe to delete or re-link |
| **Duplicate** | Same `cliSessionId` appears in multiple extension sessions | Keep newest, flag oldest |
| **Corrupted** | Missing required fields (`id`, `createdAt`, `model`) | Quarantine, don't delete |
| **Real** | Has meaningful messages (length ≥ 5) with non-generic name | **PROTECT** — never auto-delete |

### 4.2 Cleanup Procedure (Non-Destructive)

**Phase A — Diagnose (dry-run only)**
```bash
# Command: "OpenCode: Diagnose Sessions"
# 1. Read all sessions from globalState
# 2. Fetch all sessions from opencode server
# 3. Cross-reference extension sessions ↔ server sessions
# 4. Classify each session by category above
# 5. Output a report: counts per category, orphaned list, duplicate list
# 6. Write report to output channel — DO NOT DELETE ANYTHING
```

**Phase B — Export backup**
```bash
# Command: "OpenCode: Export Sessions Backup"
# 1. Serialize all globalState sessions to JSON file
# 2. Save to user-chosen location via save dialog
# 3. Verify file is valid JSON with correct session count
```

**Phase C — Selective cleanup (with confirmation)**
```bash
# Command: "OpenCode: Cleanup Test Sessions"
# 1. Show dry-run report
# 2. Ask user to confirm categories to clean (checkbox: empty, test, orphaned)
# 3. Show exact sessions that will be deleted (name, date, message count)
# 4. Final confirmation with count
# 5. Delete selected sessions from globalState ONLY
# 6. Optionally delete corresponding server sessions
# 7. Log all deletions
```

**Phase D — Rollback**
```bash
# If something goes wrong:
# 1. Import the backup JSON from Phase B
# 2. Write all sessions back to globalState
# 3. Reload webview
```

### 4.3 Safety Constraints
- **Never delete all sessions** — always require category selection
- **Never delete sessions with ≥ 5 messages** without explicit per-session confirmation
- **Always log what was deleted** (session IDs, names, timestamps)
- **Always offer backup export** before any deletion
- **Never touch server sessions** unless user explicitly opts in
- **Dry-run first** — every cleanup command must support `--dry-run`

---

## 5. Recommended Implementation Phases

### Phase 1: Critical Path Hardening (touches ≤ 5 files)
**Goal:** Fix streaming timeout and message visibility — the two issues that make the extension unusable.

| # | Task | Files | Test |
|---|------|-------|------|
| 1.1 | Fix `StreamCoordinator` timeout to reset on chunk receipt | `src/chat/handlers/StreamCoordinator.ts` | `StreamCoordinator.test.ts` |
| 1.2 | Add unknown-event-type passthrough in `EventNormalizer` | `src/session/EventNormalizer.ts` | `EventNormalizer.test.ts` |
| 1.3 | Add session diagnostic command (dry-run only) | `src/commands/session.ts`, `src/session/SessionStore.ts` | `session.test.ts` |

**Verification:**
```bash
npx tsc --noEmit && npm run lint && npm test
```

### Phase 2: Session Persistence & Safety (touches ≤ 5 files)
**Goal:** Sessions survive restarts; cleanup is safe.

| # | Task | Files | Test |
|---|------|-------|------|
| 2.1 | Fix session ID mapping between extension and server | `src/session/SessionStore.ts`, `src/session/SessionManager.ts` | Integration test |
| 2.2 | Implement safe cleanup command with dry-run/backup/confirm | `src/commands/session.ts`, `src/session/SessionStore.ts` | `SessionStore.test.ts` |
| 2.3 | Add `OPENCODE_SERVER_PASSWORD` generation and injection | `src/session/SessionManager.ts` | `SessionManager.test.ts` |

**Verification:**
```bash
npx tsc --noEmit && npm run lint && npm test
```

### Phase 3: UX Fixes (touches ≤ 5 files)
**Goal:** Fix the most visible UI issues.

| # | Task | Files | Test |
|---|------|-------|------|
| 3.1 | Unify slash command handling (merge webview + extension) | `src/chat/webview/main.ts`, `src/chat/ChatCommands.ts` | Visual test |
| 3.2 | Fix font loading in webview | `src/chat/WebviewContent.ts`, `src/chat/webview/css/tokens.css` | Visual test |
| 3.3 | Fix add-context button/modal | `src/chat/webview/main.ts`, `src/chat/handlers/MessageRouter.ts` | Unit + visual test |

**Verification:**
```bash
npx tsc --noEmit && npm run lint && npm test
npx playwright test --config playwright.config.ts
```

---

## 6. Reproduction Commands & Log Views

### Extension Host Logs
```bash
# VS Code → Output → "OpenCode Harness"
# Watch for: activation, server start, health check, session load, timeout
code --disable-extensions --enable-proposed-api saoudrizwan.claude-dev
```

### Webview Console
```bash
# Open chat panel → right-click → "Inspect Webview"
# Watch for: postMessage errors, rendering errors, stream events
```

### Server Health Check
```bash
# Check if stored port is alive
PORT=$(cat ~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/opencode-server-port 2>/dev/null)
curl -s "http://127.0.0.1:${PORT}/health" || echo "Port dead"
```

### Server Sessions
```bash
# List all server-side sessions
PORT=41725  # from logs
curl -s "http://127.0.0.1:${PORT}/api/sessions" | jq '.[].id' | wc -l
```

### Network SSE Stream
```bash
# Watch raw SSE events
PORT=41725
curl -N "http://127.0.0.1:${PORT}/api/events" 2>&1 | head -50
```

### Test Suite
```bash
# Full suite
npm test

# Specific module
npx vitest run src/chat/handlers/StreamCoordinator.test.ts
npx vitest run src/session/EventNormalizer.test.ts

# Type check
npx tsc --noEmit

# Lint
npm run lint

# Build
npm run build  # or node esbuild.js
```

---

## 7. Missing Tooling & Test Gaps

### Blocking Gaps
| Gap | Impact | Recommendation |
|-----|--------|----------------|
| **No webview integration tests** | Cannot verify message rendering, slash commands, context modal | Add Playwright webview tests |
| **No mock opencode server** | Cannot test server communication without running instance | Create `tests/mocks/opencode-server.ts` |
| **No session fixture factory** | Tests create ad-hoc session data | Create `tests/fixtures/session-factory.ts` |
| **No streaming simulation** | Cannot test chunk batching, timeout, reconnection | Create `tests/helpers/stream-simulator.ts` |

### Test Coverage Gaps (modules without tests)
| Module | Risk | Priority |
|--------|------|----------|
| `src/chat/webview/main.ts` (1100 lines) | HIGH — core webview logic | P0 |
| `src/chat/webview/tabs.ts` | HIGH — tab management | P1 |
| `src/chat/webview/renderer.ts` | HIGH — message rendering | P1 |
| `src/commands/session.ts` | MEDIUM — session commands | P1 |
| `src/commands/rollback.ts` | HIGH — revert safety | P0 |
| `src/prompts/PromptManager.ts` | MEDIUM — prompt handling | P2 |

### Architectural Concerns
| Concern | Impact | Recommendation |
|---------|--------|----------------|
| `globalState` unbounded growth | Extension storage quota hit, performance degradation | Implement session eviction (LRU by `lastActiveAt`) |
| No session size tracking | Cannot warn users about large sessions | Add `SessionStore.getSessionSize(id)` |
| Webview messages unvalidated | Security risk — malformed messages could crash extension | Add Zod schemas for all webview↔extension messages |
| No structured error codes | Errors are strings, not typed | Create `src/errors/` hierarchy |

---

## 8. Issue Priority Matrix (Top 10)

| Priority | Issue ID | Symptom | Risk | Effort |
|----------|----------|---------|------|--------|
| **P0** | SLC-03 | 60s timeout kills active streams | HIGH | S |
| **P0** | SES-02 | Model messages don't show | HIGH | M |
| **P0** | SES-01 | Persisted sessions don't show | HIGH | M |
| **P1** | NET-01 | Connection failures not retried | HIGH | M |
| **P1** | SLC-02 | Server unauthenticated | HIGH | S |
| **P1** | DIF-01 | Revert may lose changes | HIGH | M |
| **P1** | EDT-02 | Clear-all may delete real data | HIGH | S |
| **P2** | CMD-01 | Clashing slash command UIs | HIGH | M |
| **P2** | UI-02 | Add context button broken | HIGH | M |
| **P2** | STR-01 | Streaming feels slow | MEDIUM | M |

---

*End of baseline audit. This document should be read before any implementation session targeting the issues above.*
