# Implementation Status - AI Methodology Enhancements (Revised)

## Overview
This document tracks the implementation status of AI methodology enhancement features following the corrected integration approach that leverages existing SADD/TDD infrastructure, plus recent context monitoring and skills system enhancements.

## Corrected Approach

### Original Mistake
Initially created a standalone `SpecService` that duplicated functionality and didn't integrate with the existing SADD/TDD infrastructure that was already in the codebase.

### Corrected Approach
Leverage existing infrastructure:
- **TDDOrchestrator** (src/skills/TDDOrchestrator.ts) - Already manages Red-Green-Refactor-Coverage cycles
- **SkillTriggerEngine** (src/skills/SkillTriggerEngine.ts) - Already has SADD/TDD trigger rules
- **TaskDecomposer** (src/skills/TaskDecomposer.ts) - Already breaks tasks into subtasks using jCodemunch
- **SkillManager** (src/methodology/SkillManager.ts) - Already manages skill definitions and composition

## Completed Work

### Phase 1: Integration with Existing TDD Infrastructure ✅

#### 1. TDDOrchestrator Enhancement ✅
- **File**: `src/skills/TDDOrchestrator.ts`
- **Changes**:
  - Added `Spec` interface for spec-driven workflows
  - Added `setSpec(spec: Spec)` method to guide TDD process
  - Added `getSpec()` method to retrieve current spec
  - Enhanced `buildRedPrompt()` to include spec context (outcomes, scope, constraints, verification criteria)
- **Integration Points**:
  - Uses existing TDD phase execution (red, green, refactor, coverage)
  - Spec context is injected into test generation prompts
  - No breaking changes to existing TDD workflow

#### 2. SkillTriggerEngine Enhancement ✅
- **File**: `src/skills/SkillTriggerEngine.ts`
- **Changes**:
  - Added `sadd-spec-driven` trigger for spec-driven development patterns
  - Added `tdd-spec-verification` trigger for spec verification workflows
  - Both triggers combine SADD and TDD skills appropriately
- **Integration Points**:
  - Uses existing trigger matching infrastructure
  - Leverages existing skill composition
  - No breaking changes to existing triggers

#### 3. MethodologyOrchestrator Cleanup ✅
- **File**: `src/methodology/MethodologyOrchestrator.ts`
- **Changes**:
  - Removed SpecService dependency (was wrong approach)
  - Removed spec-aware selection logic (was wrong approach)
  - Cleaned up comments to reflect corrected approach
- **Integration Points**:
  - Now relies on existing skill system for spec-driven workflows
  - Methodology selection remains unchanged

#### 4. MethodologyCatalog Cleanup ✅
- **File**: `src/methodology/MethodologyCatalog.ts`
- **Changes**:
  - Removed Spec type import
  - Removed `selectWithSpec()` method (was wrong approach)
- **Integration Points**:
  - Methodology selection remains based on task classification
  - Spec-driven workflows handled by skill system instead

## How Spec-Driven Development Works Now

### Workflow
1. User request mentions "spec-driven", "according to spec", or "spec-based"
2. SkillTriggerEngine matches `sadd-spec-driven` trigger
3. Skills are composed: subagent-driven-development + test-driven-development
4. If spec is available, TDDOrchestrator.setSpec(spec) is called
5. TDD process executes with spec context in test generation prompts
6. Spec verification criteria guide test creation and validation

### Integration Points
- **SkillTriggerEngine**: Detects spec-driven intent and activates appropriate skills
- **TDDOrchestrator**: Uses spec context to guide test generation
- **TaskDecomposer**: Can be used for task breakdown when spec is available (not yet integrated)
- **MethodologyOrchestrator**: Routes through cascade router based on methodology selection

### Phase 2: Methodology ↔ Skills runtime integration ✅ (2026-05-17)

After auditing the chat pipeline the following gaps were closed:

#### 5. Skills modal wiring bug ✅
- **File**: `src/chat/webview/main.ts`
- **Symptom**: clicking the "Manage skills" header button did nothing.
- **Cause**: `setupButtonsModule({ …, skillsModalOpen: skillsModalApi?.open })` captured `skillsModalApi` (still `null` at that point in `init()`), so the click handler at `src/chat/webview/ui/buttonSetup.ts:100` resolved to `undefined` forever.
- **Fix**: pass a thunk — `skillsModalOpen: () => skillsModalApi?.open?.()` — so resolution happens at click time.

#### 6. Skill enable/disable persistence ✅
- **Files**: `src/skills/SkillPreferencesStore.ts` (new), `src/chat/WebviewEventRouter.ts`, `src/chat/ChatProvider.ts`
- **Previously**: `toggle_skill` was a deliberate no-op ("opencode server doesn't support agent enable/disable"); `resolveAllSkills` hardcoded `enabled: true`.
- **Now**: `SkillPreferencesStore` persists disabled IDs to `globalState` (key `opencode-skill-disabled`). `toggle_skill` writes through the store and re-emits `skills_list`. `resolveAllSkills` reflects the persisted preference on every list.

#### 7. SkillTriggerEngine wired into the prompt pipeline ✅
- **Files**: `src/methodology/MethodologyAdvisor.ts`, `src/chat/ChatProvider.ts`
- **Previously**: `SkillTriggerEngine` was instantiated only by its own tests; its trigger rules (`tdd-*`, `sadd-*`, `react-component`, `python-testing`, `code-review`, etc.) never influenced model input.
- **Now**: `MethodologyAdvisor` accepts an optional `skillHinter: (text: string) => string[]`. `ChatProvider` wires it to `skillTriggerEngine.getTriggeredSkills(text)` filtered by `SkillPreferencesStore.isEnabled(id)`. The advisor appends `\nRelevant skills: …` to its methodology addendum (capped at 4 entries, dedup'd). Output flows through `StreamCoordinator.applyMethodologyAdvice` exactly like before, so the model receives a single combined hint per turn.

#### 8. Pre-existing timeline-jumps test repaired ✅
- **File**: `src/chat/webview/main.test.ts`
- The test grepped `main.ts` for `scrollMessageToTop(msgList, target)` inside the `scrollToTurn` block, but the implementation had moved to `src/chat/webview/ui/scrollMarkers.ts`. The test now reads from `scrollMarkersSource` (already imported at the top of the file).

### Phase 3: Slash commands & session lifecycle fixes ✅ (2026-05-17)

Frontend command availability and session creation edge cases:

#### 9. Inline slash dropdown opacity ✅
- **File**: `src/chat/webview/css/components.css`
- **Symptom**: The mention/commands dropdown was semi-transparent (94% opacity via `color-mix`), making text behind it bleed through.
- **Fix**: Changed `.dropdown` background from `color-mix(in srgb, var(--oc-editor-bg) 94%, var(--oc-panel-bg))` to `var(--oc-editor-bg)`.

#### 10. Commands modal z-index consistency ✅
- **File**: `src/chat/webview/css/components.css`
- **Symptom**: `.commands-modal` used `var(--z-modal, 1000)` while the actual `--z-modal` token is `300`.
- **Fix**: Changed fallback from `1000` to `300` to match all other modals.

#### 11. Proactive command list loading ✅
- **File**: `src/chat/webview/main.ts`
- **Symptom**: Server commands and skill/prompt commands only appeared in the inline dropdown after typing `/commands`. On fresh sessions, only the 16 hardcoded `LOCAL_COMMANDS` were available.
- **Fix**: `boot()` now sends `list_commands` immediately after `webview_ready`, pre-populating both the inline dropdown and the commands modal.

#### 12. Commands palette accessibility ✅
- **Files**: `src/chat/webview/index.html`, `src/chat/webview/dom.ts`, `src/chat/webview/main.ts`, `package.json`
- **Symptom**: Commands modal only accessible by typing `/commands` or VS Code command palette — no keyboard shortcut, no visible button.
- **Fix**: Added `Ctrl+Shift+/` keybinding, added a `>_` palette button in the input bottom bar, and the inline dropdown now hides when the modal opens.

#### 13. Command execution on new sessions ✅
- **File**: `src/chat/CommandExecutionService.ts`
- **Symptom**: Running a server command on a freshly created tab (no server session) caused `NotFoundError: Session not found` because `tab.cliSessionId` was undefined.
- **Fix**: `handleExecuteCommand` now calls `sessionManager.ensureSession()` when `cliSessionId` is missing, creates the server session on-demand, and persists the ID on both the tab and session store.

#### 14. Host state push messages handled ✅
- **File**: `src/chat/webview/main.ts`
- **Symptom**: `push_all_state` and `push_visible_state` messages from the host were logged as "unknown host message type" and silently dropped.
- **Fix**: Both messages now trigger `requestStateSyncDebounced()` for proper state synchronization.

#### 15. TDD test coverage ✅
- **File**: `src/chat/CommandExecutionService.test.ts` (new), `src/chat/webview/main.test.ts` (extended)
- **Added**: 7 tests for `CommandExecutionService` (session ensure flow, ID persistence, error handling). 4 regression tests in `main.test.ts` for message handlers, proactive loading, and button wiring.

### Phase 4: Methodology module bugfix audit ✅ (2026-05-29)

SADD-based review of `src/methodology/` (22 source files, 11 test files, ~150 tests). All 150 tests green after fixes; zero new type errors.

#### 16. CascadeRouter audit-log memory leak ✅ (C2)
- **File**: `src/methodology/CascadeRouter.ts`
- **Issue**: Audit log array grew without bound in long-lived sessions.
- **Fix**: Added `MAX_AUDIT_ENTRIES = 1000` cap; oldest entries evicted via `.shift()` when exceeded.
- **Follow-up**: Consider exposing cap via `MethodologyConfig` instead of hardcoding.

#### 17. QualityEvaluator `compiles` metric accepted non-code ✅ (C4)
- **File**: `src/methodology/QualityEvaluator.ts`
- **Issue**: `compiles` metric returned `true` for any text inside a markdown fence, even prose.
- **Fix**: Added `looksSyntacticallyValid()` (balanced-brace heuristic) as a prerequisite check.

#### 18. TaskClassifier non-deterministic tie-breaking ✅ (C5)
- **File**: `src/methodology/TaskClassifier.ts`
- **Issue**: When multiple task types scored equally, `detectTaskType()` depended on `Object.entries` insertion order.
- **Fix**: Added `TASK_TYPE_PRIORITY` map for deterministic tie-breaking.

#### 19. MethodologyCatalog specificity scoring inflated ✅ (M1)
- **File**: `src/methodology/MethodologyCatalog.ts`
- **Issue**: `ruleSpecificity()` added raw `minComplexity` and `minFileScope` values to the specificity score, causing high-threshold rules to always win.
- **Fix**: Specificity now counts constraint *presence* only, not threshold values.

#### 20. Low-complexity generate tasks over-matched ✅ (M2)
- **File**: `src/methodology/MethodologyCatalog.ts`
- **Issue**: Simple generate tasks (e.g. "generate a hello world") matched `bmad-lite` or `spec-first` instead of a lightweight methodology.
- **Fix**: Added low-complexity generate rule (`direct-execution`, tier B); reordered `bmad-full` before `bmad-lite` so more restrictive rule matches first.
- **Test update**: `methodology.test.ts` expectation changed: low-complexity generate now returns `direct-execution` (not `spec-first`).

#### 21. CascadeRouter duplicated chain-building logic ✅ (M6)
- **File**: `src/methodology/CascadeRouter.ts`
- **Issue**: `buildRecommendationChain` and `buildEscalationChain` contained ~40 lines of near-identical logic.
- **Fix**: Extracted shared `buildChain()` helper; both methods delegate to it.

#### 22. PlanValidator unnecessary async ✅ (M7)
- **File**: `src/methodology/PlanValidator.ts`
- **Issue**: `validate()` was declared `async` and returned `Promise<ValidationResult>` despite containing no asynchronous operations.
- **Fix**: Removed `async`/`Promise` wrappers; `validate()` is now synchronous.

#### 23. TaskClassifier sub-question count inflated by code blocks ✅ (m2)
- **File**: `src/methodology/TaskClassifier.ts`
- **Issue**: Sub-question count heuristic counted semicolons inside code blocks, inflating complexity scores for requests containing code snippets.
- **Fix**: Code blocks are now stripped before counting semicolons.

### Known follow-ups (not blocking)
- `CascadeRouter.MAX_AUDIT_ENTRIES` should be configurable via `MethodologyConfig`.
- `OutcomeTracker.getConfidenceAdjustment()` has a 7-day prune window but no recency weighting — confidence adjustments treat 6-day-old outcomes the same as 1-day-old ones.
- `looksSyntacticallyValid()` is a lightweight heuristic (brace-balance), not a full parser — consider integrating a real syntax checker for non-JS/TS languages.

## Remaining Work

### Integrate TaskDecomposer with Spec System ⏳
- **Status**: Not started
- **Planned Integration**:
  - Extend TaskDecomposer to accept spec as input
  - Use spec outcomes/scope to guide task decomposition
  - Use spec constraints to influence dependency analysis
  - Map spec verification criteria to test task generation

### Add Spec Management to Skill System ⏳
- **Status**: Not started
- **Planned Implementation**:
  - Add spec CRUD operations to SkillManager
  - Store specs alongside skill definitions
  - Enable spec loading during skill composition
  - Add spec validation using existing SchemaValidator

### Frontend Integration ⏳
- **Status**: Not started
- **Planned Implementation**:
  - Add spec editor UI
  - Add spec selection in skill configuration
  - Display spec context in TDD progress indicators
  - Add spec verification results display

### Context Optimization UI ⏳
- **Status**: Partially complete
- **Completed**: Backend ContextMonitor.generateOptimizationSuggestions() exposed via webview
- **Remaining**: Display optimization suggestions in context usage panel, add warning banners
- **Implementation**: WebviewEventRouter now calls ContextMonitor.generateOptimizationSuggestions() on context_suggestions_request

### Skill Performance Recording Integration ⏳
- **Status**: Invocation point now exists, recording wire-up pending
- **Infrastructure**: ConfidenceScorer class with recordSkillUsage() method exists in src/skills/ConfidenceScorer.ts
- **Invocation point (new)**: `ChatProvider`'s `skillHinter` closure now runs `SkillTriggerEngine.getTriggeredSkills` on every classified prompt — this is the natural point to call `ConfidenceScorer.recordSkillUsage(skillId, …)` once we know which suggested skills the model actually leaned on.
- **Outstanding**: emit `recordSkillUsage` from the hinter (suggested) and from a post-stream signal that observes whether the assistant referenced a suggested skill (effective). Surface counts back to `SkillInfo.performanceScore`/`usageCount` for the modal.

## Key Design Decisions

### What Changed
1. **Deleted standalone SpecService** - Was creating duplicate functionality
2. **Enhanced TDDOrchestrator** - Added spec context to existing TDD workflow
3. **Enhanced SkillTriggerEngine** - Added spec-aware triggers to existing trigger system
4. **Cleaned up MethodologyOrchestrator** - Removed spec-aware selection (wrong layer)

### What Stayed the Same
1. **TDDOrchestrator core logic** - Red-Green-Refactor-Coverage cycles unchanged
2. **SkillTriggerEngine core logic** - Trigger matching unchanged
3. **MethodologyOrchestrator core logic** - Classification and selection unchanged
4. **TaskDecomposer** - Task decomposition unchanged (not yet integrated with specs)

### Integration Principle
**Enhance existing components, don't create new ones.**
- Spec context is injected into existing TDD workflow
- Spec-aware triggers use existing skill composition
- Spec management will be added to existing SkillManager (not separate service)

## Testing Status

### Unit Tests
- TDDOrchestrator spec integration: ⏳ Pending
- SkillTriggerEngine spec-aware triggers: ⏳ Pending
- End-to-end spec-driven workflows: ⏳ Pending

### Integration Tests
- Spec-driven skill composition: ⏳ Pending
- TDD with spec context: ⏳ Pending

## Configuration

### Current Settings
No new configuration settings required for current implementation.

### Future Settings
When spec management is added to SkillManager:
```json
{
  "opencode.specDrivenDevelopment": {
    "enabled": true,
    "defaultSpec": null,
    "specStorage": "workspace"
  }
}
```

## Migration Notes

### Breaking Changes
None. All changes are enhancements to existing components.

### Migration Path
No migration required. Existing functionality unchanged.

### Rollback Plan
If issues arise:
1. Remove spec context from TDDOrchestrator.buildRedPrompt
2. Remove sadd-spec-driven and tdd-spec-verification triggers from SkillTriggerEngine
3. Revert MethodologyOrchestrator and MethodologyCatalog to original state

## Conclusion

The corrected approach leverages the existing SADD/TDD infrastructure rather than creating parallel systems. The implementation is:
- ✅ Non-duplicative (enhances existing TDDOrchestrator and SkillTriggerEngine)
- ✅ Well-integrated (uses existing skill composition and TDD workflow)
- ✅ Backward compatible (no breaking changes)
- ✅ Follows existing patterns (spec context as enhancement, not separate system)

The key insight: Spec-driven development is a **feature of the existing skill system**, not a separate parallel system. By adding spec context to TDD prompts and spec-aware triggers to the skill engine, we achieve the same goal without duplication.

Remaining work focuses on integrating spec management into SkillManager and connecting TaskDecomposer with spec input, both of which enhance existing components rather than creating new ones.
