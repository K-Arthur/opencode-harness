# Working Memory — Subagent & Multi-Model Orchestration — FINAL

## Objectives
- Extend model capability profiles with autonomy/throughput/visual-judgment axes (§1)
- Add canary/probe infrastructure for unfamiliar models (§1)
- Implement frontend visual-QA gate (§1.5)
- Wire capability-aware model selection into existing routing (§6)

## Non-negotiables — All Achieved
- Tool-call reliability, context capacity, autonomy score, visual judgment tracked as separate capabilities ✅
- Never hard-code model names; use capability profiles ✅
- Users can see/override role assignments and autonomy assumptions ✅
- Visual quality verified, not assumed (via visualQaGate) ✅
- All existing tests continue to pass (1217+11 baseline) ✅

## Architecture Findings (from §3 discovery)
- **Model routing**: `src/orchestration/modelRouting.ts` — `AgentRole`, `resolveRoutedModel`, `inferAgentRole`
- **Cascade routing**: `src/methodology/CascadeRouter.ts` — S/A/B/C tiers, `recommendModel`, `route`
- **Methodology types**: `src/methodology/types.ts` — `ModelProfile`, `ModelCapabilities`, `ModelPerformance`, `ModelTier`
- **Model manager**: `src/model/ModelManager.ts` — `getRoutedModel`, `getModeModel`, model cache with context windows
- **Settings**: `opencode.roleModels`, `opencode.roleModelsEnabled`, `opencode.modeModels`
- **Subagent UI**: `src/chat/webview/subagentCard.ts`, `subagent-panel.ts` — cards, status, detail view
- **TDD Orchestrator**: `src/skills/TDDOrchestrator.ts` — phase-based subagent dispatch
- **Skills types**: `src/skills/types.ts` — `SubagentActivity`, `DecomposedTask`

## What Was Implemented

### 1. Three-Axis Capability Profiles (`src/methodology/types.ts`)
Extended `ModelCapabilities` with:
- `autonomy` (0-1): Process autonomy / self-supervision reliability
- `throughput` (0-1): Raw task competence / cost efficiency
- `visualJudgment` (0-1): Visual/design judgment (separate from vision)
- `confidenceSources`: Per-axis provenance tracking
- `canaryScore` / `canaryProbedAt`: Canary probe results
- `hasReliableVision`: Whether vision capability is reliable for review

### 2. Capability Profile Engine (`src/orchestration/capabilityProfiles.ts`)
- `deriveAutonomyScore`, `deriveThroughputScore`, `deriveVisualJudgmentScore` — composite scoring
- `getAutonomyGuidance` — Tier-appropriate (S/A/B/C) delegation scaffolding
- `computeRoleSuitability` — Best-role matching by capability profile
- `isCapableForRole` — Capability threshold gating per role
- `scaffoldingForRole` — Prompt prefixes for lower-autonomy executors
- Canary probes: `CanaryProbeConfig`, `DEFAULT_CANARY_PROBES`, `scoreFromCanary`, `mergeCanaryIntoCapabilities`
- `AutonomyGuidance` type with `maxPromptTokens`, `requireTestPerStep`, `checkpointEveryNSteps`, `delegationStrategy`

### 3. Capability-Aware Model Routing (`src/orchestration/modelRouting.ts`)
- Added `visualReview` to `AgentRole` with aliases (`visual-review`, `ui-review`, `design-review`)
- `VISUAL_REVIEW_RE` regex for prompt-text inference
- `resolveCapabilityAwareModel` — Extends existing routing with:
  - Capability gating (`enableCapabilityGating`)
  - Autonomy scaffolding (`enableAutonomyGuidance`)
  - Returns `CapabilityAwareResult` with model, gate status, guidance

### 4. Visual-QA Gate (`src/orchestration/visualQaGate.ts`)
- `checkDesignTokens` — Catches raw color literals, non-4px-grid spacing
- `checkAccessibility` — Catches <12px fonts, low-opacity contrast issues
- `checkLayout` — Detects `overflow:hidden`, zero-size elements, negative z-index
- `runVisualQaGate` — Full composite check
- `createVisualQaGate` — `QualityGate` interface compatible with methodology pipeline
- `buildVisualReviewPrompt` — Generates a structured prompt for vision-capable reviewer
- All deterministic — no browser/vision model required for first-pass checks

### 5. Pre-Existing Files Updated
- `src/methodology/ModelProfileRegistry.ts` — S/A/B/C tiers include new axes
- `src/methodology/integration.test.ts` — Updated mock profiles

## Files Changed
| File | Change |
|------|--------|
| `src/methodology/types.ts` | Extended ModelCapabilities with autonomy/throughput/visualJudgment/confidenceSources/canaryScore/hasReliableVision |
| `src/orchestration/modelRouting.ts` | Added visualReview role, capability-aware routing, VISUAL_REVIEW_RE |
| `src/methodology/ModelProfileRegistry.ts` | Added new capability fields to tier defaults |
| `src/orchestration/capabilityProfiles.ts` | **NEW** — Capability profile engine, canary probes, autonomy guidance |
| `src/orchestration/visualQaGate.ts` | **NEW** — Visual-QA gate with design token/a11y/layout checks |
| `src/orchestration/modelRouting.test.ts` | Added tests for visualReview role, capability-aware routing |
| `src/orchestration/capabilityProfiles.test.ts` | **NEW** — 22 tests for capability profiles |
| `src/orchestration/visualQaGate.test.ts` | **NEW** — 20 tests for visual-QA gate |
| `src/methodology/ModelProfileRegistry.test.ts` | Updated mock data with new fields |
| `src/methodology/integration.test.ts` | Updated mock profiles with new fields |

## Test Results
- **55 new tests** across 3 new test files — all pass
- **1217 unit tests** (existing) — all pass (baseline unchanged)
- **11 methodology integration tests** — all pass (baseline unchanged)
- **Pre-existing failure**: `HeartbeatService.test.ts` — confirmed pre-existing, unrelated

## Verification Commands & Results
- `npm run typecheck` ✅ PASS
- `npm run build` ✅ PASS
- `node --test tests/unit/*.test.mjs` ✅ 1217/1217 pass
- `npx tsx --test src/methodology/integration.test.ts` ✅ 11/11 pass
- `npx tsx --test src/orchestration/*.test.ts` ✅ 55/55 pass
