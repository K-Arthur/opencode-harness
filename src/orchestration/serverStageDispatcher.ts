import type { Message, Part, TextPartInput } from "@opencode-ai/sdk/v2"
import { parseModelRef } from "../utils/tokenCounter"
import { sdkMessageToChatMessage } from "../session/sdkMessageConverter"
import type { SessionManager } from "../session/SessionManager"
import type { ModelRef, PromptOptions } from "../session/SessionManager"
import type { StreamCallbacks } from "../chat/handlers/StreamCoordinatorTypes"
import type { StageDispatcher } from "./pipelineCoordinator"
import type { PipelineState, PipelineStageSnapshot } from "./types"
import { log } from "../utils/outputChannel"

interface ServerStageDispatcherDeps {
  sessionManager: SessionManager
  callbacks: StreamCallbacks
  cliSessionId: string
  tabId: string
  abortController: AbortController
}

function responseTextFromParts(parts: Part[]): string {
  const chatMessage = sdkMessageToChatMessage({ role: "assistant", id: "", time: { created: Date.now() } } as Message, parts)
  if (!chatMessage) return ""
  return chatMessage.blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof (b as { text?: unknown }).text === "string")
    .map((b) => (b as { text: string }).text)
    .join("\n")
}

function agentForStage(stageId: string, role: string): "plan" | "build" {
  if (role === "implementation" || role === "debugging" || stageId === "implement" || stageId === "fix" || stageId === "document") {
    return "build"
  }
  return "plan"
}

function buildModelRef(model: string): ModelRef | undefined {
  if (!model) return undefined
  if (!model.includes("/")) return undefined
  return parseModelRef(model)
}

export function createServerStageDispatcher(deps: ServerStageDispatcherDeps): StageDispatcher {
  const { sessionManager, callbacks, cliSessionId, tabId, abortController } = deps

  return {
    async executePrompt({ sessionId, model, role, systemPrompt, userPrompt, stageId, timeoutMs, signal }) {
      const effectiveSignal = signal ?? abortController.signal
      if (effectiveSignal.aborted) {
        throw new Error("Aborted")
      }

      const modelRef = buildModelRef(model)
      const agent = agentForStage(stageId, role)
      const parts: TextPartInput[] = []
      if (systemPrompt) parts.push({ type: "text", text: systemPrompt })
      if (userPrompt) parts.push({ type: "text", text: userPrompt })

      const startedAt = Date.now()
      const options: PromptOptions = { model: modelRef, agent }
      const sendPromise = sessionManager.sendPrompt(cliSessionId, parts, options)
      const result = timeoutMs && timeoutMs > 0
        ? await Promise.race([
            sendPromise,
            new Promise<never>((_, reject) => {
              const id = setTimeout(() => reject(new Error(`Stage ${stageId} timed out after ${timeoutMs}ms`)), timeoutMs)
              if (typeof id === "object" && typeof (id as { unref?: () => void }).unref === "function") {
                ;(id as { unref: () => void }).unref()
              }
            }),
          ])
        : await sendPromise

      if (effectiveSignal.aborted) {
        throw new Error("Aborted")
      }

      const responseText = responseTextFromParts((result as { parts: Part[] }).parts)
      const durationMs = Date.now() - startedAt
      const tokensUsed = Math.ceil((systemPrompt.length + userPrompt.length + responseText.length) / 4)

      return { response: responseText, tokensUsed, estimatedCost: 0, durationMs }
    },

    postPipelineProgress(state: PipelineState, currentStage?: PipelineStageSnapshot): void {
      callbacks.postMessage({
        type: "pipeline_progress",
        sessionId: tabId,
        state,
        currentStage,
      })
    },

    isCancelled(): boolean {
      return abortController.signal.aborted
    },

    logDiagnostic(sessionId: string, event: string, data?: Record<string, unknown>): void {
      log.info(`[orchestration ${sessionId}] ${event}`, data)
    },
  }
}
