import * as crypto from "crypto";
import type { AgentRole } from "./modelRouting";
import type {
  WorkflowDefinition, StageDefinition, OrchestratedConfig,
  CostProfile, PipelineStageId,
} from "./types";
import { COST_PROFILES, PIPELINE_STAGE_LABELS } from "./types";
import { getTemplateForRole, renderTemplate, stageToRole, type TemplateVars } from "./promptTemplates";
import { WorkflowStateMachine, type StageSnapshot, type StageState, isWorkflowTerminal, isStageTerminal, isWorkflowActive, isStageActive, classifyStateError } from "./stateMachine";
import { HandoffStore, validateStageOutput, type StageHandoff } from "./handoffs";
import type { ClassificationHandoff } from "./handoffs";
import {
  type PersistenceIdentity,
  type WorkflowSnapshot,
  type PersistedStageSnapshot,
  type WorkflowRunStatus,
  type WorkflowRecoveryState,
  type PersistedCostBudget,
  type PersistedRepairState,
  type PersistedHandoffReference,
  type PersistedFileBaseline,
  type PersistedProviderReservationSummary,
  type PersistedGitState,
  type ApprovedPlanSnapshot,
  type PendingApprovalSnapshot,
  createEmptySnapshot,
} from "./workflowSnapshot";
import { WorkflowPersistenceService } from "./persistenceService";
import {
  buildDependencyGraph,
  type DependencyGraph,
  type ScheduleBatch,
  invalidateDownstreamStages,
  hasUnresolvedDependencies,
} from "./dependencyGraph";
import {
  type ProviderIdentity,
  type ProviderPermit,
  ProviderLimiter,
  extractProviderFromModel,
} from "./providerLimiter";
import {
  type FileConflict,
  WorkspaceLockManager,
  type LockOwner,
} from "./workspaceLock";
import {
  GitGuard,
  type GitGuardConfig,
  type GitGuardResult,
} from "./gitGuard";
import {
  RepairStateMachine,
  type RepairPolicy,
  type RepairFinding,
  type RepairProgress,
  computeFindingId,
  normalizeFindingDescription,
} from "./repairPolicy";
import {
  PriceRegistry,
  type ModelPriceEntry,
  type BudgetReservation,
} from "./priceRegistry";
import {
  AttachmentMaterializer,
  type AttachmentDescriptor,
  type AttachmentMaterializationInput,
} from "./multimodalDispatcher";

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

const MAX_RETRY_ATTEMPTS = 2;
const DEFAULT_TIMEOUT_MS = 120_000;
const PERSIST_TERMINAL_DELAY_MS = 100;

// ─── Integration Dependencies ─────────────────────────────────────────────

export interface CoordinatorDeps {
  persistenceService?: WorkflowPersistenceService;
  providerLimiter?: ProviderLimiter;
  lockManager?: WorkspaceLockManager;
  gitGuard?: GitGuard;
  priceRegistry?: PriceRegistry;
  attachmentMaterializer?: AttachmentMaterializer;
  /** VS Code workspaceState (optional — used if persistenceService not provided) */
  workspaceState?: { get: (key: string) => unknown; update: (key: string, value: unknown) => void };
  /** VS Code globalState (optional — used if persistenceService not provided) */
  globalState?: { get: (key: string) => unknown; update: (key: string, value: unknown) => void };
}

// ─── Stage Executor Interface ─────────────────────────────────────────────

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
    attachmentDescriptors?: AttachmentDescriptor[];
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

// ─── Orchestration Coordinator ─────────────────────────────────────────────

export class OrchestrationCoordinator {
  private machines = new Map<string, WorkflowStateMachine>();
  private handoffs = new Map<string, HandoffStore>();
  private abortControllers = new Map<string, AbortController>();
  private approvalResolvers = new Map<string, (approved: boolean) => void>();
  private pauseResolvers = new Map<string, () => void>();
  private running = new Set<string>();
  private deps: CoordinatorDeps;
  private persistenceService: WorkflowPersistenceService | null;
  private providerLimiter: ProviderLimiter | null;
  private lockManager: WorkspaceLockManager | null;
  private gitGuard: GitGuard | null;
  private priceRegistry: PriceRegistry | null;
  private repairMachines = new Map<string, RepairStateMachine>();
  private dependencyGraphs = new Map<string, DependencyGraph>();
  private gitStates = new Map<string, PersistedGitState | null>();

  constructor(deps?: CoordinatorDeps) {
    this.deps = deps ?? {};
    this.persistenceService = deps?.persistenceService ?? null;
    this.providerLimiter = deps?.providerLimiter ?? null;
    this.lockManager = deps?.lockManager ?? null;
    this.gitGuard = deps?.gitGuard ?? null;
    this.priceRegistry = deps?.priceRegistry ?? null;
  }

  async runPipeline(params: {
    sessionId: string;
    workflow: WorkflowDefinition;
    config: OrchestratedConfig;
    userRequest: string;
    attachedImages: boolean;
    desiredOutcome?: string;
    repoPath?: string;
    focusFiles?: string[];
    executor: StageExecutor;
    attachmentIds?: string[];
    /** Optional persisted snapshot to restore from (recovery path) */
    fromSnapshot?: WorkflowSnapshot;
  }): Promise<{ response: string }> {
    const { sessionId, workflow, config, userRequest, attachedImages, executor } = params;
    const runId = fromSnapshot(params) ?? `${sessionId}-${Date.now()}`;

    if (this.running.has(sessionId) && !params.fromSnapshot) {
      throw new Error(`Pipeline already running for session ${sessionId}`);
    }
    this.running.add(sessionId);

    const costProfile = COST_PROFILES[config.costProfile] ?? COST_PROFILES.balanced!;
    let machine: WorkflowStateMachine;

    if (params.fromSnapshot) {
      machine = this.restoreMachineFromSnapshot(params.fromSnapshot);
    } else {
      machine = new WorkflowStateMachine(runId, workflow.id, 1, config.costProfile);
    }

    const handoffStore = new HandoffStore();
    const abortController = new AbortController();
    const snapshotVersion = params.fromSnapshot?.revision ?? 0;

    this.machines.set(sessionId, machine);
    this.handoffs.set(sessionId, handoffStore);
    this.abortControllers.set(sessionId, abortController);

    if (this.persistenceService) {
      this.persistenceService.registerActiveSession(sessionId);
    }

    // Build/validate dependency graph if not already cached
    if (!this.dependencyGraphs.has(workflow.id)) {
      const graph = buildDependencyGraph(workflow);
      this.dependencyGraphs.set(workflow.id, graph);
      if (!graph.valid) {
        for (const err of graph.validationErrors) {
          executor.logDiagnostic("graph_validation", { error: err.message, nodes: err.nodes });
        }
      }
    }

    const dependencyGraph = this.dependencyGraphs.get(workflow.id);

    if (!params.fromSnapshot) {
      machine.transition("classifying");
    }

    // Capture initial Git state if repoPath is provided
    let gitState: PersistedGitState | null = null;
    if (params.repoPath && this.gitGuard) {
      try {
        gitState = await this.gitGuard.captureInitialState(params.repoPath);
        this.gitStates.set(sessionId, gitState);
      } catch {
        gitState = null;
      }
    }

    // Default classification (overridden below in try block)
    let classification: ClassificationHandoff = {
      taskType: "implement" as ClassificationHandoff["taskType"],
      complexity: 0.5,
      hasImages: attachedImages,
      intent: "write",
      canBypassPipeline: false,
    };

    try {
      // Classification (skip if restoring from snapshot)
      if (!params.fromSnapshot) {
        classification = {
          ...this.classifyRequest(userRequest, attachedImages, workflow),
          taskType: this.classifyRequest(userRequest, attachedImages, workflow).taskType as ClassificationHandoff["taskType"],
        };
        handoffStore.set("classify", { stage: "classify", output: classification });
        machine.transition("running");
      }

      // Determine active stages
      const activeStages = this.resolveActiveStages(workflow, classification, config);
      const stageModels = this.resolveStageModels(activeStages, config, workflow);

      let lastResponse = "";
      let repairState = this.repairMachines.get(sessionId) ?? new RepairStateMachine({
        maxPasses: workflow.maxRepairLoops ?? 3,
      });
      this.repairMachines.set(sessionId, repairState);

      // Persist initial snapshot
      this.persistSnapshot(sessionId, machine, handoffStore, classification, config, gitState, snapshotVersion > 0);

      // ─── Dependency-based scheduling ──────────────────────────────
      if (dependencyGraph) {
        await this.runDependencyScheduled(
          params, machine, handoffStore, abortController, executor,
          activeStages, stageModels, classification, dependencyGraph,
          repairState, costProfile, gitState,
        );
      } else {
        await this.runSequential(
          params, machine, handoffStore, abortController, executor,
          activeStages, stageModels, classification, repairState, costProfile, gitState,
        );
      }

      // ── Synthesis ────────────────────────────────────────────
      if (!isWorkflowTerminal(machine.getState())) {
        lastResponse = await this.runSynthesis(params, handoffStore, machine, executor, abortController);
      } else {
        lastResponse = this.getTerminalResponse(machine);
      }

      if (!isWorkflowTerminal(machine.getState())) {
        machine.transition("completed");
      }
      executor.postPipelineProgress(machine.snapshot({ currentStageId: undefined }));

      // Persist terminal state
      this.persistTerminalSnapshot(sessionId, machine, handoffStore, classification, config, gitState);

      return { response: lastResponse };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      machine.transition("failed");
      executor.postPipelineProgress(machine.snapshot());
      this.persistTerminalSnapshot(sessionId, machine, handoffStore, classification, config, gitState);
      return { response: `Pipeline failed: ${errorMsg}` };
    } finally {
      this.running.delete(sessionId);
      this.abortControllers.delete(sessionId);
      // Release all locks for this session
      if (this.lockManager) {
        this.lockManager.releaseAllForSession(sessionId);
      }
      if (this.persistenceService) {
        setTimeout(() => this.persistenceService!.unregisterActiveSession(sessionId), PERSIST_TERMINAL_DELAY_MS);
      }
    }
  }

  // ─── Dependency-Graph Scheduler ──────────────────────────────────────────

  private async runDependencyScheduled(
    params: {
      sessionId: string; workflow: WorkflowDefinition; config: OrchestratedConfig;
      userRequest: string; attachedImages: boolean; repoPath?: string; focusFiles?: string[];
      executor: StageExecutor;
    },
    machine: WorkflowStateMachine,
    handoffStore: HandoffStore,
    abortController: AbortController,
    executor: StageExecutor,
    activeStages: StageDefinition[],
    stageModels: Map<string, string>,
    classification: ClassificationHandoff,
    dependencyGraph: DependencyGraph,
    repairState: RepairStateMachine,
    costProfile: CostProfile,
    gitState: PersistedGitState | null,
  ): Promise<void> {
    const { sessionId, workflow, config, userRequest, attachedImages } = params;
    const stateByStage = new Map<string, StageState>();

    // Initialize stage states
    for (const stage of activeStages) {
      stateByStage.set(stage.id, machine.getStageState(stage.id));
    }

    // Process layers in order
    for (let layerIdx = 0; layerIdx < dependencyGraph.topologicalLayers.length; layerIdx++) {
      if (abortController.signal.aborted) {
        machine.transition("cancelled");
        break;
      }
      if (isWorkflowTerminal(machine.getState())) break;

      const batch = dependencyGraph.topologicalLayers[layerIdx]!;
      const stagesInBatch = batch.stageIds
        .map((id) => activeStages.find((s) => s.id === id))
        .filter(Boolean) as StageDefinition[];

      if (stagesInBatch.length === 0) continue;

      // Execute batch
      if (batch.parallel && stagesInBatch.length > 1) {
        // Parallel execution for independent stages
        const results = await Promise.allSettled(
          stagesInBatch.map((stage) =>
            this.executeSingleStage(
              params, stage, machine, handoffStore, abortController,
              executor, stageModels, classification, repairState,
              costProfile, gitState, stateByStage,
            ),
          ),
        );

        // Handle results
        for (let i = 0; i < results.length; i++) {
          const result = results[i]!;
          const stage = stagesInBatch[i]!;
          if (result.status === "rejected") {
            executor.logDiagnostic("stage_parallel_failed", {
              stageId: stage.id,
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            });
            if (stage.required !== false) {
              machine.transition("failed");
              return;
            }
          }
        }
      } else {
        // Sequential execution within batch (write stages or single stage)
        for (const stage of stagesInBatch) {
          if (abortController.signal.aborted) break;
          if (isWorkflowTerminal(machine.getState())) break;

          await this.executeSingleStage(
            params, stage, machine, handoffStore, abortController,
            executor, stageModels, classification, repairState,
            costProfile, gitState, stateByStage,
          );
        }
      }
    }
  }

  // ─── Single Stage Execution ──────────────────────────────────────────────

  private async executeSingleStage(
    params: {
      sessionId: string; workflow: WorkflowDefinition; config: OrchestratedConfig;
      userRequest: string; attachedImages: boolean; repoPath?: string; focusFiles?: string[];
      executor: StageExecutor; attachmentIds?: string[];
    },
    stage: StageDefinition,
    machine: WorkflowStateMachine,
    handoffStore: HandoffStore,
    abortController: AbortController,
    executor: StageExecutor,
    stageModels: Map<string, string>,
    classification: ClassificationHandoff,
    repairState: RepairStateMachine,
    costProfile: CostProfile,
    gitState: PersistedGitState | null,
    stateByStage: Map<string, StageState>,
  ): Promise<void> {
    const { sessionId, workflow, config, userRequest, attachedImages } = params;

    const model = stageModels.get(stage.id);
    if (!model) {
      machine.transitionStage(stage.id, "skipped");
      stateByStage.set(stage.id, "skipped");
      return;
    }

    if (abortController.signal.aborted) {
      machine.transitionStage(stage.id, "cancelled");
      stateByStage.set(stage.id, "cancelled");
      return;
    }

    // ── Git guard check for write stages ──────────────────────────────
    if (stage.writeAllowed && this.gitGuard && params.repoPath) {
      const targetFiles = this.getTargetFilesForStage(stage, handoffStore);

      try {
        const guardResult = await this.gitGuard.checkBeforeStage(
          params.repoPath,
          stage.id,
          stage.writeAllowed,
          targetFiles,
          gitState ?? undefined,
        );

        if (guardResult.action === "block") {
          machine.transitionStage(stage.id, "failed", { error: `Git guard blocked: ${guardResult.message}` });
          stateByStage.set(stage.id, "failed");
          executor.logDiagnostic("git_guard_blocked", { stageId: stage.id, message: guardResult.message });
          if (stage.required !== false) {
            machine.transition("failed");
          }
          return;
        }

        if (guardResult.action === "pause_for_approval") {
          machine.transition("waiting_for_approval");
          executor.postPipelineProgress(machine.snapshot({ currentStageId: stage.id }));
          executor.logDiagnostic("git_guard_paused", { stageId: stage.id, risks: guardResult.risks });

          const approved = await this.waitForApproval(sessionId, stage.id, executor);
          if (!approved) {
            machine.transition("cancelled");
            stateByStage.set(stage.id, "cancelled");
            return;
          }
          machine.transition("running");
        }
      } catch (err) {
        executor.logDiagnostic("git_guard_error", { stageId: stage.id, error: String(err) });
        // Proceed with caution if Git guard fails
      }
    }

    // ── Workspace lock for write stages ────────────────────────────────
    if (stage.writeAllowed && this.lockManager) {
      const targetFiles = this.getTargetFilesForStage(stage, handoffStore);
      const lockOwner: LockOwner = { workflowId: workflow.id, sessionId, stageId: stage.id };

      if (targetFiles.length > 0) {
        const lockResult = this.lockManager.acquireMulti(targetFiles, lockOwner, "write");
        if (!lockResult.success) {
          machine.transitionStage(stage.id, "failed", { error: "Could not acquire write locks for target files" });
          stateByStage.set(stage.id, "failed");
          executor.logDiagnostic("lock_failed", { stageId: stage.id, files: targetFiles });
          if (stage.required !== false) machine.transition("failed");
          return;
        }

        // Capture file baselines before modification
        const fileReader = async (uri: string) => {
          // Default file reader — in extension context this would use workspace.fs
          try {
            const fs = await import("fs/promises");
            const filePath = uri.replace(/^file:\/\//, "");
            const stat = await fs.stat(filePath);
            const content = stat.isFile() ? await fs.readFile(filePath, "utf8") : "";
            return { exists: stat.isFile(), content, size: stat.size, mtime: stat.mtimeMs };
          } catch {
            return { exists: false, content: "", size: 0, mtime: 0 };
          }
        };

        for (const fileUri of targetFiles.map((f) => `file://${f}`)) {
          await this.lockManager.captureBaseline(fileUri, fileReader);
        }
      }
    }

    // ── Provider permit acquisition ────────────────────────────────────
    let providerPermit: ProviderPermit | null = null;
    if (this.providerLimiter) {
      const providerId = extractProviderFromModel(model);
      try {
        providerPermit = await this.providerLimiter.acquirePermit({
          provider: providerId,
          modelId: model,
          estimatedTokens: stage.tokenBudget,
          priority: stage.id === "implement" || stage.id === "fix" ? 1 : 2,
          workflowId: workflow.id,
          stageId: stage.id,
        }, stage.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      } catch (err) {
        machine.transitionStage(stage.id, "failed", { error: `Provider permit denied: ${err instanceof Error ? err.message : String(err)}` });
        stateByStage.set(stage.id, "failed");
        if (stage.required !== false) machine.transition("failed");
        return;
      }
    }

    // ── Budget pre-check ───────────────────────────────────────────────
    if (this.priceRegistry) {
      const budgetCheck = this.priceRegistry.reserveBudget(
        model,
        stage.tokenBudget ?? 4000,
        Math.ceil((stage.tokenBudget ?? 4000) * 0.25),
        costProfile.maxTokensPerRequest,
        costProfile.maxCostPerRequest,
      );
      if (!budgetCheck.acquired) {
        executor.logDiagnostic("budget_limit", {
          stageId: stage.id,
          message: "Stage exceeds remaining budget",
        });
        machine.transitionStage(stage.id, "skipped");
        stateByStage.set(stage.id, "skipped");
        if (providerPermit) this.providerLimiter?.releasePermit(providerPermit);
        return;
      }
    }

    // ── Approval gating ────────────────────────────────────────────────
    if (this.shouldRequestApproval(stage, config)) {
      machine.transition("waiting_for_approval");
      executor.postPipelineProgress(machine.snapshot({ currentStageId: stage.id }));

      const approved = await this.waitForApproval(sessionId, stage.id, executor);
      if (!approved) {
        machine.transition("cancelled");
        stateByStage.set(stage.id, "cancelled");
        if (providerPermit) this.providerLimiter?.releasePermit(providerPermit);
        return;
      }
      machine.transition("running");
    }

    // ── Stage Execution ────────────────────────────────────────────────
    try {
      machine.transitionStage(stage.id, "ready", { role: stage.role, model });
      stateByStage.set(stage.id, "ready");

      await this.executeStageWithRetry(
        params, stage, machine, handoffStore, abortController,
        executor, model, stageModels, classification, repairState,
        providerPermit,
      );

      stateByStage.set(stage.id, machine.getStageState(stage.id));

      // ── Handle review-triggered repair ─────────────────────────────
      if (machine.getStageState(stage.id) === "succeeded" &&
          (stage.id === "review_code" || stage.id === "review_security")) {
        await this.handleReviewRepair(
          params, stage, machine, handoffStore, abortController,
          executor, stageModels, classification, repairState, costProfile, gitState, stateByStage,
        );
      }
    } catch (err) {
      executor.logDiagnostic("stage_execution_error", {
        stageId: stage.id,
        error: err instanceof Error ? err.message : String(err),
      });
      if (providerPermit) this.providerLimiter?.releasePermit(providerPermit);
      throw err;
    } finally {
      if (providerPermit) {
        this.providerLimiter?.releasePermit(providerPermit);
      }
    }

    // Persist after meaningful stage transition
    this.persistSnapshot(sessionId, machine, handoffStore, classification, config, gitState, true);
  }

  // ─── Stage Retry Loop ─────────────────────────────────────────────────────

  private async executeStageWithRetry(
    params: {
      sessionId: string; workflow: WorkflowDefinition; config: OrchestratedConfig;
      userRequest: string; attachedImages: boolean; repoPath?: string; focusFiles?: string[];
      executor: StageExecutor; attachmentIds?: string[];
    },
    stage: StageDefinition,
    machine: WorkflowStateMachine,
    handoffStore: HandoffStore,
    abortController: AbortController,
    executor: StageExecutor,
    model: string,
    stageModels: Map<string, string>,
    classification: ClassificationHandoff,
    repairState: RepairStateMachine,
    providerPermit: ProviderPermit | null,
  ): Promise<void> {
    const { sessionId, config, userRequest, attachedImages } = params;
    let stageResult: { response: string } | null = null;
    let stageError: string | null = null;
    let attempts = 0;
    const maxAttempts = Math.min(stage.maxAttempts ?? MAX_RETRY_ATTEMPTS, 3);
    const stageAgent = STAGE_TO_AGENT[stage.id] ?? "build";
    const templateKey = stageToRole(stage.id);
    const template = getTemplateForRole(templateKey);

    machine.transitionStage(stage.id, "ready", { role: stage.role, model });

    while (attempts <= maxAttempts && !abortController.signal.aborted) {
      attempts++;
      machine.transitionStage(stage.id, "starting", { retryCount: attempts - 1 });
      executor.postPipelineProgress(machine.snapshot({ currentStageId: stage.id }));

      const context = this.buildStageContext(stage, handoffStore, classification, params.workflow);

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

      // Build attachment descriptors for multimodal stages
      let attachmentDescriptors: AttachmentDescriptor[] | undefined;
      if (attachedImages && stage.needsVision && params.attachmentIds && params.attachmentIds.length > 0) {
        const materializer = this.deps.attachmentMaterializer;
        if (materializer) {
          attachmentDescriptors = materializer.getDescriptors(params.attachmentIds);
        }
      }

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
          timeoutMs: stage.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          signal: abortController.signal,
          attachedImages,
          attachmentDescriptors,
        });

        // Report token usage to provider limiter
        if (this.providerLimiter) {
          const providerId = extractProviderFromModel(model);
          this.providerLimiter.reportTokenUsage(providerId, result.tokensUsed);
        }

        // Validate handoff output
        const validation = validateStageOutput(stage.id, result.response);
        if (!validation.valid) {
          stageError = `Output validation failed: ${validation.errors.join(", ")}`;
          if (attempts < maxAttempts && classifyStateError(stageError) !== "terminal") {
            machine.transitionStage(stage.id, "retrying");
            executor.logDiagnostic("stage_output_invalid", { stageId: stage.id, attempt: attempts, errors: validation.errors });
            await this.backoff(attempts);
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

        executor.logDiagnostic("stage_completed", {
          stageId: stage.id, model, attempt: attempts,
          tokens: result.tokensUsed, cost: result.estimatedCost,
        });

        return;
      } catch (err) {
        stageError = err instanceof Error ? err.message : String(err);
        const category = classifyStateError(stageError);
        const isRetryable = category === "transient" || category === "unknown";

        if (isRetryable && attempts <= maxAttempts && !abortController.signal.aborted) {
          machine.transitionStage(stage.id, "retrying");
          executor.logDiagnostic("stage_retry", {
            stageId: stage.id, attempt: attempts, error: stageError, category,
          });

          // Report rate limit to provider limiter
          if (this.providerLimiter && (stageError.includes("429") || stageError.includes("rate"))) {
            const providerId = extractProviderFromModel(model);
            this.providerLimiter.reportRateLimit(providerId, 10000 * attempts);
          }

          await this.backoff(attempts);
        } else {
          break;
        }
      }
    }

    // Handle failure with fallback chain
    if (!stageResult && !abortController.signal.aborted) {
      await this.handleStageFailure(
        params, stage, machine, handoffStore, abortController,
        executor, model, stageModels, classification, stageError, stageAgent,
      );
    }
  }

  // ─── Fallback Chain ──────────────────────────────────────────────────────

  private async handleStageFailure(
    params: {
      sessionId: string; workflow: WorkflowDefinition; config: OrchestratedConfig;
      userRequest: string; attachedImages: boolean; repoPath?: string; focusFiles?: string[];
      executor: StageExecutor; attachmentIds?: string[];
    },
    stage: StageDefinition,
    machine: WorkflowStateMachine,
    handoffStore: HandoffStore,
    abortController: AbortController,
    executor: StageExecutor,
    originalModel: string,
    stageModels: Map<string, string>,
    classification: ClassificationHandoff,
    stageError: string | null,
    stageAgent: string,
  ): Promise<void> {
    const { sessionId, config, userRequest } = params;
    const templateKey = stageToRole(stage.id);
    const template = getTemplateForRole(templateKey);

    if (stage.fallbackChain && stage.fallbackChain.length > 0 && config.costProfile !== "economy") {
      executor.logDiagnostic("fallback_started", {
        stageId: stage.id,
        originalModel,
        fallbackChain: stage.fallbackChain,
      });

      for (const fallbackModel of stage.fallbackChain) {
        if (abortController.signal.aborted) break;

        // Acquire new provider permit for fallback
        if (this.providerLimiter) {
          try {
            const fbProviderId = extractProviderFromModel(fallbackModel);
            const fbPermit = await this.providerLimiter.acquirePermit({
              provider: fbProviderId,
              modelId: fallbackModel,
              priority: 2,
              workflowId: params.workflow.id,
              stageId: stage.id,
            }, (stage.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 2);
            this.providerLimiter.releasePermit(fbPermit);
          } catch {
            continue;
          }
        }

        try {
          const context = this.buildStageContext(stage, handoffStore, classification, params.workflow);
          const vars: TemplateVars = {
            userRequest,
            contextFromPreviousStages: context,
            customInstructions: (config.customTemplates as Record<string, string> | undefined)?.[templateKey],
          };
          const systemPrompt = template ? renderTemplate(template, vars) : "";
          const userPrompt = this.buildUserPrompt(stage, userRequest, handoffStore);

          machine.transitionStage(stage.id, "running", { model: fallbackModel });

          const result = await executor.executePrompt({
            sessionId,
            model: fallbackModel,
            role: stage.role,
            agent: stageAgent,
            systemPrompt,
            userPrompt,
            stageId: stage.id,
            stageRole: stage.role,
            maxTokens: stage.tokenBudget,
            timeoutMs: (stage.timeoutMs ?? DEFAULT_TIMEOUT_MS) * 1.5,
            signal: abortController.signal,
            attachedImages: params.attachedImages,
          });

          const validation = validateStageOutput(stage.id, result.response);
          if (validation.valid) {
            handoffStore.set(stage.id, validation.handoff);
            machine.transitionStage(stage.id, "succeeded", {
              model: fallbackModel,
              tokensUsed: result.tokensUsed,
              estimatedCost: result.estimatedCost,
              durationMs: result.durationMs,
            });
            executor.logDiagnostic("fallback_succeeded", { stageId: stage.id, fallbackModel });
            return;
          }
        } catch (fbErr) {
          executor.logDiagnostic("fallback_failed", {
            stageId: stage.id, fallbackModel, error: String(fbErr),
          });
        }
      }
    }

    // All attempts and fallbacks failed
    machine.transitionStage(stage.id, "failed", { error: stageError ?? "Stage failed" });
    if (stage.required !== false) {
      executor.logDiagnostic("stage_failed_terminal", { stageId: stage.id, error: stageError });
      machine.transition("failed");
    } else {
      machine.transition("completed_with_warnings");
    }
  }

  // ─── Review → Repair Loop ─────────────────────────────────────────────────

  private async handleReviewRepair(
    params: {
      sessionId: string; workflow: WorkflowDefinition; config: OrchestratedConfig;
      userRequest: string; attachedImages: boolean; repoPath?: string; focusFiles?: string[];
      executor: StageExecutor; attachmentIds?: string[];
    },
    stage: StageDefinition,
    machine: WorkflowStateMachine,
    handoffStore: HandoffStore,
    abortController: AbortController,
    executor: StageExecutor,
    stageModels: Map<string, string>,
    classification: ClassificationHandoff,
    repairState: RepairStateMachine,
    costProfile: CostProfile,
    gitState: PersistedGitState | null,
    stateByStage: Map<string, StageState>,
  ): Promise<void> {
    const reviewHf = handoffStore.get(stage.id);
    if (!reviewHf) return;

    // Extract findings
    const findingBlockers = this.extractFindings(reviewHf, stage.id);

    // Compute finding IDs for dedup detection
    const findings: RepairFinding[] = findingBlockers.map((f: { category: string; file: string; description: string }) => ({
      id: computeFindingId({
        category: f.category,
        file: f.file,
        normalizedDescription: normalizeFindingDescription(f.description ?? ""),
      }),
      category: f.category,
      file: f.file,
      description: f.description ?? "",
      evidence: f.description ?? "",
      normalizedDescription: normalizeFindingDescription(f.description ?? ""),
    }));

    const fixStage = params.workflow.stages.find((s) => s.id === "fix");
    if (!fixStage) return;

    // Check repair policy
    const progress = repairState.shouldRepair(findings, []);
    if (progress.noProgress || progress.sameAsPrevious) {
      executor.logDiagnostic("repair_skipped", {
        reason: progress.sameAsPrevious ? "repeated_findings" : "no_progress",
        pass: progress.pass,
      });
      return;
    }

    // Check if user approval is needed
    if (repairState.needsUserApproval()) {
      machine.transition("waiting_for_approval");
      executor.postPipelineProgress(machine.snapshot({ currentStageId: "fix" }));

      const approved = await this.waitForApproval(params.sessionId, "fix", executor);
      if (!approved) {
        machine.transition("running");
        repairState.recordFindings(findings);
        return;
      }
      machine.transition("running");
    }

    // Execute the fix stage
    const fixModel = stageModels.get("fix") ?? stageModels.get(stage.id);
    if (!fixModel) return;

    const fixAgent = STAGE_TO_AGENT["fix"] ?? "build";
    const templateKey = stageToRole("fix");
    const fixTemplate = getTemplateForRole(templateKey);
    const reviewSummary = JSON.stringify(findings.slice(0, 10), null, 2);

    const vars: TemplateVars = {
      userRequest: params.userRequest,
      contextFromPreviousStages: reviewSummary,
      customInstructions: (params.config.customTemplates as Record<string, string> | undefined)?.[templateKey],
    };

    const systemPrompt = fixTemplate ? renderTemplate(fixTemplate, vars) : "";

    machine.transitionStage("fix", "ready", { role: fixStage.role, model: fixModel });

    try {
      // Acquire provider permit for fix
      let fixPermit: ProviderPermit | null = null;
      if (this.providerLimiter) {
        const fbProviderId = extractProviderFromModel(fixModel);
        fixPermit = await this.providerLimiter.acquirePermit({
          provider: fbProviderId,
          modelId: fixModel,
          priority: 1,
          workflowId: params.workflow.id,
          stageId: "fix",
        }, fixStage.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      }

      const fixTemplateKey2 = stageToRole("fix");
      const fixTemplate2 = getTemplateForRole(fixTemplateKey2);
      const vars2: TemplateVars = {
        userRequest: params.userRequest,
        contextFromPreviousStages: reviewSummary,
        customInstructions: (params.config.customTemplates as Record<string, string> | undefined)?.[fixTemplateKey2],
      };

      const systemPrompt2 = fixTemplate2 ? renderTemplate(fixTemplate2, vars2) : "";

      machine.transitionStage("fix", "running");
      executor.postPipelineProgress(machine.snapshot({ currentStageId: "fix" }));

      const fixResult = await executor.executePrompt({
        sessionId: params.sessionId,
        model: fixModel,
        role: fixStage.role,
        agent: fixAgent,
        systemPrompt: systemPrompt2,
        userPrompt: params.userRequest,
        stageId: "fix",
        stageRole: fixStage.role,
        maxTokens: fixStage.tokenBudget,
        timeoutMs: fixStage.timeoutMs ?? 180_000,
        signal: abortController.signal,
        attachedImages: params.attachedImages,
      });

      const fixValidation = validateStageOutput("fix", fixResult.response);
      if (fixValidation.valid) {
        handoffStore.set("fix", fixValidation.handoff);
        machine.transitionStage("fix", "succeeded", {
          tokensUsed: fixResult.tokensUsed,
          estimatedCost: fixResult.estimatedCost,
          durationMs: fixResult.durationMs,
        });
        repairState.recordPass(progress);
        repairState.recordFindings([]);
        executor.logDiagnostic("repair_succeeded", { pass: progress.pass });
      } else {
        machine.transitionStage("fix", "failed", { error: "Fix output validation failed" });
        repairState.recordFindings(findings);
      }

      if (fixPermit) this.providerLimiter?.releasePermit(fixPermit);
    } catch (fixErr) {
      machine.transitionStage("fix", "failed", { error: String(fixErr) });
      repairState.recordFindings(findings);
    }
  }

  // ─── Legacy Sequential Path ──────────────────────────────────────────────

  private async runSequential(
    params: {
      sessionId: string; workflow: WorkflowDefinition; config: OrchestratedConfig;
      userRequest: string; attachedImages: boolean; repoPath?: string; focusFiles?: string[];
      executor: StageExecutor; attachmentIds?: string[];
    },
    machine: WorkflowStateMachine,
    handoffStore: HandoffStore,
    abortController: AbortController,
    executor: StageExecutor,
    activeStages: StageDefinition[],
    stageModels: Map<string, string>,
    classification: ClassificationHandoff,
    repairState: RepairStateMachine,
    costProfile: CostProfile,
    gitState: PersistedGitState | null,
  ): Promise<void> {
    const stateByStage = new Map<string, StageState>();

    for (const stage of activeStages) {
      if (abortController.signal.aborted) {
        machine.transition("cancelled");
        break;
      }
      if (isWorkflowTerminal(machine.getState())) break;

      await this.executeSingleStage(
        params, stage, machine, handoffStore, abortController,
        executor, stageModels, classification, repairState,
        costProfile, gitState, stateByStage,
      );
    }
  }

  // ─── Synthesis ───────────────────────────────────────────────────────────

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

      // Report token usage
      if (this.providerLimiter) {
        const providerId = extractProviderFromModel(model);
        this.providerLimiter.reportTokenUsage(providerId, result.tokensUsed);
      }

      return result.response;
    } catch (err) {
      machine.transitionStage("synthesise", "failed", { error: String(err) });
      return "Synthesis failed. Pipeline completed with partial results.";
    }
  }

  // ─── Classification ──────────────────────────────────────────────────────

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

  // ─── Stage Resolution ────────────────────────────────────────────────────

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
    if (!models.has("fix") && workflow.stages.some((s) => s.id === "fix")) {
      const fixStage = workflow.stages.find((s) => s.id === "fix")!;
      const model = this.resolveModelForStage(fixStage, config, workflow);
      if (model) models.set("fix", model);
    }
    return models;
  }

  private resolveModelForStage(stage: StageDefinition, config: OrchestratedConfig, _workflow: WorkflowDefinition): string | undefined {
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

  // ─── Approval ────────────────────────────────────────────────────────────

  private async waitForApproval(
    sessionId: string,
    stageId: string,
    executor: StageExecutor,
  ): Promise<boolean> {
    const resolver = new Promise<boolean>((resolve) => {
      this.approvalResolvers.set(`${sessionId}-${stageId}`, resolve);
    });

    executor.requestApproval(stageId);

    // Timeout after 5 minutes
    const timeout = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), 300_000);
    });

    return Promise.race([resolver, timeout]);
  }

  private shouldRequestApproval(stage: StageDefinition, config: OrchestratedConfig): boolean {
    if (stage.requiresApprovalBeforeStart) return true;
    if (stage.id === "implement" && config.requirePlanApproval) return true;
    return false;
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  private persistSnapshot(
    sessionId: string,
    machine: WorkflowStateMachine,
    handoffStore: HandoffStore,
    classification: ClassificationHandoff,
    config: OrchestratedConfig,
    gitState: PersistedGitState | null,
    coalesce: boolean,
  ): void {
    if (!this.persistenceService) return;

    const machineSnapshot = machine.snapshot();
    const snapshot = this.buildSnapshot(sessionId, machineSnapshot, handoffStore, classification, config, gitState);

    if (coalesce) {
      this.persistenceService.persistSnapshot(snapshot, false);
    } else {
      this.persistenceService.persistSnapshot(snapshot, true);
    }
  }

  private persistTerminalSnapshot(
    sessionId: string,
    machine: WorkflowStateMachine,
    handoffStore: HandoffStore,
    classification: ClassificationHandoff,
    config: OrchestratedConfig,
    gitState: PersistedGitState | null,
  ): void {
    if (!this.persistenceService) return;

    const machineSnapshot = machine.snapshot();
    const snapshot = this.buildSnapshot(sessionId, machineSnapshot, handoffStore, classification, config, gitState);

    this.persistenceService.persistTerminal(snapshot);
  }

  private buildSnapshot(
    sessionId: string,
    machineSnapshot: ReturnType<WorkflowStateMachine["snapshot"]>,
    handoffStore: HandoffStore,
    classification: ClassificationHandoff,
    config: OrchestratedConfig,
    gitState: PersistedGitState | null,
  ): WorkflowSnapshot {
    const handoffs = handoffStore.getAll();
    const machineStages = machineSnapshot.stages;

    const persistedStages: PersistedStageSnapshot[] = machineStages.map((s: StageSnapshot) => ({
      stageId: s.stageId,
      state: s.state,
      role: s.role,
      model: s.model,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      durationMs: s.durationMs,
      tokensUsed: s.tokensUsed,
      estimatedCost: s.estimatedCost,
      error: s.error,
      retryCount: s.retryCount,
      attemptCount: s.attemptHistory?.length ?? 0,
      attemptHistory: (s.attemptHistory ?? []).map((a) => ({
        model: a.model,
        startedAt: a.startedAt,
        completedAt: a.completedAt,
        state: a.state,
        tokensUsed: a.tokensUsed,
        estimatedCost: a.estimatedCost,
        error: a.error,
      })),
    }));

    const handoffRefs: PersistedHandoffReference[] = handoffs.map((h, i) => ({
      stageId: h.stage,
      stageIndex: i,
      summary: JSON.stringify(h.output).slice(0, 200),
      sizeBytes: JSON.stringify(h.output).length,
    }));

    const costProfile = COST_PROFILES[config.costProfile] ?? COST_PROFILES.balanced!;

    const budget: PersistedCostBudget = {
      runId: machineSnapshot.runId,
      totalTokensUsed: machineSnapshot.totalTokensUsed,
      totalEstimatedCost: machineSnapshot.totalEstimatedCost,
      tokenCap: costProfile.maxTokensPerRequest,
      costCap: costProfile.maxCostPerRequest,
      stageCaps: {},
      exceeded: false,
      pausedDueToBudget: false,
      userIncreasedBudget: false,
    };

    const repairState = this.repairMachines.get(sessionId);
    const repairStateData: PersistedRepairState = repairState?.getState() ?? {
      repairPasses: 0,
      maxRepairPasses: 3,
      blockedFindingIds: [],
      noProgressCount: 0,
      stoppedEarly: false,
    };

    const lockManager = this.lockManager;
    const fileBaselines: PersistedFileBaseline[] = lockManager?.getPersistedBaselines() ?? [];

    const snapshot: WorkflowSnapshot = {
      ...createEmptySnapshot({
        runId: machineSnapshot.runId,
        sessionId,
        workspaceIdentity: "default",
        workflowId: machineSnapshot.workflowId,
        workflowVersion: machineSnapshot.workflowVersion,
      }),
      schemaVersion: 1,
      status: machineSnapshot.state as WorkflowRunStatus,
      revision: machineSnapshot.revision,
      createdAt: machineSnapshot.startedAt,
      updatedAt: Date.now(),
      completedAt: machineSnapshot.completedAt,
      currentStageIds: machineSnapshot.currentStageId ? [machineSnapshot.currentStageId] : [],
      stages: persistedStages,
      handoffs: handoffRefs,
      budget,
      repairState: repairStateData,
      fileBaselines,
      userRequestSummary: classification.taskType,
      gitInitialState: gitState ?? undefined,
    };

    return snapshot;
  }

  private restoreMachineFromSnapshot(snapshot: WorkflowSnapshot): WorkflowStateMachine {
    const machine = new WorkflowStateMachine(
      snapshot.runId,
      snapshot.workflowId,
      snapshot.workflowVersion,
    );

    // Restore workflow state
    if (snapshot.status !== "created") {
      const stateMap: Record<string, string> = {
        created: "created",
        classifying: "classifying",
        running: "running",
        paused: "paused",
        cancelled: "cancelled",
        failed: "failed",
        completed: "completed",
        completed_with_warnings: "completed_with_warnings",
        recovering: "recovering",
        waiting_for_approval: "waiting_for_approval",
        cancelling: "cancelling",
        interrupted: "failed",
      };

      const wfState = stateMap[snapshot.status] ?? "recovering";
      machine.transition(wfState as never);
    }

    // Restore stage states
    for (const stage of snapshot.stages) {
      machine.transitionStage(stage.stageId, stage.state, {
        role: stage.role,
        model: stage.model,
        startedAt: stage.startedAt,
        completedAt: stage.completedAt,
        durationMs: stage.durationMs,
        tokensUsed: stage.tokensUsed,
        estimatedCost: stage.estimatedCost,
        error: stage.error,
        retryCount: stage.retryCount,
      });
    }

    // Restore file baselines in lock manager
    if (this.lockManager && snapshot.fileBaselines.length > 0) {
      this.lockManager.restoreBaselines(snapshot.fileBaselines);
    }

    // Restore repair state
    if (snapshot.repairState) {
      this.repairMachines.set(snapshot.sessionId, new RepairStateMachine(
        { maxPasses: snapshot.repairState.maxRepairPasses },
        snapshot.repairState,
      ));
    }

    return machine;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private extractFindings(handoff: unknown, stageId: string): Array<{ category: string; file: string; description: string }> {
    const items: Array<{ category: string; file: string; description: string }> = [];
    if (!handoff || typeof handoff !== "object") return items;

    const h = handoff as Record<string, unknown>;
    const output = h.output as Record<string, unknown> | undefined;
    if (!output) return items;

    if (output.findings && Array.isArray(output.findings)) {
      for (const f of output.findings) {
        const finding = f as Record<string, unknown>;
        items.push({
          category: (finding.category as string) ?? stageId,
          file: (finding.file as string) ?? "",
          description: (finding.evidence as string) ?? (finding.recommendedFix as string) ?? "",
        });
      }
    }

    return items;
  }

  private getTargetFilesForStage(stage: StageDefinition, handoffStore: HandoffStore): string[] {
    if (stage.id === "implement" || stage.id === "fix") {
      const planHf = handoffStore.get("plan");
      if (planHf && planHf.stage === "plan") {
        return planHf.output.filesAffected ?? [];
      }
    }
    return [];
  }

  private getTerminalResponse(machine: WorkflowStateMachine): string {
    const s = machine.getState();
    if (s === "completed_with_warnings") {
      return "Pipeline completed with warnings. Check stage details for more information.";
    }
    if (s === "failed") {
      let response = "Pipeline failed. Check stage details for error information.";
      const failedStage = machine.getAllStages().find((st) => st.state === "failed");
      if (failedStage?.error) {
        response += `\n\nError in stage "${failedStage.stageId}": ${failedStage.error}`;
      }
      return response;
    }
    if (s === "cancelled") {
      return "Pipeline cancelled.";
    }
    return "Pipeline completed with partial results.";
  }

  private backoff(attempt: number): Promise<void> {
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  // ─── Public Control API ──────────────────────────────────────────────────

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
    if (this.lockManager) {
      this.lockManager.releaseAllForSession(sessionId);
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

  /**
   * Override the model for a specific stage in a running pipeline.
   */
  overrideStageModel(sessionId: string, stageId: string, model: string): boolean {
    const machine = this.machines.get(sessionId);
    if (!machine) return false;
    const snap = machine.getStageSnapshot(stageId);
    if (!snap || isStageTerminal(snap.state)) return false;
    machine.transitionStage(stageId, snap.state, { model });
    return true;
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
    this.repairMachines.delete(sessionId);
    this.gitStates.delete(sessionId);
    if (this.lockManager) {
      this.lockManager.releaseAllForSession(sessionId);
    }
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId);
  }

  /**
   * Get the persisted snapshot for a session (for recovery).
   */
  getPersistedSnapshot(sessionId: string): WorkflowSnapshot | null {
    if (!this.persistenceService) return null;
    return this.persistenceService.loadSnapshot(sessionId);
  }

  /**
   * Get all active/restorable workflows from persistence.
   */
  getActiveWorkflowsFromPersistence(): WorkflowSnapshot[] {
    if (!this.persistenceService) return [];
    return this.persistenceService.loadActiveWorkflows();
  }
}

// ─── Helper ────────────────────────────────────────────────────────────────

function fromSnapshot(params: { fromSnapshot?: WorkflowSnapshot }): string | undefined {
  if (params.fromSnapshot) return params.fromSnapshot.runId;
  return undefined;
}
