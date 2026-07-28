# T3.3: webview/main.ts Decomposition Plan

**Date**: 2026-05-25
**Target**: `src/chat/webview/main.ts` (4108 LoC, 123 functions)
**Prerequisite**: T3.1 (SessionManager) — DONE, T3.2a (BackfillService) — DONE

## Current State

`main.ts` is the webview's single entry point. It contains 123 functions in an IIFE,
organized by feature proximity rather than module boundaries. 20+ `setup*` modules
already exist in sibling files (tabs, model-dropdown, stream, todos-panel, skills-modal,
etc.), but the following groups remain inlined:

| Group | LoC | Functions | Extraction Priority |
|-------|-----|-----------|-------------------|
| messageHandlers (dispatch map) | ~980 | `setupMessageListener`, `messageHandlers` map, `dispatchHostMessage` | High |
| composer (send, queue, input) | ~710 | sendMessage, abortStream, renderQueue, sendQueuedPrompt, setupInput, etc. | High |
| streaming | ~340 | handleStreamStart/Chunk/End, processStreamEndBlocks, scheduleToolUpdate, etc. | Medium |
| tabs | ~260 | createNewTab, createTabUI, switchTab, closeTab, updateTabBar | Medium |
| display (timeline, thinking) | ~220 | setupTimelineToggle, setupThinkingToggle, refreshConversationTimeline, etc. | Low |
| init/boot | ~210 | init(), boot(), IIFE preamble | None (stays) |
| diffReview / fileTracking | ~80 | handleDiffResult, appendOrCoalesceEditBanner, handleChangedFiles, etc. | Low |
| chatList (session list, modal) | ~55 | renderRecentSessionsList, setupSessionModal, openSessionModal, filterByWorkspace | Low |
| contextBar | ~50 | updateContextBarFromSession, updateContextUsageBar, checkOverflowWarnings | Low |
| scrollMarkers | ~40 | updateScrollMarkers, setupJumpToBottom, applyHistoryCondensation, etc. | Low |
| tokenCost | ~30 | handleTokenUsage, accumulateTokenUsage, updateTokenDisplay, etc. | Low |
| other misc | ~80 | addMessage, applyHistoryCondensation, showSystemMessage, etc. | Low |

**Total extractable**: ~2400 LoC → main.ts from 4108 → ~1700 LoC

## Extraction Order

Sequential, one commit per extraction. Each must keep tests passing.

### Step 1: Inline stream handlers → `stream.ts` (~340 LoC moved)

**Functions to move** (from main.ts):
- `handleStreamStart`, `handleStreamChunk`, `handleStreamEnd`
- `showStreamEndReasonMessage`, `processQueueIfReady`, `processStreamEndBlocks`
- `sendQueuedPrompt`, `handleServerStatus`, `handleRequestError`
- `scheduleToolUpdate`, `flushToolUpdate`, `markToolChainProgress`, `clearToolChainProgress`
- `updateAgentStatus`, `showSkillIndicator`
- `setupTimelineToggle`, `setupThinkingToggle`, `applyTimelineVisibility`,
  `refreshConversationTimeline`, `ensureTimeline`, `updateTimelineProgress`

**Dependencies** (available via closure or module-level state):
- `vscode` (VS Code API)
- `stateManager` (persisted state)
- `els` (DOM element refs)
- `modelDropdown`, `modelManager`, `tabBar`, `mention`, `commandsModal`
- `attachmentManager`, `todosPanelApi`, `skillsModalApi`, `subagentPanelApi`
- `scopedState` (session-scoped state per tab)

**Approach**: Export an `initStreamDispatchers(deps)` function from `stream.ts`
that wires the message handlers to the exported functions. The `messageHandlers`
map entries for stream-related types reference the new module's functions.

### Step 2: Composer → a new `composer.ts` (~710 LoC moved)

**Functions to move**:
- `sendMessage`, `abortStream`, `sendSteerPrompt`, `sendQueuedPrompt`
- `setupInput`, `onInputChange`, `onInputKeydown`, `onPaste`
- `renderQueue`, `persistQueues`, `restoreQueues`
- `wireChipReorderHandlers`, `updateQueueSendButton`, `updateSendButton`,
  `updateSendButtonIcon`, `processQueueIfReady`
- `generateTitle`, `isAutoSessionName`, `autoResizeTextarea`
- `insertTextAtCursor`, `runCommandEntry`, `insertIntoPrompt`, `setSteerMode`
- `getStreamCapacityState`, `updatePromptContextChips`, `renderAttachmentChips`

**Approach**: Export `setupComposer(deps)` that returns a `ComposerAPI` with
`sendMessage`, `sendSteerPrompt`, `abortStream`, `processQueueIfReady`.

### Step 3: Stream handlers (remaining) + timeline → `streamHandlers.ts` extension or new `streamDisplay.ts`

**~220 LoC remaining** from display group.

### Step 4: Remaining inline code review / diff / tokenCost wrappers

**~200 LoC** of thin delegation functions to existing UI modules.

## Façade (`main.ts`) After Extraction (~1700 LoC)

| Group | LoC | Notes |
|-------|-----|-------|
| IIFE boot sequence | ~50 | Global error handlers, API shim, `let` declarations |
| init/boot | ~210 | Setup call orchestrator |
| messageHandlers map | ~200 | Remaining handlers after extraction; stream/composer handlers delegated |
| Tabs (remaining) | ~260 | Could keep or extract later |
| ChatList / SessionModal | ~55 | Keep |
| Diff / changedFiles wrappers | ~80 | Keep |
| Context bar wrappers | ~50 | Keep |
| Scroll markers wrappers | ~40 | Keep |
| TokenCost wrappers | ~30 | Keep |
| Other (addMessage, etc.) | ~80 | Keep |
| Module-level setup* calls | ~200 | ~20 setupXxx() calls with wiring |

## Risks and Mitigations

1. **Circular dependencies between extracted modules**: Stream handlers reference composer
   (`processQueueIfReady`), composer references stream handlers (`handleStreamEnd`).
   **Mitigation**: Both get their cross-references via the shared `scope` / `scopedState`
   pattern or injected callbacks.

2. **Shared mutable state**: `let` variables declared in IIFE scope are accessed by all
   functions. **Mitigation**: Keep shared state in main.ts, pass as deps to module init
   functions. Each module returns an API object that main.ts can call.

3. **Test breakage**: Source-analysis tests search for patterns in main.ts.
   **Mitigation**: Update tests to search in the new feature modules.

4. **Boot order**: Extracted modules must be initialized before `boot()` runs.
   **Mitigation**: All init happens in `init()` or at module level before `boot()`.
