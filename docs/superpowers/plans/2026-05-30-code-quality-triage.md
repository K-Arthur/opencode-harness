# Code Quality Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the high-risk complexity, circular dependencies, test gaps, and dead-code noise identified in the opencode-harness triage report.

**Architecture:** Treat the triage as a refactoring program, not a single patch. First make the analysis reliable and add tests around production behavior, then make cycle-breaking and extraction changes behind existing public interfaces. Prefer same-directory extractions and existing services over broad rewrites.

**Tech Stack:** TypeScript VS Code extension, chat webview TypeScript/CSS, existing repo test runner, jCodemunch for navigation and post-edit cache invalidation.

---

## Triage Review

Confirmed by jCodemunch:

- Repo health matches the report: 440 files, 8,029 symbols, average complexity 5.17, dead code reported at 4.1%, 4 dependency cycles, 145 unstable modules.
- Top hotspots match the report: `src/chat/webview/composer.ts::createComposer` complexity 219, `src/chat/handlers/StreamCoordinator.ts::StreamCoordinator.startPrompt` complexity 50, `src/chat/ChatProvider.ts::resolveWebviewView` complexity 38, plus webview rendering/stream handlers.
- Dependency cycles match the report:
  - `src/chat/webview/streamEndHandler.ts` <-> `src/chat/webview/streamHandlers.ts`
  - `src/chat/webview/renderer.ts` <-> `src/chat/webview/toolCallRenderer.ts`
  - 12-file chat command/bootstrap cycle from `src/chat/ChatCommands.ts` through `src/extension.ts` and `src/inline/QuickChatCommand.ts`
  - `src/session/SessionClient.ts` <-> `src/session/SessionManager.ts` <-> `src/session/SseSubscriber.ts`
- Untested-symbol findings are directionally correct: `AutoCompactor`, `BackfillService`, and `BatchEngine` production behavior is not reached by tests.

Important correction:

- Dead-code results need entry-point calibration before deleting production code. `get_dead_code_v2` warned that no standard entry points were detected, which inflates dead-code results for VS Code extension code. Treat `opencode-easy-vision/` and hook helpers as removal candidates, but treat `src/chat/*` dead-code claims as analyzer noise until entry points are configured.

## File Map

- Modify or create analysis config: `.jcodemunch.jsonc` if missing, otherwise the existing jCodemunch config file.
- Modify tests:
  - `src/chat/AutoCompactor.test.ts`
  - `src/chat/BackfillService.test.ts`
  - `src/chat/BatchEngine.test.ts`
  - Existing focused tests near `src/chat/ChatProvider.test.ts`
  - Existing focused tests near webview renderer/stream handler tests
- Modify production code:
  - `src/chat/AutoCompactor.ts`
  - `src/chat/BackfillService.ts`
  - `src/chat/BatchEngine.ts`
  - `src/session/SessionClient.ts`
  - `src/session/SessionManager.ts`
  - `src/session/SseSubscriber.ts`
  - `src/chat/webview/streamEndHandler.ts`
  - `src/chat/webview/streamHandlers.ts`
  - `src/chat/webview/renderer.ts`
  - `src/chat/webview/toolCallRenderer.ts`
  - `src/chat/handlers/StreamCoordinator.ts`
  - `src/chat/ChatProvider.ts`
  - `src/chat/webview/composer.ts`
- Likely create small extracted modules:
  - `src/session/SessionConnection.ts`
  - `src/chat/webview/streamLifecycle.ts`
  - `src/chat/webview/renderingUtils.ts`
  - `src/chat/handlers/PromptStartContext.ts`
  - `src/chat/PostMessageRetryQueue.ts`
  - `src/chat/WebviewViewInitializer.ts`
- Candidate removal or formalization:
  - `opencode-easy-vision/`
  - `.opencode/hooks/pre-commit-clippy.sh`
  - `.opencode/hooks/pre-commit-compile.sh`
  - `.opencode/hooks/pre-commit-coverage.sh`
  - `.opencode/hooks/pre-commit-prod-quality.sh`

## Phase 0: Make Measurements Trustworthy

### Task 0.1: Configure entry points for static analysis

**Files:**
- Create or modify: `.jcodemunch.jsonc`

- [ ] Use `resolve_repo`, `suggest_queries`, and `plan_turn` before editing.
- [ ] Check whether `.jcodemunch.jsonc` already exists with jCodemunch file tools.
- [ ] Add VS Code extension and webview entry points so analyzer dead-code signals stop treating production modules as unreachable.

Recommended entry-point patterns:

```jsonc
{
  "entry_point_patterns": [
    "src/extension.ts",
    "src/chat/webview/main.ts",
    "src/chat/webview/**/*.css",
    "esbuild.js",
    ".opencode/hooks/*.sh"
  ]
}
```

- [ ] Run the repo health and dead-code scans again.

```bash
npm test
npm run compile
```

Expected result: tests and compile still pass; dead-code output no longer reports most reachable `src/chat/*` methods as dead only because no entry point was known.

- [ ] Commit:

```bash
git add .jcodemunch.jsonc
git commit -m "chore: calibrate code quality analysis entry points"
```

### Task 0.2: Capture a baseline before refactoring

**Files:**
- Modify: `docs/superpowers/plans/2026-05-30-code-quality-triage.md`

- [ ] Record the current jCodemunch values in this plan before any code changes:

```text
cycle_count=4
createComposer complexity=219
StreamCoordinator.startPrompt complexity=50
ChatProvider.resolveWebviewView complexity=38
untested production classes include AutoCompactor, BackfillService, BatchEngine
```

- [ ] Run the current full verification command.

```bash
npm test
npm run compile
```

Expected result: establish whether the repo starts green. If baseline fails, record the failing command and do not mix unrelated baseline fixes into refactor commits.

## Phase 1: Add Missing Test Nets

### Task 1.1: Cover BatchEngine

**Files:**
- Create: `src/chat/BatchEngine.test.ts`
- Modify only if needed for testability: `src/chat/BatchEngine.ts`

- [ ] Write tests for adding items, replacing duplicate keys, scheduled flush, manual flush, delete, clear, keys, size, and dispose.
- [ ] Use fake timers if the existing test framework supports them.
- [ ] Keep production API unchanged.

Minimum behavior matrix:

```text
add() stores or replaces keyed work
flush() drains pending work exactly once
delete() prevents a deleted item from flushing
clear() removes all pending items
dispose() cancels scheduled timers and clears state
```

- [ ] Run:

```bash
npm test -- src/chat/BatchEngine.test.ts
```

Expected result: `BatchEngine` behavior is pinned down before other chat refactors can accidentally break batching.

- [ ] Commit:

```bash
git add src/chat/BatchEngine.test.ts src/chat/BatchEngine.ts
git commit -m "test: cover chat batch engine"
```

### Task 1.2: Cover AutoCompactor

**Files:**
- Create: `src/chat/AutoCompactor.test.ts`
- Modify only if needed for dependency injection: `src/chat/AutoCompactor.ts`

- [ ] Test the "below threshold does nothing" path.
- [ ] Test the "above threshold prompts or compacts" path.
- [ ] Test `compactNow` success and failure behavior.
- [ ] Test `handleBannerAction` routing for accepted, dismissed, and unsupported actions.
- [ ] Test `dispose` clears timers/listeners and leaves `isCompacting()` false.

Minimum behavior matrix:

```text
tryCompactIfNeeded() is idempotent while compaction is in progress
compactNow() delegates to the configured model/session dependency
handleBannerAction() does not compact after dismiss
dispose() prevents later scheduled compaction work
```

- [ ] Run:

```bash
npm test -- src/chat/AutoCompactor.test.ts
```

Expected result: `AutoCompactor` can be refactored safely and no longer appears as an untested production class.

- [ ] Commit:

```bash
git add src/chat/AutoCompactor.test.ts src/chat/AutoCompactor.ts
git commit -m "test: cover auto compaction behavior"
```

### Task 1.3: Cover BackfillService

**Files:**
- Create: `src/chat/BackfillService.test.ts`
- Modify only if needed for dependency injection: `src/chat/BackfillService.ts`

- [ ] Test `hydrate` marks service hydrated and avoids duplicate hydration.
- [ ] Test `backfillRecoveredSessions` attempts each recovered session once.
- [ ] Test failed backfill schedules retry without losing the tab.
- [ ] Test `backfillTabIfNeeded` skips already hydrated tabs and backfills missing history.
- [ ] Test `dispose` cancels pending retry timers.

Minimum behavior matrix:

```text
hydrate() is one-shot
setHydrated() affects isHydrated()
backfillRecoveredSessions() isolates failure per session
scheduleBackfillRetry() does not create duplicate timers for the same tab
dispose() clears retry state
```

- [ ] Run:

```bash
npm test -- src/chat/BackfillService.test.ts
```

Expected result: recovered-session behavior is protected before ChatProvider extraction.

- [ ] Commit:

```bash
git add src/chat/BackfillService.test.ts src/chat/BackfillService.ts
git commit -m "test: cover recovered session backfill"
```

## Phase 2: Break Small Cycles First

### Task 2.1: Break the session client/manager/subscriber cycle

**Files:**
- Create: `src/session/SessionConnection.ts`
- Modify: `src/session/SessionClient.ts`
- Modify: `src/session/SessionManager.ts`
- Modify: `src/session/SseSubscriber.ts`

- [ ] Create small interfaces in `SessionConnection.ts` for SSE callbacks and session event publishing.

```ts
export interface SessionEventSink {
  onSessionEvent(event: unknown): void | Promise<void>;
  onSessionError(error: unknown): void | Promise<void>;
}

export interface SessionSubscription {
  dispose(): void | Promise<void>;
}
```

- [ ] Refactor `SseSubscriber` so it depends on `SessionEventSink` instead of importing `SessionManager`.
- [ ] Refactor `SessionClient` so it owns transport concerns only.
- [ ] Keep `SessionManager` as the orchestrator that wires `SessionClient` and `SseSubscriber` together.
- [ ] Run:

```bash
npm test -- src/session
npm run compile
```

Expected result: the `SessionClient.ts`/`SessionManager.ts`/`SseSubscriber.ts` cycle is gone, public behavior is unchanged.

- [ ] Commit:

```bash
git add src/session/SessionConnection.ts src/session/SessionClient.ts src/session/SessionManager.ts src/session/SseSubscriber.ts
git commit -m "refactor: invert session SSE dependencies"
```

### Task 2.2: Break streamEndHandler/streamHandlers cycle

**Files:**
- Create: `src/chat/webview/streamLifecycle.ts`
- Modify: `src/chat/webview/streamEndHandler.ts`
- Modify: `src/chat/webview/streamHandlers.ts`

- [ ] Move shared stream completion decisions, event-shape helpers, or constants used by both files into `streamLifecycle.ts`.
- [ ] Make `streamEndHandler.ts` and `streamHandlers.ts` import the shared helper module instead of each other.
- [ ] Keep all exported function names used by callers stable.
- [ ] Run:

```bash
npm test -- src/chat/webview
npm run compile
```

Expected result: webview stream rendering behavior is unchanged and the two-file cycle is gone.

- [ ] Commit:

```bash
git add src/chat/webview/streamLifecycle.ts src/chat/webview/streamEndHandler.ts src/chat/webview/streamHandlers.ts
git commit -m "refactor: separate shared webview stream lifecycle helpers"
```

### Task 2.3: Break renderer/toolCallRenderer cycle

**Files:**
- Create: `src/chat/webview/renderingUtils.ts`
- Modify: `src/chat/webview/renderer.ts`
- Modify: `src/chat/webview/toolCallRenderer.ts`

- [ ] Move shared pure helpers such as snippet extraction, plan-file detection support, and formatting utilities into `renderingUtils.ts`.
- [ ] Leave DOM mutation and top-level rendering orchestration in the existing renderer files.
- [ ] Add or update tests for `detectPlanFile` and snippet extraction before moving code.
- [ ] Run:

```bash
npm test -- src/chat/webview
npm run compile
```

Expected result: the renderer cycle is gone and hotspot helpers have focused tests.

- [ ] Commit:

```bash
git add src/chat/webview/renderingUtils.ts src/chat/webview/renderer.ts src/chat/webview/toolCallRenderer.ts
git commit -m "refactor: extract shared webview rendering utilities"
```

## Phase 3: Extract StreamCoordinator.startPrompt

### Task 3.1: Add characterization coverage for startPrompt

**Files:**
- Create or modify the existing test near: `src/chat/handlers/StreamCoordinator.ts`

- [ ] Add tests that cover:
  - new prompt starts a stream and records active state
  - prompt with attachments is passed through unchanged
  - existing stream for the same tab is aborted or rejected according to current behavior
  - failed provider/session start cleans up pending state
  - completion callback reaches finalizer once

- [ ] Run:

```bash
npm test -- src/chat/handlers
```

Expected result: tests fail only if current behavior is not represented correctly, then pass before extraction.

- [ ] Commit:

```bash
git add src/chat/handlers
git commit -m "test: characterize stream prompt startup"
```

### Task 3.2: Extract prompt-start context building

**Files:**
- Create: `src/chat/handlers/PromptStartContext.ts`
- Modify: `src/chat/handlers/StreamCoordinator.ts`

- [ ] Move parameter normalization and request/context assembly out of `startPrompt`.
- [ ] Keep `StreamCoordinator.startPrompt` signature stable.
- [ ] Use a narrow exported function name:

```ts
export function createPromptStartContext(/* current startPrompt inputs */) {
  // Move existing normalization logic here during implementation.
}
```

- [ ] Run:

```bash
npm test -- src/chat/handlers
npm run compile
```

Expected result: `startPrompt` complexity drops without changing callers.

- [ ] Commit:

```bash
git add src/chat/handlers/PromptStartContext.ts src/chat/handlers/StreamCoordinator.ts
git commit -m "refactor: extract stream prompt start context"
```

### Task 3.3: Extract lifecycle/error branches from startPrompt

**Files:**
- Modify: `src/chat/handlers/StreamCoordinator.ts`
- Create only if it remains cohesive: `src/chat/handlers/StreamStartLifecycle.ts`

- [ ] Extract state registration, finalizer wiring, and error cleanup into private methods or a small helper module.
- [ ] Prefer private methods if the helper would have many dependencies.
- [ ] Re-run complexity check for `StreamCoordinator.startPrompt`.

```bash
npm test -- src/chat/handlers
npm run compile
```

Expected result: `startPrompt` is below cyclomatic complexity 20, with no signature change.

- [ ] Commit:

```bash
git add src/chat/handlers/StreamCoordinator.ts src/chat/handlers/StreamStartLifecycle.ts
git commit -m "refactor: simplify stream prompt lifecycle"
```

## Phase 4: Shrink ChatProvider Blast Radius

### Task 4.1: Extract postMessage retry queue

**Files:**
- Create: `src/chat/PostMessageRetryQueue.ts`
- Modify: `src/chat/ChatProvider.ts`
- Modify tests near: `src/chat/ChatProvider.test.ts`

- [ ] Move `scheduleRetry` and `processRetryQueue` state into `PostMessageRetryQueue`.
- [ ] Keep actual VS Code webview posting injected as a callback.

```ts
export interface RetryablePostMessage {
  readonly message: unknown;
  readonly attempt: number;
}

export class PostMessageRetryQueue {
  constructor(private readonly post: (message: unknown) => Thenable<boolean> | Promise<boolean>) {}
}
```

- [ ] Test retry success, retry exhaustion, disposal, and ordering.
- [ ] Run:

```bash
npm test -- src/chat/ChatProvider.test.ts
npm test -- src/chat/PostMessageRetryQueue.test.ts
npm run compile
```

Expected result: `ChatProvider.processRetryQueue` is removed or becomes a one-line delegate, reducing `ChatProvider.ts` complexity and dependency churn.

- [ ] Commit:

```bash
git add src/chat/PostMessageRetryQueue.ts src/chat/PostMessageRetryQueue.test.ts src/chat/ChatProvider.ts src/chat/ChatProvider.test.ts
git commit -m "refactor: move webview post retries out of ChatProvider"
```

### Task 4.2: Extract webview view initialization

**Files:**
- Create: `src/chat/WebviewViewInitializer.ts`
- Modify: `src/chat/ChatProvider.ts`
- Modify tests near: `src/chat/ChatProvider.test.ts`

- [ ] Move the non-trivial setup branches from `resolveWebviewView` into `WebviewViewInitializer`.
- [ ] Keep ownership of long-lived services in `ChatProvider`; initializer should receive dependencies instead of creating global state.
- [ ] Test HTML setup, message listener wiring, initial state push, and disposal registration.
- [ ] Run:

```bash
npm test -- src/chat/ChatProvider.test.ts
npm run compile
```

Expected result: `resolveWebviewView` complexity falls below 15 and `ChatProvider.ts` imports fewer modules directly.

- [ ] Commit:

```bash
git add src/chat/WebviewViewInitializer.ts src/chat/ChatProvider.ts src/chat/ChatProvider.test.ts
git commit -m "refactor: extract chat webview initialization"
```

### Task 4.3: Attack the 12-file chat/bootstrap cycle

**Files:**
- Modify: `src/chat/ChatCommands.ts`
- Modify: `src/chat/ChatProvider.ts`
- Modify: `src/chat/CommandExecutionService.ts`
- Modify: `src/chat/SessionLifecycleService.ts`
- Modify: `src/chat/WebviewEventRouter.ts`
- Modify: `src/chat/handlers/SteerPromptHandler.ts`
- Modify: `src/chat/handlers/StreamCoordinator.ts`
- Modify: `src/chat/handlers/StreamFinalizerService.ts`
- Modify: `src/commands/index.ts`
- Modify: `src/commands/session.ts`
- Modify: `src/extension.ts`
- Modify: `src/inline/QuickChatCommand.ts`

- [ ] Find the first back-edge in the cycle with `get_dependency_cycles` and `get_dependency_graph`.
- [ ] Move shared contracts out of implementation modules into a low-level type-only module, such as `src/chat/ChatContracts.ts`, only if an existing type module cannot host them cleanly.
- [ ] Replace value imports with `import type` wherever only types are needed.
- [ ] Ensure `extension.ts` constructs services but does not get imported by chat services.
- [ ] Ensure command modules depend on small chat interfaces, not concrete `ChatProvider` internals.
- [ ] Run:

```bash
npm test
npm run compile
```

Expected result: the 12-file cycle is broken without changing extension activation behavior.

- [ ] Commit:

```bash
git add src/chat src/commands src/extension.ts src/inline/QuickChatCommand.ts
git commit -m "refactor: break chat command bootstrap cycle"
```

## Phase 5: Reduce Webview Monolith Complexity

### Task 5.1: Characterize createComposer behavior

**Files:**
- Modify existing tests near: `src/chat/webview/composer.ts`

- [ ] Add tests or browser-harness assertions for:
  - text entry and submit state
  - attachments and image handling
  - slash command/mention interactions
  - mode/model/provider controls
  - disabled/streaming states
  - keyboard navigation and focus restoration
- [ ] Run:

```bash
npm test -- src/chat/webview
```

Expected result: the main composer workflows are pinned down before extraction.

- [ ] Commit:

```bash
git add src/chat/webview
git commit -m "test: characterize webview composer behavior"
```

### Task 5.2: Split createComposer into cohesive pieces

**Files:**
- Modify: `src/chat/webview/composer.ts`
- Create as needed:
  - `src/chat/webview/composerState.ts`
  - `src/chat/webview/composerAttachments.ts`
  - `src/chat/webview/composerCommands.ts`
  - `src/chat/webview/composerKeyboard.ts`

- [ ] Extract pure state derivation first.
- [ ] Extract attachment handling second.
- [ ] Extract command/mention handling third.
- [ ] Extract keyboard/focus behavior last.
- [ ] Keep the public `createComposer` entry point stable and let it orchestrate the smaller modules.
- [ ] Run complexity after each extraction and stop when `createComposer` is below 40.

```bash
npm test -- src/chat/webview
npm run compile
```

Expected result: `createComposer` remains the single public factory but no longer contains the full UI state machine.

- [ ] Commit after each coherent extraction:

```bash
git add src/chat/webview/composer.ts src/chat/webview/composerState.ts
git commit -m "refactor: extract composer state model"
```

```bash
git add src/chat/webview/composer.ts src/chat/webview/composerAttachments.ts
git commit -m "refactor: extract composer attachment handling"
```

```bash
git add src/chat/webview/composer.ts src/chat/webview/composerCommands.ts src/chat/webview/composerKeyboard.ts
git commit -m "refactor: extract composer interactions"
```

## Phase 6: Resolve Dead Code Intentionally

### Task 6.1: Decide and act on opencode-easy-vision

**Files:**
- Candidate remove or formalize:
  - `opencode-easy-vision/package.json`
  - `opencode-easy-vision/src/index.ts`
  - `opencode-easy-vision/src/config.ts`
  - `opencode-easy-vision/src/imageSaver.ts`
  - `opencode-easy-vision/src/modelDetector.ts`
  - `opencode-easy-vision/src/promptInjector.ts`

- [ ] Check whether this subpackage is shipped, documented, or referenced by package/workspace metadata.
- [ ] Default decision: remove it from this repo if it is not shipped or referenced.
- [ ] If keeping it, formalize it as a workspace/package and add tests for config, image saving, model detection, and prompt injection.
- [ ] Run:

```bash
npm test
npm run compile
```

Expected result: either the disconnected package is gone, or it is intentionally part of the build/test graph.

- [ ] Commit one of:

```bash
git rm -r opencode-easy-vision
git commit -m "chore: remove disconnected easy vision package"
```

```bash
git add package.json opencode-easy-vision
git commit -m "test: formalize easy vision package coverage"
```

### Task 6.2: Clean up hook helper duplication

**Files:**
- Modify:
  - `.opencode/hooks/pre-commit-clippy.sh`
  - `.opencode/hooks/pre-commit-compile.sh`
  - `.opencode/hooks/pre-commit-coverage.sh`
  - `.opencode/hooks/pre-commit-prod-quality.sh`

- [ ] Treat each shell file as an executable entry point, not dead code.
- [ ] If `_fc_write_violation` duplication is intentional and local, leave it but ensure analyzer entry points include `.opencode/hooks/*.sh`.
- [ ] If duplication causes maintenance risk, move shared helper logic to `.opencode/hooks/lib/pre-commit-common.sh` and source it from each hook.
- [ ] Run:

```bash
bash -n .opencode/hooks/pre-commit-clippy.sh
bash -n .opencode/hooks/pre-commit-compile.sh
bash -n .opencode/hooks/pre-commit-coverage.sh
bash -n .opencode/hooks/pre-commit-prod-quality.sh
npm test
```

Expected result: hook scripts remain syntactically valid and no longer show up as accidental dead-code removals.

- [ ] Commit:

```bash
git add .opencode/hooks
git commit -m "chore: clarify pre-commit hook shared helpers"
```

## Phase 7: Final Verification and Acceptance

### Task 7.1: Re-run jCodemunch quality checks

**Files:**
- Modify: `docs/superpowers/plans/2026-05-30-code-quality-triage.md`

- [ ] Run:
  - `get_repo_health`
  - `get_hotspots`
  - `get_dependency_cycles`
  - `get_untested_symbols`
  - `get_dead_code_v2`
  - `get_coupling_metrics` for `src/chat/ChatProvider.ts` and `src/chat/webview/composer.ts`
- [ ] Record before/after values in this plan.

Acceptance targets:

```text
dependency cycles: 4 -> 0
createComposer complexity: 219 -> below 40
StreamCoordinator.startPrompt complexity: 50 -> below 20
ChatProvider.resolveWebviewView complexity: 38 -> below 15
AutoCompactor, BackfillService, BatchEngine: no longer listed as untested production classes
dead-code report: no uncalibrated production src/chat/* false positives
```

- [ ] Run full verification:

```bash
npm test
npm run compile
```

Expected result: all tests and compile pass after the refactor program.

- [ ] Commit:

```bash
git add docs/superpowers/plans/2026-05-30-code-quality-triage.md
git commit -m "docs: record code quality triage outcomes"
```

## Execution Order

1. Phase 0: calibrate analysis and baseline.
2. Phase 1: add tests for currently untested production classes.
3. Phase 2: break the two small cycles and the session cycle.
4. Phase 3: extract `StreamCoordinator.startPrompt`.
5. Phase 4: reduce `ChatProvider` and break the 12-file cycle.
6. Phase 5: split `createComposer`.
7. Phase 6: handle dead-code candidates after entry points are trustworthy.
8. Phase 7: verify metrics and record outcomes.

## Risk Controls

- Do not delete `src/chat/*` methods based solely on dead-code output until entry points are configured.
- Keep public exports and command IDs stable until tests prove callers have moved.
- Prefer type-only imports for cycle breaking before introducing new runtime modules.
- Commit after each small extraction so regressions can be bisected.
- Re-run `register_edit` after code edits if hooks do not auto-reindex edited files.
