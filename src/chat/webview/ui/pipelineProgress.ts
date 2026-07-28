/**
 * Pipeline Progress UI — displays the current state of the orchestrated pipeline.
 *
 * Renders a compact progress indicator showing:
 * - Current stage (animate-visible)
 * - Completed stages (checkmark)
 * - Failed stages (error indicator)
 * - Stage label and model name
 * - Token usage and estimated cost
 */

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
}

export interface PipelineStateUI {
  sessionId: string;
  workflowId: string;
  stages: PipelineStageSnapshotUI[];
  currentStageIndex: number;
  status: "running" | "completed" | "failed" | "cancelled";
  totalTokensUsed: number;
  totalEstimatedCost: number;
}

export interface PipelineProgressElements {
  container: HTMLElement;
  stageList: HTMLElement;
  summaryRow: HTMLElement;
}

/**
 * Render the full pipeline progress UI.
 */
export function renderPipelineProgress(
  state: PipelineStateUI,
  els: PipelineProgressElements,
): void {
  const { container, stageList, summaryRow } = els;

  container.classList.remove("hidden");
  container.setAttribute("role", "status");
  container.setAttribute("aria-label", `Orchestration pipeline ${state.status}`);

  // Render stage list
  stageList.innerHTML = "";
  for (let i = 0; i < state.stages.length; i++) {
    const stage = state.stages[i]!;
    const row = createStageRow(stage, i === state.currentStageIndex);
    stageList.appendChild(row);
  }

  // Render summary
  summaryRow.innerHTML = "";
  const tokensEl = document.createElement("span");
  tokensEl.className = "pipeline-summary-tokens";
  tokensEl.textContent = `${(state.totalTokensUsed / 1000).toFixed(1)}K tokens`;

  const costEl = document.createElement("span");
  costEl.className = "pipeline-summary-cost";
  costEl.textContent = `$${state.totalEstimatedCost.toFixed(4)}`;

  const statusEl = document.createElement("span");
  statusEl.className = `pipeline-summary-status pipeline-summary-status--${state.status}`;
  statusEl.textContent = state.status === "running" ? "Running" : state.status === "completed" ? "Completed" : state.status === "failed" ? "Failed" : "Cancelled";

  summaryRow.appendChild(tokensEl);
  summaryRow.appendChild(document.createTextNode(" · "));
  summaryRow.appendChild(costEl);
  summaryRow.appendChild(document.createTextNode(" · "));
  summaryRow.appendChild(statusEl);
}

function createStageRow(stage: PipelineStageSnapshotUI, isCurrent: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = `pipeline-stage pipeline-stage--${stage.status}`;
  if (isCurrent) row.classList.add("pipeline-stage--current");

  // Status indicator
  const indicator = document.createElement("span");
  indicator.className = "pipeline-stage-indicator";
  indicator.setAttribute("aria-hidden", "true");
  indicator.textContent = stage.status === "completed" ? "✓" : stage.status === "running" ? "⟳" : stage.status === "failed" ? "✗" : stage.status === "cancelled" ? "–" : "○";
  row.appendChild(indicator);

  // Label + model
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

  row.appendChild(info);

  // Duration
  if (stage.completedAt && stage.startedAt) {
    const duration = document.createElement("span");
    duration.className = "pipeline-stage-duration";
    duration.textContent = formatDuration(stage.completedAt - stage.startedAt);
    row.appendChild(duration);
  }

  // Error tooltip
  if (stage.error) {
    row.title = stage.error;
    row.classList.add("pipeline-stage--has-error");
  }

  return row;
}

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
  // Pipeline container
  const pipelineContainer = document.createElement("div");
  pipelineContainer.id = "pipeline-progress";
  pipelineContainer.className = "pipeline-progress hidden";
  pipelineContainer.setAttribute("role", "region");
  pipelineContainer.setAttribute("aria-label", "Orchestration pipeline progress");

  // Header
  const header = document.createElement("div");
  header.className = "pipeline-progress-header";
  header.textContent = "Pipeline";
  pipelineContainer.appendChild(header);

  // Stage list
  const stageList = document.createElement("div");
  stageList.className = "pipeline-stage-list";
  stageList.setAttribute("role", "list");
  stageList.setAttribute("aria-label", "Pipeline stages");
  pipelineContainer.appendChild(stageList);

  // Summary
  const summaryRow = document.createElement("div");
  summaryRow.className = "pipeline-progress-summary";
  pipelineContainer.appendChild(summaryRow);

  container.appendChild(pipelineContainer);

  return {
    container: pipelineContainer,
    stageList,
    summaryRow,
  };
}
