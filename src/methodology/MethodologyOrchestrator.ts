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
  config?: MethodologyConfigPatch;
  modelExecutor?: ModelExecutor;
  modelProfiles?: ModelProfile[];
}

type MethodologyConfigPatch = Partial<{
  enabled: MethodologyConfig['enabled'];
  defaultMethodology: MethodologyConfig['defaultMethodology'];
  modelTiers: Partial<MethodologyConfig['modelTiers']>;
  cascade: Partial<MethodologyConfig['cascade']>;
  prompting: Partial<MethodologyConfig['prompting']>;
  qualityGates: {
    enabled?: MethodologyConfig['qualityGates']['enabled'];
    gates?: Partial<MethodologyConfig['qualityGates']['gates']>;
  };
  protocols: {
    mcp?: Partial<MethodologyConfig['protocols']['mcp']>;
    a2a?: Partial<MethodologyConfig['protocols']['a2a']>;
    agui?: Partial<MethodologyConfig['protocols']['agui']>;
  };
  multimodal: Partial<MethodologyConfig['multimodal']>;
  refactoring: Partial<MethodologyConfig['refactoring']>;
}>;

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
  private modelExecutor?: ModelExecutor;

  constructor(options: OrchestratorOptions = {}) {
    this.config = mergeMethodologyConfig(DEFAULT_CONFIG, options.config);
    this.classifier = new TaskClassifier();
    this.catalog = new MethodologyCatalog();
    this.registry = new ModelProfileRegistry();
    this.modelProfiles = options.modelProfiles ?? this.registry.getAllProfiles();
    this.modelExecutor = options.modelExecutor;

    this.router = this.createRouter();
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

  updateConfig(config: MethodologyConfigPatch): void {
    this.config = mergeMethodologyConfig(this.config, config);
    this.router = this.createRouter();
  }

  getConfig(): MethodologyConfig {
    return mergeMethodologyConfig(this.config, undefined);
  }

  private createRouter(): CascadeRouter {
    return new CascadeRouter(
      {
        maxEscalations: this.config.cascade.maxEscalations,
        qualityThresholds: this.config.cascade.qualityThresholds,
      },
      this.modelExecutor
    );
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

function mergeMethodologyConfig(
  base: MethodologyConfig,
  patch: MethodologyConfigPatch | undefined
): MethodologyConfig {
  if (!patch) {
    return {
      ...base,
      modelTiers: { ...base.modelTiers },
      cascade: { ...base.cascade, qualityThresholds: { ...base.cascade.qualityThresholds } },
      prompting: { ...base.prompting },
      qualityGates: { ...base.qualityGates, gates: { ...base.qualityGates.gates } },
      protocols: {
        mcp: { ...base.protocols.mcp, servers: [...base.protocols.mcp.servers] },
        a2a: { ...base.protocols.a2a, agents: [...base.protocols.a2a.agents] },
        agui: { ...base.protocols.agui },
      },
      multimodal: { ...base.multimodal },
      refactoring: { ...base.refactoring },
    };
  }

  return {
    ...base,
    ...patch,
    modelTiers: { ...base.modelTiers, ...patch.modelTiers },
    cascade: {
      ...base.cascade,
      ...patch.cascade,
      qualityThresholds: {
        ...base.cascade.qualityThresholds,
        ...patch.cascade?.qualityThresholds,
      },
    },
    prompting: { ...base.prompting, ...patch.prompting },
    qualityGates: {
      ...base.qualityGates,
      ...patch.qualityGates,
      gates: { ...base.qualityGates.gates, ...patch.qualityGates?.gates },
    },
    protocols: {
      mcp: { ...base.protocols.mcp, ...patch.protocols?.mcp },
      a2a: { ...base.protocols.a2a, ...patch.protocols?.a2a },
      agui: { ...base.protocols.agui, ...patch.protocols?.agui },
    },
    multimodal: { ...base.multimodal, ...patch.multimodal },
    refactoring: { ...base.refactoring, ...patch.refactoring },
  };
}
