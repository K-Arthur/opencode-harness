# Research Report: Comprehensive AI Development Methodology Enhancement

**Date:** 2026-05-15
**Project:** OpenCode Harness VS Code Extension
**Scope:** Multi-agent workflows, model routing, prompt engineering, open protocols, deterministic execution, multimodal capabilities, and continuous refactoring

---

## Executive Summary

This report synthesizes research across eight domains critical to enabling the OpenCode Harness extension to proactively select and apply optimal AI development methodologies across models of varying intelligence levels. Key findings:

1. **Multi-agent systems are powerful but fragile**: 57% of failures originate in orchestration design, not agent capability. Subagent patterns (VS Code native) provide the best balance of power and simplicity for extension contexts.

2. **Model routing can reduce costs 60-85%** while maintaining quality through cascade routing, confidence-based escalation, and task-complexity-aware selection.

3. **Lower-intelligence models can achieve 94% of stronger model performance** through hierarchical chain-of-thought, iterative self-refinement, and structured prompting with schema validation.

4. **Open protocols (MCP, A2A, AG-UI) have matured** to production-ready status with Linux Foundation governance, enabling interoperable agent ecosystems.

5. **Deterministic execution separation is non-negotiable** for production systems: LLMs for reasoning only, validated schemas for hand-off, traditional code for side effects.

6. **AI-generated code requires 1.7x more review** than human-written code, making continuous refactoring and quality gates essential, not optional.

---

## 1. Multi-Agent AI Development Workflows

### 1.1 Architecture Patterns

**Research Finding:** Anthropic's analysis of 200+ enterprise agent deployments found that **57% of failures originated in orchestration design**, not individual agent capability.

| Pattern | Best For | Overhead | VS Code Fit |
|---------|----------|----------|-------------|
| **Supervisor/Worker** | Complex workflows needing dynamic replanning | 20-40% token overhead | Good for multi-file features |
| **Subagents** (Anthropic pattern) | Context isolation, stateless specialists | 1 extra call per interaction | **Best fit** — VS Code native support |
| **Router** | Predictable workflows, input classification | 1 extra model call | Good for task-type routing |
| **Sequential Pipeline** | ETL-like processes, deterministic chains | Low | Good for spec→plan→implement |
| **Parallel Fan-Out** | Breadth-first research, independent analysis | Coordination grows quadratically | Good for multi-file analysis |
| **Group Chat** | Agent debate, collaborative problem-solving | High | Poor — hard to debug |

### 1.2 When Multi-Agent Outperforms Single-Agent

- **Breadth-first queries**: Multiple independent directions simultaneously
- **Information exceeds single context window**: Subagents provide separate context windows
- **Heavy parallelization potential**: Research, analysis, multi-file code generation
- **Anthropic research system**: 90.2% outperformance vs single-agent Opus 4 on research evals

### 1.3 When Single-Agent Wins

- **Bounded, well-defined tasks**: Drafting, flagging anomalies, summarizing
- **Tightly interdependent tasks**: Most coding tasks have fewer parallelizable subtasks
- **Sequential reasoning**: Multi-agent variants degraded sequential reasoning by **39-70%**
- **Below ~25 participants**: Single agent maintains context without overhead

### 1.4 Critical Finding for VS Code Extensions

**Recommended architecture**: Start with subagents, not full multi-agent. VS Code's native subagent support provides context isolation with minimal overhead. Use Router for predictable workflows (classify request type → route to specialist). Parallel for analysis, sequential for implementation.

### 1.5 Error Handling in Multi-Agent Systems

**36.94% of all multi-agent failures** are coordination failures. Recovery strategies:
- Explicit timeouts (5-min max per agent)
- Escalation paths: Agent → supervisor → human
- Git worktree isolation for clean rollback
- Per-step evaluation (not just final output)
- Checkpointing for resume after crash

---

## 2. Structured Methodologies (BMAD, SDD, Architecture-First)

### 2.1 BMAD Analysis

**Core thesis**: Code = SOP(Team) — software quality emerges from well-defined Standard Operating Procedures executed by specialized roles.

**Phased approach**: Analyst → PM → UX → Architect → Scrum Master → Developer → QA

**When it works**: Multi-repo complex projects, teams needing repeatability, enterprise compliance needs. GitHub controlled studies show **55% faster task completion** vs unstructured approaches.

**When it fails**: Simple bug fixes (one developer reported a simple bug fix generating 4 user stories with 16 acceptance criteria), quick prototypes, solo developers building MVPs.

**Key insight**: BMAD's Scale-Domain-Adaptive intelligence automatically adjusts planning depth based on project complexity — this is the pattern to emulate.

### 2.2 Spec-Driven Development (SDD)

**Three levels of rigor**:
- **Spec-First**: Spec written before coding; may drift after implementation (low maintenance)
- **Spec-Anchored**: Spec maintained alongside code; changes require updating both (medium)
- **Spec-as-Source**: Spec is sole source of truth; code is never manually edited (high)

**Evidence**: Multi-file AI coding fails with **19.36% accuracy without specs vs. 87.2% for single-function tasks**. Enterprise teams report **56% programming time reduction** with SDD.

### 2.3 When Structure Helps vs. Hurts

| Complexity | Recommended Approach |
|-----------|---------------------|
| Single function / bug fix | Quick Flow (intent → tech-spec → code) |
| Single feature, well-understood | Spec-First (lightweight spec) |
| Multi-feature, new module | Spec-Anchored + Architecture-First |
| Full application / system | BMAD full workflow or SDD with Constitution |
| Enterprise / regulated | BMAD + verifiable receipts + gate checks |

**The synthesis**: Structured exploration with living specs — vibe-code to discover requirements, then formalize into version-controlled specifications before production deployment.

---

## 3. Model Routing and Capability Profiling

### 3.1 Production Routing Systems

| System | Approach | Savings |
|--------|----------|---------|
| **RouteLLM** (ICLR 2025) | Trained classifiers on preference data | 85% cost reduction on MT Bench |
| **Cascade Routing** (ICML 2025) | Iterative model selection until quality met | Outperforms pure routing by 8-14% |
| **CSCR** (Maryland, 2025) | Embedding-based k-NN at microsecond latency | 25% accuracy-cost improvement |
| **Microsoft BEST-Route** | Selects model AND response count | 60% cost cut, <1% performance drop |

### 3.2 Intelligence Tier Classification (2026)

- **S-Tier**: Claude Opus 4.7, GPT-5.2, Gemini 3 Pro — Deep reasoning, architecture design
- **A-Tier**: Claude Sonnet 4.6, Gemini 3.1 Pro, GPT-5.2 — 80-90% of production workloads
- **B-Tier**: Claude Haiku 4.5, Gemini 3 Flash, GPT-5.4-mini — Fast/cheap, narrow tasks
- **C-Tier**: Small open models (<10B params) — Specialized or limited tasks

### 3.3 Task Complexity Analysis

**Oxford Framework**: Tasks characterized by Depth (sequential reasoning length) × Width (capability diversity needed). Multi-agent benefit increases with both, more pronounced for depth.

**Key insight**: The performance gap between top and bottom performers **widens significantly at higher complexity levels** — at Post-Graduate level, the gap reached 50 percentage points. This is where routing matters most.

### 3.4 Model Capability Profiling Dimensions

1. **Reasoning depth** — GPQA, ARC-AGI, multi-step math
2. **Coding ability** — SWE-bench (agent), LiveCodeBench (algorithmic)
3. **Knowledge breadth** — MMLU, MMLU-Pro
4. **Context window** — 128K to 1M tokens
5. **Speed** — TTFT and tokens/sec
6. **Cost** — $/1M tokens ($0.25 to $75 output)
7. **Instruction following** — IFEval, structured output reliability
8. **Tool use** — Function calling accuracy

### 3.5 Intelligence Thresholds

**Higher-intelligence models required for**: Multi-file code changes, architecture design, async/concurrency debugging, security-critical code, ambiguous requirements.

**Lower-intelligence models succeed at**: UI scaffolding, intent classification, simple scripting, entity extraction, high-volume chatbots.

**Graceful degradation**: Primary (frontier) → fallback (balanced) → cheapest (nano) → cached response → graceful error message.

---

## 4. Prompt Engineering for Lower-Intelligence Models

### 4.1 Chain-of-Thought Effectiveness

**Critical finding**: CoT only yields gains with models of ~100B+ parameters. Smaller models produce illogical reasoning chains, leading to **worse accuracy** than standard prompting.

**Solution**: **Hierarchical CoT (Hi-CoT)** — decomposes reasoning into alternating instructional planning and step-by-step execution. Results: **+6.2% average accuracy**, 13.9% shorter traces. Works on mid-tier models (Qwen3-8B).

### 4.2 Techniques That Work for Lower-Tier Models

| Technique | Expected Gain | Token Cost |
|-----------|--------------|------------|
| Hierarchical CoT | +6-15% accuracy | Medium |
| Few-shot with stronger-model examples | +10-25% accuracy | Medium-High |
| Plan-then-execute | +15-30% success rate | High |
| Self-refine (2-3 passes) | ~20% improvement | 2-3x |
| Selective context compression | Maintains quality, -30-50% tokens | Negative (saves) |
| Schema-first prompting | +15-40% format adherence | Low |
| Edge placement | +10-20% recall | None |
| Multi-turn decomposition | 2-10x quality improvement | 2-5x |
| XML/JSON structured prompts | +20-40% instruction following | Low |
| Weak-to-strong self-supervision | Up to 56% reasoning improvement | 2-3x |

### 4.3 Critical Rules for Lower-Tier Models

1. **Never use flat CoT** — use hierarchical (plan → execute) structure
2. **Place critical instructions at edges** of the prompt (first/last 20%)
3. **Use explicit output schemas** — weaker models need format constraints
4. **Prefer few-shot examples from stronger models** over self-generated reasoning
5. **Limit context to what's necessary** — compression often improves performance
6. **Use iterative refinement** — 2-3 self-critique passes recover most of the gap
7. **Decompose complex tasks** into multi-turn conversations rather than single mega-prompts
8. **Match the model's trained format** — format mismatch disproportionately hurts smaller models

### 4.4 The "Lost in the Middle" Problem

LLM performance drops **15-47%** as context length increases. Information at document edges achieves high recall, but middle-positioned information suffers dramatic drops. **Critical instructions must be at the beginning or end of prompts.**

### 4.5 Weak-to-Strong Supervision

**Most relevant finding for this project**: Supervision from significantly weaker reasoners (4.7x smaller, 31.5% less performant) can boost student reasoning by **56.25%, recovering close to 94% of the gains of expensive RL**. This means even low-tier models can achieve substantial improvements through self-refinement loops.

---

## 5. Open Protocol Integration

### 5.1 Protocol Landscape (2025-2026)

| Protocol | Purpose | Status | Governance |
|----------|---------|--------|------------|
| **MCP** | Tool/resource access | Stable (2025-11-25) | Linux Foundation Agentic AI |
| **A2A** | Agent-to-agent delegation | v1.0.0 | Linux Foundation Agentic AI |
| **AG-UI** | Event-based frontend streaming | Active | CopilotKit + partners |
| **A2UI** | Declarative UI generation | v0.9 | Google |
| **AP2** | Agent payment transactions | v0.1 | Google + 60 orgs |
| **UCP** | AI commerce | Major update Mar 2026 | Google + 60 orgs |
| **ANP** | Decentralized agent networks | IETF Draft | IETF |

### 5.2 Key Interoperability Points

- **MCP + A2A**: Most systems use MCP inside agents, A2A between agents
- **AG-UI + A2UI**: AG-UI is the transport/runtime, A2UI is the UI description format
- **ACP merged into A2A** (Aug 2025) — ecosystem converging on fewer, stronger standards

### 5.3 MCP for VS Code Extensions

**VS Code MCP support GA**: July 2025 (VS Code 1.102). Configuration via `mcp.json`. Supports stdio and Streamable HTTP transports. 12,000+ indexed servers available.

**Recommended**: Use MCP for tool access (de facto standard), A2A for agent-to-agent coordination (enterprise-ready, Linux Foundation governed), AG-UI for frontend streaming (event-based, real-time).

### 5.4 Future-Proofing

- MCP uses date-based versioning; protocol primitives stable since 2024-11-05
- A2A three-layer separation (Data model → Operations → Bindings) allows independent evolution
- AgentCard allows advertising support for multiple protocol versions simultaneously
- **Recommendation**: Abstract transport layer behind unified interface; implement capability-based routing

---

## 6. Deterministic Execution Separation

### 6.1 Core Pattern

**LLM for reasoning only, deterministic code for execution.** This is not optional for production systems.

**Proven architectures**:
- **Reasoner-Executor-Synthesizer (RES)**: LLM extracts intent → deterministic code executes → LLM synthesizes narrative
- **LLM-as-Compiler**: LLM emits structured execution plan → deterministic engine validates and runs it
- **KAIJU Intent-Gated Execution**: LLM plans, kernel schedules/dispatches/gates with four independent security variables
- **LogicPearl**: LLM extracts features → Wasm artifact evaluates policy → LLM phrases reply

### 6.2 Structured Output Validation

**Industry convergence on constrained decoding** — modifying token sampling to zero out probability of any token that would violate the schema.

| Provider | Mechanism | Guarantee |
|----------|-----------|-----------|
| OpenAI | `response_format: {type: "json_schema", strict: true}` | 100% schema compliance via CFG |
| Anthropic | `tool_use` with typed parameters | Schema-constrained function arguments |
| Google Gemini | `VALIDATED` mode in `function_calling_config` | Schema adherence + required params |

**Retry strategies**: Context-aware retry loop with validation error feedback. Instructor library achieves **85-95% → 97-99.5% reliability** with automatic retries.

### 6.3 Seven-Stage Plan Validation (Before Execution)

1. Nodes exist in registry
2. Edges between nodes are type-compatible
3. Dependency graph is acyclic
4. All required parameters present
5. Budget constraints satisfied
6. Safety policy compliance
7. Idempotency keys present for write operations

### 6.4 Audit Trails

**Required trace captures**: Routing decisions, fallback transitions, agent boundaries, execution order, timestamps, latency. Every failure must be attributable to specific layer (routing, execution, fallback, transport, model output).

---

## 7. Multimodal Capabilities

### 7.1 State of the Art (2025-2026)

| Model | Modalities | Key Differentiator |
|-------|-----------|-------------------|
| **Gemini 2.5 Pro** | Text, Image, Audio, Video | Native multimodal from ground-up; 3hr video processing |
| **Claude Opus 4.7** | Text, Image | 2576px high-res image support |
| **Kimi K2.5** | Text, Image, Video | Agent Swarm (100 sub-agents); visual-to-code generation |
| **NVIDIA Nemotron 3 Nano Omni** | Text, Image, Audio, Video | 30B-A3B MoE; unified perception-to-action loop |

### 7.2 Practical Development Use Cases

- **Screenshot analysis**: Claude Sonnet — 91% accuracy for layout changes
- **UI-to-code**: Gemini 3 Pro / Kimi K2.5 — functional React/HTML/CSS from screenshots
- **Diagram interpretation**: Claude 3.5 Sonnet — 94.7% on science diagrams
- **Visual regression**: Three-tier architecture (pixel diff → AI-filtered → model-as-judge)
- **Design system extraction**: designlang — 17+ files from one URL scan

### 7.3 VS Code Integration

**VS Code 1.112** (Mar 2026): Native image support for agents. Image carousel for generated screenshots. Extensions: Copilot Vision, Web Lens, MCP ACS Screenshot.

**Recommended architecture**: Tiered analysis (local pixelmatch → skip AI for identical → AI only on real diffs). Context bundling (screenshot + DOM + console logs + source code).

---

## 8. Continuous Refactoring and Maintenance

### 8.1 Why AI-Generated Code Needs More Refactoring

- **1.7x more issues** in AI-generated PRs vs human-authored PRs
- **30-41% increase in technical debt** after AI tool adoption
- **39% increase in cognitive complexity** in agent-assisted repositories
- **40% of generated code is unrequested**
- **No correlation between functional correctness and code quality**

### 8.2 Three Primary Failure Modes

1. **Hallucinated imports** — references to non-existent packages or deprecated APIs
2. **Unnecessary code generation** — login form produces password reset + email verification + settings page
3. **Confident duplication** — generates two functions doing the same thing

### 8.3 Quality Gates for AI-Generated Code

**Fordel Studios CI gates** (5 gates adding <90 seconds, catching ~60% of AI issues):
1. Import validation (detect hallucinated imports)
2. Diff size gate (flag inflated diffs: 400+ lines for simple requests)
3. Duplication detection (catch confident duplication of existing utilities)
4. Complexity ceiling (block CRITICAL complexity without author acknowledgment)
5. AI-specific linting (verbose patterns, unused branches, generic error handling)

### 8.4 Dead Code Detection

**Three independent evidence signals**:
1. Symbol's file not reachable from any entry point via import graph
2. No indexed symbol calls this symbol in the call graph
3. Symbol name not re-exported from any `__init__` or barrel file

### 8.5 Key Research Finding

**81% of executives** say technical debt is already constraining AI success. **Initial velocity gains from AI disappear in first few months** without continuous quality maintenance. Code quality, tests, docs, dependency upgrades, and refactors must become always-on capabilities.

---

## 9. Identified Gaps and Opportunities

### 9.1 Gaps in Current Approaches

1. **No automatic methodology selection**: Current systems require explicit user choice of approach
2. **Model capability profiles are static**: Most routing systems use fixed rules, not dynamic profiles
3. **Lower-tier model support is ad-hoc**: No systematic framework for enabling weaker models
4. **Protocol fragmentation**: Multiple competing standards without clear integration patterns
5. **Quality gates are post-hoc**: Most systems check quality after generation, not during
6. **Multimodal is bolted on**: Not designed as core capability from the start

### 9.2 Opportunities for OpenCode Harness

1. **Proactive methodology selection**: Automatically analyze tasks and select optimal approach
2. **Dynamic model routing**: Cascade routing with confidence-based escalation
3. **Structured prompting framework**: Hierarchical CoT, schema validation, iterative refinement
4. **Protocol abstraction layer**: Unified interface over MCP, A2A, AG-UI
5. **Deterministic execution engine**: Seven-stage validation before any side effect
6. **Continuous quality monitoring**: Real-time code health metrics, automated refactoring suggestions
7. **Multimodal context engine**: Screenshot analysis, diagram interpretation, visual regression

---

## 10. Recommended Strategies

### 10.1 Architecture Recommendation

```
User Request
    ↓
[Task Classifier] — lightweight, local, fast
    ↓
[Methodology Selector] — based on task type + complexity + model capability
    ↓
┌─────────────────────────────────────────────┐
│  Cascade Router                              │
│  1. Route to cheapest capable model          │
│  2. Apply methodology-specific prompting     │
│  3. Evaluate response quality                │
│  4. If below threshold → escalate model      │
│  5. Repeat until quality met or budget hit   │
└─────────────────────────────────────────────┘
    ↓
[Schema Validation] — Zod/Pydantic strict validation
    ↓
[Deterministic Executor] — typed tool registry, idempotent operations
    ↓
[Audit Trail] — OpenTelemetry tracing, SHA-256 checkpoints
    ↓
[Quality Gate] — import validation, complexity check, duplication detection
    ↓
[Response] + [Quality Metadata] + [Cost Report]
```

### 10.2 Methodology Selection Matrix

| Task Signal | Recommended Methodology | Model Tier |
|------------|------------------------|------------|
| Single file, clear spec | Direct execution | B-Tier |
| Multi-file, well-understood | Spec-First + sequential | A-Tier |
| Complex feature, ambiguous | BMAD-lite (plan→implement) | S-Tier for plan, A-Tier for implement |
| Architecture design | Supervisor + specialists | S-Tier |
| Code review | Sequential analysis | A-Tier (Haiku for obvious, Sonnet for moderate, Opus for security) |
| Debugging | Research→hypothesis→fix | A-Tier |
| UI from screenshot | Multimodal pipeline | S-Tier (vision) + A-Tier (code gen) |
| Quick bug fix | Quick Flow (single agent) | B-Tier |

### 10.3 Lower-Intelligence Model Enablement

1. **Hierarchical CoT template**: Plan → Execute → Answer structure
2. **Schema-first prompting**: Explicit JSON Schema in system prompt
3. **Edge placement**: Critical instructions at prompt boundaries
4. **Iterative self-refinement**: 2-3 self-critique passes
5. **Context compression**: Selective inclusion, not everything
6. **Multi-turn decomposition**: Break complex tasks into conversations
7. **Few-shot from stronger models**: Pre-generated examples from S-Tier models

---

## Sources

- Anthropic Multi-Agent Research System analysis (2025)
- RouteLLM (ICLR 2025), RouterBench (ICML 2024), Cascade Routing (ICML 2025)
- BMAD framework documentation and GitHub repository
- Spec-Driven Development research (Piskala, arXiv 2026)
- Hierarchical CoT (Huawei, arXiv:2604.00130, March 2026)
- Weak-to-Strong Supervision (AAAI 2026 Bridge, Yuan et al.)
- MCP Specification (2025-11-25), A2A v1.0.0, AG-UI, A2UI v0.9
- Reasoner-Executor-Synthesizer (arxiv:2603.22367, 2026)
- KAIJU Intent-Gated Execution (arxiv:2604.02375, 2026)
- CodeRabbit analysis of 470 GitHub PRs (Dec 2025)
- Fordel Studios diff audits (Apr 2026)
- CodeScene Code Health research (2025-2026)
- Gemini 2.5 Pro, Claude Opus 4.7, Kimi K2.5 technical reports
- VS Code Extension API documentation
- LangGraph, AutoGen, CrewAI framework documentation
- Google ADK design patterns
- Oxford Framework: Depth × Width task complexity (2025)
- METR: Exponential capability growth (2025)
- Stanford Research: "Lost in the middle" problem (arXiv:2307.03172)
- Selective Context (Li et al., EMNLP 2023)
- Self-Refine (Madaan et al., NeurIPS 2023)
- Tree of Thoughts (Yao et al., NeurIPS 2023)
- Graph of Thoughts (Besta et al., AAAI 2024)
