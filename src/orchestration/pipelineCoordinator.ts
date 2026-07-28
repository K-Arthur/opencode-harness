/**
 * Pipeline Coordinator — sequential multi-model dispatch for the Orchestrated mode.
 *
 * The coordinator manages the full pipeline: classification → exploration →
 * planning → implementation → review → fix → synthesis. Each stage is
 * dispatched with the appropriate model, role-specific prompt, and structured
 * handoff to the next stage.
 *
 * The coordinator does NOT make model calls itself. It delegates to the
 * existing StreamCoordinator infrastructure via a dispatcher interface,
 * making it testable without real provider access.
 */

import type { AgentRole } from "./modelRouting";
import type { ModelCapabilities } from "../methodology/types";
import { getTemplateForRole, renderTemplate, stageToRole, type TemplateVars } from "./promptTemplates";
import type { WorkflowDefinition, StageDefinition, PipelineState, PipelineStageSnapshot, PipelineStageStatus, CostProfile, OrchestratedConfig } from "./types";
import { COST_PROFILES } from "./types";
import { PIPELINE_STAGE_LABELS, type PipelineStageId } from "./types";
import { resolveRoutedModel, type RoutedModelInput } from "./modelRouting";
import { isCapableForRole } from "./capabilityProfiles";

// ─── Dispatcher Interface ─────────────────────────────────────────────────

export interface StageDispatcher {
  /**
   * Execute a single prompt against a model and return the response.
   * Implementations wrap StreamCoordinator or a mock for testing.
   */
  executePrompt(params: {
    sessionId: string;
    model: string;
    role: string;
    systemPrompt: string;
    userPrompt: string;
    stageId: string;
    maxTokens?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<{
    response: string;
    tokensUsed: number;
    estimatedCost: number;
    durationMs: number;
  }>;

  /** Post pipeline progress to the UI */
  postPipelineProgress(state: PipelineState, currentStage?: PipelineStageSnapshot): void;

  /** Check if the pipeline has been cancelled */
  isCancelled(sessionId: string): boolean;

  /** Log a pipeline diagnostic event */
  logDiagnostic(sessionId: string, event: string, data?: Record<string, unknown>): void;
}

// ─── Stage Context ────────────────────────────────────────────────────────

export interface StageContext {
  sessionId: string;
  stage: StageDefinition;
  workflow: WorkflowDefinition;
  costProfile: CostProfile;
  config: OrchestratedConfig;
  previousHandoffs: Map<PipelineStageId, unknown>;
  contextAccumulator: string[];
  dispatcher: StageDispatcher;
}

// ─── Coordinator ──────────────────────────────────────────────────────────

export class PipelineCoordinator {
  private pipelines = new Map<string, PipelineState>();
  private abortControllers = new Map<string, AbortController>();

  /**
   * Run the full orchestration pipeline for a user request.
   * Returns the final synthesized response.
   */
  async runPipeline(params: {
    sessionId: string;
    workflow: WorkflowDefinition;
    config: OrchestratedConfig;
    userRequest: string;
    attachedImages: boolean;
    repoPath?: string;
    focusFiles?: string[];
    dispatcher: StageDispatcher;
  }): Promise<{ response: string; pipelineState: PipelineState }> {
    const { sessionId, workflow, config, userRequest, attachedImages, dispatcher } = params;
    const costProfile = (COST_PROFILES[config.costProfile] ?? COST_PROFILES["balanced"])!;

    const pipeline: PipelineState = {
      sessionId,
      workflowId: workflow.id,
      costProfileId: config.costProfile,
      stages: [],
      currentStageIndex: 0,
      startedAt: Date.now(),
      status: "running",
      totalTokensUsed: 0,
      totalEstimatedCost: 0,
      retryCount: 0,
      repairLoopCount: 0,
    };
    this.pipelines.set(sessionId, pipeline);

    const abortController = new AbortController();
    this.abortControllers.set(sessionId, abortController);

    const previousHandoffs = new Map<PipelineStageId, unknown>();
    const contextAccumulator: string[] = [];
    let repairCount = 0;

    try {
      // ── Classify stage (built-in, no model call) ────────────────────
      const stageSnapshot = this.beginStage(pipeline, "classify", "implementation", config);
      dispatcher.postPipelineProgress(pipeline, stageSnapshot);
      this.endStage(pipeline, "classify", "completed", { tokensUsed: 0, estimatedCost: 0, durationMs: 0 });

      // ── Filter stages based on context ──────────────────────────────
      const activeStages = workflow.stages.filter((s) => {
        if (s.skipWhen) {
          if (s.skipWhen.whenNoImages && !attachedImages) return false;
          if (s.skipWhen.whenQuickRequest && userRequest.length < 80) return false;
        }
        return true;
      });

      // ── Execute stages sequentially ─────────────────────────────────
      for (let i = 0; i < activeStages.length && i < costProfile.maxStages; i++) {
        if (abortController.signal.aborted) {
          pipeline.status = "cancelled";
          break;
        }

        const stage = activeStages[i]!;
        pipeline.currentStageIndex = i;

        const result = await this.executeStage({
          sessionId,
          stage,
          workflow,
          costProfile,
          config,
          previousHandoffs,
          contextAccumulator,
          userRequest,
          attachedImages,
          repoPath: params.repoPath,
          focusFiles: params.focusFiles,
          dispatcher,
          abortController,
          pipeline,
        });

        if (result.handoff) {
          previousHandoffs.set(stage.id, result.handoff);
        }
        if (result.contextSummary) {
          contextAccumulator.push(result.contextSummary);
        }

        // Check if review stage found blocking issues — trigger fix
        if (stage.id === "review_code" && result.needsFix && repairCount < costProfile.maxRepairLoops) {
          repairCount++;
          // Insert a fix stage after review
          const fixStage = workflow.stages.find((s) => s.id === "fix");
          if (fixStage) {
            await this.executeStage({
              sessionId,
              stage: fixStage,
              workflow,
              costProfile,
              config,
              previousHandoffs,
              contextAccumulator,
              userRequest,
              attachedImages,
              repoPath: params.repoPath,
              focusFiles: params.focusFiles,
              dispatcher,
              abortController,
              pipeline,
            });
          }
        }
      }

      // ── Final synthesis ─────────────────────────────────────────────
      if (!abortController.signal.aborted && pipeline.status !== "cancelled") {
        const synthStage = workflow.stages.find((s) => s.id === "synthesise");
        if (synthStage) {
          await this.executeStage({
            sessionId,
            stage: synthStage,
            workflow,
            costProfile,
            config,
            previousHandoffs,
            contextAccumulator,
            userRequest,
            attachedImages,
            repoPath: params.repoPath,
            focusFiles: params.focusFiles,
            dispatcher,
            abortController,
            pipeline,
          });
        }
      }

      pipeline.status = pipeline.status === "cancelled" ? "cancelled" : "completed";
      pipeline.completedAt = Date.now();
      dispatcher.postPipelineProgress(pipeline);

      const synthesisHandoff = previousHandoffs.get("synthesise") as { response: string } | undefined;
      return {
        response: synthesisHandoff?.response ?? "Pipeline completed.",
        pipelineState: pipeline,
      };
    } catch (err) {
      pipeline.status = "failed";
      pipeline.error = err instanceof Error ? err.message : String(err);
      pipeline.completedAt = Date.now();
      dispatcher.postPipelineProgress(pipeline);
      throw err;
    } finally {
      this.abortControllers.delete(sessionId);
    }
  }

  private async executeStage(ctx: StageContext & {
    userRequest: string;
    attachedImages: boolean;
    repoPath?: string;
    focusFiles?: string[];
    abortController: AbortController;
    pipeline: PipelineState;
  }): Promise<{ handoff?: unknown; contextSummary?: string; needsFix?: boolean }> {
    const { sessionId, stage, config, userRequest, dispatcher, pipeline, abortController } = ctx;

    const role = stage.role;
    const templateKey = stageToRole(stage.id);
    const template = getTemplateForRole(templateKey);

    if (!template) {
      dispatcher.logDiagnostic(sessionId, "no_template", { stageId: stage.id, role });
      return { handoff: { skipped: true } };
    }

    // Resolve the model for this stage
    const model = this.resolveStageModel(stage, role, config);
    if (!model) {
      dispatcher.logDiagnostic(sessionId, "no_model", { stageId: stage.id, role });
      return { handoff: { error: "No model available for stage", skipped: true } };
    }

    const stageSnapshot = this.beginStage(pipeline, stage.id, role, config, model);
    dispatcher.postPipelineProgress(pipeline, stageSnapshot);

    // Build context from previous stages
    const contextSummary = this.buildStageContext(stage, ctx.previousHandoffs, ctx.contextAccumulator);

    // Render the prompt
    const vars: TemplateVars = {
      userRequest,
      contextFromPreviousStages: contextSummary,
      customInstructions: (config.customTemplates as Record<string, string> | undefined)?.[templateKey],
      focusFiles: ctx.focusFiles,
    };

    if (stage.id === "implement") {
      const planHandoff = ctx.previousHandoffs.get("plan");
      if (planHandoff && typeof planHandoff === "object" && "goals" in planHandoff) {
        vars.planSummary = JSON.stringify(planHandoff, null, 2);
      }
    }

    const systemPrompt = renderTemplate(template, vars);
    const userPrompt = this.buildUserPrompt(stage, userRequest, ctx.previousHandoffs);

    // Execute via dispatcher
    try {
      const result = await dispatcher.executePrompt({
        sessionId,
        model,
        role,
        systemPrompt,
        userPrompt,
        stageId: stage.id,
        maxTokens: stage.tokenBudget,
        timeoutMs: stage.timeoutMs,
        signal: abortController.signal,
      });

      // Track usage
      pipeline.totalTokensUsed += result.tokensUsed;
      pipeline.totalEstimatedCost += result.estimatedCost;

      // Check cost limits
      if (pipeline.totalEstimatedCost > ctx.costProfile.maxCostPerRequest && ctx.costProfile.maxCostPerRequest > 0) {
        dispatcher.logDiagnostic(sessionId, "cost_limit_reached", {
          totalCost: pipeline.totalEstimatedCost,
          limit: ctx.costProfile.maxCostPerRequest,
        });
        this.endStage(pipeline, stage.id, "completed", result, model);
        return { handoff: { costLimitReached: true } };
      }

      this.endStage(pipeline, stage.id, "completed", result, model);
      dispatcher.logDiagnostic(sessionId, "stage_completed", {
        stageId: stage.id,
        model,
        tokens: result.tokensUsed,
        cost: result.estimatedCost,
        durationMs: result.durationMs,
      });

      // Check if review found blocking issues
      let needsFix = false;
      if (stage.id === "review_code" || stage.id === "review_security") {
        try {
          const parsed = JSON.parse(result.response);
          if (Array.isArray(parsed)) {
            needsFix = parsed.some((r) => r.severity === "blocking" || r.blocksCompletion);
          }
        } catch {}
      }

      return {
        handoff: { stage: stage.id, output: result.response },
        contextSummary: `${PIPELINE_STAGE_LABELS[stage.id] ?? stage.id} completed using ${model}.\n\n${result.response.slice(0, 2000)}`,
        needsFix,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.endStage(pipeline, stage.id, "failed", undefined, model, errorMsg);
      dispatcher.logDiagnostic(sessionId, "stage_failed", { stageId: stage.id, model, error: errorMsg });

      // Try fallback models
      if (stage.fallbackChain && stage.fallbackChain.length > 0 && config.costProfile !== "economy") {
        for (const fallbackModel of stage.fallbackChain) {
          if (abortController.signal.aborted) break;
          try {
            const result = await dispatcher.executePrompt({
              sessionId,
              model: fallbackModel,
              role,
              systemPrompt,
              userPrompt,
              stageId: stage.id,
              maxTokens: stage.tokenBudget,
              timeoutMs: stage.timeoutMs,
              signal: abortController.signal,
            });
            pipeline.totalTokensUsed += result.tokensUsed;
            pipeline.totalEstimatedCost += result.estimatedCost;
            this.endStage(pipeline, stage.id, "completed", result, fallbackModel);
            dispatcher.logDiagnostic(sessionId, "fallback_succeeded", {
              stageId: stage.id,
              originalModel: model,
              fallbackModel,
            });
            return { handoff: { stage: stage.id, output: result.response }, contextSummary: `${stage.id} completed (fallback: ${fallbackModel})` };
          } catch {}
        }
      }

      return { handoff: { error: errorMsg, failed: true } };
    }
  }

  private resolveStageModel(stage: StageDefinition, _role: AgentRole, config: OrchestratedConfig): string | undefined {
    const roleKey = _role as keyof typeof config.roleModels;
    const roleModel = config.roleModels[roleKey];
    if (roleModel) return roleModel;
    return stage.preferredModel;
  }

  private buildStageContext(stage: StageDefinition, previousHandoffs: Map<PipelineStageId, unknown>, contextAccumulator: string[]): string {
    const parts: string[] = [];
    if (stage.dependsOn) {
      for (const dep of stage.dependsOn) {
        const handoff = previousHandoffs.get(dep);
        if (handoff) {
          parts.push(`## ${PIPELINE_STAGE_LABELS[dep] ?? dep}\n${JSON.stringify(handoff, null, 2).slice(0, 3000)}`);
        }
      }
    }
    if (contextAccumulator.length > 0) {
      parts.push(contextAccumulator.join("\n\n").slice(0, 4000));
    }
    return parts.join("\n\n");
  }

  private buildUserPrompt(stage: StageDefinition, userRequest: string, _previousHandoffs: Map<PipelineStageId, unknown>): string {
    return userRequest;
  }

  private beginStage(pipeline: PipelineState, stageId: PipelineStageId, role: AgentRole, config: OrchestratedConfig, model?: string): PipelineStageSnapshot {
    const existing = pipeline.stages.find((s) => s.stageId === stageId);
    if (existing) {
      existing.status = "running";
      existing.retryCount++;
      return existing;
    }
    const snapshot: PipelineStageSnapshot = {
      stageId,
      status: "running",
      model: model ?? "unknown",
      role,
      startedAt: Date.now(),
      retryCount: 0,
    };
    pipeline.stages.push(snapshot);
    return snapshot;
  }

  private endStage(
    pipeline: PipelineState,
    stageId: PipelineStageId,
    status: PipelineStageStatus,
    result?: { tokensUsed: number; estimatedCost: number; durationMs: number },
    model?: string,
    error?: string,
  ): void {
    const snapshot = pipeline.stages.find((s) => s.stageId === stageId);
    if (!snapshot) return;
    snapshot.status = status;
    snapshot.completedAt = Date.now();
    snapshot.durationMs = result?.durationMs ?? (snapshot.startedAt ? Date.now() - snapshot.startedAt : 0);
    snapshot.tokensUsed = (snapshot.tokensUsed ?? 0) + (result?.tokensUsed ?? 0);
    snapshot.estimatedCost = (snapshot.estimatedCost ?? 0) + (result?.estimatedCost ?? 0);
    if (model) snapshot.model = model;
    if (error) snapshot.error = error;
  }

  /** Cancel a running pipeline */
  cancelPipeline(sessionId: string): void {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
    }
    const pipeline = this.pipelines.get(sessionId);
    if (pipeline && pipeline.status === "running") {
      pipeline.status = "cancelled";
      pipeline.completedAt = Date.now();
    }
  }

  /** Get the current pipeline state for a session */
  getPipelineState(sessionId: string): PipelineState | undefined {
    return this.pipelines.get(sessionId);
  }

  /** Clean up pipeline state */
  removePipeline(sessionId: string): void {
    this.pipelines.delete(sessionId);
    this.abortControllers.delete(sessionId);
  }
}

// ─── Default Workflow Definitions ─────────────────────────────────────────

import type { PipelineStageId as _PipelineStageId } from "./types";

export const STANDARD_WORKFLOW: WorkflowDefinition = {
  id: "standard",
  name: "Standard",
  description: "Explore, plan, implement, review, fix if needed, synthesize",
  stages: [
    {
      id: "explore",
      role: "planning",
      readOnly: true,
      dependsOn: [],
      parallel: false,
      tokenBudget: 4000,
      timeoutMs: 60000,
    },
    {
      id: "plan",
      role: "planning",
      readOnly: true,
      dependsOn: ["explore"],
      parallel: false,
      reasoningEffort: "high",
      tokenBudget: 4000,
      timeoutMs: 60000,
    },
    {
      id: "implement",
      role: "implementation",
      writeAllowed: true,
      dependsOn: ["plan"],
      parallel: false,
      reasoningEffort: "medium",
      tokenBudget: 32000,
      timeoutMs: 300000,
    },
    {
      id: "review_code",
      role: "review",
      readOnly: true,
      dependsOn: ["implement"],
      parallel: false,
      reasoningEffort: "medium",
      tokenBudget: 8000,
      timeoutMs: 120000,
    },
    {
      id: "fix",
      role: "debugging",
      writeAllowed: true,
      dependsOn: ["review_code"],
      parallel: false,
      maxIterations: 2,
      reasoningEffort: "high",
      tokenBudget: 16000,
      timeoutMs: 180000,
      skipWhen: { whenComplexityBelow: 0.3 },
    },
    {
      id: "synthesise",
      role: "planning",
      readOnly: true,
      dependsOn: ["implement", "review_code"],
      parallel: false,
      reasoningEffort: "low",
      tokenBudget: 4000,
      timeoutMs: 30000,
    },
  ],
  costProfileId: "balanced",
  contextPolicy: {
    passFullContext: false,
    deduplicate: true,
    summarizeCompleted: true,
    cacheExploration: true,
    compactionThreshold: 0.8,
  },
  maxRepairLoops: 2,
  parallelReads: true,
  requirePlanApproval: false,
  requireReview: true,
  maxTotalTokens: 100000,
  maxTotalCost: 2.0,
};

export const QUICK_WORKFLOW: WorkflowDefinition = {
  id: "quick",
  name: "Quick",
  description: "Minimal pipeline for simple requests — classify then implement directly",
  stages: [
    {
      id: "implement",
      role: "implementation",
      writeAllowed: true,
      dependsOn: [],
      parallel: false,
      reasoningEffort: "low",
      tokenBudget: 16000,
      timeoutMs: 120000,
    },
    {
      id: "synthesise",
      role: "planning",
      readOnly: true,
      dependsOn: ["implement"],
      parallel: false,
      reasoningEffort: "low",
      tokenBudget: 2000,
      timeoutMs: 15000,
      skipWhen: { whenQuickRequest: true },
    },
  ],
  costProfileId: "economy",
  contextPolicy: {
    passFullContext: true,
    deduplicate: true,
    summarizeCompleted: false,
    cacheExploration: false,
    compactionThreshold: 0.9,
  },
  maxRepairLoops: 0,
  parallelReads: false,
  requirePlanApproval: false,
  requireReview: false,
  maxTotalTokens: 20000,
  maxTotalCost: 0.2,
};

export const DEBUG_WORKFLOW: WorkflowDefinition = {
  id: "debug",
  name: "Debug",
  description: "Focused bug investigation pipeline",
  stages: [
    {
      id: "explore",
      role: "planning",
      readOnly: true,
      dependsOn: [],
      parallel: false,
      tokenBudget: 4000,
      timeoutMs: 60000,
    },
    {
      id: "implement",
      role: "debugging",
      writeAllowed: true,
      dependsOn: ["explore"],
      parallel: false,
      reasoningEffort: "high",
      tokenBudget: 24000,
      timeoutMs: 300000,
    },
    {
      id: "test_execute",
      role: "review",
      readOnly: true,
      dependsOn: ["implement"],
      parallel: false,
      tokenBudget: 4000,
      timeoutMs: 60000,
    },
    {
      id: "synthesise",
      role: "planning",
      readOnly: true,
      dependsOn: ["implement", "test_execute"],
      parallel: false,
      reasoningEffort: "low",
      tokenBudget: 2000,
      timeoutMs: 15000,
    },
  ],
  costProfileId: "balanced",
  contextPolicy: {
    passFullContext: false,
    deduplicate: true,
    summarizeCompleted: true,
    cacheExploration: true,
    compactionThreshold: 0.8,
  },
  maxRepairLoops: 2,
  parallelReads: false,
  requirePlanApproval: false,
  requireReview: true,
  maxTotalTokens: 80000,
  maxTotalCost: 1.0,
};

export const REVIEW_WORKFLOW: WorkflowDefinition = {
  id: "review",
  name: "Full Review",
  description: "Comprehensive code review with security and accessibility checks",
  stages: [
    {
      id: "explore",
      role: "planning",
      readOnly: true,
      dependsOn: [],
      parallel: false,
      tokenBudget: 4000,
      timeoutMs: 60000,
    },
    {
      id: "review_code",
      role: "review",
      readOnly: true,
      dependsOn: ["explore"],
      parallel: false,
      reasoningEffort: "high",
      tokenBudget: 16000,
      timeoutMs: 180000,
    },
    {
      id: "review_security",
      role: "review",
      readOnly: true,
      dependsOn: ["explore"],
      parallel: true,
      reasoningEffort: "high",
      tokenBudget: 16000,
      timeoutMs: 180000,
    },
    {
      id: "review_accessibility",
      role: "review",
      readOnly: true,
      dependsOn: ["explore"],
      parallel: true,
      reasoningEffort: "medium",
      tokenBudget: 8000,
      timeoutMs: 120000,
    },
    {
      id: "synthesise",
      role: "planning",
      readOnly: true,
      dependsOn: ["review_code", "review_security", "review_accessibility"],
      parallel: false,
      reasoningEffort: "medium",
      tokenBudget: 8000,
      timeoutMs: 60000,
    },
  ],
  costProfileId: "quality",
  contextPolicy: {
    passFullContext: true,
    deduplicate: true,
    summarizeCompleted: true,
    cacheExploration: true,
    compactionThreshold: 0.8,
  },
  maxRepairLoops: 0,
  parallelReads: true,
  requirePlanApproval: false,
  requireReview: true,
  maxTotalTokens: 100000,
  maxTotalCost: 2.0,
};

export const MULTIMODAL_WORKFLOW: WorkflowDefinition = {
  id: "multimodal",
  name: "Multimodal",
  description: "Pipeline that routes visual attachments to vision-capable models",
  stages: [
    {
      id: "visual_analyse",
      role: "visualReview",
      needsVision: true,
      readOnly: true,
      dependsOn: [],
      parallel: false,
      reasoningEffort: "medium",
      tokenBudget: 8000,
      timeoutMs: 120000,
    },
    {
      id: "explore",
      role: "planning",
      readOnly: true,
      dependsOn: ["visual_analyse"],
      parallel: false,
      tokenBudget: 4000,
      timeoutMs: 60000,
    },
    {
      id: "plan",
      role: "planning",
      readOnly: true,
      dependsOn: ["explore", "visual_analyse"],
      parallel: false,
      reasoningEffort: "high",
      tokenBudget: 8000,
      timeoutMs: 120000,
    },
    {
      id: "implement",
      role: "implementation",
      writeAllowed: true,
      dependsOn: ["plan"],
      parallel: false,
      reasoningEffort: "medium",
      tokenBudget: 32000,
      timeoutMs: 300000,
    },
    {
      id: "review_code",
      role: "review",
      readOnly: true,
      dependsOn: ["implement"],
      parallel: false,
      reasoningEffort: "medium",
      tokenBudget: 8000,
      timeoutMs: 120000,
    },
    {
      id: "synthesise",
      role: "planning",
      readOnly: true,
      dependsOn: ["implement", "review_code", "visual_analyse"],
      parallel: false,
      reasoningEffort: "low",
      tokenBudget: 4000,
      timeoutMs: 30000,
    },
  ],
  costProfileId: "balanced",
  contextPolicy: {
    passFullContext: false,
    deduplicate: true,
    summarizeCompleted: true,
    cacheExploration: true,
    compactionThreshold: 0.8,
  },
  maxRepairLoops: 1,
  parallelReads: true,
  requirePlanApproval: false,
  requireReview: true,
  maxTotalTokens: 100000,
  maxTotalCost: 2.0,
};

export const WORKFLOWS: Record<string, WorkflowDefinition> = {
  standard: STANDARD_WORKFLOW,
  quick: QUICK_WORKFLOW,
  debug: DEBUG_WORKFLOW,
  review: REVIEW_WORKFLOW,
  multimodal: MULTIMODAL_WORKFLOW,
};

export function selectWorkflow(userRequest: string, attachedImages: boolean, requestLength: number): WorkflowDefinition {
  if (attachedImages) return MULTIMODAL_WORKFLOW;
  if (/debug|bug|failing|error|exception|crash|stack.?trace|timeout/i.test(userRequest)) return DEBUG_WORKFLOW;
  if (/review|audit|security|accessibility|performance/i.test(userRequest) && requestLength < 200) return REVIEW_WORKFLOW;
  if (requestLength < 60) return QUICK_WORKFLOW;
  return STANDARD_WORKFLOW;
}
