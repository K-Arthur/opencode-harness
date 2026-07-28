import { PIPELINE_STAGE_LABELS, type PipelineStageId } from "../../../orchestration/types";

export interface PipelineStageSnapshotUI {
  stageId: PipelineStageId;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "cancelled";
  model: string;
  startedAt?: number;
  completedAt?: number;
  tokensUsed?: number;
  estimatedCost?: number;
  error?: string;
  retryCount?: number;
}

export interface PipelineStateUI {
  sessionId: string;
  workflowId: string;
  stages: PipelineStageSnapshotUI[];
  currentStageIndex: number;
  status: "running" | "completed" | "failed" | "cancelled";
  totalTokensUsed: number;
  totalEstimatedCost: number;
  runId?: string;
  workflowState?: string;
  revision?: number;
  /** Recovery state after reload */
  recoveryState?: string;
  /** Repair loop info */
  repairPass?: number;
  repairMaxPasses?: number;
}

export interface PipelineProgressElements {
  container: HTMLElement;
  stageList: HTMLElement;
  summaryRow: HTMLElement;
  controlsRow: HTMLElement;
}

export type PipelineControlAction =
  | { type: "cancel" }
  | { type: "cancel_stage"; stageId: string }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "retry_stage"; stageId: string; model?: string }
  | { type: "skip_stage"; stageId: string }
  | { type: "approve_stage"; stageId: string; approved: boolean }
  | { type: "override_model"; stageId: string; model: string }
  | { type: "pause_after_stage"; stageId: string }
  | { type: "approve_plan"; approvalId: string; decision: "approve" | "reject" }
  | { type: "confirm_recovery"; action: "continue" | "cancel" | "review" }
  | { type: "stop_with_results" };

export type PipelineControlHandler = (action: PipelineControlAction) => void;

export function renderPipelineProgress(
  state: PipelineStateUI,
  els: PipelineProgressElements,
  onControl?: PipelineControlHandler,
): void {
  const { container, stageList, summaryRow, controlsRow } = els;

  container.classList.remove("hidden");
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", `Orchestration pipeline — ${state.status}`);

  // Render recovery banner if applicable
  if (state.recoveryState) {
    renderRecoveryBanner(container, state, onControl);
  }

  // Render stage list
  stageList.innerHTML = "";
  for (let i = 0; i < state.stages.length; i++) {
    const stage = state.stages[i]!;
    const row = createStageRow(stage, i === state.currentStageIndex, state.status, state.workflowState, onControl);
    stageList.appendChild(row);
  }

  // Render summary
  summaryRow.innerHTML = "";
  const tokensEl = document.createElement("span");
  tokensEl.className = "pipeline-summary-tokens";
  tokensEl.textContent = `${(state.totalTokensUsed / 1000).toFixed(1)}K tokens`;

  const costEl = document.createElement("span");
  costEl.className = "pipeline-summary-cost";
  costEl.textContent = state.totalEstimatedCost > 0 ? `$${state.totalEstimatedCost.toFixed(4)}` : "";

  const statusEl = document.createElement("span");
  statusEl.className = `pipeline-summary-status pipeline-summary-status--${state.status}`;
  statusEl.textContent = getStatusLabel(state);

  summaryRow.appendChild(tokensEl);
  if (costEl.textContent) {
    summaryRow.appendChild(document.createTextNode(" · "));
    summaryRow.appendChild(costEl);
  }
  summaryRow.appendChild(document.createTextNode(" · "));
  summaryRow.appendChild(statusEl);

  // Repair pass info
  if (state.repairPass && state.repairMaxPasses) {
    const repairEl = document.createElement("span");
    repairEl.className = "pipeline-summary-repair";
    repairEl.textContent = ` · Repair ${state.repairPass}/${state.repairMaxPasses}`;
    summaryRow.appendChild(repairEl);
  }

  // Render controls
  controlsRow.innerHTML = "";
  if (onControl) {
    if (state.status === "running" || state.workflowState === "waiting_for_approval") {
      const pauseBtn = createControlButton("Pause", "pipeline-ctrl-pause", () => onControl({ type: "pause" }));
      controlsRow.appendChild(pauseBtn);
      const cancelBtn = createControlButton("Cancel", "pipeline-ctrl-cancel", () => onControl({ type: "cancel" }));
      cancelBtn.className = "pipeline-ctrl-btn pipeline-ctrl-cancel";
      controlsRow.appendChild(cancelBtn);
    }

    // Recovery controls
    if (state.recoveryState === "pending_user_review" || state.recoveryState === "pending_user_confirmation") {
      const continueBtn = createControlButton("Continue", "pipeline-ctrl-recover", () => onControl({ type: "confirm_recovery", action: "continue" }));
      controlsRow.appendChild(continueBtn);
      const reviewBtn = createControlButton("Review", "pipeline-ctrl-review", () => onControl({ type: "confirm_recovery", action: "review" }));
      controlsRow.appendChild(reviewBtn);
      const cancelBtn = createControlButton("Cancel", "pipeline-ctrl-cancel", () => onControl({ type: "confirm_recovery", action: "cancel" }));
      cancelBtn.className = "pipeline-ctrl-btn pipeline-ctrl-cancel";
      controlsRow.appendChild(cancelBtn);
    }
  }
}

function renderRecoveryBanner(
  container: HTMLElement,
  state: PipelineStateUI,
  onControl?: PipelineControlHandler,
): void {
  const existing = container.querySelector(".pipeline-recovery-banner");
  if (existing) return;

  const banner = document.createElement("div");
  banner.className = "pipeline-recovery-banner";
  banner.setAttribute("role", "alert");

  const message = document.createElement("span");
  message.className = "pipeline-recovery-message";
  message.textContent = state.recoveryState === "pending_user_review"
    ? "Pipeline recovered from reload — review before continuing"
    : state.recoveryState === "pending_user_confirmation"
      ? "Pipeline recovered — confirm to continue"
      : "Pipeline recovered";
  banner.appendChild(message);

  container.prepend(banner);
}

function createStageRow(
  stage: PipelineStageSnapshotUI,
  isCurrent: boolean,
  pipelineStatus: string,
  workflowState?: string,
  onControl?: PipelineControlHandler,
): HTMLElement {
  const row = document.createElement("div");
  row.className = `pipeline-stage pipeline-stage--${stage.status}`;
  if (isCurrent) row.classList.add("pipeline-stage--current");

  // Status indicator
  const indicator = document.createElement("span");
  indicator.className = "pipeline-stage-indicator";
  indicator.setAttribute("aria-hidden", "true");
  indicator.textContent = stage.status === "completed"
    ? "✓"
    : stage.status === "running"
      ? "⟳"
      : stage.status === "failed"
        ? "✗"
        : stage.status === "cancelled"
          ? "–"
          : stage.status === "skipped"
            ? "→"
            : "○";
  row.appendChild(indicator);

  // Info: label + model
  const info = document.createElement("span");
  info.className = "pipeline-stage-info";

  const label = document.createElement("span");
  label.className = "pipeline-stage-label";
  label.textContent = PIPELINE_STAGE_LABELS[stage.stageId] ?? stage.stageId;
  info.appendChild(label);

  if (stage.model && stage.status !== "pending") {
    const modelBadge = document.createElement("span");
    modelBadge.className = "pipeline-stage-model";
    modelBadge.textContent = shortenModelName(stage.model);
    info.appendChild(modelBadge);
  }

  // Retry count badge
  if (stage.retryCount && stage.retryCount > 1) {
    const retryBadge = document.createElement("span");
    retryBadge.className = "pipeline-stage-retry";
    retryBadge.textContent = `×${stage.retryCount}`;
    info.appendChild(retryBadge);
  }

  row.appendChild(info);

  // Duration
  if (stage.completedAt && stage.startedAt) {
    const duration = document.createElement("span");
    duration.className = "pipeline-stage-duration";
    duration.textContent = formatDuration(stage.completedAt - stage.startedAt);
    row.appendChild(duration);
  }

  // Token/cost info for completed stages
  if (stage.tokensUsed && stage.tokensUsed > 0) {
    const meta = document.createElement("span");
    meta.className = "pipeline-stage-meta";
    meta.textContent = `${(stage.tokensUsed / 1000).toFixed(1)}K`;
    if (stage.estimatedCost && stage.estimatedCost > 0) {
      meta.textContent += ` · $${stage.estimatedCost.toFixed(4)}`;
    }
    row.appendChild(meta);
  }

  // Error tooltip
  if (stage.error) {
    row.title = stage.error;
    row.classList.add("pipeline-stage--has-error");
  }

  // Control buttons for failed/cancelled stages
  if (onControl && (stage.status === "failed" || stage.status === "cancelled")) {
    const actions = document.createElement("span");
    actions.className = "pipeline-stage-actions";

    const retryBtn = createControlButton("↻", "pipeline-ctrl-retry", (e) => {
      e.stopPropagation();
      onControl({ type: "retry_stage", stageId: stage.stageId });
    });
    retryBtn.title = "Retry this stage";
    retryBtn.setAttribute("aria-label", `Retry ${PIPELINE_STAGE_LABELS[stage.stageId] ?? stage.stageId}`);
    actions.appendChild(retryBtn);

    // Model override button
    if (stage.status === "failed") {
      const modelBtn = createControlButton("Model", "pipeline-ctrl-model", (e) => {
        e.stopPropagation();
        const newModel = prompt(`Enter model ID to retry ${stage.stageId}:`, stage.model);
        if (newModel && newModel.trim()) {
          onControl({ type: "override_model", stageId: stage.stageId, model: newModel.trim() });
        }
      });
      modelBtn.title = "Retry with a different model";
      modelBtn.setAttribute("aria-label", `Retry with model for ${PIPELINE_STAGE_LABELS[stage.stageId] ?? stage.stageId}`);
      actions.appendChild(modelBtn);
    }

    const skipBtn = createControlButton("Skip", "pipeline-ctrl-skip", (e) => {
      e.stopPropagation();
      onControl({ type: "skip_stage", stageId: stage.stageId });
    });
    skipBtn.title = "Skip this stage";
    skipBtn.setAttribute("aria-label", `Skip ${PIPELINE_STAGE_LABELS[stage.stageId] ?? stage.stageId}`);
    actions.appendChild(skipBtn);

    row.appendChild(actions);
  }

  // Controls for running stage
  if (onControl && stage.status === "running" && pipelineStatus === "running") {
    const actions = document.createElement("span");
    actions.className = "pipeline-stage-actions";

    const cancelBtn = createControlButton("Cancel", "pipeline-ctrl-cancel-stage", (e) => {
      e.stopPropagation();
      onControl({ type: "cancel_stage", stageId: stage.stageId });
    });
    cancelBtn.title = "Cancel this stage";
    cancelBtn.setAttribute("aria-label", `Cancel ${PIPELINE_STAGE_LABELS[stage.stageId] ?? stage.stageId}`);
    actions.appendChild(cancelBtn);

    // Pause after this stage
    const pauseAfterBtn = createControlButton("Pause →", "pipeline-ctrl-pause-after", (e) => {
      e.stopPropagation();
      onControl({ type: "pause_after_stage", stageId: stage.stageId });
    });
    pauseAfterBtn.title = "Pause after this stage completes";
    pauseAfterBtn.setAttribute("aria-label", `Pause after ${PIPELINE_STAGE_LABELS[stage.stageId] ?? stage.stageId}`);
    actions.appendChild(pauseAfterBtn);

    row.appendChild(actions);
  }

  return row;
}

function createControlButton(text: string, className: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = `pipeline-ctrl-btn ${className}`;
  btn.textContent = text;
  btn.type = "button";
  btn.addEventListener("click", onClick);
  return btn;
}

function getStatusLabel(state: PipelineStateUI): string {
  if (state.recoveryState) return "Recovering";
  if (state.workflowState === "waiting_for_approval") return "Awaiting approval";
  return state.status === "running" ? "Running"
    : state.status === "completed" ? "Completed"
      : state.status === "failed" ? "Failed"
        : "Cancelled";
}

// ─── Approval Banner ───────────────────────────────────────────────────────

export function showApprovalBanner(
  container: HTMLElement,
  stageId: string,
  onApprove: () => void,
  onReject: () => void,
  onEdit?: () => void,
  onModelOverride?: (model: string) => void,
): HTMLElement {
  const banner = document.createElement("div");
  banner.className = "pipeline-approval-banner";
  banner.setAttribute("role", "alertdialog");
  banner.setAttribute("aria-label", "Stage approval required");

  const message = document.createElement("span");
  message.className = "pipeline-approval-message";
  message.textContent = `Stage "${PIPELINE_STAGE_LABELS[stageId as PipelineStageId] ?? stageId}" is ready. Approve to proceed.`;
  banner.appendChild(message);

  const actions = document.createElement("span");
  actions.className = "pipeline-approval-actions";

  const approveBtn = createControlButton("Approve", "pipeline-ctrl-approve", () => {
    banner.remove();
    onApprove();
  });
  actions.appendChild(approveBtn);

  const rejectBtn = createControlButton("Reject", "pipeline-ctrl-reject", () => {
    banner.remove();
    onReject();
  });
  rejectBtn.className = "pipeline-ctrl-btn pipeline-ctrl-cancel";
  actions.appendChild(rejectBtn);

  if (onEdit) {
    const editBtn = createControlButton("Edit Plan", "pipeline-ctrl-edit", () => {
      banner.remove();
      onEdit();
    });
    actions.appendChild(editBtn);
  }

  if (onModelOverride) {
    const modelBtn = createControlButton("Change Model", "pipeline-ctrl-model", () => {
      const newModel = prompt("Enter model ID to use for implementation:");
      if (newModel && newModel.trim()) {
        banner.remove();
        onModelOverride(newModel.trim());
      }
    });
    actions.appendChild(modelBtn);
  }

  banner.appendChild(actions);
  container.prepend(banner);
  return banner;
}

// ─── Recovery Banner ───────────────────────────────────────────────────────

export function showRecoveryBanner(
  container: HTMLElement,
  state: PipelineStateUI,
  onContinue: () => void,
  onCancel: () => void,
  onReview?: () => void,
): HTMLElement {
  const banner = document.createElement("div");
  banner.className = "pipeline-recovery-banner";
  banner.setAttribute("role", "alertdialog");
  banner.setAttribute("aria-label", "Pipeline recovery");

  const message = document.createElement("span");
  message.className = "pipeline-recovery-message";
  message.textContent = "Pipeline was interrupted. Review the state and choose an action.";
  banner.appendChild(message);

  const actions = document.createElement("span");
  actions.className = "pipeline-recovery-actions";

  const continueBtn = createControlButton("Continue", "pipeline-ctrl-recover", () => {
    banner.remove();
    onContinue();
  });
  actions.appendChild(continueBtn);

  if (onReview) {
    const reviewBtn = createControlButton("Review", "pipeline-ctrl-review", () => {
      banner.remove();
      onReview();
    });
    actions.appendChild(reviewBtn);
  }

  const cancelBtn = createControlButton("Cancel", "pipeline-ctrl-cancel", () => {
    banner.remove();
    onCancel();
  });
  cancelBtn.className = "pipeline-ctrl-btn pipeline-ctrl-cancel";
  actions.appendChild(cancelBtn);

  banner.appendChild(actions);
  container.prepend(banner);
  return banner;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function shortenModelName(model: string): string {
  const parts = model.split("/");
  if (parts.length >= 2) {
    const provider = parts[0]!.length > 8 ? parts[0]!.slice(0, 6) + "…" : parts[0]!;
    const name = parts.slice(1).join("/");
    return `${provider}/${name}`;
  }
  return model.length > 20 ? model.slice(0, 18) + "…" : model;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

export function hidePipelineProgress(els: PipelineProgressElements): void {
  els.container.classList.add("hidden");
}

export function createPipelineProgressElements(container: HTMLElement): PipelineProgressElements {
  const pipelineContainer = document.createElement("div");
  pipelineContainer.id = "pipeline-progress";
  pipelineContainer.className = "pipeline-progress hidden";
  pipelineContainer.setAttribute("role", "region");
  pipelineContainer.setAttribute("aria-label", "Orchestration pipeline progress");

  const header = document.createElement("div");
  header.className = "pipeline-progress-header";

  const title = document.createElement("span");
  title.className = "pipeline-progress-title";
  title.textContent = "Pipeline";
  header.appendChild(title);

  pipelineContainer.appendChild(header);

  const stageList = document.createElement("div");
  stageList.className = "pipeline-stage-list";
  stageList.setAttribute("role", "list");
  stageList.setAttribute("aria-label", "Pipeline stages");
  pipelineContainer.appendChild(stageList);

  const summaryRow = document.createElement("div");
  summaryRow.className = "pipeline-progress-summary";
  pipelineContainer.appendChild(summaryRow);

  const controlsRow = document.createElement("div");
  controlsRow.className = "pipeline-progress-controls";
  pipelineContainer.appendChild(controlsRow);

  container.appendChild(pipelineContainer);

  return {
    container: pipelineContainer,
    stageList,
    summaryRow,
    controlsRow,
  };
}

export function getPipelineProgressElements(container: HTMLElement): PipelineProgressElements | null {
  const pipelineContainer = container.querySelector("#pipeline-progress") as HTMLElement | null;
  if (!pipelineContainer) return null;
  const stageList = pipelineContainer.querySelector(".pipeline-stage-list") as HTMLElement | null;
  const summaryRow = pipelineContainer.querySelector(".pipeline-progress-summary") as HTMLElement | null;
  const controlsRow = pipelineContainer.querySelector(".pipeline-progress-controls") as HTMLElement | null;
  if (!stageList || !summaryRow || !controlsRow) return null;
  return { container: pipelineContainer, stageList, summaryRow, controlsRow };
}
