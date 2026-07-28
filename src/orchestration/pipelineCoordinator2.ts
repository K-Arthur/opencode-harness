/**
 * Upgraded Pipeline Coordinator — formal state machine, typed handoffs,
 * retry/cancel/pause/approval, stage-aware subtask delegation, budget enforcement.
 *
 * Uses SubtaskPartInput from the SDK to delegate stages as real server-side
 * sub-agent invocations with per-stage model overrides. Extension-local
 * coordination provides workflow selection, context packaging, approval gating,
 * budget enforcement, and persistence.
 */

import * as crypto from "crypto";
import type { AgentRole } from "./modelRouting";
import type {
  WorkflowDefinition, StageDefinition, OrchestratedConfig,
  CostProfile, PipelineStageId,
} from "./types";
import { COST_PROFILES, PIPELINE_STAGE_LABELS } from "./types";
import { resolveRoutedModel, type RoutedModelInput } from "./modelRouting";
import { getTemplateForRole, renderTemplate, stageToRole, type TemplateVars } from "./promptTemplates";
import { WorkflowStateMachine, type StageSnapshot, isWorkflowTerminal, isStageTerminal, isWorkflowActive, classifyStateError } from "./stateMachine";
import { HandoffStore, validateStageOutput, type StageHandoff } from "./handoffs";
import type { ClassificationHandoff } from "./handoffs";

const STAGE_TO_AGENT: Record<string, string> = {
  explore: "explore",
  plan: "plan",
  implement: "build",
  fix: "build",
  review_code: "review",
  review_security: "review",
  review_accessibility: "review",
  review_performance: "review",
  visual_analyse: "plan",
  synthesise: "plan",
  test_execute: "plan",
  document: "build",
  research: "explore",
};

const MAX_REPAIR_LOOPS_DEFAULT = 3;
const MAX_RETRY_ATTEMPTS = 2;

// ─── Dispatcher Interface ─────────────────────────────────────────────────

export interface StageExecutor {
  executePrompt(params: {
    sessionId: string;
    model: string;
    role: string;
    agent: string;
    systemPrompt: string;
    userPrompt: string;
    stageId: string;
    stageRole: string;
    maxTokens?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    attachedImages?: boolean;
  }): Promise<{
    response: string;
    tokensUsed: number;
    estimatedCost: number;
    durationMs: number;
  }>;

  postPipelineProgress(snapshot: ReturnType<WorkflowStateMachine["snapshot"]>): void;
  isCancelled(): boolean;
  logDiagnostic(event: string, data?: Record<string, unknown>): void;
  requestApproval(stageId: string): Promise<boolean>;
}

// ─── Coordinator ──────────────────────────────────────────────────────────

export class OrchestrationCoordinator {
  private machines = new Map<string, WorkflowStateMachine>();
  private handoffs = new Map<string, HandoffStore>();
  private abortControllers = new Map<string, AbortController>();
  private approvalResolvers = new Map<string, (approved: boolean) => void>();
  private pauseResolvers = new Map<string, () => void>();
  private running = new Set<string>();

  async runPipeline(params: {
    sessionId: string;
    workflow: WorkflowDefinition;
    config: OrchestratedConfig;
    userRequest: string;
    attachedImages: boolean;
    repoPath?: string;
    focusFiles?: string[];
    executor: StageExecutor;
  }): Promise<{ response: string }> {
    const { sessionId, workflow, config, userRequest, attachedImages, executor } = params;
    const runId = `${sessionId}-${Date.now()}`;

    if (this.running.has(sessionId)) {
      throw new Error(`Pipeline already running for session ${sessionId}`);
    }
    this.running.add(sessionId);

    const costProfile = COST_PROFILES[config.costProfile] ?? COST_PROFILES.balanced!;
    const machine = new WorkflowStateMachine(runId, workflow.id, 1, config.costProfile);
    const handoffStore = new HandoffStore();
    const abortController = new AbortController();

    this.machines.set(sessionId, machine);
    this.handoffs.set(sessionId, handoffStore);
    this.abortControllers.set(sessionId, abortController);

    machine.transition("classifying");

    try {
      // ── Classification (built-in, heuristic) ─────────────────────
      const classification: ClassificationHandoff = {
        ...this.classifyRequest(userRequest, attachedImages, workflow),
        taskType: this.classifyRequest(userRequest, attachedImages, workflow).taskType as ClassificationHandoff["taskType"],
      };
      handoffStore.set("classify", { stage: "classify", output: classification });
      machine.transition("running");

      // ── Determine active stages ──────────────────────────────────
      const activeStages = this.resolveActiveStages(workflow, classification, config);
      const stageModels = this.resolveStageModels(activeStages, config, workflow);

      let lastResponse = "";
      let repairCount = 0;

      for (let i = 0; i < activeStages.length; i++) {
        if (abortController.signal.aborted) {
          machine.transition("cancelled");
          break;
        }
        if (isWorkflowTerminal(machine.getState())) break;

        const stage = activeStages[i]!;
        const model = stageModels.get(stage.id);
        if (!model) {
          machine.transitionStage(stage.id, "skipped");
          continue;
        }

        // ── Check approval gating ─────────────────────────────
        if (stage.requiresApprovalBeforeStart && config.requirePlanApproval) {
          machine.transition("waiting_for_approval");
          executor.postPipelineProgress(machine.snapshot({ currentStageId: stage.id }));

          const approved = await this.waitForApproval(sessionId, stage.id, executor);
          if (!approved) {
            machine.transition("cancelled");
            break;
          }
          machine.transition("running");
        }

        // ── Check pause before stage ──────────────────────────
        if (config.requirePlanApproval && stage.id === "implement") {
          machine.transition("waiting_for_approval");
          executor.postPipelineProgress(machine.snapshot({ currentStageId: stage.id }));

          const approved = await this.waitForApproval(sessionId, stage.id, executor);
          if (!approved) {
            machine.transition("cancelled");
            break;
          }
          machine.transition("running");
        }

        // ── Execute stage with retry ──────────────────────────
        let stageResult: { response: string } | null = null;
        let stageError: string | null = null;
        let attempts = 0;
        const maxAttempts = Math.min(stage.maxAttempts ?? MAX_RETRY_ATTEMPTS, 3);

        const stageAgent = STAGE_TO_AGENT[stage.id] ?? "build";
        machine.transitionStage(stage.id, "ready", { role: stage.role, model });

        while (attempts <= maxAttempts && !abortController.signal.aborted) {
          attempts++;
          machine.transitionStage(stage.id, "starting", { retryCount: attempts - 1 });
          executor.postPipelineProgress(machine.snapshot({ currentStageId: stage.id }));

          // Build context from handoffs
          const context = this.buildStageContext(stage, handoffStore, classification, workflow);

          const templateKey = stageToRole(stage.id);
          const template = getTemplateForRole(templateKey);

          const vars: TemplateVars = {
            userRequest,
            contextFromPreviousStages: context,
            customInstructions: (config.customTemplates as Record<string, string> | undefined)?.[templateKey],
            focusFiles: params.focusFiles,
          };

          if (stage.id === "implement" || stage.id === "fix") {
            const planHf = handoffStore.get("plan");
            if (planHf && planHf.stage === "plan") {
              vars.planSummary = JSON.stringify(planHf.output, null, 2);
            }
          }

          const systemPrompt = template ? renderTemplate(template, vars) : "";
          const userPrompt = this.buildUserPrompt(stage, userRequest, handoffStore);

          machine.transitionStage(stage.id, "running");
          executor.postPipelineProgress(machine.snapshot({ currentStageId: stage.id }));

          try {
            const result = await executor.executePrompt({
              sessionId,
              model,
              role: stage.role,
              agent: stageAgent,
              systemPrompt,
              userPrompt,
              stageId: stage.id,
              stageRole: stage.role,
              maxTokens: stage.tokenBudget,
              timeoutMs: stage.timeoutMs ?? 120_000,
              signal: abortController.signal,
              attachedImages,
            });

            // Validate handoff output
            const validation = validateStageOutput(stage.id, result.response);
            if (!validation.valid) {
              stageError = `Output validation failed: ${validation.errors.join(", ")}`;
              if (attempts < maxAttempts) {
                machine.transitionStage(stage.id, "retrying");
                executor.logDiagnostic("stage_output_invalid", { stageId: stage.id, attempt: attempts, errors: validation.errors });
                continue;
              }
              break;
            }

            handoffStore.set(stage.id, validation.handoff);
            stageResult = { response: result.response };
            stageError = null;

            machine.transitionStage(stage.id, "succeeded", {
              tokensUsed: result.tokensUsed,
              estimatedCost: result.estimatedCost,
              durationMs: result.durationMs,
            });
            break;
          } catch (err) {
            stageError = err instanceof Error ? err.message : String(err);
            const category = classifyStateError(stageError);
            const isRetryable = category === "transient" || category === "unknown";

            if (isRetryable && attempts <= maxAttempts) {
              machine.transitionStage(stage.id, "retrying");
              executor.logDiagnostic("stage_retry", { stageId: stage.id, attempt: attempts, error: stageError, category });
              // Exponential backoff
              await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempts - 1), 8000)));
            } else {
              break;
            }
          }
        }

        // ── Handle stage failure ──────────────────────────────
        if (!stageResult && !abortController.signal.aborted) {
          // Try fallback chain
          if (stage.fallbackChain && stage.fallbackChain.length > 0) {
            executor.logDiagnostic("fallback_started", { stageId: stage.id, fallbackChain: stage.fallbackChain });
            let fallbackSucceeded = false;
            for (const fallbackModel of stage.fallbackChain) {
              if (abortController.signal.aborted) break;
              try {
                const templateKey2 = stageToRole(stage.id);
                const template2 = getTemplateForRole(templateKey2);
                const vars2: TemplateVars = {
                  userRequest,
                  contextFromPreviousStages: this.buildStageContext(stage, handoffStore, classification, workflow),
                  customInstructions: (config.customTemplates as Record<string, string> | undefined)?.[templateKey2],
                  focusFiles: params.focusFiles,
                };
                const systemPrompt2 = template2 ? renderTemplate(template2, vars2) : "";
                const userPrompt2 = this.buildUserPrompt(stage, userRequest, handoffStore);

                machine.transitionStage(stage.id, "running");

                const fallbackResult = await executor.executePrompt({
                  sessionId,
                  model: fallbackModel,
                  role: stage.role,
                  agent: stageAgent,
                  systemPrompt: systemPrompt2,
                  userPrompt: userPrompt2,
                  stageId: stage.id,
                  stageRole: stage.role,
                  maxTokens: stage.tokenBudget,
                  timeoutMs: (stage.timeoutMs ?? 120_000) * 1.5,
                  signal: abortController.signal,
                  attachedImages,
                });

                const validation = validateStageOutput(stage.id, fallbackResult.response);
                if (validation.valid) {
                  handoffStore.set(stage.id, validation.handoff);
                  stageResult = { response: fallbackResult.response };
                  machine.transitionStage(stage.id, "succeeded", {
                    model: fallbackModel,
                    tokensUsed: fallbackResult.tokensUsed,
                    estimatedCost: fallbackResult.estimatedCost,
                    durationMs: fallbackResult.durationMs,
                  });
                  fallbackSucceeded = true;
                  executor.logDiagnostic("fallback_succeeded", { stageId: stage.id, fallbackModel });
                  break;
                }
              } catch (fallbackErr) {
                executor.logDiagnostic("fallback_failed", { stageId: stage.id, fallbackModel, error: String(fallbackErr) });
              }
            }
            if (!fallbackSucceeded) {
              machine.transitionStage(stage.id, "failed", { error: stageError ?? "All fallbacks failed" });
              if (stage.required) {
                machine.transition("failed");
                break;
              }
              machine.transition("completed_with_warnings");
            }
          } else {
            machine.transitionStage(stage.id, "failed", { error: stageError ?? "Stage failed" });
            if (stage.required) {
              machine.transition("failed");
              break;
            }
            machine.transition("completed_with_warnings");
          }
        }

        // ── Check for repair loop (review→fix cycles) ──────────
        if (stageResult && (stage.id === "review_code" || stage.id === "review_security")) {
          const reviewHf = handoffStore.get(stage.id);
          if (reviewHf && (reviewHf.stage === "review_code" || reviewHf.stage === "review_security") && reviewHf.output.blockingCount > 0) {
            const fixStage = workflow.stages.find((s) => s.id === "fix");
            if (fixStage && repairCount < (workflow.maxRepairLoops ?? MAX_REPAIR_LOOPS_DEFAULT)) {
              repairCount++;
              executor.logDiagnostic("repair_loop_started", { repairCount, blockingCount: reviewHf.output.blockingCount });
              // Re-run the same index i will point to fix on the next iteration
              // Insert fix stage by re-running from this point
              const fixModel = stageModels.get("fix") ?? model;
              const fixAgent = STAGE_TO_AGENT["fix"] ?? "build";
              machine.transitionStage("fix", "ready", { role: fixStage.role, model: fixModel });

              const templateKey3 = stageToRole("fix");
              const template3 = getTemplateForRole(templateKey3);
              const vars3: TemplateVars = {
                userRequest,
                contextFromPreviousStages: JSON.stringify(reviewHf.output),
                customInstructions: (config.customTemplates as Record<string, string> | undefined)?.[templateKey3],
              };

              const systemPrompt3 = template3 ? renderTemplate(template3, vars3) : "";
              const userPrompt3 = this.buildUserPrompt(fixStage, userRequest, handoffStore);

              machine.transitionStage("fix", "starting");
              try {
                const fixResult = await executor.executePrompt({
                  sessionId,
                  model: fixModel,
                  role: fixStage.role,
                  agent: fixAgent,
                  systemPrompt: systemPrompt3,
                  userPrompt: userPrompt3,
                  stageId: "fix",
                  stageRole: fixStage.role,
                  maxTokens: fixStage.tokenBudget,
                  timeoutMs: fixStage.timeoutMs ?? 180_000,
                  signal: abortController.signal,
                  attachedImages,
                });
                const fixValidation = validateStageOutput("fix", fixResult.response);
                if (fixValidation.valid) {
                  handoffStore.set("fix", fixValidation.handoff);
                  machine.transitionStage("fix", "succeeded", {
                    tokensUsed: fixResult.tokensUsed,
                    estimatedCost: fixResult.estimatedCost,
                    durationMs: fixResult.durationMs,
                  });
                } else {
                  machine.transitionStage("fix", "failed", { error: "Fix output validation failed" });
                }
              } catch (fixErr) {
                machine.transitionStage("fix", "failed", { error: String(fixErr) });
              }
            }
          }
        }
      }

      // ── Synthesis ────────────────────────────────────────────
      if (!isWorkflowTerminal(machine.getState())) {
        lastResponse = await this.runSynthesis(params, handoffStore, machine, executor, abortController);
      } else if (machine.getState() === "completed_with_warnings") {
        lastResponse = "Pipeline completed with warnings. Check stage details for more information.";
      } else if (machine.getState() === "failed") {
        lastResponse = "Pipeline failed. Check stage details for error information.";
        const failedStage = machine.getAllStages().find((s) => s.state === "failed");
        if (failedStage?.error) {
          lastResponse += `\n\nError in stage "${failedStage.stageId}": ${failedStage.error}`;
        }
      }

      if (!isWorkflowTerminal(machine.getState())) {
        machine.transition("completed");
      }
      executor.postPipelineProgress(machine.snapshot({ currentStageId: undefined }));

      return { response: lastResponse };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      machine.transition("failed");
      executor.postPipelineProgress(machine.snapshot());
      return { response: `Pipeline failed: ${errorMsg}` };
    } finally {
      this.running.delete(sessionId);
      this.abortControllers.delete(sessionId);
    }
  }

  private async runSynthesis(
    params: { sessionId: string; workflow: WorkflowDefinition; config: OrchestratedConfig; userRequest: string },
    handoffStore: HandoffStore,
    machine: WorkflowStateMachine,
    executor: StageExecutor,
    abortController: AbortController,
  ): Promise<string> {
    const { sessionId, workflow, config, userRequest } = params;
    const synthStage = workflow.stages.find((s) => s.id === "synthesise");
    if (!synthStage) return "Pipeline completed.";

    const model = this.resolveModelForStage(synthStage, config, workflow);
    if (!model) return "Pipeline completed.";

    machine.transitionStage("synthesise", "ready", { role: synthStage.role, model });

    const template = getTemplateForRole("synthesise");
    const allHandoffs = handoffStore.getAll();
    const contextSummary = allHandoffs
      .map((h) => `## ${h.stage}\n${JSON.stringify(h.output, null, 2).slice(0, 3000)}`)
      .join("\n\n");

    const vars: TemplateVars = {
      userRequest,
      contextFromPreviousStages: contextSummary,
    };

    const systemPrompt = template ? renderTemplate(template, vars) : "";

    machine.transitionStage("synthesise", "running");
    executor.postPipelineProgress(machine.snapshot({ currentStageId: "synthesise" }));

    try {
      const result = await executor.executePrompt({
        sessionId,
        model,
        role: synthStage.role,
        agent: STAGE_TO_AGENT["synthesise"] ?? "plan",
        systemPrompt,
        userPrompt: userRequest,
        stageId: "synthesise",
        stageRole: synthStage.role,
        maxTokens: synthStage.tokenBudget,
        timeoutMs: synthStage.timeoutMs ?? 60_000,
        signal: abortController.signal,
      });

      machine.transitionStage("synthesise", "succeeded", {
        tokensUsed: result.tokensUsed,
        estimatedCost: result.estimatedCost,
        durationMs: result.durationMs,
      });
      return result.response;
    } catch (err) {
      machine.transitionStage("synthesise", "failed", { error: String(err) });
      return "Synthesis failed. Pipeline completed with partial results.";
    }
  }

  private classifyRequest(
    userRequest: string,
    attachedImages: boolean,
    workflow: WorkflowDefinition,
  ): {
    taskType: string;
    complexity: number;
    hasImages: boolean;
    intent: "read" | "write" | "analyse" | "mixed";
    canBypassPipeline: boolean;
  } {
    const isTrivial = userRequest.length < 60;
    const isReadOnly = /^(explain|what|how|describe|show|list|find|search|summarize|summarise)/i.test(userRequest.trim());
    const isBug = /\b(debug|bug|failing|error|exception|crash|stack.?trace|timeout|fix|broken)\b/i.test(userRequest);
    const hasCode = /```|`\w+`|function|class|import|export|const\s|let\s/g.test(userRequest);

    const complexity = isTrivial ? 0.1 : isBug ? 0.6 : hasCode ? 0.5 : 0.3;
    const intent: "read" | "write" | "analyse" | "mixed" = isReadOnly ? "read" : isBug ? "analyse" : "write";
    const canBypassPipeline = isTrivial && intent === "read";

    return {
      taskType: isBug ? "debug" : isReadOnly ? "explore" : "implement",
      complexity,
      hasImages: attachedImages,
      intent,
      canBypassPipeline,
    };
  }

  private resolveActiveStages(
    workflow: WorkflowDefinition,
    classification: { canBypassPipeline: boolean; complexity: number; hasImages: boolean; taskType: string },
    config: OrchestratedConfig,
  ): StageDefinition[] {
    if (classification.canBypassPipeline) {
      const synthStage = workflow.stages.find((s) => s.id === "synthesise");
      return synthStage ? [synthStage] : workflow.stages.slice(0, 1);
    }

    return workflow.stages.filter((s) => {
      if (s.enabledByDefault === false && !config.customStages?.some((cs) => "id" in cs && cs.id === s.id)) return false;
      if (s.skipWhen) {
        if (s.skipWhen.whenNoImages && !classification.hasImages) return false;
        if (s.skipWhen.whenQuickRequest && classification.complexity < 0.3) return false;
        if (s.skipWhen.whenComplexityBelow !== undefined && classification.complexity < s.skipWhen.whenComplexityBelow) return false;
      }
      return true;
    });
  }

  private resolveStageModels(
    stages: StageDefinition[],
    config: OrchestratedConfig,
    workflow: WorkflowDefinition,
  ): Map<string, string> {
    const models = new Map<string, string>();
    for (const stage of stages) {
      const model = this.resolveModelForStage(stage, config, workflow);
      if (model) models.set(stage.id, model);
    }
    // Also resolve fix model if not in stages
    if (!models.has("fix") && workflow.stages.some((s) => s.id === "fix")) {
      const fixStage = workflow.stages.find((s) => s.id === "fix")!;
      const model = this.resolveModelForStage(fixStage, config, workflow);
      if (model) models.set("fix", model);
    }
    return models;
  }

  private resolveModelForStage(stage: StageDefinition, config: OrchestratedConfig, workflow: WorkflowDefinition): string | undefined {
    const roleKey = stage.role as keyof typeof config.roleModels;
    const roleModel = config.roleModels[roleKey];
    if (roleModel) return roleModel;
    if (stage.preferredModel) return stage.preferredModel;
    return undefined;
  }

  private buildStageContext(
    stage: StageDefinition,
    handoffStore: HandoffStore,
    classification: { taskType: string; complexity: number },
    workflow: WorkflowDefinition,
  ): string {
    const parts: string[] = [];
    if (stage.dependsOn) {
      for (const dep of stage.dependsOn) {
        const hf = handoffStore.get(dep);
        if (hf) {
          parts.push(`## ${PIPELINE_STAGE_LABELS[dep as PipelineStageId] ?? dep}\n${JSON.stringify(hf.output, null, 2).slice(0, 3000)}`);
        }
      }
    }
    if (workflow.contextPolicy?.passFullContext) {
      const all = handoffStore.getAll();
      for (const hf of all) {
        if (!stage.dependsOn?.includes(hf.stage as PipelineStageId)) {
          parts.push(`## Additional Context: ${hf.stage}\n${JSON.stringify(hf.output, null, 2).slice(0, 2000)}`);
        }
      }
    }
    return parts.join("\n\n");
  }

  private buildUserPrompt(stage: StageDefinition, userRequest: string, _handoffStore: HandoffStore): string {
    return userRequest;
  }

  private async waitForApproval(
    sessionId: string,
    stageId: string,
    executor: StageExecutor,
  ): Promise<boolean> {
    const resolver = new Promise<boolean>((resolve) => {
      this.approvalResolvers.set(`${sessionId}-${stageId}`, resolve);
    });
    // Timeout after 5 minutes
    const timeout = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), 300_000);
    });
    return Promise.race([resolver, timeout]);
  }

  // ─── Public Control API ──────────────────────────────────────────────

  cancelPipeline(sessionId: string): void {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
    }
    const machine = this.machines.get(sessionId);
    if (machine && isWorkflowActive(machine.getState())) {
      machine.transition("cancelled");
    }
  }

  cancelStage(sessionId: string, stageId: string): void {
    const controller = this.abortControllers.get(sessionId);
    if (controller) controller.abort();
    const machine = this.machines.get(sessionId);
    if (machine) {
      machine.transitionStage(stageId, "cancelled");
    }
  }

  pauseWorkflow(sessionId: string): boolean {
    const machine = this.machines.get(sessionId);
    if (!machine) return false;
    return machine.transition("paused");
  }

  resumeWorkflow(sessionId: string): boolean {
    const machine = this.machines.get(sessionId);
    if (!machine) return false;
    return machine.transition("running");
  }

  approveStage(sessionId: string, stageId: string, approved: boolean): void {
    const key = `${sessionId}-${stageId}`;
    const resolver = this.approvalResolvers.get(key);
    if (resolver) {
      resolver(approved);
      this.approvalResolvers.delete(key);
    }
  }

  retryStage(sessionId: string, stageId: string): void {
    const machine = this.machines.get(sessionId);
    if (!machine) return;
    const snap = machine.getStageSnapshot(stageId);
    if (!snap) return;
    if (isStageTerminal(snap.state) || snap.state === "failed" || snap.state === "cancelled") {
      machine.transitionStage(stageId, "retrying");
      // The retry will be picked up by the main loop on next poll
    }
  }

  skipStage(sessionId: string, stageId: string): void {
    const machine = this.machines.get(sessionId);
    if (!machine) return;
    const snap = machine.getStageSnapshot(stageId);
    if (snap && !isStageTerminal(snap.state)) {
      machine.transitionStage(stageId, "skipped");
    }
  }

  getPipelineState(sessionId: string): ReturnType<WorkflowStateMachine["snapshot"]> | undefined {
    const machine = this.machines.get(sessionId);
    if (!machine) return undefined;
    return machine.snapshot();
  }

  getHandoffs(sessionId: string): StageHandoff[] | undefined {
    const store = this.handoffs.get(sessionId);
    return store?.getAll();
  }

  removePipeline(sessionId: string): void {
    this.machines.delete(sessionId);
    this.handoffs.delete(sessionId);
    this.abortControllers.delete(sessionId);
    this.running.delete(sessionId);
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId);
  }
}
