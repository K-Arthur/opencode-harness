# Integration Design - AI Methodology Enhancements

## Overview
Design for integrating new AI methodology enhancement features with existing infrastructure to avoid conflicts and redundancies.

## Integration Strategy

### Principle: Enhance Existing Components, Don't Duplicate

The existing infrastructure is comprehensive. New features should be implemented as enhancements to existing components rather than standalone systems.

## Feature 1: Spec-Driven Development

### Current State
- No existing spec management system
- SchemaValidator exists for validation
- TaskDecomposer exists for task breakdown
- ContextEngine exists for context gathering

### Integration Design

#### 1.1 SpecService (New Component)
**Location:** `src/methodology/SpecService.ts`

**Dependencies:**
- SchemaValidator for spec validation
- TaskDecomposer for task breakdown from specs
- ContextEngine for context gathering during spec generation

**Integration Points:**
- MethodologyOrchestrator: Add spec-aware methodology selection
- SessionManager: Add spec-driven prompt generation
- PromptEngine: Add spec template variables

**API Design:**
```typescript
class SpecService {
  // CRUD operations
  async createSpec(projectId: string, elements: SpecElements): Promise<Spec>
  async getSpec(specId: string): Promise<Spec | null>
  async updateSpec(specId: string, updates: Partial<SpecElements>): Promise<Spec>
  async deleteSpec(specId: string): Promise<void>
  
  // Validation (uses SchemaValidator)
  validateSpec(spec: Spec): ValidationResult
  
  // Task decomposition (uses TaskDecomposer)
  decomposeTasks(spec: Spec): TaskBreakdown[]
  
  // Context gathering for spec generation (uses ContextEngine)
  gatherContextForSpec(projectId: string): ContextPackage
}
```

#### 1.2 Spec Types
**Location:** `src/methodology/types.ts` (extend existing types)

```typescript
export interface Spec {
  id: string;
  projectId: string;
  version: string;
  elements: SpecElements;
  status: 'draft' | 'approved' | 'deprecated';
  createdAt: Date;
  updatedAt: Date;
}

export interface SpecElements {
  outcomes: string[];
  scope: { inScope: string[]; outOfScope: string[] };
  constraints: string[];
  decisions: Record<string, string>;
  taskBreakdown: TaskBreakdown[];
  verificationCriteria: VerificationCriteria[];
}
```

#### 1.3 Integration with MethodologyOrchestrator
**Modification:** Extend MethodologyOrchestrator to support spec-aware methodology selection

```typescript
class MethodologyOrchestrator {
  private specService?: SpecService;
  
  constructor(options: OrchestratorOptions) {
    // ... existing initialization
    this.specService = options.specService;
  }
  
  async process(query: string, options: ProcessOptions): Promise<OrchestrationResult> {
    // Check if spec exists for current project
    const spec = this.specService?.getLatestSpec(options.projectId);
    
    if (spec) {
      // Use spec-aware methodology selection
      const classification = this.classifier.classify(query, options);
      const methodology = this.catalog.selectWithSpec(classification, spec);
      // ... rest of pipeline
    } else {
      // Use existing methodology selection
      // ... existing pipeline
    }
  }
}
```

## Feature 2: Adversarial Agent Patterns

### Current State
- SessionManager has agent coordination via AgentPartInput
- SessionManager has sendPrompt with agent support
- SessionManager has listAgents for agent discovery
- No explicit adversarial pattern implementation

### Integration Design

#### 2.1 AdversarialWorkflow (New Component)
**Location:** `src/methodology/AdversarialWorkflow.ts`

**Dependencies:**
- SessionManager for agent coordination
- ConfidenceScorer for adversarial pattern detection
- SchemaValidator for result validation

**Integration Points:**
- SessionManager: Add workflow orchestration layer
- SkillTriggerEngine: Add adversarial trigger rules

**API Design:**
```typescript
class AdversarialWorkflow {
  constructor(private sessionManager: SessionManager) {}
  
  async coordinateAdversarial(
    sessionId: string,
    implementors: string[],
    verifier: string,
    context: AgentContext
  ): Promise<CoordinationResult> {
    // Phase 1: Coordinator decomposes task
    const coordinatorResult = await this.sessionManager.sendPrompt(
      sessionId,
      [{ agent: 'coordinator', content: context.input }]
    );
    
    // Phase 2: Parallel implementor execution
    const implementorResults = await Promise.all(
      implementors.map(implId => 
        this.sessionManager.sendPrompt(sessionId, [
          { agent: implId, content: context.input }
        ])
      )
    );
    
    // Phase 3: Verifier validates results
    const verifierResult = await this.sessionManager.sendPrompt(
      sessionId,
      [{ agent: verifier, content: this.formatVerificationContext(implementorResults) }]
    );
    
    return this.evaluateAdversarialResult(verifierResult);
  }
}
```

#### 2.2 Integration with SessionManager
**Modification:** Add workflow orchestration methods to SessionManager

```typescript
class SessionManager {
  // ... existing methods
  
  async createWorkflow(workflowId: string, agents: string[]): Promise<void> {
    // Initialize workflow state
  }
  
  async handoff(fromAgent: string, toAgent: string, context: unknown): Promise<void> {
    // Implement handoff protocol using existing sendPrompt
  }
  
  async getWorkflowState(workflowId: string): Promise<WorkflowState> {
    // Return current workflow state
  }
}
```

#### 2.3 Integration with ConfidenceScorer
**Modification:** Add adversarial pattern detection

```typescript
class ConfidenceScorer {
  // ... existing methods
  
  detectAdversarialPattern(result: unknown, verification: unknown): {
    hasAdversary: boolean;
    confidence: number;
    reasoning: string;
  } {
    // Analyze if verification indicates adversarial pattern
    // e.g., implementor vs verifier disagreement
  }
}
```

## Feature 3: Advanced RAG (Retrieval-Augmented Generation)

### Current State
- ContextEngine does token-based context selection
- ContextEngine does not have semantic retrieval
- ContextMonitor tracks usage but not retrieval metrics

### Integration Design

#### 3.1 Enhance ContextEngine
**Modification:** Add semantic retrieval capabilities to ContextEngine

**New Dependencies:**
- Embedding provider interface (optional, can use simple TF-IDF fallback)

**API Design:**
```typescript
class ContextEngine {
  // ... existing methods
  
  async gatherContextWithRAG(
    config: GatherConfig & { 
      useSemanticSearch?: boolean;
      embeddingProvider?: EmbeddingProvider;
    }
  ): Promise<ContextPackage> {
    if (config.useSemanticSearch && config.embeddingProvider) {
      return this.gatherContextSemantic(config);
    }
    return this.gatherContext(config);
  }
  
  private async gatherContextSemantic(
    config: GatherConfig & { embeddingProvider: EmbeddingProvider }
  ): Promise<ContextPackage> {
    // Generate embedding for query
    const queryEmbedding = await config.embeddingProvider.embed(config.query || '');
    
    // Generate embeddings for context items
    const items = await this.gatherContextItems(config);
    const scoredItems = await this.scoreItemsBySimilarity(items, queryEmbedding, config.embeddingProvider);
    
    // Select top-K items
    const selectedItems = this.selectTopK(scoredItems, config.topK || 10);
    
    return this.buildContextPackage(selectedItems);
  }
}
```

#### 3.2 Embedding Provider Interface
**Location:** `src/context/EmbeddingProvider.ts`

```typescript
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  similarity(a: number[], b: number[]): number;
}

// Simple TF-IDF fallback (no external dependencies)
export class SimpleEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    // TF-IDF-like embedding
  }
  
  similarity(a: number[], b: number[]): number {
    // Cosine similarity
  }
}
```

#### 3.3 Integration with ContextMonitor
**Modification:** Add retrieval metrics tracking

```typescript
class ContextMonitor {
  // ... existing methods
  
  trackRetrievalMetrics(metrics: {
    retrievalStrategy: 'token-based' | 'semantic' | 'hybrid';
    retrievalCount: number;
    similarityScores: number[];
    compressionRatio: number;
  }): void {
    // Track retrieval-specific metrics
  }
}
```

## Implementation Order

### Phase 1: Spec-Driven Development (Highest Priority)
1. Create SpecService with basic CRUD
2. Integrate with SchemaValidator for validation
3. Integrate with TaskDecomposer for task breakdown
4. Add spec-aware methodology selection to MethodologyOrchestrator
5. Add spec templates to PromptEngine

### Phase 2: Adversarial Agent Patterns
1. Create AdversarialWorkflow class
2. Add workflow orchestration to SessionManager
3. Add adversarial pattern detection to ConfidenceScorer
4. Add adversarial trigger rules to SkillTriggerEngine

### Phase 3: Advanced RAG
1. Create EmbeddingProvider interface and SimpleEmbeddingProvider
2. Add semantic search to ContextEngine
3. Add retrieval metrics to ContextMonitor
4. Integrate with PromptEngine for RAG-enhanced prompts

## Testing Strategy

### Unit Tests
- SpecService: CRUD operations, validation, task decomposition
- AdversarialWorkflow: Coordination logic, handoff protocols
- ContextEngine enhancements: Semantic retrieval accuracy

### Integration Tests
- SpecService integration with existing components
- AdversarialWorkflow integration with SessionManager
- ContextEngine RAG integration with ContextMonitor

### Visual Tests
- Spec editor UI (if implemented)
- Workflow visualization (if implemented)

## Configuration and Migration

### Configuration
Add to VS Code settings:
```json
{
  "opencode.specDrivenDevelopment": {
    "enabled": true,
    "autoGenerateSpecs": false,
    "specStorage": "workspace"
  },
  "opencode.adversarialAgents": {
    "enabled": true,
    "maxImplementors": 3,
    "verificationThreshold": 0.8
  },
  "opencode.advancedRAG": {
    "enabled": false,
    "embeddingProvider": "simple",
    "topK": 10
  }
}
```

### Migration
- No breaking changes to existing components
- New features are opt-in via configuration
- Existing functionality remains unchanged

## Conclusion

This integration design leverages the robust existing infrastructure by:
1. Adding SpecService as a new feature layer that uses existing components
2. Enhancing SessionManager for adversarial workflows rather than creating new coordination system
3. Extending ContextEngine with semantic retrieval rather than creating separate optimizer

This approach avoids duplication, reduces maintenance burden, and ensures consistency with existing patterns.
