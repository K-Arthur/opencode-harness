# AI Methodology Enhancement Architecture Design

**Project:** opencode-harness Extension  
**Date:** 2026-05-15  
**Based on:** Research Report (docs/research/ai-methodology-enhancement-research-report.md)

---

## 1. Architecture Overview

### 1.1 Design Principles

1. **Model-Capability-Aware:** All methodology selection decisions consider model intelligence tiers and capabilities
2. **Hybrid Approach:** No single methodology; dynamic routing based on task characteristics
3. **Lower-Intelligence Support:** Enhanced prompting, planning mode, and context optimization for less capable models
4. **Deterministic Execution:** Schema validation and execution separation for reliability
5. **Frontend-Backend Parity:** UI components expose methodology selection and monitoring
6. **Incremental Adoption:** Phased implementation with backward compatibility

### 1.2 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend Layer                           │
├─────────────────────────────────────────────────────────────────┤
│  Methodology Selector │ Planning Mode UI │ Spec Editor UI        │
│  Agent Dashboard      │ Context Monitor  │ Validation Status      │
└──────────────────────┬──────────────────────────────────────────┘
                       │ Webview Events
┌──────────────────────▼──────────────────────────────────────────┐
│                    Methodology Orchestrator                      │
├─────────────────────────────────────────────────────────────────┤
│  Task Complexity Analyzer │ Model Intelligence Profiler          │
│  Methodology Router      │ Prompt Template Manager              │
│  Spec Manager            │ Context Optimizer                    │
└──────────┬────────────────────────┬──────────────────────────────┘
           │                        │
┌──────────▼──────────┐   ┌────────▼──────────────────────────────┐
│  Existing Services  │   │      New Methodology Services        │
├─────────────────────┤   ├──────────────────────────────────────┤
│  SessionManager     │   │  SpecService (spec management)       │
│  ModelSkillRegistry │   │  MethodologyService (routing logic)  │
│  PromptManager      │   │  TaskAnalyzer (complexity scoring)   │
│  McpServerManager   │   │  ContextOptimizer (RAG/compression)  │
│  ContextEngine      │   │  ValidatorService (schema validation)│
│  StreamCoordinator  │   │  AgentCoordinator (multi-agent)       │
└─────────────────────┘   └──────────────────────────────────────┘
           │                        │
           └──────────┬─────────────┘
                      │
┌─────────────────────▼──────────────────────────────────────────┐
│                    Agent Execution Layer                         │
├─────────────────────────────────────────────────────────────────┤
│  Single Agent │ Multi-Agent (Coordinator/Implementor/Verifier) │
│  Plan Mode     │ Act Mode                                         │
│  BMAD Workflow │ GSD Workflow │ SDD Workflow                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Components

### 2.1 Task Complexity Analyzer

**Purpose:** Analyze task characteristics to determine appropriate methodology

**Location:** `src/methodology/TaskAnalyzer.ts`

**Responsibilities:**
- Analyze task complexity based on multiple factors
- Generate complexity score (1-10 scale)
- Identify task domain (frontend, backend, database, architecture, etc.)
- Detect task urgency (high, medium, low)
- Estimate affected file count and impact scope

**Key Methods:**
```typescript
interface TaskAnalysis {
  complexityScore: number; // 1-10 scale
  domain: TaskDomain;
  urgency: 'high' | 'medium' | 'low';
  affectedFileCount: number;
  architecturalImpact: 'low' | 'medium' | 'high';
  dependencies: string[];
  estimatedTime: number; // minutes
}

class TaskAnalyzer {
  analyzeTask(prompt: string, context: ContextSnapshot): TaskAnalysis;
  calculateComplexityScore(analysis: Partial<TaskAnalysis>): number;
  detectTaskDomain(prompt: string): TaskDomain;
  estimateImpactScope(files: string[]): 'low' | 'medium' | 'high';
}
```

**Complexity Scoring Factors:**
- **File count:** More files = higher complexity
- **Codebase size:** Larger codebase = higher complexity
- **Architectural impact:** Changes to core components = higher complexity
- **Dependency depth:** Deep dependencies = higher complexity
- **Domain complexity:** Architecture > backend > frontend > general
- **Ambiguity:** Vague requirements = higher complexity

**Integration:**
- Called by `MethodologyRouter` before methodology selection
- Uses `ContextEngine` for codebase analysis
- Leverages `ModelSkillRegistry` for model capability context

### 2.2 Model Intelligence Profiler

**Purpose:** Profile models by intelligence tier and capabilities

**Location:** `src/methodology/ModelIntelligenceProfiler.ts`

**Responsibilities:**
- Classify models into intelligence tiers (high, medium, low)
- Track model-specific capabilities and limitations
- Maintain methodology compatibility matrix
- Update profiles based on usage analytics

**Key Methods:**
```typescript
interface ModelIntelligenceProfile {
  modelId: string;
  tier: 'high' | 'medium' | 'low';
  capabilities: ModelCapabilities;
  methodologyCompatibility: MethodologyCompatibility;
  performanceMetrics: PerformanceMetrics;
}

interface MethodologyCompatibility {
  bmad: boolean;
  gsd: boolean;
  sdd: boolean;
  adversarial: boolean;
  planningMode: boolean;
}

class ModelIntelligenceProfiler {
  getProfile(modelId: string): ModelIntelligenceProfile;
  classifyTier(modelId: string): 'high' | 'medium' | 'low';
  getCompatibleMethodologies(modelId: string): string[];
  updateProfile(modelId: string, metrics: PerformanceMetrics): void;
}
```

**Integration:**
- Extends existing `ModelSkillRegistry`
- Uses `UsageAnalytics` for performance tracking
- Provides input to `MethodologyRouter`

### 2.3 Methodology Router

**Purpose:** Route tasks to optimal methodology based on analysis and model capabilities

**Location:** `src/methodology/MethodologyRouter.ts`

**Responsibilities:**
- Select optimal methodology for given task and model
- Apply routing rules and fallback strategies
- Consider user preferences and constraints
- Provide routing rationale for transparency

**Key Methods:**
```typescript
interface RoutingDecision {
  methodology: MethodologyType;
  modelId: string;
  rationale: string;
  confidence: number;
  fallbackStrategy?: FallbackStrategy;
}

type MethodologyType = 
  | 'standard' 
  | 'bmad' 
  | 'gsd' 
  | 'sdd' 
  | 'sdd-anchored' 
  | 'adversarial';

class MethodologyRouter {
  route(
    taskAnalysis: TaskAnalysis, 
    modelId: string, 
    userPreferences?: UserPreferences
  ): RoutingDecision;
  applyRoutingRules(
    analysis: TaskAnalysis, 
    profile: ModelIntelligenceProfile
  ): MethodologyType;
  determineFallbackStrategy(
    primary: MethodologyType, 
    modelTier: string
  ): FallbackStrategy;
}
```

**Routing Logic:**
```typescript
// Pseudocode for routing decision
IF taskAnalysis.complexityScore >= 8 AND profile.tier === 'high' THEN
  RETURN { methodology: 'bmad', model: currentModel, confidence: 0.9 }
ELSE IF taskAnalysis.complexityScore >= 8 AND profile.tier === 'medium' THEN
  RETURN { methodology: 'sdd-anchored', model: currentModel, confidence: 0.8 }
ELSE IF taskAnalysis.complexityScore >= 8 AND profile.tier === 'low' THEN
  RETURN { methodology: 'gsd', model: escalateToHigherTier(), confidence: 0.7 }
ELSE IF taskAnalysis.complexityScore >= 5 AND taskAnalysis.urgency === 'high' THEN
  RETURN { methodology: 'gsd', model: currentModel, confidence: 0.85 }
ELSE IF taskAnalysis.complexityScore >= 5 THEN
  RETURN { methodology: 'sdd', model: currentModel, confidence: 0.8 }
ELSE
  RETURN { methodology: 'standard', model: optimizeForCost(), confidence: 0.75 }
END IF
```

**Integration:**
- Called by `MethodologyOrchestrator` before task execution
- Uses `TaskAnalyzer` and `ModelIntelligenceProfiler`
- Stores routing decisions in `SessionManager` for audit trail

### 2.4 Methodology Orchestrator

**Purpose:** Coordinate methodology execution and manage transitions

**Location:** `src/methodology/MethodologyOrchestrator.ts`

**Responsibilities:**
- Coordinate methodology execution flow
- Manage transitions between planning and execution modes
- Handle methodology-specific state
- Provide progress updates to frontend

**Key Methods:**
```typescript
interface MethodologyExecution {
  methodology: MethodologyType;
  phase: 'planning' | 'execution' | 'verification' | 'complete';
  state: MethodologyState;
  progress: Progress;
}

class MethodologyOrchestrator {
  startMethodology(
    sessionId: string, 
    methodology: MethodologyType, 
    taskAnalysis: TaskAnalysis
  ): Promise<MethodologyExecution>;
  transitionPhase(
    execution: MethodologyExecution, 
    newPhase: string
  ): Promise<void>;
  updateProgress(
    execution: MethodologyExecution, 
    progress: Progress
  ): void;
  handleMethodologyError(
    execution: MethodologyExecution, 
    error: Error
  ): Promise<void>;
}
```

**Integration:**
- Extends existing `StreamCoordinator`
- Coordinates with `SessionManager` for agent management
- Pushes state updates via `StatePushService`

### 2.5 Spec Service

**Purpose:** Manage specifications for spec-driven development

**Location:** `src/methodology/SpecService.ts`

**Responsibilities:**
- Create, read, update, and delete specifications
- Validate specifications against schema
- Version specifications and track changes
- Integrate with MCP for spec resources

**Key Methods:**
```typescript
interface Spec {
  id: string;
  projectId: string;
  version: string;
  elements: SpecElements;
  status: 'draft' | 'approved' | 'deprecated';
  createdAt: Date;
  updatedAt: Date;
}

interface SpecElements {
  outcomes: string[];
  scope: { inScope: string[]; outOfScope: string[] };
  constraints: string[];
  decisions: Record<string, string>;
  taskBreakdown: TaskBreakdown[];
  verificationCriteria: VerificationCriteria[];
}

class SpecService {
  createSpec(projectId: string, elements: SpecElements): Promise<Spec>;
  getSpec(specId: string): Promise<Spec>;
  updateSpec(specId: string, updates: Partial<SpecElements>): Promise<Spec>;
  validateSpec(spec: Spec): ValidationResult;
  getVersionHistory(specId: string): Promise<Spec[]>;
}
```

**Integration:**
- Uses `PromptManager` for spec templates
- Stores specs in workspace or user global state
- Exposes specs as MCP resources
- Integrates with `SessionManager` for spec-based workflows

### 2.6 Context Optimizer

**Purpose:** Optimize context window usage for better performance and cost

**Location:** `src/methodology/ContextOptimizer.ts`

**Responsibilities:**
- Apply RAG for relevant context retrieval
- Implement prompt compression strategies
- Manage selective context loading
- Monitor context usage and provide recommendations

**Key Methods:**
```typescript
interface ContextOptimization {
  strategy: OptimizationStrategy;
  compressionRatio: number;
  retrievalResults: RetrievalResult[];
  usageMetrics: ContextUsageMetrics;
}

type OptimizationStrategy = 
  | 'rag' 
  | 'compression' 
  | 'selective' 
  | 'hybrid';

class ContextOptimizer {
  optimizeContext(
    context: ContextSnapshot, 
    task: TaskAnalysis
  ): Promise<ContextOptimization>;
  applyRAG(context: ContextSnapshot, query: string): Promise<RetrievalResult[]>;
  compressContext(context: ContextSnapshot): Promise<CompressedContext>;
  selectContext(context: ContextSnapshot, task: TaskAnalysis): ContextSnapshot;
  monitorUsage(sessionId: string): ContextUsageMetrics;
}
```

**Integration:**
- Works with existing `ContextEngine` and `ContextMonitor`
- Uses embedding provider for semantic search
- Provides recommendations via frontend UI

### 2.7 Validator Service

**Purpose:** Validate agent outputs against schemas and specifications

**Location:** `src/methodology/ValidatorService.ts`

**Responsibilities:**
- Validate tool inputs and outputs against schemas
- Verify outputs against specification criteria
- Detect and report validation failures
- Provide actionable error messages

**Key Methods:**
```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

class ValidatorService {
  validateToolInput(toolName: string, input: unknown): ValidationResult;
  validateToolOutput(toolName: string, output: unknown): ValidationResult;
  validateAgainstSpec(output: unknown, spec: Spec): ValidationResult;
  validateSchema(data: unknown, schema: JSONSchema): ValidationResult;
}
```

**Integration:**
- Intercepts tool calls in `StreamCoordinator`
- Uses JSON Schema definitions from tool metadata
- Integrates with `SpecService` for spec-based validation

### 2.8 Agent Coordinator

**Purpose:** Coordinate multi-agent workflows (BMAD, adversarial pattern)

**Location:** `src/methodology/AgentCoordinator.ts`

**Responsibilities:**
- Manage agent lifecycle and communication
- Coordinate handoffs between agents
- Implement adversarial pattern (Coordinator/Implementor/Verifier)
- Track agent state and progress

**Key Methods:**
```typescript
interface AgentCoordination {
  agents: AgentInstance[];
  workflow: AgentWorkflow;
  state: CoordinationState;
  messages: AgentMessage[];
}

interface AgentInstance {
  id: string;
  role: AgentRole;
  status: 'idle' | 'active' | 'waiting' | 'complete';
  context: AgentContext;
}

type AgentRole = 
  | 'coordinator' 
  | 'implementor' 
  | 'verifier' 
  | 'business-analyst' 
  | 'product-manager' 
  | 'system-architect' 
  | 'developer' 
  | 'qa-engineer';

class AgentCoordinator {
  createWorkflow(
    methodology: MethodologyType, 
    task: TaskAnalysis
  ): AgentCoordination;
  startAgent(agentId: string, context: AgentContext): Promise<void>;
  handoff(fromAgent: string, toAgent: string, message: AgentMessage): Promise<void>;
  coordinateAdversarial(
    implementors: string[], 
    verifier: string
  ): Promise<CoordinationResult>;
  getWorkflowState(workflowId: string): CoordinationState;
}
```

**Integration:**
- Uses existing `SessionManager.listAgents()` and `sendPrompt()`
- Implements Hermes-style message protocols
- Coordinates with `MethodologyOrchestrator` for workflow management

---

## 3. Frontend Components

### 3.1 Methodology Selector

**Location:** `src/chat/webview/methodology-selector.ts`

**Purpose:** Allow users to select and view current methodology

**UI Components:**
- Dropdown for methodology selection
- Display current methodology with description
- Show methodology-specific settings
- Provide routing rationale when auto-selected

**State Management:**
```typescript
interface MethodologySelectorState {
  currentMethodology: MethodologyType;
  availableMethodologies: MethodologyType[];
  autoSelected: boolean;
  routingRationale?: string;
}
```

**Event Handlers:**
- `onMethodologyChange(methodology: MethodologyType)`
- `onViewRationale()`
- `onConfigureSettings()`

### 3.2 Planning Mode UI

**Location:** `src/chat/webview/planning-mode.ts`

**Purpose:** Display and manage planning mode state

**UI Components:**
- Toggle between plan/act modes
- Display plan summary with steps
- Show current step and progress
- Enable plan editing and approval

**State Management:**
```typescript
interface PlanningModeState {
  mode: 'plan' | 'act';
  plan?: Plan;
  currentStep?: number;
  approved?: boolean;
}

interface Plan {
  steps: PlanStep[];
  rationale: string;
  estimatedTime: number;
  risks: string[];
}
```

**Event Handlers:**
- `onToggleMode()`
- `onApprovePlan()`
- `onEditPlan()`
- `onProceedToNextStep()`

### 3.3 Spec Editor UI

**Location:** `src/chat/webview/spec-editor.ts`

**Purpose:** Create and edit specifications

**UI Components:**
- Markdown editor with live preview
- Spec template selector
- Validation status indicators
- Version history viewer

**State Management:**
```typescript
interface SpecEditorState {
  spec?: Spec;
  mode: 'create' | 'edit' | 'view';
  validation?: ValidationResult;
  versions?: Spec[];
}
```

**Event Handlers:**
- `onSaveSpec(spec: Spec)`
- `onValidateSpec()`
- `onViewVersion(version: string)`
- `onUseTemplate(template: string)`

### 3.4 Agent Dashboard

**Location:** `src/chat/webview/agent-dashboard.ts`

**Purpose:** Monitor multi-agent workflows

**UI Components:**
- Agent status cards
- Message flow visualization
- Handoff protocol indicators
- Parallel execution monitoring

**State Management:**
```typescript
interface AgentDashboardState {
  workflow?: AgentCoordination;
  agentStates: Map<string, AgentInstance>;
  messages: AgentMessage[];
  performanceMetrics: PerformanceMetrics;
}
```

**Event Handlers:**
- `onViewAgentDetails(agentId: string)`
- `onPauseWorkflow()`
- `onResumeWorkflow()`
- `onAbortWorkflow()`

### 3.5 Context Monitor UI

**Location:** `src/chat/webview/context-monitor.ts`

**Purpose:** Display context usage and optimization status

**UI Components:**
- Context usage breakdown by type
- Compression statistics
- RAG retrieval results
- Optimization recommendations

**State Management:**
```typescript
interface ContextMonitorState {
  usage: ContextUsageMetrics;
  optimization?: ContextOptimization;
  recommendations: OptimizationRecommendation[];
}
```

**Event Handlers:**
- `onApplyOptimization(strategy: OptimizationStrategy)`
- `onViewDetails()`
- `onConfigureSettings()`

---

## 4. Data Flow

### 4.1 Methodology Selection Flow

```
User Prompt
    │
    ▼
TaskAnalyzer.analyzeTask()
    │
    ├─→ Complexity Score
    ├─→ Domain
    ├─→ Urgency
    └─→ Impact Scope
    │
    ▼
ModelIntelligenceProfiler.getProfile()
    │
    ├─→ Intelligence Tier
    ├─→ Capabilities
    └─→ Methodology Compatibility
    │
    ▼
MethodologyRouter.route()
    │
    ├─→ Apply Routing Rules
    ├─→ Consider User Preferences
    └─→ Determine Fallback Strategy
    │
    ▼
Routing Decision
    │
    ├─→ Methodology
    ├─→ Model Selection
    ├─→ Rationale
    └─→ Confidence
    │
    ▼
MethodologyOrchestrator.startMethodology()
    │
    ▼
Frontend: Update Methodology Selector
```

### 4.2 Spec-Driven Development Flow

```
User: Create Spec
    │
    ▼
SpecService.createSpec()
    │
    ├─→ Validate Elements
    ├─→ Assign Version
    └─→ Store Spec
    │
    ▼
Frontend: Spec Editor
    │
    ▼
User: Approve Spec
    │
    ▼
MethodologyRouter.route() // with spec context
    │
    ▼
MethodologyOrchestrator.startMethodology('sdd')
    │
    ├─→ Load Spec into Context
    ├─→ Decompose Tasks
    └─→ Assign to Agents
    │
    ▼
AgentCoordinator.createWorkflow()
    │
    ├─→ Coordinator Agent
    ├─→ Implementor Agents
    └─→ Verifier Agent
    │
    ▼
Execution with Spec Constraints
    │
    ▼
ValidatorService.validateAgainstSpec()
    │
    ▼
Verification Result
    │
    ▼
Frontend: Display Validation Status
```

### 4.3 Planning Mode Flow

```
User Prompt (Complex Task)
    │
    ▼
TaskAnalyzer.analyzeTask()
    │
    ├─→ Complexity Score >= 5
    └─→ Model Tier: Low/Medium
    │
    ▼
MethodologyRouter.route()
    │
    ▼
Routing Decision: GSD with Planning Mode
    │
    ▼
MethodologyOrchestrator.startMethodology('gsd')
    │
    ├─→ Set Phase: 'planning'
    └─→ Enable Planning Mode
    │
    ▼
Frontend: Planning Mode UI
    │
    ▼
Agent: Generate Plan
    │
    ├─→ Analyze Task
    ├─→ Break Down Steps
    ├─→ Identify Risks
    └─→ Estimate Time
    │
    ▼
Frontend: Display Plan
    │
    ▼
User: Approve Plan
    │
    ▼
MethodologyOrchestrator.transitionPhase('execution')
    │
    ├─→ Set Phase: 'execution'
    └─→ Execute Steps Sequentially
    │
    ▼
Frontend: Update Progress
    │
    ▼
Completion
```

### 4.4 Adversarial Agent Pattern Flow

```
User Prompt (Complex Task)
    │
    ▼
TaskAnalyzer.analyzeTask()
    │
    ├─→ Complexity Score >= 8
    └─→ Model Tier: High
    │
    ▼
MethodologyRouter.route()
    │
    ▼
Routing Decision: Adversarial Pattern
    │
    ▼
SpecService.createSpec() // if not exists
    │
    ▼
MethodologyOrchestrator.startMethodology('adversarial')
    │
    ▼
AgentCoordinator.createWorkflow()
    │
    ├─→ Coordinator Agent
    ├─→ Implementor Agent 1
    ├─→ Implementor Agent 2
    └─→ Verifier Agent
    │
    ▼
Coordinator: Decompose Spec
    │
    ▼
Parallel Implementor Execution
    │
    ├─→ Implementor 1: Task A
    └─→ Implementor 2: Task B
    │
    ▼
Implementors: Complete Tasks
    │
    ▼
Verifier: Validate Against Spec
    │
    ├─→ Check Outcomes
    ├─→ Verify Scope Boundaries
    ├─→ Validate Constraints
    └─→ Test Verification Criteria
    │
    ▼
ValidatorService.validateAgainstSpec()
    │
    ▼
Verification Result
    │
    ├─→ Valid: Approve
    └─→ Invalid: Request Fixes
    │
    ▼
Frontend: Agent Dashboard
```

---

## 5. Integration with Existing Components

### 5.1 SessionManager Extensions

**New Methods:**
```typescript
class SessionManager {
  // Existing methods...
  
  // New methodology-related methods
  setMethodology(sessionId: string, methodology: MethodologyType): void;
  getMethodology(sessionId: string): MethodologyType;
  setRoutingDecision(sessionId: string, decision: RoutingDecision): void;
  getRoutingDecision(sessionId: string): RoutingDecision;
  listMethodologyAgents(methodology: MethodologyType): Promise<AgentInfo[]>;
}
```

**Integration Points:**
- Store methodology selection in session metadata
- Track routing decisions for audit trail
- List methodology-specific agents

### 5.2 ModelSkillRegistry Extensions

**New Methods:**
```typescript
class ModelSkillRegistry {
  // Existing methods...
  
  // New methodology-related methods
  setMethodologyCompatibility(modelId: string, methodology: MethodologyType, compatible: boolean): void;
  getMethodologyCompatibility(modelId: string): MethodologyCompatibility;
  getModelIntelligenceTier(modelId: string): 'high' | 'medium' | 'low';
}
```

**Integration Points:**
- Extend model capabilities with methodology compatibility
- Add intelligence tier classification
- Provide methodology routing constraints

### 5.3 PromptManager Extensions

**New Methods:**
```typescript
class PromptManager {
  // Existing methods...
  
  // New methodology-related methods
  getMethodologyPrompt(methodology: MethodologyType, modelTier: string): string;
  getPlanningModePrompt(task: TaskAnalysis): string;
  getSpecTemplate(specType: string): string;
}
```

**Integration Points:**
- Add methodology-specific prompt templates
- Provide planning mode prompts
- Supply spec templates for SDD

### 5.4 StreamCoordinator Extensions

**New Methods:**
```typescript
class StreamCoordinator {
  // Existing methods...
  
  // New methodology-related methods
  setMethodologyContext(sessionId: string, methodology: MethodologyType): void;
  validateToolCall(toolName: string, input: unknown): ValidationResult;
  applyContextOptimization(sessionId: string): Promise<void>;
}
```

**Integration Points:**
- Apply methodology-specific context
- Validate tool inputs/outputs
- Optimize context during streaming

### 5.5 StatePushService Extensions

**New Methods:**
```typescript
class StatePushService {
  // Existing methods...
  
  // New methodology-related methods
  pushMethodologyState(sessionId: string, state: MethodologyExecution): void;
  pushRoutingDecision(sessionId: string, decision: RoutingDecision): void;
  pushSpecState(sessionId: string, spec: Spec): void;
  pushAgentCoordinationState(sessionId: string, coordination: AgentCoordination): void;
}
```

**Integration Points:**
- Push methodology state to webview
- Push routing decisions for transparency
- Push spec state for SDD workflows
- Push agent coordination state for multi-agent workflows

---

## 6. Schema Definitions

### 6.1 Tool Input/Output Schemas

**Example: File Write Tool**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "pattern": "^[a-zA-Z0-9_\\-./]+$"
    },
    "content": {
      "type": "string"
    }
  },
  "required": ["path", "content"]
}
```

**Location:** `src/schemas/tools/`

### 6.2 Spec Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "outcomes": {
      "type": "array",
      "items": { "type": "string" }
    },
    "scope": {
      "type": "object",
      "properties": {
        "inScope": { "type": "array", "items": { "type": "string" } },
        "outOfScope": { "type": "array", "items": { "type": "string" } }
      }
    },
    "constraints": {
      "type": "array",
      "items": { "type": "string" }
    },
    "decisions": {
      "type": "object",
      "additionalProperties": { "type": "string" }
    },
    "taskBreakdown": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "description": { "type": "string" },
          "dependencies": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "verificationCriteria": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "criteria": { "type": "string" },
          "test": { "type": "string" }
        }
      }
    }
  }
}
```

**Location:** `src/schemas/spec.json`

### 6.3 Agent Message Schema (Hermes-style)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "from": { "type": "string" },
    "to": { "type": "string" },
    "type": {
      "type": "string",
      "enum": ["request", "response", "handoff", "notification"]
    },
    "payload": { "type": "object" },
    "timestamp": { "type": "string", "format": "date-time" },
    "metadata": { "type": "object" }
  },
  "required": ["id", "from", "to", "type", "timestamp"]
}
```

**Location:** `src/schemas/agent-message.json`

---

## 7. Configuration

### 7.1 User Preferences

**Location:** `src/methodology/UserPreferences.ts`

```typescript
interface UserPreferences {
  defaultMethodology?: MethodologyType;
  autoSelectMethodology: boolean;
  preferredModelTier?: 'high' | 'medium' | 'low';
  costOptimization: boolean;
  latencyOptimization: boolean;
  qualityOptimization: boolean;
  planningModeThreshold: number; // complexity score threshold
  contextOptimization: boolean;
  adversarialPattern: boolean;
  specValidation: boolean;
}
```

### 7.2 Workspace Configuration

**Location:** `.opencode/methodology.jsonc`

```jsonc
{
  "defaultMethodology": "standard",
  "autoSelectMethodology": true,
  "methodologySettings": {
    "bmad": {
      "enabled": true,
      "personas": ["business-analyst", "product-manager", "system-architect", "developer", "qa-engineer"]
    },
    "gsd": {
      "enabled": true,
      "planningMode": true,
      "planningThreshold": 5
    },
    "sdd": {
      "enabled": true,
      "specValidation": true,
      "adversarialPattern": false
    }
  },
  "modelSettings": {
    "intelligenceTiering": true,
    "fallbackStrategy": "escalate"
  },
  "contextSettings": {
    "optimization": "hybrid",
    "ragEnabled": true,
    "compressionEnabled": true
  }
}
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

**Test Coverage:**
- `TaskAnalyzer`: Complexity scoring algorithms
- `ModelIntelligenceProfiler`: Tier classification logic
- `MethodologyRouter`: Routing rules and fallback strategies
- `SpecService`: Spec validation and versioning
- `ContextOptimizer`: RAG and compression algorithms
- `ValidatorService`: Schema validation logic

**Location:** `tests/unit/methodology/`

### 8.2 Integration Tests

**Test Scenarios:**
- End-to-end methodology selection flow
- Spec-driven development workflow
- Planning mode transitions
- Adversarial agent pattern coordination
- Context optimization integration

**Location:** `tests/integration/methodology/`

### 8.3 Visual Tests

**Test Components:**
- Methodology selector UI
- Planning mode UI
- Spec editor UI
- Agent dashboard UI
- Context monitor UI

**Location:** `tests/visual/methodology/`

---

## 9. Performance Considerations

### 9.1 Caching Strategy

**Cacheable Results:**
- Task analysis results (per session)
- Model intelligence profiles (global)
- Methodology compatibility (global)
- Spec templates (global)
- RAG embeddings (per workspace)

**Implementation:**
- Use in-memory cache for session-specific data
- Use persistent cache for global data
- Implement cache invalidation on configuration changes

### 9.2 Async Processing

**Async Operations:**
- Task complexity analysis (non-blocking)
- RAG retrieval (parallel)
- Context compression (background)
- Spec validation (background)

**Implementation:**
- Use Promise.all() for parallel operations
- Provide loading states in UI
- Implement timeout handling

### 9.3 Token Optimization

**Strategies:**
- Compress conversation history
- Use selective context loading
- Implement RAG for large codebases
- Cache frequently accessed context

**Implementation:**
- Leverage existing `ContextMonitor` and `AutoCompactor`
- Add compression strategies in `ContextOptimizer`
- Monitor token usage and provide recommendations

---

## 10. Security Considerations

### 10.1 Schema Validation

**Purpose:** Prevent injection and malformed data

**Implementation:**
- Validate all tool inputs against schemas
- Validate agent outputs before execution
- Use JSON Schema for strict validation
- Provide clear error messages for validation failures

### 10.2 Agent Isolation

**Purpose:** Prevent unauthorized access

**Implementation:**
- Run agents in isolated contexts
- Restrict tool access based on agent role
- Implement permission checks for file operations
- Audit agent actions for security review

### 10.3 Spec Security

**Purpose:** Prevent spec injection attacks

**Implementation:**
- Validate spec elements against schema
- Sanitize spec content before use
- Restrict spec execution to trusted sources
- Implement spec approval workflow

---

## 11. Migration Strategy

### 11.1 Backward Compatibility

**Approach:**
- Default to 'standard' methodology for existing sessions
- Gradual rollout of new features
- Provide opt-in for advanced methodologies
- Maintain existing prompt templates

### 11.2 Data Migration

**Migration Steps:**
1. Add methodology field to session metadata
2. Migrate existing prompts to new template system
3. Initialize model intelligence profiles
4. Create default workspace configuration

### 11.3 User Communication

**Communication Plan:**
1. Announce new methodology features
2. Provide documentation and tutorials
3. Offer in-app guidance and tooltips
4. Collect feedback and iterate

---

## 12. Success Metrics

### 12.1 Adoption Metrics

- Percentage of sessions using enhanced methodologies
- Methodology selection accuracy (user satisfaction)
- Planning mode adoption rate
- Spec-driven development usage

### 12.2 Quality Metrics

- Task completion rate (by methodology)
- Error rate (by methodology)
- Validation failure rate
- User-reported issues

### 12.3 Performance Metrics

- Response time (by methodology)
- Token usage (with vs without optimization)
- Cost efficiency (by methodology)
- Context window utilization

### 12.4 User Satisfaction Metrics

- User satisfaction scores
- Methodology helpfulness ratings
- UI usability scores
- Feature request frequency

---

## 13. Future Enhancements

### 13.1 Advanced Features

- **Machine Learning for Routing:** Train models to predict optimal methodology
- **Dynamic Spec Generation:** Auto-generate specs from requirements
- **Cross-Session Learning:** Learn from user methodology preferences
- **Predictive Context Loading:** Anticipate context needs

### 13.2 Integrations

- **External Spec Tools:** Integration with spec management platforms
- **CI/CD Integration:** Spec validation in CI pipelines
- **Project Management:** Sync specs with project management tools
- **Documentation:** Auto-generate documentation from specs

### 13.3 Research Opportunities

- **Methodology Effectiveness Studies:** Measure real-world impact
- **Model Capability Benchmarking:** Continuous model assessment
- **User Behavior Analysis:** Understand methodology preferences
- **Cost-Benefit Analysis:** Quantify methodology tradeoffs

---

## 14. Conclusion

This architecture design provides a comprehensive foundation for implementing AI methodology enhancements in the opencode-harness extension. The design prioritizes:

1. **Model-Capability Awareness:** All decisions consider model intelligence and capabilities
2. **Hybrid Methodology Approach:** Dynamic routing based on task characteristics
3. **Lower-Intelligence Support:** Enhanced prompting and planning modes
4. **Deterministic Execution:** Schema validation and execution separation
5. **Frontend-Backend Parity:** UI components expose methodology features
6. **Incremental Adoption:** Phased implementation with backward compatibility

The architecture builds on existing components (`ModelSkillRegistry`, `SessionManager`, `PromptManager`, etc.) while adding new services (`TaskAnalyzer`, `MethodologyRouter`, `SpecService`, etc.) to enable intelligent methodology selection and execution.

The next phase will focus on creating a detailed implementation plan based on this architecture design.
