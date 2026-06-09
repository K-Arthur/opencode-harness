# Implementation Plan: Comprehensive AI Development Methodology Enhancement

**Date:** 2026-05-15
**Project:** OpenCode Harness VS Code Extension
**Version:** 1.0
**Timeline:** 4 phases over ~16 weeks

---

## Phase 0: Foundation (Weeks 1-2)

### Objective
Establish the core infrastructure that all subsequent phases depend on.

### Deliverables

#### 0.1 Configuration Schema
- **File:** `src/methodology/types.ts`
- Define all TypeScript interfaces from the design document
- Create `MethodologyConfig` schema with VS Code settings integration
- Add settings to `package.json` configuration section

#### 0.2 Task Classifier
- **File:** `src/methodology/TaskClassifier.ts`
- Implement signal extraction from user requests
- Build complexity scoring (depth, width, ambiguity, fileScope)
- Add modality detection (vision, diagram, code execution needs)
- Unit tests with 20+ classified request examples

#### 0.3 Model Profile Store
- **File:** `src/methodology/ModelProfiler.ts`
- Define `ModelProfile` interface with capability scores
- Load initial profiles from benchmark data (static JSON)
- Implement empirical tracking (record outcomes per model per task type)
- VS Code globalState persistence

#### 0.4 Methodology Catalog
- **File:** `src/methodology/MethodologyCatalog.ts`
- Define all `MethodologyId` types
- Implement `METHODOLOGY_RULES` selection matrix
- Build selection algorithm (first-match-wins, ordered by specificity)
- Default fallback to `spec-first` when no rule matches

### Success Metrics
- Task classifier correctly categorizes 90%+ of test requests
- Model profiles load within 100ms
- Methodology selection returns a result within 50ms
- All settings visible and configurable in VS Code Settings UI

### Testing Strategy
- Unit tests for TaskClassifier with known request/classification pairs
- Unit tests for methodology rule matching
- Integration test: full pipeline from request → classification → methodology selection

### Risks and Mitigation
| Risk | Impact | Mitigation |
|------|--------|------------|
| Task classifier too simplistic | Medium | Start with rule-based, add ML later |
| Model profiles stale quickly | Medium | Add periodic refresh mechanism |
| Selection matrix too rigid | Low | Make rules configurable by user |

---

## Phase 1: Prompt Engineering and Model Routing (Weeks 3-6)

### Objective
Enable intelligent methodology application with model-aware prompting and cascade routing.

### Deliverables

#### 1.1 Prompt Engine
- **File:** `src/methodology/PromptEngine.ts`
- Implement all prompt strategies:
  - `direct`: Simple, no reasoning overhead
  - `hierarchical-cot`: Plan → Execute → Answer template
  - `plan-then-execute`: Separate planning and execution turns
  - `iterative-refinement`: Generate → Critique → Refine
  - `schema-first`: JSON Schema embedded in prompt
  - `few-shot-strong`: Pre-generated examples from stronger models
  - `conversational-decompose`: Multi-turn task decomposition
- Context optimizer with edge placement
- Token budget management

#### 1.2 Cascade Router
- **File:** `src/methodology/CascadeRouter.ts`
- Implement cascade routing logic
- Quality evaluation (structural metrics, task-specific metrics)
- Escalation logging and reporting
- Budget enforcement (max tokens, max cost)

#### 1.3 Schema Validator
- **File:** `src/methodology/SchemaValidator.ts`
- Zod-based validation for all LLM outputs
- Retry loop with validation error feedback
- Configurable max retries with exponential backoff
- Error classification (partial JSON, schema violation, hallucinated fields)

#### 1.4 Skill Manager
- **File:** `src/methodology/SkillManager.ts`
- Load skills from local `.agents/skills/` directory
- Trigger matching against user requests
- Skill composition (deduplicate overlapping instructions)
- Version management and updates

#### 1.5 AGENTS.md Generator
- **File:** `src/methodology/AgentsMdGenerator.ts`
- Auto-detect technology stack from project files
- Generate `AGENTS.md` with conventions, commands, structure
- Update triggers (new framework detected, new patterns)
- User override support

### Success Metrics
- Cascade routing reduces cost by 40%+ vs single-model baseline
- Schema validation achieves 95%+ first-pass success rate
- Iterative refinement improves B-tier model output quality by 20%+
- Skill loading adds <200ms to request processing

### Testing Strategy
- Unit tests for each prompt strategy template
- Integration tests for cascade routing with mock models
- Schema validation tests with intentionally malformed outputs
- Performance tests for skill loading and composition

### Integration Points
- Connect to existing `ModelManager.ts` for model selection
- Integrate with `ChatProvider.ts` for prompt injection
- Hook into `StreamCoordinator.ts` for methodology-specific streaming

### Risks and Mitigation
| Risk | Impact | Mitigation |
|------|--------|------------|
| Cascade routing too slow | High | Set max 2 escalations, timeout per model |
| Schema validation rejects valid outputs | Medium | Allow configurable strictness per task type |
| Prompt templates too verbose | Medium | Token budget enforcement, context compression |

---

## Phase 2: Deterministic Execution and Quality Gates (Weeks 7-10)

### Objective
Separate probabilistic reasoning from deterministic execution with robust validation.

### Deliverables

#### 2.1 Tool Registry
- **File:** `src/methodology/ToolRegistry.ts`
- Typed tool definitions with Zod input/output schemas
- `invoke()` method with validation before execution
- Idempotency key support for write operations
- Approval gates for side effects

#### 2.2 Plan Validator
- **File:** `src/methodology/PlanValidator.ts`
- Seven-stage validation:
  1. Nodes exist in registry
  2. Edges type-compatible
  3. DAG acyclic
  4. Params present
  5. Budget satisfied
  6. Safety compliant
  7. Idempotency keys present
- Detailed error reporting per check

#### 2.3 Quality Gates
- **File:** `src/methodology/QualityGate.ts`
- Import validation (detect hallucinated imports)
- Diff size gate (flag inflated diffs)
- Duplication detection (catch confident duplication)
- Complexity ceiling (block critical complexity)
- AI-specific linting rules
- Configurable severity (block/warn/info)

#### 2.4 Audit Trail
- **File:** `src/methodology/AuditTrail.ts`
- OpenTelemetry tracing for all operations
- SHA-256 hashes on plan versions
- Intent → plan → execution → result trace
- Error classification and attribution

#### 2.5 Refactoring Engine
- **File:** `src/methodology/RefactoringEngine.ts`
- Dead code detection (import graph + call graph analysis)
- Complexity monitoring (cyclomatic, cognitive)
- Duplication detection
- Naming consistency checks
- Automated suggestion generation

### Success Metrics
- Zero unvalidated LLM outputs reach execution
- Quality gates catch 60%+ of AI-generated code issues
- Audit trail captures 100% of methodology applications
- Refactoring engine identifies 80%+ of dead code

### Testing Strategy
- Unit tests for each validation stage
- Integration tests: full pipeline from LLM output → validation → execution
- Quality gate tests with known-bad AI outputs
- Audit trail verification (traces are complete and accurate)

### Integration Points
- Connect to existing `DiffApplier.ts` for quality gate validation
- Integrate with `CheckpointManager.ts` for rollback support
- Hook into `ContextEngine.ts` for import graph analysis

### Risks and Mitigation
| Risk | Impact | Mitigation |
|------|--------|------------|
| Seven-stage validation too slow | Medium | Parallelize independent checks |
| Quality gates block valid changes | Medium | User override with acknowledgment |
| Audit trail too verbose | Low | Configurable trace level |

---

## Phase 3: Protocol Integration and Multimodal (Weeks 11-14)

### Objective
Add open protocol support and multimodal capabilities.

### Deliverables

#### 3.1 Protocol Abstraction Layer
- **File:** `src/methodology/ProtocolAdapter.ts`
- Unified `ProtocolAdapter` interface
- MCP adapter (stdio + Streamable HTTP)
- A2A adapter (JSON-RPC + SSE)
- AG-UI adapter (event streaming)
- Capability-based protocol selection

#### 3.2 Unified Message Router
- **File:** `src/methodology/UnifiedMessageRouter.ts`
- Protocol translation (unified → target → unified)
- Agent card discovery and caching
- Authentication management
- Error handling and retry

#### 3.3 Multimodal Engine
- **File:** `src/methodology/MultimodalEngine.ts`
- Screenshot capture integration (MCP ACS Screenshot / clipboard)
- Tiered visual analysis (pixel diff → fast check → full analysis)
- Context bundling (screenshot + DOM + code + console)
- Vision model selection and routing

#### 3.4 Visual Regression Testing
- **File:** `src/methodology/VisualRegression.ts`
- Pixel diff comparison (local, free)
- AI classification of changes (regression/intentional/noise)
- Source code tracing to exact CSS property
- Baseline management

#### 3.5 Database Schema Documentation
- **File:** `src/methodology/SchemaDocGenerator.ts`
- Detect schema files (Prisma, Drizzle, SQLAlchemy)
- Parse and generate mermaid ERD
- Auto-update on schema changes
- Integration with AGENTS.md

### Success Metrics
- Protocol adapter supports 3+ protocols with unified interface
- Multimodal analysis completes within 5 seconds
- Visual regression catches 90%+ of UI regressions
- Schema documentation auto-updates on every schema change

### Testing Strategy
- Unit tests for protocol translation
- Integration tests with real MCP servers
- Multimodal tests with known screenshots
- Visual regression tests with controlled UI changes

### Integration Points
- Connect to existing MCP server management
- Integrate with webview for visual diff display
- Hook into `ThemeManager.ts` for visual indicators

### Risks and Mitigation
| Risk | Impact | Mitigation |
|------|--------|------------|
| Protocol specs change | Medium | Version negotiation, abstract interface |
| Vision models expensive | High | Tiered analysis, skip when possible |
| Schema parsing fragile | Medium | Support multiple schema formats |

---

## Phase 4: Feedback Loops and Polish (Weeks 15-16)

### Objective
Close the loop with continuous learning and user-facing polish.

### Deliverables

#### 4.1 Feedback Loop
- **File:** `src/methodology/FeedbackLoop.ts`
- Record outcome of every methodology application
- Update model profiles with empirical data
- Adjust methodology rules based on success rates
- Export analytics for user review

#### 4.2 Methodology Status UI
- **Webview:** Methodology selection indicator in chat header
- Show active methodology, model tier, quality score
- Cost tracking per methodology
- User controls: override methodology, adjust quality threshold

#### 4.3 Refactoring Suggestions UI
- **Webview:** Refactoring suggestion panel
- Show dead code, complexity issues, duplication
- One-click apply (with diff preview)
- Bulk apply for multiple suggestions

#### 4.4 Documentation
- Update `AGENTS.md` with methodology usage guidelines
- Update `README.md` with new features
- Create user guide for methodology selection
- Create developer guide for extending methodologies

#### 4.5 Performance Optimization
- Profile and optimize hot paths
- Cache methodology selection results
- Lazy-load protocol adapters
- Optimize context bundling

### Success Metrics
- Feedback loop updates model profiles within 1 second of outcome
- Methodology status UI updates in real-time
- Refactoring suggestions apply without errors
- End-to-end latency <2 seconds for simple tasks

### Testing Strategy
- End-to-end tests for full methodology pipeline
- Performance tests under load
- User acceptance testing with real development tasks
- A/B test: methodology-enabled vs disabled

### Risks and Mitigation
| Risk | Impact | Mitigation |
|------|--------|------------|
| Feedback loop introduces latency | Medium | Async recording, batch updates |
| UI too complex | Medium | Progressive disclosure, sensible defaults |
| Performance regression | High | Performance budget, CI performance tests |

---

## Overall Testing Strategy

### Test Layers

| Layer | Scope | Tools | Target |
|-------|-------|-------|--------|
| Unit | Individual components | Node.js test runner | 90%+ coverage |
| Integration | Component interactions | VS Code test API | All integration points |
| E2E | Full methodology pipeline | Playwright | 100% of user journeys |
| Performance | Latency, throughput | Custom benchmarks | <2s for simple tasks |
| Quality | AI output quality | Custom evaluators | 80%+ pass rate |

### Test Data

- **Task classification dataset**: 100+ labeled requests across all task types
- **Model profile dataset**: Benchmark scores for 20+ models
- **Quality gate dataset**: 50+ known-bad AI outputs for gate testing
- **Multimodal dataset**: 30+ screenshots with known analysis results

### Continuous Integration

```yaml
# .github/workflows/methodology.yml
name: Methodology Enhancement
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npm run test:integration
      - name: Performance test
        run: node tests/performance/methodology.mjs
      - name: Quality gate test
        run: node tests/quality/ai-outputs.mjs
```

---

## Rollout Strategy

### Internal Testing (Week 16)
- Developer dogfooding on real projects
- Collect feedback on methodology selection accuracy
- Measure cost savings from cascade routing
- Identify edge cases and failure modes

### Beta Release (Week 17-18)
- Release to 10-20 beta users
- Monitor methodology effectiveness metrics
- Collect user feedback on UI/UX
- Fix critical issues

### General Availability (Week 19+)
- Release to all users
- Default: enabled with conservative settings
- Users can disable or customize
- Continuous improvement based on telemetry

### Model Intelligence Level Rollout

| Model Tier | Phase | Features Enabled |
|-----------|-------|-----------------|
| S-Tier | Phase 1 | Full methodology, cascade routing, all prompt strategies |
| A-Tier | Phase 1 | Full methodology, cascade routing, hierarchical CoT |
| B-Tier | Phase 2 | Simplified methodology, schema-first prompting, iterative refinement |
| C-Tier | Phase 3 | Quick-flow only, direct prompting, strict schema validation |

---

## Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Model API changes break routing | Medium | High | Abstract model interface, version negotiation |
| Protocol specs diverge | Low | Medium | Abstract protocol layer, capability negotiation |
| Context budget exceeded frequently | Medium | Medium | Context compression, retrieval on demand |
| Quality gates too aggressive | Medium | Low | User override, configurable thresholds |
| Performance regression | Low | High | Performance budget, CI benchmarks |

### Product Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Users find methodology selection confusing | Medium | Medium | Progressive disclosure, sensible defaults |
| Cost savings not realized | Low | Medium | Transparent cost reporting, adjustable thresholds |
| Lower-tier models still underperform | Medium | Medium | Better prompt templates, more refinement passes |
| Feature bloat | Medium | High | Strict prioritization, user feedback gates |

### Mitigation Summary

1. **Start simple**: Phase 0 establishes minimal viable infrastructure
2. **Measure everything**: Telemetry on every methodology application
3. **User control**: All features configurable, disable-able
4. **Graceful degradation**: Every component has a fallback path
5. **Iterative improvement**: Feedback loop continuously optimizes

---

## Success Criteria

### Phase-Level Success

| Phase | Metric | Target |
|-------|--------|--------|
| Phase 0 | Task classification accuracy | 90%+ |
| Phase 1 | Cost reduction from cascade routing | 40%+ |
| Phase 2 | Quality gate catch rate | 60%+ |
| Phase 3 | Multimodal analysis accuracy | 85%+ |
| Phase 4 | End-to-end latency (simple tasks) | <2s |

### Overall Success

- Proactive methodology selection works without explicit user instruction
- Lower-intelligence models show measurable improvement (20%+ quality gain)
- Agent coordination across multiple methodologies is reliable
- Both frontend and backend development benefit equally
- Continuous feedback loops improve methodology effectiveness over time
- All design decisions grounded in research findings
- Graceful degradation when preferred methodologies fail
- High code quality maintained across all model intelligence levels
