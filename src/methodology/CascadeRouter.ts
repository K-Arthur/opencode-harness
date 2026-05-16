/**
 * Cascade Router — routes tasks to models using cascade escalation.
 *
 * Starts with the cheapest capable model, evaluates response quality,
 * and escalates to more capable models only when quality is insufficient.
 *
 * Based on research from RouteLLM (ICLR 2025), Cascade Routing (ICML 2025),
 * and Microsoft BEST-Route (ICLR 2024).
 */

import {
  CascadeRouterConfig,
  ModelProfile,
  RouterResult,
  TaskClassification,
  TaskType,
  QualityMetrics,
  MethodologyId,
  PromptStrategy,
  ModelTier,
  AuditEntry,
  ClassifiedError,
  ErrorClass,
} from './types.js';

// ─── Default Configuration ──────────────────────────────────────────────────

const DEFAULT_CONFIG: CascadeRouterConfig = {
  qualityThresholds: {
    generate: 0.7,
    review: 0.8,
    debug: 0.75,
    architect: 0.85,
    'quick-fix': 0.6,
    explain: 0.65,
    refactor: 0.7,
    document: 0.6,
    test: 0.7,
    'ui-from-image': 0.8,
  },
  maxEscalations: 2,
  maxTokensPerRequest: 50000,
  maxCostPerRequest: 5.0, // $5 max per request
  fallbackChain: [], // Populated at runtime from model profiles
};

// ─── Quality Evaluator ──────────────────────────────────────────────────────

/**
 * Lightweight quality evaluation (not LLM-as-judge).
 * Uses structural and task-specific metrics.
 */
export class QualityEvaluator {
  /**
   * Evaluate the quality of a model response.
   * Returns a score between 0.0 and 1.0.
   */
  evaluate(
    response: string,
    task: TaskClassification
  ): QualityMetrics {
    const schemaCompliance = this.checkSchemaCompliance(response);
    const completeness = this.checkCompleteness(response, task);
    const specificity = this.checkSpecificity(response);
    const consistencyScore = this.checkConsistency(response);

    return {
      schemaCompliance,
      completeness,
      specificity,
      consistencyScore,
    };
  }

  /**
   * Calculate overall quality score from metrics.
   */
  overallScore(metrics: QualityMetrics): number {
    const weights = {
      schemaCompliance: 0.3,
      completeness: 0.25,
      specificity: 0.25,
      consistencyScore: 0.2,
    };

    return (
      (metrics.schemaCompliance ? 1 : 0) * weights.schemaCompliance +
      metrics.completeness * weights.completeness +
      metrics.specificity * weights.specificity +
      metrics.consistencyScore * weights.consistencyScore
    );
  }

  private checkSchemaCompliance(response: string): boolean {
    // Check if response looks like valid JSON when schema is expected
    const trimmed = response.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        JSON.parse(trimmed);
        return true;
      } catch {
        return false;
      }
    }
    // Non-JSON responses are considered compliant (no schema expected)
    return true;
  }

  private checkCompleteness(
    response: string,
    task: TaskClassification
  ): number {
    // Heuristic: longer responses for complex tasks are more complete
    const expectedLength = this.estimateExpectedLength(task);
    const actualLength = response.length;

    if (actualLength >= expectedLength) return 1.0;
    return actualLength / expectedLength;
  }

  private estimateExpectedLength(task: TaskClassification): number {
    const base = 200; // minimum response length
    const complexityMultiplier =
      (task.complexity.depth + task.complexity.width) / 2;

    switch (task.type) {
      case 'quick-fix':
        return base * 2;
      case 'explain':
        return base * 5;
      case 'generate':
        return base * 10 * (1 + complexityMultiplier);
      case 'review':
        return base * 8;
      case 'architect':
        return base * 15 * (1 + complexityMultiplier);
      case 'debug':
        return base * 6 * (1 + complexityMultiplier);
      default:
        return base * 5;
    }
  }

  private checkSpecificity(response: string): number {
    // Check for vague language
    const vaguePatterns = [
      /\b(maybe|perhaps|possibly|might|could|should|try)\b/gi,
      /\b(something|somehow|somewhat)\b/gi,
      /\b(it depends|varies|hard to say)\b/gi,
    ];

    let vagueCount = 0;
    for (const pattern of vaguePatterns) {
      const matches = response.match(pattern);
      if (matches) vagueCount += matches.length;
    }

    const totalWords = response.split(/\s+/).length;
    if (totalWords === 0) return 0;

    const vagueRatio = vagueCount / totalWords;
    return Math.max(0, 1 - vagueRatio * 10); // Penalize heavily for vague language
  }

  private checkConsistency(response: string): number {
    // Check for self-contradiction (simple heuristic)
    const lowerResponse = response.toLowerCase();

    // Detect contradictory statements
    const contradictions = [
      { a: 'should', b: 'should not' },
      { a: 'must', b: 'must not' },
      { a: 'always', b: 'never' },
      { a: 'is required', b: 'is optional' },
    ];

    let contradictionCount = 0;
    for (const { a, b } of contradictions) {
      if (lowerResponse.includes(a) && lowerResponse.includes(b)) {
        contradictionCount++;
      }
    }

    return Math.max(0, 1 - contradictionCount * 0.25);
  }
}

// ─── Cascade Router ─────────────────────────────────────────────────────────

export interface ModelExecutor {
  /**
   * Execute a prompt against a specific model.
   * Returns the response, token count, and cost.
   */
  execute(
    modelId: string,
    systemPrompt: string,
    userPrompt: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<{
    response: string;
    tokens: number;
    cost: number;
  }>;
}

export class CascadeRouter {
  private config: CascadeRouterConfig;
  private executor: ModelExecutor;
  private evaluator: QualityEvaluator;
  private auditLog: AuditEntry[] = [];

  constructor(
    config: Partial<CascadeRouterConfig>,
    executor: ModelExecutor
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.executor = executor;
    this.evaluator = new QualityEvaluator();
  }

  /**
   * Route a task through the cascade routing pipeline.
   *
   * 1. Select starting model based on recommended tier
   * 2. Execute with model
   * 3. Evaluate quality
   * 4. If quality meets threshold, return
   * 5. Otherwise, escalate to next model up
   * 6. Repeat until quality met or budget exhausted
   */
  async route(
    task: TaskClassification,
    methodology: MethodologyId,
    systemPrompt: string,
    userPrompt: string,
    modelProfiles: ModelProfile[],
    modelTiers: Record<ModelTier, string[]>
  ): Promise<RouterResult> {
    const traceId = this.generateTraceId();
    const startTime = Date.now();

    // 1. Build escalation chain from model tiers
    const escalationChain = this.buildEscalationChain(
      task,
      methodology,
      modelProfiles,
      modelTiers
    );

    if (escalationChain.length === 0) {
      throw this.classifyError(
        'routing',
        'No models available in escalation chain',
        true,
        'Configure at least one model in settings.'
      );
    }

    let bestResult: RouterResult | null = null;
    let totalCost = 0;
    let totalTokens = 0;

    // 2. Execute through escalation chain
    for (let attempt = 0; attempt < escalationChain.length; attempt++) {
      const modelId = escalationChain[attempt]!;

      // Check budget
      if (totalCost >= this.config.maxCostPerRequest) {
        if (bestResult) {
          bestResult.warning = 'Budget exhausted, returning best result';
          return bestResult;
        }
        throw this.classifyError(
          'routing',
          `Budget exceeded ($${this.config.maxCostPerRequest})`,
          false,
          'Increase budget limit or reduce task complexity.'
        );
      }

      if (totalTokens >= this.config.maxTokensPerRequest) {
        if (bestResult) {
          bestResult.warning = 'Token budget exhausted, returning best result';
          return bestResult;
        }
        throw this.classifyError(
          'routing',
          `Token budget exceeded (${this.config.maxTokensPerRequest})`,
          false,
          'Increase token budget or simplify the task.'
        );
      }

      try {
        // Execute with model
        const execution = await this.executor.execute(
          modelId,
          systemPrompt,
          userPrompt
        );

        totalCost += execution.cost;
        totalTokens += execution.tokens;

        // Evaluate quality
        const qualityMetrics = this.evaluator.evaluate(execution.response, task);
        const quality = this.evaluator.overallScore(qualityMetrics);

        const result: RouterResult = {
          model: modelId,
          response: execution.response,
          quality,
          escalations: attempt,
          cost: execution.cost,
          tokens: execution.tokens,
        };

        // Check if quality meets threshold
        const threshold =
          this.config.qualityThresholds[task.type] ?? 0.7;

        if (quality >= threshold) {
          // Success — return immediately
          this.logAudit({
            traceId,
            timestamp: new Date(),
            intent: userPrompt.slice(0, 100),
            methodology,
            model: modelId,
            planHash: '',
            status: 'success',
            quality,
            cost: execution.cost,
            tokens: execution.tokens,
            duration: Date.now() - startTime,
            escalations: attempt,
          });

          return result;
        }

        // Quality insufficient — keep as best so far and escalate
        if (!bestResult || quality > bestResult.quality) {
          bestResult = result;
        }
      } catch (error) {
        // Model execution failed — try next model
        console.warn(`Model ${modelId} failed:`, error);
        continue;
      }
    }

    // All models exhausted — return best result with warning
    if (bestResult) {
      bestResult.warning =
        `Quality threshold not met after ${escalationChain.length} attempts. ` +
        `Best quality: ${(bestResult.quality * 100).toFixed(0)}%`;

      this.logAudit({
        traceId,
        timestamp: new Date(),
        intent: userPrompt.slice(0, 100),
        methodology,
        model: bestResult.model,
        planHash: '',
        status: 'degraded',
        quality: bestResult.quality,
        cost: totalCost,
        tokens: totalTokens,
        duration: Date.now() - startTime,
        escalations: escalationChain.length - 1,
        error: {
          class: 'quality',
          message: 'Quality threshold not met',
          recoverable: true,
          recoveryAction: 'Try rephrasing the task or increasing quality threshold',
          userMessage: 'The response may not fully meet quality expectations. Consider rephrasing your request.',
        },
      });

      return bestResult;
    }

    // All models failed
    throw this.classifyError(
      'model',
      'All models in escalation chain failed',
      false,
      'Check model configuration and API connectivity.'
    );
  }

  /**
   * Build the escalation chain: ordered list of models to try.
   * Starts with the recommended tier, escalates upward.
   */
  private buildEscalationChain(
    task: TaskClassification,
    methodology: MethodologyId,
    modelProfiles: ModelProfile[],
    modelTiers: Record<ModelTier, string[]>
  ): string[] {
    // Get models for each tier
    const tierOrder: ModelTier[] = ['B', 'A', 'S'];
    const chain: string[] = [];

    for (const tier of tierOrder) {
      const models = modelTiers[tier] || [];
      for (const modelId of models) {
        // Check if model is available (has a profile)
        const profile = modelProfiles.find((p) => p.id === modelId);
        if (!profile) continue;

        // Check if model has required capabilities for the task
        if (task.modalities.needsVision && profile.capabilities.vision < 0.5) {
          continue; // Skip models without vision capability
        }

        chain.push(modelId);
      }
    }

    return chain;
  }

  // ─── Audit Logging ──────────────────────────────────────────────────────

  private logAudit(entry: AuditEntry): void {
    this.auditLog.push(entry);
    // In production, send to OpenTelemetry or persistent storage
  }

  getAuditLog(): AuditEntry[] {
    return [...this.auditLog];
  }

  // ─── Error Classification ───────────────────────────────────────────────

  private classifyError(
    errorClass: ErrorClass,
    message: string,
    recoverable: boolean,
    userMessage: string
  ): Error & ClassifiedError {
    const error = new Error(message) as Error & ClassifiedError;
    error.class = errorClass;
    error.message = message;
    error.recoverable = recoverable;
    error.userMessage = userMessage;
    return error;
  }

  private generateTraceId(): string {
    return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
