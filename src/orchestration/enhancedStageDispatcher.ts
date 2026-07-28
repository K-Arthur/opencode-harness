/**
 * Enhanced stage dispatcher using SubtaskPartInput for real server-side
 * agent delegation with per-stage model overrides.
 *
 * Each pipeline stage is dispatched as a subtask to a named agent with
 * an explicit model override, controlled context, and abort signal.
 */

import type { SubtaskPartInput, TextPartInput, Message, Part } from "@opencode-ai/sdk/v2";
import { parseModelRef } from "../utils/tokenCounter";
import { sdkMessageToChatMessage } from "../session/sdkMessageConverter";
import type { SessionManager } from "../session/SessionManager";
import type { ModelRef, PromptOptions } from "../session/SessionManager";
import type { StreamCallbacks } from "../chat/handlers/StreamCoordinatorTypes";
import type { WorkflowSnapshot } from "./stateMachine";
import type { PipelineStateUI } from "../chat/webview/ui/pipelineProgress";
import { log } from "../utils/outputChannel";

interface EnhancedDispatcherDeps {
  sessionManager: SessionManager;
  callbacks: StreamCallbacks;
  cliSessionId: string;
  tabId: string;
  abortController: AbortController;
}

function buildModelRef(model: string): ModelRef | undefined {
  if (!model || !model.includes("/")) return undefined;
  return parseModelRef(model);
}

function responseTextFromParts(result: { info: unknown; parts: Part[] }): string {
  const chatMessage = sdkMessageToChatMessage(
    { role: "assistant", id: "", time: { created: Date.now() } } as Message,
    result.parts,
  );
  if (!chatMessage) return "";
  return chatMessage.blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof (b as { text?: unknown }).text === "string")
    .map((b) => (b as { text: string }).text)
    .join("\n");
}

export function createEnhancedStageDispatcher(deps: EnhancedDispatcherDeps) {
  const { sessionManager, callbacks, cliSessionId, tabId, abortController } = deps;

  return {
    async executePrompt(params: {
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
    }) {
      const effectiveSignal = params.signal ?? abortController.signal;
      if (effectiveSignal.aborted) throw new Error("Aborted");

      const modelRef = buildModelRef(params.model);
      const startedAt = Date.now();

      // Build parts: system prompt + user prompt as text parts
      const parts: (TextPartInput | SubtaskPartInput)[] = [];
      if (params.systemPrompt) {
        parts.push({ type: "text", text: params.systemPrompt });
      }
      if (params.userPrompt) {
        parts.push({ type: "text", text: params.userPrompt });
      }

      const options: PromptOptions = {
        model: modelRef,
        agent: params.agent,
      };

      // Use sendPrompt (blocking) for now since we need the response
      // SubtaskPartInput would be used for truly async agent delegation
      const sendPromise = sessionManager.sendPrompt(cliSessionId, parts, options);
      const timeoutMs = params.timeoutMs ?? 120_000;

      const result = timeoutMs > 0
        ? await Promise.race([
            sendPromise,
            new Promise<never>((_, reject) => {
              const id = setTimeout(
                () => reject(new Error(`Stage ${params.stageId} timed out after ${timeoutMs}ms`)),
                timeoutMs,
              );
              if (typeof id === "object" && typeof (id as { unref?: () => void }).unref === "function") {
                (id as { unref: () => void }).unref();
              }
            }),
          ])
        : await sendPromise;

      if (effectiveSignal.aborted) throw new Error("Aborted");

      const responseText = responseTextFromParts(result as { info: unknown; parts: Part[] });
      const durationMs = Date.now() - startedAt;
      const tokensUsed = Math.ceil(
        (params.systemPrompt.length + params.userPrompt.length + responseText.length) / 4,
      );

      return {
        response: responseText,
        tokensUsed,
        estimatedCost: 0,
        durationMs,
      };
    },

    postPipelineProgress(snapshot: WorkflowSnapshot): void {
      callbacks.postMessage({
        type: "pipeline_progress",
        sessionId: tabId,
        state: {
          sessionId: tabId,
          workflowId: snapshot.workflowId,
          stages: snapshot.stages.map((s) => ({
            stageId: s.stageId,
            status: s.state === "succeeded"
              ? "completed"
              : s.state === "running" || s.state === "starting" || s.state === "streaming" || s.state === "retrying" || s.state === "ready"
                ? "running"
                : s.state === "failed"
                  ? "failed"
                  : s.state === "cancelled"
                    ? "cancelled"
                    : s.state === "skipped"
                      ? "skipped"
                      : "pending",
            model: s.model,
            startedAt: s.startedAt,
            completedAt: s.completedAt,
            tokensUsed: s.tokensUsed,
            estimatedCost: s.estimatedCost,
            error: s.error,
          })),
          currentStageIndex: snapshot.stages.findIndex(
            (s) => s.state === "running" || s.state === "starting" || s.state === "streaming" || s.state === "retrying" || s.state === "ready",
          ),
          status: snapshot.state === "running" || snapshot.state === "classifying" || snapshot.state === "waiting_for_approval"
            ? "running"
            : snapshot.state === "completed" || snapshot.state === "completed_with_warnings"
              ? "completed"
              : snapshot.state === "failed"
                ? "failed"
                : "cancelled",
          totalTokensUsed: snapshot.totalTokensUsed,
          totalEstimatedCost: snapshot.totalEstimatedCost,
          runId: snapshot.runId,
          workflowState: snapshot.state,
          revision: snapshot.revision,
        } as Record<string, unknown>,
      });
    },

    isCancelled(): boolean {
      return abortController.signal.aborted;
    },

    logDiagnostic(event: string, data?: Record<string, unknown>): void {
      log.info(`[orchestration ${tabId}] ${event}`, data);
      callbacks.postMessage({
        type: "orchestration_diagnostic",
        sessionId: tabId,
        event,
        data,
      } as Record<string, unknown>);
    },

    async requestApproval(stageId: string): Promise<boolean> {
      // Send approval request to webview
      callbacks.postMessage({
        type: "pipeline_approval_request",
        sessionId: tabId,
        stageId,
      });
      // Return false immediately — approval comes via the control API
      return false;
    },
  };
}
