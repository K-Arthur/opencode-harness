# Design Document: Comprehensive AI Development Methodology Enhancement

**Date:** 2026-05-15
**Project:** OpenCode Harness VS Code Extension
**Version:** 1.0
**Status:** Design Proposal

---

## 1. System Architecture Overview

### 1.1 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        VS Code Extension Host                     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              Methodology Orchestrator                        │ │
│  │  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐  │ │
│  │  │ Task     │  │Methodology│  │ Model    │  │ Prompt    │  │ │
│  │  │Classifier│─▶│ Selector  │─▶│ Router   │─▶│ Engine    │  │ │
│  │  └──────────┘  └───────────┘  └──────────┘  └───────────┘  │ │
│  │       │              │              │              │         │ │
│  │       ▼              ▼              ▼              ▼         │ │
│  │  ┌──────────────────────────────────────────────────────┐   │ │
│  │  │              Cascade Router Engine                    │   │ │
│  │  │  Primary → Evaluate → Escalate → Retry → Fallback    │   │ │
│  │  └──────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              Execution Layer                                  │ │
│  │  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐  │ │
│  │  │ Schema   │  │ Plan      │  │ Tool     │  │ Quality   │  │ │
│  │  │Validator │─▶│ Validator │─▶│ Executor │─▶│ Gate      │  │ │
│  │  │ (Zod)    │  │ (7-stage) │  │ (typed)  │  │ (CI gates)│  │ │
│  │  └──────────┘  └───────────┘  └──────────┘  └───────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              Protocol Abstraction Layer                       │ │
│  │  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐  │ │
│  │  │ MCP      │  │ A2A       │  │ AG-UI    │  │ A2UI      │  │ │
│  │  │ Client   │  │ Client    │  │ Client   │  │ Renderer  │  │ │
│  │  └──────────┘  └───────────┘  └──────────┘  └───────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              Cross-Cutting Concerns                           │ │
│  │  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐  │ │
│  │  │ Audit    │  │ Model     │  │ Context  │  │ Refactor  │  │ │
│  │  │ Trail    │  │ Profiles  │  │ Manager  │  │ Engine    │  │ │
│  │  │ (OTel)   │  │ (dynamic) │  │ (budget) │  │ (always-on)│ │ │
│  │  └──────────┘  └───────────┘  └──────────┘  └───────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 Design Principles

1. **LLMs reason, code executes**: Strict separation between probabilistic reasoning and deterministic execution
2. **Cascade, don't guess**: Start cheap, escalate only when needed
3. **Schema-first**: Every LLM output validated against strict schemas before execution
4. **Methodology-aware**: Automatically select optimal approach based on task characteristics
5. **Protocol-abstracted**: Unified interface over MCP, A2A, AG-UI
6. **Quality-gated**: Every AI output passes through quality gates before application
7. **Always-on maintenance**: Continuous refactoring and code health monitoring

---

## 2. Methodology Selection Engine

### 2.1 Task Classification

The Task Classifier analyzes incoming user requests and extracts signals for methodology selection:

```typescript
interface TaskClassification {
  // Task type detection
  type: 'generate' | 'explain' | 'refactor' | 'debug' | 'review' |
        'architect' | 'document' | 'test' | 'ui-from-image' | 'quick-fix';

  // Complexity signals (0.0 - 1.0)
  complexity: {
    depth: number;       // Sequential reasoning steps needed
    width: number;       // Number of domains/skills involved
    ambiguity: number;   // How unclear the requirements are
    fileScope: number;   // Estimated number of files affected
  };

  // Modality requirements
  modalities: {
    needsVision: boolean;    // Requires image understanding
    needsDiagram: boolean;   // Requires diagram interpretation
    needsCodeExec: boolean;  // Requires code execution
  };

  // Urgency and constraints
  constraints: {
    speedPreferred: boolean;  // User wants fast results
    qualityPreferred: boolean; // User wants thorough results
    budgetLimit?: number;     // Token/budget constraint
  };
}
```

**Classification signals**:
- Query length and structure
- Presence of technical jargon, code snippets, file paths
- Number of sub-questions or constraints
- Ambiguity markers ("maybe", "not sure", "depends on")
- Image attachments (triggers vision modality)
- Historical patterns from similar requests

### 2.2 Methodology Catalog

```typescript
type MethodologyId =
  | 'direct-execution'      // Single agent, direct implementation
  | 'spec-first'            // Write spec, then implement
  | 'spec-anchored'         // Spec maintained alongside code
  | 'bmad-lite'             // Lightweight BMAD: plan → implement → review
  | 'bmad-full'             // Full BMAD: analyst → PM → architect → dev → QA
  | 'supervisor-workers'    // Supervisor decomposes, workers execute in parallel
  | 'cascade-review'        // Multi-pass review: Haiku → Sonnet → Opus
  | 'multimodal-pipeline'   // Vision → extract → generate → validate
  | 'quick-flow'            // Intent → tech-spec → code (single session)
  | 'research-hypothesis';  // Research → hypothesize → test → fix
```

### 2.3 Selection Matrix

```typescript
interface MethodologyRule {
  // Conditions that trigger this methodology
  when: {
    taskTypes?: TaskClassification['type'][];
    minComplexity?: number;
    maxComplexity?: number;
    needsVision?: boolean;
    minFileScope?: number;
  };

  // The methodology to apply
  methodology: MethodologyId;

  // Model tier recommendation
  recommendedTier: 'S' | 'A' | 'B' | 'C';

  // Prompt engineering strategy
  promptStrategy: PromptStrategy;

  // Execution pattern
  executionPattern: 'sequential' | 'parallel' | 'hybrid';
}

const METHODOLOGY_RULES: MethodologyRule[] = [
  {
    when: {
      taskTypes: ['quick-fix'],
      maxComplexity: 0.3,
      maxFileScope: 1,
    },
    methodology: 'quick-flow',
    recommendedTier: 'B',
    promptStrategy: 'direct',
    executionPattern: 'sequential',
  },
  {
    when: {
      taskTypes: ['generate', 'refactor'],
      minComplexity: 0.3,
      maxComplexity: 0.6,
      maxFileScope: 3,
    },
    methodology: 'spec-first',
    recommendedTier: 'A',
    promptStrategy: 'hierarchical-cot',
    executionPattern: 'sequential',
  },
  {
    when: {
      taskTypes: ['generate'],
      minComplexity: 0.6,
      minFileScope: 3,
    },
    methodology: 'bmad-lite',
    recommendedTier: 'S',
    promptStrategy: 'plan-then-execute',
    executionPattern: 'hybrid',
  },
  {
    when: {
      taskTypes: ['architect'],
      minComplexity: 0.7,
    },
    methodology: 'supervisor-workers',
    recommendedTier: 'S',
    promptStrategy: 'multi-agent-debate',
    executionPattern: 'parallel',
  },
  {
    when: {
      taskTypes: ['review'],
    },
    methodology: 'cascade-review',
    recommendedTier: 'A',
    promptStrategy: 'iterative-refinement',
    executionPattern: 'sequential',
  },
  {
    when: {
      needsVision: true,
    },
    methodology: 'multimodal-pipeline',
    recommendedTier: 'S',
    promptStrategy: 'cross-modal',
    executionPattern: 'sequential',
  },
  // ... more rules
];
```

### 2.4 Selection Algorithm

```
1. Classify task → extract signals
2. Match against METHODOLOGY_RULES (first match wins, ordered by specificity)
3. If no rule matches → default to 'spec-first' with A-tier model
4. Apply methodology-specific prompt template
5. Route to cascade router with recommended tier
```

---

## 3. Model Routing and Capability Profiling

### 3.1 Dynamic Model Profiles

```typescript
interface ModelProfile {
  id: string;                    // "anthropic/claude-sonnet-4-6"
  provider: string;
  name: string;
  tier: 'S' | 'A' | 'B' | 'C';

  // Capability scores (0.0 - 1.0)
  capabilities: {
    reasoning: number;           // GPQA, multi-step reasoning
    coding: number;              // SWE-bench, LiveCodeBench
    knowledge: number;           // MMLU, MMLU-Pro
    instructionFollowing: number;// IFEval, structured output
    toolUse: number;             // Function calling accuracy
    vision: number;              // Image understanding
    contextUtilization: number;  // Needle-in-haystack retrieval
  };

  // Performance characteristics
  performance: {
    contextWindow: number;       // Max tokens
    ttft: number;               // Time to first token (ms)
    tokensPerSecond: number;
    costPerInputToken: number;
    costPerOutputToken: number;
  };

  // Task-type performance (dynamic, updated from usage)
  taskPerformance: Record<TaskClassification['type'], {
    successRate: number;
    avgQuality: number;
    avgTokens: number;
    sampleSize: number;
  }>;

  // Metadata
  lastUpdated: Date;
  source: 'benchmark' | 'empirical' | 'hybrid';
}
```

### 3.2 Cascade Router

```typescript
interface CascadeRouterConfig {
  // Quality thresholds per task type
  qualityThresholds: Record<TaskClassification['type'], number>;

  // Maximum escalation depth
  maxEscalations: number;

  // Budget constraints
  maxTokensPerRequest: number;
  maxCostPerRequest: number;

  // Fallback chain
  fallbackChain: string[]; // Model IDs in order of escalation
}

class CascadeRouter {
  async route(
    task: TaskClassification,
    methodology: MethodologyId,
    prompt: string
  ): Promise<RouterResult> {
    // 1. Determine starting model based on methodology recommendation
    const startModel = this.selectStartingModel(task, methodology);

    // 2. Execute with cascade escalation
    for (let attempt = 0; attempt < config.maxEscalations; attempt++) {
      const model = config.fallbackChain[attempt];
      if (!model) break;

      const response = await this.executeWithModel(model, prompt, task);

      // 3. Evaluate quality
      const quality = await this.evaluateQuality(response, task);

      // 4. If quality meets threshold, return
      if (quality >= config.qualityThresholds[task.type]) {
        return { model, response, quality, escalations: attempt };
      }

      // 5. Otherwise, escalate to next model
      this.logEscalation(model, quality, task);
    }

    // 6. If all models exhausted, return best result with warning
    return { model: config.fallbackChain[0], response: bestResponse, quality: bestQuality, escalations: config.maxEscalations, warning: 'Quality threshold not met' };
  }
}
```

### 3.3 Quality Evaluation

Quality evaluation uses a lightweight local assessment (not LLM-as-judge):

```typescript
interface QualityMetrics {
  // Structural metrics
  schemaCompliance: boolean;     // Output matches expected schema
  completeness: number;          // All required fields present
  specificity: number;           // Concrete vs vague language

  // Task-specific metrics
  codeMetrics?: {
    compiles: boolean;
    testsPass: boolean;
    complexityOk: boolean;
    noDuplication: boolean;
    importsValid: boolean;
  };

  // Confidence metrics
  modelConfidence?: number;      // Model's self-reported confidence
  consistencyScore: number;      // Internal consistency of response
}
```

---

## 4. Prompt Engineering Framework

### 4.1 Prompt Strategy Catalog

```typescript
type PromptStrategy =
  | 'direct'                    // Simple, no reasoning overhead
  | 'hierarchical-cot'          // Plan → Execute → Answer
  | 'plan-then-execute'         // Separate planning and execution turns
  | 'iterative-refinement'      // Generate → Critique → Refine (N passes)
  | 'multi-agent-debate'        // Multiple perspectives, synthesize
  | 'cross-modal'              // Text + image + code reasoning
  | 'schema-first'             // JSON Schema embedded in prompt
  | 'few-shot-strong'          // Examples from stronger models
  | 'conversational-decompose'; // Multi-turn task decomposition
```

### 4.2 Hierarchical CoT Template (for B/C-tier models)

```
<system>
You are a development assistant. For complex tasks, follow this structure:

PLAN: List the steps needed to complete the task.
STEP 1: [Execute first step]
STEP 2: [Execute second step]
...
ANSWER: [Final result]

Be specific and concrete. Do not skip steps.
</system>

<user>
[Task description]
</user>
```

### 4.3 Schema-First Prompt Template

```
<system>
Return your response as JSON matching this schema exactly:
{schema_json}

Do not include any text outside the JSON object.
Do not add fields not in the schema.
Do not omit required fields.
</system>

<user>
[Task description]
</user>
```

### 4.4 Iterative Refinement Loop

```typescript
class IterativeRefiner {
  async refine(
    initialPrompt: string,
    schema: z.ZodSchema,
    maxPasses: number = 3
  ): Promise<RefinementResult> {
    let result = await this.generate(initialPrompt);
    const history: RefinementPass[] = [];

    for (let pass = 0; pass < maxPasses; pass++) {
      // Validate
      const validation = schema.safeParse(result);
      if (validation.success) break;

      // Self-critique
      const critique = await this.critique(result, validation.error);

      // Refine
      result = await this.refineWithFeedback(result, critique);

      history.push({ pass, critique, result });
    }

    return { result, history, passes: history.length };
  }
}
```

### 4.5 Context Optimization

```typescript
class ContextOptimizer {
  async optimize(
    fullContext: ContextItem[],
    budget: number,
    task: TaskClassification
  ): Promise<OptimizedContext> {
    // 1. Score each context item by relevance to task
    const scored = fullContext.map(item => ({
      ...item,
      score: this.relevanceScore(item, task),
    }));

    // 2. Sort by score, place critical items at edges
    const sorted = scored.sort((a, b) => b.score - a.score);

    // 3. Pack greedily until budget exhausted
    const selected: ContextItem[] = [];
    let used = 0;
    for (const item of sorted) {
      if (used + item.tokenCount > budget) break;
      selected.push(item);
      used += item.tokenCount;
    }

    // 4. Reorder: highest-score items at beginning and end
    return this.edgePlacement(selected, budget);
  }
}
```

---

## 5. Documentation-Driven Development Patterns

### 5.1 AGENTS.md Generation and Maintenance

```typescript
interface AgentsMdConfig {
  // Technology stack
  languages: string[];
  frameworks: string[];
  buildTools: string[];
  testFramework: string;

  // Coding conventions
  namingConventions: Record<string, string>;
  fileStructure: string;
  importOrder: string[];
  errorHandling: string;

  // Commands
  build: string;
  test: string;
  lint: string;
  typecheck: string;

  // Project structure
  directories: Record<string, string>;

  // Boundaries
  doList: string[];
  dontList: string[];

  // Retrieval hooks
  searchCommands: Record<string, string>;
}
```

**Auto-generation triggers**:
- New project initialization
- New framework detected in dependencies
- New coding pattern detected (e.g., new error handling convention)
- User explicitly requests regeneration

### 5.2 Skills-Based Knowledge Extension

```typescript
interface Skill {
  id: string;
  name: string;
  description: string;
  triggers: string[];          // Keywords that activate this skill
  content: string;             // The skill's instructions
  version: string;
  dependencies: string[];      // Other skills this depends on
}

class SkillManager {
  private skills: Map<string, Skill> = new Map();

  async loadSkill(skillId: string): Promise<Skill | null> {
    // Load from local cache, remote registry, or generate
  }

  async matchTriggers(text: string): Promise<Skill[]> {
    // Match text against skill trigger keywords
    // Return ordered list of relevant skills
  }

  async composeSkills(
    basePrompt: string,
    task: TaskClassification
  ): Promise<string> {
    const skills = await this.matchTriggers(basePrompt);
    // Compose skill instructions into system prompt
    // Deduplicate overlapping instructions
    // Order by specificity (most specific first)
  }
}
```

### 5.3 Database Schema Documentation

```typescript
interface SchemaDoc {
  models: {
    name: string;
    description: string;
    columns: {
      name: string;
      type: string;
      nullable: boolean;
      description: string;
    }[];
    relationships: {
      type: 'one-to-one' | 'one-to-many' | 'many-to-many';
      target: string;
      description: string;
    }[];
  }[];

  // Mermaid ER diagram
  mermaidDiagram: string;

  // Last updated
  lastUpdated: Date;
  source: string; // File path or connection string
}
```

**Auto-generation**: Detect schema files (Prisma, Drizzle, SQLAlchemy, etc.) → parse → generate mermaid ERD → update documentation.

---

## 6. Spec-Driven and Architecture-First Workflow

### 6.1 Spec Document Schema

```typescript
interface SpecDocument {
  // Metadata
  id: string;
  title: string;
  version: string;
  status: 'draft' | 'review' | 'approved' | 'implemented';

  // Requirements
  userStory: string;
  acceptanceCriteria: string[];
  edgeCases: string[];
  nonFunctionalRequirements: {
    performance?: string;
    security?: string;
    accessibility?: string;
  };

  // Technical design
  architecture: {
    components: string[];
    dataFlow: string;
    apiContracts: ApiContract[];
  };

  // Implementation plan
  tasks: {
    id: string;
    description: string;
    files: string[];
    dependencies: string[];
    completionCriteria: string;
  }[];

  // Testing
  testStrategy: string;
  reservedTests: string[]; // Tests agents cannot modify
}
```

### 6.2 Workflow Enforcement

```
User Request
    ↓
[Spec Generator] — Creates or updates spec document
    ↓
[Spec Review] — Human or automated review of spec
    ↓
[Architecture Validator] — Checks against architectural constraints
    ↓
[Task Decomposer] — Breaks spec into implementable tasks
    ↓
[Implementation Agent] — Implements one task at a time
    ↓
[Test Validator] — Runs reserved tests + generates new tests
    ↓
[Quality Gate] — All gates pass → apply changes
```

### 6.3 Vertical Slice Organization

Code organized by use case/feature rather than technical layer:

```
src/
├── features/
│   ├── user-auth/
│   │   ├── spec.md           # Feature specification
│   │   ├── components/       # UI components
│   │   ├── services/         # Business logic
│   │   ├── api/              # API endpoints
│   │   ├── tests/            # Feature tests
│   │   └── reserved-tests/   # Immutable regression tests
│   └── ...
└── shared/                   # Cross-cutting utilities
```

---

## 7. Open Protocol Integration

### 7.1 Protocol Abstraction Layer

```typescript
interface ProtocolAdapter {
  // Discovery
  discoverCapabilities(): Promise<Capability[]>;

  // Tool invocation
  invokeTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;

  // Resource access
  readResource(uri: string): Promise<Resource>;

  // Event streaming
  onEvent(type: string, handler: (event: ProtocolEvent) => void): void;

  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

class McpAdapter implements ProtocolAdapter { /* MCP-specific implementation */ }
class A2aAdapter implements ProtocolAdapter { /* A2A-specific implementation */ }
class AgUiAdapter implements ProtocolAdapter { /* AG-UI-specific implementation */ }
```

### 7.2 Unified Message Router

```typescript
class UnifiedMessageRouter {
  private adapters: Map<string, ProtocolAdapter> = new Map();

  async route(message: AgentMessage): Promise<AgentMessage> {
    // 1. Determine target protocol based on capability
    const target = this.selectProtocol(message.requiredCapabilities);

    // 2. Translate message to target protocol format
    const translated = this.translate(message, target);

    // 3. Send via adapter
    const adapter = this.adapters.get(target);
    const result = await adapter.invokeTool(translated.name, translated.args);

    // 4. Translate result back to unified format
    return this.translateResult(result, message);
  }
}
```

### 7.3 Agent Card Discovery

```typescript
interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    skills: {
      id: string;
      name: string;
      description: string;
      tags: string[];
      inputModalities: ('text' | 'image' | 'audio')[];
      outputModalities: ('text' | 'image' | 'audio')[];
    }[];
  };
  authentication: {
    schemes: ('api_key' | 'oauth2' | 'none')[];
  };
  protocolVersions: string[];
}
```

---

## 8. Deterministic Execution Separation

### 8.1 Tool Registry with Typed Schemas

```typescript
interface ToolDefinition<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  outputSchema: z.ZodSchema<TOutput>;
  invoke: (input: TInput) => Promise<TOutput>;
  idempotent: boolean;
  sideEffect: boolean;
  requiresApproval: boolean;
}

class ToolRegistry {
  private tools: Map<string, ToolDefinition<unknown, unknown>> = new Map();

  async invoke<TInput, TOutput>(
    name: string,
    rawInput: unknown
  ): Promise<TOutput> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);

    // 1. Validate input against schema
    const input = tool.inputSchema.parse(rawInput);

    // 2. If side effect and requires approval, pause for user
    if (tool.sideEffect && tool.requiresApproval) {
      await this.requestApproval(name, input);
    }

    // 3. Execute deterministically
    const output = await tool.invoke(input);

    // 4. Validate output against schema
    return tool.outputSchema.parse(output);
  }
}
```

### 8.2 Seven-Stage Plan Validation

```typescript
class PlanValidator {
  async validate(plan: ExecutionPlan): Promise<ValidationResult> {
    const checks = [
      { name: 'nodes_exist', fn: () => this.checkNodesExist(plan) },
      { name: 'edges_type_compatible', fn: () => this.checkEdgeTypes(plan) },
      { name: 'dag_acyclic', fn: () => this.checkAcyclic(plan) },
      { name: 'params_present', fn: () => this.checkParams(plan) },
      { name: 'budget_satisfied', fn: () => this.checkBudget(plan) },
      { name: 'safety_compliant', fn: () => this.checkSafety(plan) },
      { name: 'idempotency_keys', fn: () => this.checkIdempotency(plan) },
    ];

    const results = await Promise.all(
      checks.map(async (check) => {
        try {
          const valid = await check.fn();
          return { name: check.name, passed: valid, error: null };
        } catch (error) {
          return { name: check.name, passed: false, error };
        }
      })
    );

    return {
      valid: results.every(r => r.passed),
      checks: results,
    };
  }
}
```

### 8.3 Audit Trail with OpenTelemetry

```typescript
class AuditTrail {
  private tracer: Tracer;

  async traceExecution(
    intent: string,
    plan: ExecutionPlan,
    execution: () => Promise<unknown>
  ): Promise<unknown> {
    return this.tracer.startActiveSpan('agent_execution', async (span) => {
      span.setAttribute('intent', intent);
      span.setAttribute('plan_hash', sha256(JSON.stringify(plan)));
      span.setAttribute('timestamp', Date.now().toString());

      try {
        const result = await execution();
        span.setAttribute('status', 'success');
        return result;
      } catch (error) {
        span.setAttribute('status', 'error');
        span.setAttribute('error', String(error));
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
```

---

## 9. Multimodal Capability Integration

### 9.1 Multimodal Context Engine

```typescript
interface MultimodalContext {
  text: string;
  images?: {
    source: 'clipboard' | 'file' | 'screenshot' | 'url';
    data: string; // base64 or URL
    mimeType: string;
    description?: string; // Alt text
  }[];
  code?: {
    filePath: string;
    language: string;
    content: string;
    lineRange?: [number, number];
  }[];
  dom?: {
    accessibilityTree: string;
    viewport: { width: number; height: number };
  };
}

class MultimodalEngine {
  async analyze(context: MultimodalContext): Promise<AnalysisResult> {
    // 1. Pre-filter: skip analysis if images are identical (pixelmatch)
    if (context.images) {
      const diffResult = await this.pixelDiff(context.images);
      if (diffResult.identical) {
        return { skipReason: 'No visual changes detected' };
      }
    }

    // 2. Bundle context: screenshot + DOM + code + console logs
    const bundled = await this.bundleContext(context);

    // 3. Route to appropriate vision model
    const model = this.selectVisionModel(bundled);

    // 4. Execute analysis
    return this.executeAnalysis(model, bundled);
  }
}
```

### 9.2 Tiered Visual Analysis

```
Screenshot Input
    ↓
[Tier 1: Pixel Diff] — Local pixelmatch, free, instant
    ├── Identical → SKIP (0 tokens)
    └── Different ↓
         ↓
[Tier 2: Fast Check] — ~600 tokens, classify change type
    ├── Intentional → SKIP
    ├── Noise → SKIP
    └── Regression ↓
         ↓
[Tier 3: Full Analysis] — ~2,400 tokens, detailed diagnosis
    └── Trace to exact CSS property on exact line
```

---

## 10. Continuous Refactoring Engine

### 10.1 Always-On Quality Monitoring

```typescript
interface QualityMetrics {
  // Per-file metrics
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  couplingAfferent: number;   // Ca: files that depend on this
  couplingEfferent: number;   // Ce: files this depends on
  instability: number;        // I = Ce/(Ca+Ce)
  deadCode: boolean;
  duplication: number;        // Percentage of duplicated code

  // Per-symbol metrics
  blastRadius: number;        // Files affected if changed
  hotspotScore: number;       // complexity × log(1 + commits)
  testCoverage: number;

  // AI-specific metrics
  aiGenerated: boolean;
  aiIssues: {
    hallucinatedImports: number;
    unnecessaryCode: number;
    confidentDuplication: number;
  }[];
}
```

### 10.2 Automated Refactoring Suggestions

```typescript
class RefactoringEngine {
  async analyze(file: string): Promise<RefactoringSuggestion[]> {
    const metrics = await this.getMetrics(file);
    const suggestions: RefactoringSuggestion[] = [];

    // Dead code detection
    if (metrics.deadCode) {
      suggestions.push({
        type: 'remove_dead_code',
        severity: 'medium',
        description: 'Unused symbols detected',
        affectedSymbols: metrics.deadSymbols,
      });
    }

    // Complexity reduction
    if (metrics.cyclomaticComplexity > 10) {
      suggestions.push({
        type: 'reduce_complexity',
        severity: 'high',
        description: 'High cyclomatic complexity',
        affectedSymbols: metrics.complexFunctions,
      });
    }

    // Duplication detection
    if (metrics.duplication > 15) {
      suggestions.push({
        type: 'extract_shared',
        severity: 'medium',
        description: 'Code duplication detected',
        affectedRegions: metrics.duplicatedRegions,
      });
    }

    // Naming consistency
    const namingIssues = await this.checkNamingConsistency(file);
    if (namingIssues.length > 0) {
      suggestions.push({
        type: 'rename_for_consistency',
        severity: 'low',
        description: 'Naming inconsistencies found',
        affectedSymbols: namingIssues,
      });
    }

    return suggestions;
  }
}
```

### 10.3 CI Quality Gates for AI-Generated Code

```typescript
interface QualityGate {
  name: string;
  check: (diff: CodeDiff) => Promise<GateResult>;
  severity: 'block' | 'warn' | 'info';
}

const AI_QUALITY_GATES: QualityGate[] = [
  {
    name: 'import-validation',
    check: async (diff) => {
      // Detect hallucinated imports
      const imports = extractImports(diff);
      const valid = await validateImports(imports);
      return { passed: valid.allValid, failures: valid.invalid };
    },
    severity: 'block',
  },
  {
    name: 'diff-size',
    check: async (diff) => {
      // Flag inflated diffs for simple requests
      return { passed: diff.linesChanged < 400 };
    },
    severity: 'warn',
  },
  {
    name: 'duplication',
    check: async (diff) => {
      // Catch confident duplication
      const duplicates = findDuplication(diff.newContent);
      return { passed: duplicates.length === 0, duplicates };
    },
    severity: 'block',
  },
  {
    name: 'complexity-ceiling',
    check: async (diff) => {
      // Block critical complexity without acknowledgment
      const complex = findHighComplexity(diff.newContent);
      return { passed: complex.length === 0, complex };
    },
    severity: 'warn',
  },
];
```

---

## 11. Feedback and Refinement Loops

### 11.1 Continuous Learning

```typescript
interface FeedbackLoop {
  // Record outcome of each methodology application
  recordOutcome(
    methodology: MethodologyId,
    task: TaskClassification,
    model: string,
    quality: number,
    cost: number,
    duration: number
  ): void;

  // Update model profiles based on empirical data
  updateModelProfile(model: string, outcome: Outcome): void;

  // Adjust methodology rules based on success rates
  adjustMethodologyRules(): void;
}
```

### 11.2 Methodology Effectiveness Tracking

```typescript
interface MethodologyStats {
  methodology: MethodologyId;
  totalApplications: number;
  successRate: number;
  avgQuality: number;
  avgCost: number;
  avgDuration: number;
  byTaskType: Record<TaskClassification['type'], {
    count: number;
    successRate: number;
    avgQuality: number;
  }>;
  byModelTier: Record<'S' | 'A' | 'B' | 'C', {
    count: number;
    successRate: number;
  }>;
}
```

---

## 12. Frontend and Backend Parity

### 12.1 Unified Methodology Application

The methodology selection engine applies equally to frontend and backend tasks:

```typescript
// Frontend-specific methodology adaptations
const FRONTEND_ADAPTATIONS: Record<MethodologyId, FrontendAdaptation> = {
  'multimodal-pipeline': {
    visionStep: 'screenshot → design token extraction',
    generationStep: 'React component + Tailwind classes',
    validationStep: 'visual regression + accessibility check',
  },
  'spec-first': {
    specIncludes: ['component API', 'props interface', 'visual states', 'responsive breakpoints'],
    validationStep: 'Storybook story + visual test',
  },
};

// Backend-specific methodology adaptations
const BACKEND_ADAPTATIONS: Record<MethodologyId, BackendAdaptation> = {
  'spec-first': {
    specIncludes: ['API contract', 'database schema', 'error responses', 'auth requirements'],
    validationStep: 'contract test + integration test',
  },
  'bmad-lite': {
    architectStep: 'API design + data model + security review',
    validationStep: 'API test suite + security scan',
  },
};
```

### 12.2 Full-Stack Testing Strategy

```typescript
interface FullStackTestPlan {
  // Unit tests (generated by AI, verified by deterministic runner)
  unitTests: {
    framework: string;
    coverageTarget: number;
    reservedTests: string[]; // Tests AI cannot modify
  };

  // Integration tests (API contracts, database interactions)
  integrationTests: {
    apiContracts: ApiContract[];
    databaseTests: string[];
  };

  // Visual tests (frontend-specific)
  visualTests: {
    screenshots: string[];
    accessibilityChecks: string[];
    responsiveBreakpoints: number[];
  };

  // End-to-end tests (full user journeys)
  e2eTests: {
    userJourneys: string[];
    criticalPaths: string[];
  };
}
```

---

## 13. Integration with Existing Architecture

### 13.1 Extension Points

The methodology enhancement integrates with existing OpenCode Harness components:

| Existing Component | Integration Point |
|-------------------|-------------------|
| `ChatProvider.ts` | Receives methodology recommendations, applies to session |
| `TabManager.ts` | Per-tab methodology state and configuration |
| `StreamCoordinator.ts` | Methodology-specific streaming patterns |
| `ModelManager.ts` | Dynamic model profiles, cascade routing |
| `ContextEngine.ts` | Context optimization, budget-aware inclusion |
| `DiffApplier.ts` | Quality gate validation before applying diffs |
| `ThemeManager.ts` | Visual indicators for methodology status |

### 13.2 New Components

| New Component | Responsibility |
|--------------|----------------|
| `MethodologyOrchestrator.ts` | Core methodology selection and application |
| `TaskClassifier.ts` | Analyze user requests, extract signals |
| `CascadeRouter.ts` | Model routing with quality-based escalation |
| `PromptEngine.ts` | Methodology-specific prompt generation |
| `SchemaValidator.ts` | Zod-based validation of LLM outputs |
| `PlanValidator.ts` | Seven-stage execution plan validation |
| `ToolRegistry.ts` | Typed tool definitions with schemas |
| `AuditTrail.ts` | OpenTelemetry tracing of all operations |
| `QualityGate.ts` | CI-style gates for AI-generated code |
| `RefactoringEngine.ts` | Continuous code health monitoring |
| `MultimodalEngine.ts` | Image/diagram analysis pipeline |
| `ProtocolAdapter.ts` | MCP/A2A/AG-UI abstraction layer |
| `SkillManager.ts` | On-demand skill loading and composition |
| `ModelProfiler.ts` | Dynamic model capability tracking |
| `ContextOptimizer.ts` | Context budget management |

---

## 14. Configuration Schema

```typescript
interface MethodologyConfig {
  // Enable/disable methodology selection
  enabled: boolean;

  // Default methodology for unclassified tasks
  defaultMethodology: MethodologyId;

  // Model tier preferences
  modelTiers: {
    S: string[];  // Model IDs for S-tier
    A: string[];  // Model IDs for A-tier
    B: string[];  // Model IDs for B-tier
    C: string[];  // Model IDs for C-tier
  };

  // Cascade routing settings
  cascade: {
    enabled: boolean;
    maxEscalations: number;
    qualityThresholds: Record<string, number>;
  };

  // Prompt engineering settings
  prompting: {
    defaultStrategy: PromptStrategy;
    maxRefinementPasses: number;
    contextBudget: number;
  };

  // Quality gate settings
  qualityGates: {
    enabled: boolean;
    gates: {
      importValidation: boolean;
      diffSize: boolean;
      duplication: boolean;
      complexityCeiling: boolean;
      aiSpecificLinting: boolean;
    };
  };

  // Protocol settings
  protocols: {
    mcp: { enabled: boolean; servers: string[] };
    a2a: { enabled: boolean; agents: string[] };
    agui: { enabled: boolean };
  };

  // Multimodal settings
  multimodal: {
    enabled: boolean;
    tieredAnalysis: boolean;
    maxImageSize: number;
  };

  // Refactoring settings
  refactoring: {
    enabled: boolean;
    autoSuggest: boolean;
    complexityThreshold: number;
    duplicationThreshold: number;
  };
}
```

---

## 15. Error Handling and Graceful Degradation

### 15.1 Degradation Chain

```
Full methodology selection + cascade routing + quality gates
    ↓ (if methodology engine unavailable)
Default methodology + single model + basic validation
    ↓ (if model unavailable)
Fallback model + simplified prompt
    ↓ (if all models unavailable)
Cached response or user-facing error with actionable guidance
```

### 15.2 Error Classification

```typescript
type ErrorClass =
  | 'routing'           // Methodology selection failed
  | 'model'             // Model API unavailable
  | 'validation'        // Schema validation failed
  | 'execution'         // Tool execution failed
  | 'quality'           // Quality gate failed
  | 'protocol'          // Protocol communication failed
  | 'context'           // Context budget exceeded
  | 'multimodal';       // Image processing failed

interface ClassifiedError {
  class: ErrorClass;
  message: string;
  recoverable: boolean;
  recoveryAction?: string;
  userMessage: string;
}
```

---

## 16. Security Considerations

### 16.1 Input Validation

- All user input sanitized before sending to any model
- Prompt injection detection in file attachments
- Sensitive file filtering (`.env`, credentials, private keys)

### 16.2 Output Validation

- Schema validation on all LLM outputs before execution
- Tool call parameter validation before execution
- Side effect approval gates for destructive operations

### 16.3 Protocol Security

- OAuth 2.0 for remote MCP/A2A servers
- API key management in VS Code secure storage
- Transport encryption for all protocol communications

### 16.4 Audit Compliance

- SHA-256 hashes on all plan versions
- Immutable audit trail with OpenTelemetry
- Reproducible execution from cached traces
