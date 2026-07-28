# T3.2: ChatProvider Decomposition Plan

**Date**: 2026-05-25
**Target**: `src/chat/ChatProvider.ts` (~1802 LoC → ~800 LoC façade)
**Prerequisite**: T3.1 (SessionManager decomposition) — DONE

## Current State

ChatProvider has 69 methods across 1802 LoC. It already delegates to 15+ extracted sub-services
(StreamCoordinator, SessionLifecycleService, CommandExecutionService, ChatFileOps, WebviewEventRouter,
TabManager, StatePushService, PromptManager, AutoCompactor, etc.), but still contains:

- A 291-line `serverEventHandlers` map with inline closures
- A 182-line backfill subsystem (3 methods + 4 fields)
- A 175-line message-reliability subsystem (5 methods + 5 fields)
- 20 one-liner delegation methods (~60 LoC of pure pass-through)

## Extracted Services

### 1. ServerEventHandler (new: `src/chat/ServerEventHandler.ts`)

**Extracts**: `serverEventHandlers` map (L577–867), `handleServerEvent` (L1059–1119),
`shouldAutoRejectPlanPermission` (L1121–1133), `isPlanDocumentPattern` (L1135–1138)

**~376 LoC** → self-contained event routing with 20+ handler closures.

**Dependencies** (injected via constructor):
- `postMessage(msg)` — callback to push messages to webview
- `postRequestError(msg)` — callback to push errors
- `sessionManager: { getSessionMessages, sendPrompt, respondToPermission, ... }`
- `sessionStore: { addMessage, updateSession, ... }`
- `tabManager: { getTab, getTabs }`
- `streamCoordinator: { appendChunk, appendToolStart, appendToolEnd }`
- `modelManager: { ... }` — for model list refresh on server_connected
- `autoCompactor: { ... }` — for context usage events
- `pendingEventBuffer: PendingEventBuffer` — for event buffering
- `sessionLifecycle: { ... }` — for resume/compact/diff delegation
- `refreshCommandListQuietly()` — callback for mcp_tools_changed
- `backfillRecoveredSessions()` — callback for sessions_recovered
- `backfillTabIfNeeded(tabId)` — callback for session_created

**Seam**: ChatProvider constructs ServerEventHandler with bound callbacks.
`handleWebviewMessage` already delegates to `eventRouter.route()` — no change there.
New: `handleServerEvent` becomes `serverEventHandler.handleEvent(event)`.

### 2. BackfillService (new: `src/chat/BackfillService.ts`)

**Extracts**: `backfillRecoveredSessions` (L869–945), `scheduleBackfillRetry` (L947–991),
`backfillTabIfNeeded` (L993–1042), plus fields: `backfillInProgress`, `backfillRetryTimer`,
`BACKFILL_RETRY_DELAYS_MS`, `BACKFILL_CONCURRENCY`, `restoredTabsHydrated`

**~182 LoC** → session recovery backfill with parallel fetch, exponential retry.

**Dependencies** (injected via constructor):
- `sessionManager: { getSessionMessages }`
- `sessionStore: { getSession, addMessage, updateSession, ... }`
- `tabManager: { getTab, getTabs, onTabCreated }`
- `sdkMessagesToChatMessages` — pure function
- `summarizeOpencodeMessageUsage` — pure function
- `pushInitState()` — callback to re-hydrate webview after backfill
- `postSessionListUpdate()` — callback to update session list

**Seam**: ChatProvider constructs BackfillService and passes it to ServerEventHandler.
`tabManager.onTabCreated` subscription moves from ChatProvider to BackfillService.

### 3. WebviewMessagingService (new: `src/chat/WebviewMessagingService.ts`)

**Extracts**: `postMessage` (L1360–1379), `postRawMessage` (L1381–1408),
`recordPostMessageRejected` (L1420–1433), `scheduleRetry` (L1436–1452),
`processRetryQueue` (L1455–1531), plus fields: `messageBatcher`, `messageRetryQueue`,
`retryTimer`, `postMessageRejectedConsecutive`, `postMessageRejectedTotal`,
`lastBackpressureLogAt`, and statics: `CRITICAL_MESSAGE_TYPES`, `MAX_RETRIES`,
`RETRY_DELAYS_MS`, `MAX_RETRY_QUEUE_SIZE`

**~175 LoC** → buffered message posting with backpressure detection and retry.

**Dependencies**:
- `webviewView: { visible, onDidChangeVisibility }` — injected later via `setView(view)`
- `HostMessageBatcher` — batch layer
- `notifyTurnComplete()` — callback for turn-complete notification
- `log` — output channel

**Seam**: ChatProvider creates WebviewMessagingService and calls `msgService.postMessage(msg)`.
`resolveWebviewView` calls `msgService.setView(view)`.

## Remaining Façade (~800 LoC)

After extraction, ChatProvider retains:

| Group | LoC | Methods |
|-------|-----|---------|
| Constructor + wiring | ~161 | 1 |
| Webview Lifecycle | ~320 | resolveWebviewView, pushInitStateToWebview, pushAllStateToWebview, pushVisibleStateToWebview, dispose |
| Session CRUD (delegation) | ~77 | ensureLocalTab, openSessionInWebview, handleResumeSession, etc. |
| Model Management | ~30 | pushModelToWebview, applyContextWindowFor, pushModelListToWebview |
| Configuration (delegation) | ~163 | provider CRUD, stash, commands, MCP, rate limit |
| Other delegation | ~60 | handleAttach*, handleCompact*, handleExecute*, toUserErrorMessage, etc. |
| **Total** | **~811** | |

## Execution Order

1. **WebviewMessagingService** — cleanest seam (postMessage is called by everything but calls nothing back except callbacks)
2. **BackfillService** — depends only on sessionManager + stores, easy to isolate
3. **ServerEventHandler** — largest extraction, depends on both new services via callbacks

Each extraction is a separate commit for safe rollback.

## Test Strategy

- Source-analysis tests for each new service (~20 tests each)
- Existing ChatProvider.test.ts and ChatProvider.source-analysis.test.ts updated to search new files
- Full suite must pass before each commit

## Rollback

Each extraction is a single commit. Reverting the commit restores the previous state.
No shared mutable state between services — all communication via callbacks.
