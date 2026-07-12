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
  MethodologyId,
  ModelTier,
  AuditEntry,
  ClassifiedError,
  ErrorClass,
  MethodologySelection,
} from './types.js';
import { ModelProfileRegistry } from './ModelProfileRegistry.js';
import { QualityEvaluator } from './QualityEvaluator.js';

export { QualityEvaluator } from './QualityEvaluator.js';

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

const TIER_RANK: Record<ModelTier, number> = { C: 0, B: 1, A: 2, S: 3 };

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

// ─── Advisory Result (no model calls) ────────────────────────────────────────

export interface AdvisoryResult {
  recommendedModel: string;
  recommendedTier: ModelTier;
  reasoning: string;
  fallbackChain: Array<{ modelId: string; tier: ModelTier; reason: string }>;
  estimatedCostPer1kTokens: number;
}

// ─── Cascade Router ─────────────────────────────────────────────────────────

export class CascadeRouter {
  private config: CascadeRouterConfig;
  private executor: ModelExecutor | null;
  private evaluator: QualityEvaluator;
  private auditLog: AuditEntry[] = [];
  private registry: ModelProfileRegistry;

  constructor(
    config: Partial<CascadeRouterConfig>,
    executor?: ModelExecutor
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.executor = executor ?? null;
    this.evaluator = new QualityEvaluator();
    this.registry = new ModelProfileRegistry();
  }

  /**
   * Advisory-only model recommendation — no model calls made.
   * Returns the best model for the task based on capabilities and cost,
   * along with a fallback chain for the CLI to try if quality is insufficient.
   */
  recommendModel(
    task: TaskClassification,
    methodology: MethodologyId,
    selection: MethodologySelection,
    modelProfiles: ModelProfile[],
    modelTiers: Record<ModelTier, string[]>
  ): AdvisoryResult {
    const chain = this.buildChain(task, modelProfiles, modelTiers);
    const startTier = selection.recommendedTier;
    const startRank = TIER_RANK[startTier] ?? 0;
    const eligibleChain = chain.filter((entry) => TIER_RANK[entry.tier] >= startRank);

    if (eligibleChain.length === 0) {
      return {
        recommendedModel: '',
        recommendedTier: startTier,
        reasoning: `Task "${task.type}" with methodology "${methodology}" suggests tier ${startTier}. No matching models available in this or higher tiers.`,
        fallbackChain: [],
        estimatedCostPer1kTokens: 0,
      };
    }

    let chosen = eligibleChain[0]!;

    if (task.constraints.speedPreferred) {
      let bestSpeed = -1;
      for (const entry of eligibleChain) {
        const profile = modelProfiles.find(p => p.id === entry.modelId)
          ?? this.registry.resolveOrInfer(entry.modelId);
        if (profile && profile.performance.tokensPerSecond > bestSpeed) {
          bestSpeed = profile.performance.tokensPerSecond;
          chosen = entry;
        }
      }
    }

    const profile = modelProfiles.find(p => p.id === chosen.modelId)
      ?? this.registry.resolveOrInfer(chosen.modelId);
    const estimatedCostPer1kTokens = profile
      ? (profile.performance.costPerInputToken + profile.performance.costPerOutputToken) * 1000
      : 0;

    let reasoning = `Task "${task.type}" recommends tier ${startTier}. Selected ${chosen.modelId} (tier ${chosen.tier}) based on`;
    reasoning += task.constraints.speedPreferred ? ' maximum throughput.' : ' capability matching.';
    if (task.modalities.needsVision) {
      reasoning += ' Vision capability required — models without vision excluded.';
    }

    this.logAudit({
      traceId: this.generateTraceId(),
      timestamp: new Date(),
      intent: `${task.type}:${methodology}`,
      methodology,
      model: chosen.modelId,
      planHash: '',
      status: 'success',
      quality: 0,
      cost: 0,
      tokens: 0,
      duration: 0,
      escalations: 0,
    });

    return {
      recommendedModel: chosen.modelId,
      recommendedTier: chosen.tier,
      reasoning,
      fallbackChain: eligibleChain.slice(0, this.config.maxEscalations + 1),
      estimatedCostPer1kTokens,
    };
  }

  private buildChain(
    task: TaskClassification,
    modelProfiles: ModelProfile[],
    modelTiers: Record<ModelTier, string[]>
  ): Array<{ modelId: string; tier: ModelTier; reason: string }> {
    const tierOrder: ModelTier[] = ['C', 'B', 'A', 'S'];
    const chain: Array<{ modelId: string; tier: ModelTier; reason: string }> = [];

    for (const tier of tierOrder) {
      const models = modelTiers[tier] || [];
      for (const modelId of models) {
        // Try strict profile match first, then fall back to inferred
        const profile = modelProfiles.find(p => p.id === modelId)
          ?? this.registry.resolveOrInfer(modelId);
        if (!profile) continue;
        if (task.modalities.needsVision && profile.capabilities.vision < 0.5) continue;
        const isInferred = !modelProfiles.some(p => p.id === modelId);
        const label = isInferred ? ' (inferred)' : '';
        chain.push({
          modelId,
          tier,
          reason: `Tier ${profile.tier}${label} — ${profile.name} (capability: ${((profile.capabilities.reasoning + profile.capabilities.coding) / 2 * 100).toFixed(1)}%)`,
        });
      }
    }

    return chain;
  }

  // ─── Route (requires ModelExecutor) ────────────────────────────────────────

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
    if (!this.executor) {
      throw new Error('CascadeRouter.route() requires a ModelExecutor. Use recommendModel() for advisory mode.');
    }
    const traceId = this.generateTraceId();
    const startTime = Date.now();

    // 1. Build escalation chain from model tiers
    const escalationChain = this.buildChain(task, modelProfiles, modelTiers).map(e => e.modelId);

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
  // ─── Audit Logging ──────────────────────────────────────────────────────

  private static readonly MAX_AUDIT_ENTRIES = 1000;

  private logAudit(entry: AuditEntry): void {
    this.auditLog.push(entry);
    if (this.auditLog.length > CascadeRouter.MAX_AUDIT_ENTRIES) {
      this.auditLog = this.auditLog.slice(-CascadeRouter.MAX_AUDIT_ENTRIES);
    }
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
