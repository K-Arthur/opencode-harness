/**
 * Methodology Orchestrator — the central coordinator that ties together
 * task classification, methodology selection, cascade routing, prompt
 * engineering, and quality gates.
 *
 * Supports two modes:
 * 1. Advisory — recommends model/methodology without making model calls
 * 2. Full cascade — (requires ModelExecutor) routes through models with quality eval
 *
 * The advisory mode is the default for the VS Code extension, where the
 * opencode CLI handles actual model execution.
 */

import {
  MethodologyConfig,
  DEFAULT_CONFIG,
  TaskClassification,
  MethodologySelection,
  ModelProfile,
  AuditEntry,
  MethodologyId,
  ModelTier,
} from './types.js';
import { TaskClassifier } from './TaskClassifier.js';
import { MethodologyCatalog } from './MethodologyCatalog.js';
import { CascadeRouter, type AdvisoryResult, type ModelExecutor } from './CascadeRouter.js';
import { ModelProfileRegistry } from './ModelProfileRegistry.js';

// ─── Orchestrator ───────────────────────────────────────────────────────────

export interface OrchestratorOptions {
  config?: Partial<MethodologyConfig>;
  modelExecutor?: ModelExecutor;
  modelProfiles?: ModelProfile[];
}

export interface AdvisoryOrchestrationResult {
  methodology: MethodologySelection;
  advisory: AdvisoryResult;
  classification: TaskClassification;
  auditTrail: AuditEntry[];
}

export class MethodologyOrchestrator {
  private config: MethodologyConfig;
  private classifier: TaskClassifier;
  private catalog: MethodologyCatalog;
  private router: CascadeRouter;
  private registry: ModelProfileRegistry;
  private modelProfiles: ModelProfile[];

  constructor(options: OrchestratorOptions = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.classifier = new TaskClassifier();
    this.catalog = new MethodologyCatalog();
    this.registry = new ModelProfileRegistry();
    this.modelProfiles = options.modelProfiles ?? this.registry.getAllProfiles();

    this.router = new CascadeRouter(
      {
        maxEscalations: this.config.cascade.maxEscalations,
        qualityThresholds: this.config.cascade.qualityThresholds,
        maxTokensPerRequest: 50000,
        maxCostPerRequest: 5.0,
        fallbackChain: [],
      },
      options.modelExecutor
    );
  }

  /**
   * Advisory processing — classifies task, selects methodology,
   * recommends best model. No model calls made.
   */
  advise(
    query: string,
    options: {
      hasImageAttachment?: boolean;
      selectedCode?: string;
      openFiles?: string[];
    } = {}
  ): AdvisoryOrchestrationResult {
    const classification = this.classifier.classify(query, options);
    const methodology = this.catalog.select(classification);

    const tierMap = this.mergeTierMaps();
    const advisory = this.router.recommendModel(
      classification,
      methodology.methodology,
      methodology,
      this.modelProfiles,
      tierMap
    );

    return {
      methodology,
      advisory,
      classification,
      auditTrail: this.router.getAuditLog(),
    };
  }

  getCatalog(): MethodologyCatalog {
    return this.catalog;
  }

  getRegistry(): ModelProfileRegistry {
    return this.registry;
  }

  updateModelProfiles(profiles: ModelProfile[]): void {
    this.modelProfiles = profiles;
  }

  updateConfig(config: Partial<MethodologyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): MethodologyConfig {
    return { ...this.config };
  }

  private mergeTierMaps(): Record<ModelTier, string[]> {
    const staticMap = this.registry.buildTierMap();
    const configMap = this.config.modelTiers;
    return {
      S: [...new Set([...(configMap.S ?? []), ...staticMap.S])],
      A: [...new Set([...(configMap.A ?? []), ...staticMap.A])],
      B: [...new Set([...(configMap.B ?? []), ...staticMap.B])],
      C: [...new Set([...(configMap.C ?? []), ...staticMap.C])],
    };
  }
}
