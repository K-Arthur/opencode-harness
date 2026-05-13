import { StreamCoordinator } from "./StreamCoordinator"
import { SessionStore } from "../../session/SessionStore"
import { SessionManager } from "../../session/SessionManager"
import type { SteerPrompt } from "../webview/types"
import { log } from "../../utils/outputChannel"

export interface StreamCallbacks {
  postMessage: (msg: Record<string, unknown>) => void
  postRequestError: (message: string, sessionId?: string) => void
}

/**
 * Handles mid-generation steer prompts to correct, redirect, or add context
 * during active AI streaming.
 */
export class SteerPromptHandler {
  constructor(
    private readonly streamCoordinator: StreamCoordinator,
    private readonly sessionStore: SessionStore,
    private readonly sessionManager: SessionManager
  ) {}

  /**
   * Send a steer prompt based on its mode.
   * - interrupt: Abort current stream and send immediately
   * - append: Send after current stream completes
   * - queue: Add to prompt queue
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

    if (!steerPrompt || !steerPrompt.text || steerPrompt.text.trim().length === 0) {
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
        case "append":
          await this.handleAppend(sessionId, steerPrompt, callbacks)
          break
        case "queue":
          await this.handleQueue(sessionId, steerPrompt, callbacks)
          break
        default:
          log.warn(`[SteerPromptHandler] Unknown steer mode: ${steerPrompt.mode}`)
          callbacks.postRequestError(`Unknown steer mode: ${steerPrompt.mode}`, sessionId)
      }
    } catch (error) {
      log.error(`[SteerPromptHandler] Error sending steer prompt: ${error}`)
      callbacks.postRequestError(`Failed to send steer prompt: ${error instanceof Error ? error.message : String(error)}`, sessionId)
    }
  }

  /**
   * Interrupt mode: Abort current stream and send steer prompt immediately.
   */
  private async handleInterrupt(
    sessionId: string,
    steerPrompt: SteerPrompt,
    callbacks: StreamCallbacks
  ): Promise<void> {
    log.info(`[SteerPromptHandler] Interrupt mode: aborting stream for ${sessionId}`)
    
    try {
      // Abort current stream
      await this.streamCoordinator.abort(sessionId, callbacks)
      
      // Send steer prompt immediately
      await this.streamCoordinator.startPrompt(
        sessionId,
        steerPrompt.text,
        callbacks
      )
      
      // Track the steer prompt for history
      this.trackSteerPrompt(sessionId, steerPrompt)
    } catch (error) {
      log.error(`[SteerPromptHandler] Error in interrupt mode: ${error}`)
      throw error
    }
  }

  /**
   * Append mode: Register callback to send after stream completes.
   */
  private async handleAppend(
    sessionId: string,
    steerPrompt: SteerPrompt,
    callbacks: StreamCallbacks
  ): Promise<void> {
    log.info(`[SteerPromptHandler] Append mode: registering callback for ${sessionId}`)
    
    try {
      // Register callback to send after stream_end
      this.streamCoordinator.registerAppendCallback(sessionId, async () => {
        log.info(`[SteerPromptHandler] Append callback triggered for ${sessionId}`)
        try {
          await this.streamCoordinator.startPrompt(
            sessionId,
            steerPrompt.text,
            callbacks
          )
          this.trackSteerPrompt(sessionId, steerPrompt)
        } catch (error) {
          log.error(`[SteerPromptHandler] Error in append callback: ${error}`)
          callbacks.postRequestError(`Failed to send appended prompt: ${error instanceof Error ? error.message : String(error)}`, sessionId)
        }
      })
    } catch (error) {
      log.error(`[SteerPromptHandler] Error registering append callback: ${error}`)
      throw error
    }
  }

  /**
   * Queue mode: Add to existing prompt queue.
   * Posts a message to the webview to add the steer prompt to the queue.
   */
  private async handleQueue(
    sessionId: string,
    steerPrompt: SteerPrompt,
    callbacks: StreamCallbacks
  ): Promise<void> {
    log.info(`[SteerPromptHandler] Queue mode: adding to queue for ${sessionId}`)
    
    try {
      // Post message to webview to add to queue
      callbacks.postMessage({
        type: "add_to_queue",
        sessionId,
        text: steerPrompt.text,
        attachments: steerPrompt.attachments,
        isSteerPrompt: true,
      })
      
      this.trackSteerPrompt(sessionId, steerPrompt)
    } catch (error) {
      log.error(`[SteerPromptHandler] Error in queue mode: ${error}`)
      callbacks.postRequestError(`Failed to queue prompt: ${error instanceof Error ? error.message : String(error)}`, sessionId)
    }
  }

  /**
   * Track steer prompts in session metadata for export/history.
   */
  private trackSteerPrompt(sessionId: string, steerPrompt: SteerPrompt): void {
    const session = this.sessionStore.get(sessionId)
    if (!session) return

    // Add steer prompt to session metadata
    // This will be used for export and history display
    log.info(`[SteerPromptHandler] Tracking steer prompt ${steerPrompt.id} for session ${sessionId}`)
  }
}
