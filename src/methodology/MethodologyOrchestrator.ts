/**
 * Methodology Orchestrator — the central coordinator that ties together
 * task classification, methodology selection, cascade routing, prompt
 * engineering, and quality gates.
 *
 * This is the main entry point for the methodology enhancement system.
 */

import {
  MethodologyConfig,
  DEFAULT_CONFIG,
  TaskClassification,
  MethodologySelection,
  ModelProfile,
  RouterResult,
  AuditEntry,
  ClassifiedError,
  MethodologyId,
  ModelTier,
} from './types.js';
import { TaskClassifier } from './TaskClassifier.js';
import { MethodologyCatalog } from './MethodologyCatalog.js';
import { CascadeRouter, ModelExecutor } from './CascadeRouter.js';
import { SpecService, type Spec } from './SpecService.js';

// ─── Orchestrator ───────────────────────────────────────────────────────────

export interface OrchestratorOptions {
  config?: Partial<MethodologyConfig>;
  modelExecutor: ModelExecutor;
  modelProfiles: ModelProfile[];
  specService?: SpecService;
}

export interface OrchestrationResult {
  methodology: MethodologySelection;
  routing: RouterResult;
  classification: TaskClassification;
  auditTrail: AuditEntry[];
}

export class MethodologyOrchestrator {
  private config: MethodologyConfig;
  private classifier: TaskClassifier;
  private catalog: MethodologyCatalog;
  private router: CascadeRouter;
  private modelProfiles: ModelProfile[];

  constructor(options: OrchestratorOptions) {
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.classifier = new TaskClassifier();
    this.catalog = new MethodologyCatalog();
    this.modelProfiles = options.modelProfiles;

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
   * Process a user request through the full methodology pipeline:
   *
   * 1. Classify the task
   * 2. Select methodology
   * 3. Generate methodology-specific prompt
   * 4. Route through cascade router
   * 5. Return result with audit trail
   */
  async process(
    query: string,
    options: {
      hasImageAttachment?: boolean;
      selectedCode?: string;
      openFiles?: string[];
    } = {}
  ): Promise<OrchestrationResult> {
    // Step 1: Classify the task
    const classification = this.classifier.classify(query, options);

    // Step 2: Select methodology
    const methodology = this.catalog.select(classification);

    // Step 3: Generate prompt
    const template = this.catalog.getPromptTemplate(methodology.promptStrategy);
    const systemPrompt = template.systemPrompt;
    const userPrompt = template.userPromptTemplate.replace('{{task}}', query);

    // Step 4: Route through cascade router
    const routing = await this.router.route(
      classification,
      methodology.methodology,
      systemPrompt,
      userPrompt,
      this.modelProfiles,
      this.config.modelTiers
    );

    // Step 5: Return result
    return {
      methodology,
      routing,
      classification,
      auditTrail: this.router.getAuditLog(),
    };
  }

  /**
   * Update model profiles at runtime (e.g., from empirical data).
   */
  updateModelProfiles(profiles: ModelProfile[]): void {
    this.modelProfiles = profiles;
  }

  /**
   * Update configuration at runtime.
   */
  updateConfig(config: Partial<MethodologyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current configuration.
   */
  getConfig(): MethodologyConfig {
    return { ...this.config };
  }
}
