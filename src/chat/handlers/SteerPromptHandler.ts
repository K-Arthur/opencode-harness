import { StreamCoordinator } from "./StreamCoordinator"
import { SessionStore } from "../../session/SessionStore"
import type { SteerPrompt, ChatMessage, Block } from "../types"
import type { HostPromptQueue } from "../HostPromptQueue"
import { log } from "../../utils/outputChannel"
import { generateUserMessageId } from "../../session/messageId"

export interface StreamCallbacks {
  postMessage: (msg: Record<string, unknown>) => void | boolean | Thenable<boolean | void>
  postRequestError: (message: string, sessionId?: string) => void
}

/**
 * Handles messages submitted while the AI is still streaming.
 *
 * Two behaviors (the old "append" mode was folded into "queue" — same intent,
 * "run after the current turn", but with visible, editable queue feedback):
 * - queue (default): add to the visible HostPromptQueue, drained FIFO after the
 *   current turn ends. Never aborts.
 * - interrupt (explicit): abort the current turn and send the new prompt now. The
 *   expected MessageAbortedError is suppressed via StreamCoordinator's
 *   intentional-abort window (see ChatProvider's server_error handler).
 */
export class SteerPromptHandler {
  constructor(
    private readonly streamCoordinator: StreamCoordinator,
    private readonly sessionStore: SessionStore,
    private readonly hostQueue: HostPromptQueue,
  ) {}

  /**
   * Send a steer prompt based on its mode.
   * - queue (default): add to prompt queue, drained after the current turn
   * - interrupt: abort current stream and send immediately
   */
  async sendSteerPrompt(
    sessionId: string,
    steerPrompt: SteerPrompt,
    callbacks: StreamCallbacks
  ): Promise<void> {
    // Edge case: Validate inputs
    if (!sessionId) {
      log.warn("[SteerPromptHandler] Missing sessionId")
      callbacks.postRequestError("Session ID is required", sessionId)
      return
    }

    const hasText = !!steerPrompt?.text && steerPrompt.text.trim().length > 0
    const hasAttachments = Array.isArray(steerPrompt?.attachments) && steerPrompt.attachments.length > 0
    if (!steerPrompt || (!hasText && !hasAttachments)) {
      log.warn("[SteerPromptHandler] Empty steer prompt text")
      callbacks.postRequestError("Steer prompt text cannot be empty", sessionId)
      return
    }

    // Edge case: Check if session exists
    const session = this.sessionStore.get(sessionId)
    if (!session) {
      log.warn(`[SteerPromptHandler] Session ${sessionId} not found`)
      callbacks.postRequestError("Session not found", sessionId)
      return
    }

    log.info(`[SteerPromptHandler] Sending steer prompt in ${steerPrompt.mode} mode for session ${sessionId}`)

    try {
      switch (steerPrompt.mode) {
        case "interrupt":
          await this.handleInterrupt(sessionId, steerPrompt, callbacks)
          break
        case "queue":
          await this.handleQueue(sessionId, steerPrompt, callbacks)
          break
        default:
          // Unknown / legacy modes (e.g. the removed "append") default to the safe,
          // visible queue rather than rejecting the user's input.
          log.warn(`[SteerPromptHandler] Unknown steer mode "${steerPrompt.mode}" — queueing`)
          await this.handleQueue(sessionId, steerPrompt, callbacks)
      }
    } catch (error) {
      log.error(`[SteerPromptHandler] Error sending steer prompt: ${error}`)
      callbacks.postRequestError(`Failed to send steer prompt: ${error instanceof Error ? error.message : String(error)}`, sessionId)
    }
  }

  /**
   * Interrupt mode: Abort current stream and send steer prompt immediately.
   * Persists the user message to SessionStore at submit time (same as normal path).
   */
  private async handleInterrupt(
    sessionId: string,
    steerPrompt: SteerPrompt,
    callbacks: StreamCallbacks
  ): Promise<void> {
    log.info(`[SteerPromptHandler] Interrupt mode: aborting stream for ${sessionId}`)
    
    try {
      // Build and persist the user message BEFORE abort, so it's in history
      // even if the abort or subsequent startPrompt fails.
      const userMessageId = steerPrompt.userMessageId || generateUserMessageId()
      const textBlocks: Block[] = steerPrompt.text.trim() ? [{ type: "text", text: steerPrompt.text }] : []
      const imageBlocks: Block[] = (steerPrompt.attachments || []).map((a) => ({ type: "image" as const, data: a.data, mimeType: a.mimeType }))
      const userMsg: ChatMessage = {
        role: "user",
        id: userMessageId,
        blocks: [...textBlocks, ...imageBlocks],
        timestamp: Date.now(),
        sessionId,
      }
      this.sessionStore.appendMessage(sessionId, userMsg)
      callbacks.postMessage({ type: "add_message", sessionId, message: userMsg })

      // Abort current stream
      await this.streamCoordinator.abort(sessionId, callbacks)
      
      // Send steer prompt immediately, reusing the same user message id
      await this.streamCoordinator.startPrompt({
        tabId: sessionId,
        text: steerPrompt.text,
        callbacks,
        attachments: steerPrompt.attachments,
        identity: { userMessageId },
      })
    } catch (error) {
      log.error(`[SteerPromptHandler] Error in interrupt mode: ${error}`)
      throw error
    }
  }

  /**
   * Queue mode: Add to HostPromptQueue.
   * The queue is drained by StreamCoordinator.onQueueDrain after stream end.
   * Persists the user message to SessionStore AT QUEUE TIME so it survives
   * reloads even if the queue never drains. drainQueuedPrompt reuses the same
   * id for the actual send.
   */
  private async handleQueue(
    sessionId: string,
    steerPrompt: SteerPrompt,
    callbacks: StreamCallbacks
  ): Promise<void> {
    log.info(`[SteerPromptHandler] Queue mode: enqueuing for ${sessionId}`)
    
    try {
      // Build and persist the user message immediately at queue-time,
      // so it appears in history even if the queue never drains.
      const userMessageId = steerPrompt.userMessageId || generateUserMessageId()
      const textBlocks: Block[] = steerPrompt.text.trim() ? [{ type: "text", text: steerPrompt.text }] : []
      const imageBlocks: Block[] = (steerPrompt.attachments || []).map((a) => ({ type: "image" as const, data: a.data, mimeType: a.mimeType }))
      const userMsg: ChatMessage = {
        role: "user",
        id: userMessageId,
        blocks: [...textBlocks, ...imageBlocks],
        timestamp: Date.now(),
        sessionId,
      }
      this.sessionStore.appendMessage(sessionId, userMsg)
      callbacks.postMessage({ type: "add_message", sessionId, message: userMsg })

      const id = this.hostQueue.enqueue(sessionId, {
        text: steerPrompt.text,
        sessionId,
        attachments: steerPrompt.attachments || [],
        mode: "queue",
        isSteerPrompt: true,
        userMessageId,
      })
      
      if (id) {
        callbacks.postMessage({
          type: "prompt_queued",
          sessionId,
          itemId: id,
        })
        // Push full queue state to webview for UI update
        const items = this.hostQueue.getAll(sessionId).map((item, index) => ({
          id: item.id,
          text: item.text,
          state: item.state === "failed" ? "failed" as const : "queued" as const,
          attachments: item.attachments,
          isSteerPrompt: item.isSteerPrompt,
          createdAt: item.createdAt,
          position: index,
        }))
        callbacks.postMessage({
          type: "queue_state",
          sessionId,
          items,
        })
      } else {
        callbacks.postRequestError("Queue is full. Remove some queued prompts first.", sessionId)
      }
    } catch (error) {
      log.error(`[SteerPromptHandler] Error in queue mode: ${error}`)
      callbacks.postRequestError(`Failed to queue prompt: ${error instanceof Error ? error.message : String(error)}`, sessionId)
    }
  }

}
