import * as vscode from "vscode"
import type { TabManager } from "./TabManager"
import { SessionStore } from "../session/SessionStore"
import type { SessionManager } from "../session/SessionManager"
import type { DiffApplier } from "../diff/DiffApplier"
import type { StatePushService } from "./StatePushService"
import type { StreamCoordinator } from "./handlers/StreamCoordinator"
import type { AutoCompactor } from "./AutoCompactor"
import type { CheckpointManager } from "../checkpoint/CheckpointManager"
import { checkFileSecurity } from "../utils/security"
import { sdkMessagesToChatMessages } from "../session/sdkMessageConverter"
import { summarizeOpencodeMessageUsage } from "../session/sdkUsageSummary"
import { log } from "../utils/outputChannel"
import { computeMessageCounts } from "./webview/messageCounter"
import type { ChatMessage, Block } from "./types"

export interface SessionLifecycleOptions {
  tabManager: TabManager
  sessionStore: SessionStore
  sessionManager: SessionManager
  diffApplier: DiffApplier
  statePush: StatePushService
  streamCoordinator: StreamCoordinator
  autoCompactor: AutoCompactor
  checkpointManager: CheckpointManager
  showWarningMessage: (msg: string) => void
  showInformationMessage: (msg: string) => void
  showErrorMessage: (msg: string) => void
}

export class SessionLifecycleService {
  constructor(private opts: SessionLifecycleOptions) {}

  private ensureLocalTab(sessionId: string, name?: string, model?: string, mode?: string): void {
    const storeSession = this.opts.sessionStore.ensure(
      sessionId,
      name?.trim() || "",
      model,
      mode || "normal"
    )
    const tab = this.opts.tabManager.getTab(sessionId)
    const nextModel = storeSession.model || model
    const nextMode = storeSession.mode || mode
    if (tab) {
      if (nextModel && tab.model !== nextModel) this.opts.tabManager.setModel(sessionId, nextModel)
      if (nextMode && tab.mode !== nextMode) this.opts.tabManager.setMode(sessionId, nextMode)
    } else {
      this.opts.tabManager.createTab(sessionId, storeSession.cliSessionId, nextModel, nextMode)
    }
  }

  async openSessionInWebview(sessionId: string): Promise<void> {
    await this.handleResumeSession(sessionId)
  }

  async handleResumeSession(sessionId: string): Promise<void> {
    const session = this.opts.sessionStore.setActive(sessionId)
    if (!session) {
      this.opts.showWarningMessage("That saved session could not be found.")
      return
    }
    if (!this.opts.tabManager.getTab(session.id)) {
      this.ensureLocalTab(session.id, session.name, session.model, session.mode)
    }
    this.opts.tabManager.switchTab(session.id)

    // Only re-attach to an existing server session here. Do NOT speculatively
    // create a fresh CLI session for a still-pending tab with no messages —
    // that produced server-side noise (empty `ses_…` sessions that
    // immediately returned 0 messages on getSessionMessages) and gave the
    // tab a bogus cliSessionId before the user had even typed. The first
    // real prompt will create the session through StreamCoordinator.
    if (this.opts.sessionManager.isRunning && session.cliSessionId) {
      try {
        const cliSessionId = await this.opts.sessionManager.ensureSession(
          session.cliSessionId,
          session.name || undefined
        )
        this.opts.tabManager.setCliSessionId(sessionId, cliSessionId)
        this.opts.sessionStore.updateCliSessionId(sessionId, cliSessionId)
      } catch (err) {
        log.warn(`Could not re-attach server session for resume (${sessionId})`, err)
      }
    }

    const updatedSession = this.opts.sessionStore.get(sessionId) || session
    const effectiveCliId = updatedSession.cliSessionId || session.cliSessionId

    if (effectiveCliId && this.opts.sessionManager.isRunning) {
      try {
        const rows = await this.opts.sessionManager.getSessionMessages(effectiveCliId)
        const messages = sdkMessagesToChatMessages(rows)
        if (messages.length > 0) {
          this.opts.sessionStore.applyBackfilledMessages(session.id, messages, summarizeOpencodeMessageUsage(rows))
          this.opts.sessionStore.autoTitleFromMessages(session.id)
        } else if (updatedSession.messages.length === 0) {
          log.info(`Server returned 0 messages for ${session.id}; keeping local state for retry`)
        }
      } catch (err) {
        log.warn(`Message refresh on resume failed for ${session.id}`, err)
      }
    }

    const fresh = this.opts.sessionStore.get(session.id) || session

    const INITIAL_RESUME_COUNT = 50
    const totalMessages = fresh.messages.length
    const initialMessages = fresh.messages.slice(-INITIAL_RESUME_COUNT)
    const totalCounts = computeMessageCounts(fresh.messages)
    const initialCounts = computeMessageCounts(initialMessages)
    const hiddenTurns = (totalCounts.userTurns + totalCounts.assistantTurns) - (initialCounts.userTurns + initialCounts.assistantTurns)

    this.opts.statePush.postMessage({
      type: "resume_session_data",
      session: {
        id: fresh.id,
        name: SessionStore.displayName(fresh),
        model: fresh.model,
        mode: fresh.mode,
        messages: initialMessages,
        isStreaming: false,
        cost: fresh.cost,
        tokenUsage: fresh.tokenUsage,
        contextUsage: this.opts.sessionStore.getContextUsage(fresh.id),
        instructions: this.opts.tabManager.getTab(fresh.id)?.instructions,
      },
      totalMessages,
      initialBeforeIndex: totalMessages - initialMessages.length,
      initialHiddenTurns: hiddenTurns,
    })
  }

  async handleAttachFiles(): Promise<void> {
    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: "Attach",
      title: "Attach files to OpenCode prompt",
    })

    if (!files?.length) return

    const checks = await Promise.all(files.map(async (uri) => ({ uri, check: await checkFileSecurity(uri) })))
    const risky = checks.filter(({ check }) => check.isSensitive || check.hasInjectionRisk)
    let filesToAttach = files

    if (risky.length > 0) {
      const fileNames = risky.map(({ uri }) => vscode.workspace.asRelativePath(uri)).join(", ")
      const proceed = await vscode.window.showWarningMessage(
        `Warning: ${risky.length} risky file(s) detected: ${fileNames}. They may contain secrets or prompt-injection text. Attach anyway?`,
        { modal: true },
        "Attach All",
        "Review Files",
        "Cancel"
      )

      if (!proceed || proceed === "Cancel") return
      if (proceed === "Review Files") {
        const picked = await vscode.window.showQuickPick(
          checks.map(({ uri, check }) => ({
            label: vscode.workspace.asRelativePath(uri),
            description: check.isSensitive ? "Sensitive filename" : check.hasInjectionRisk ? "Prompt-injection text" : "No warning",
            uri,
          })),
          { canPickMany: true, placeHolder: "Select files to attach" }
        )
        if (!picked?.length) return
        filesToAttach = picked.map((item) => item.uri)
      }
    }

    const mentions = filesToAttach
      .map((uri) => `@file:${vscode.workspace.asRelativePath(uri)}`)
      .join(" ")

    this.opts.statePush.postMessage({
      type: "insert_text",
      text: `${mentions} `,
    })
  }

  handleAttachImage(sessionId: string, data: string, mimeType: string): void {
    const sizeBytes = Buffer.from(data.includes(",") ? data.split(",").pop()! : data, "base64").length
    const sizeMB = sizeBytes / 1024 / 1024
    if (sizeBytes > 10 * 1024 * 1024) {
      this.opts.statePush.postRequestError(`Image too large (${sizeMB.toFixed(1)}MB). Maximum 10MB.`, sessionId)
      return
    }

    const imageBlock: Block = { type: "image", data, mimeType }
    const imageMsg: ChatMessage = {
      role: "user",
      blocks: [imageBlock],
      timestamp: Date.now(),
      sessionId,
    }
    this.opts.sessionStore.appendMessage(sessionId, imageMsg)
    this.opts.statePush.postMessage({
      type: "message",
      sessionId,
      message: imageMsg,
    })
  }

  async handleCompactSession(sessionId?: string): Promise<void> {
    if (!sessionId) return
    await this.opts.autoCompactor.compactNow(sessionId, {
      postMessage: (m) => this.opts.statePush.postMessage(m),
      postRequestError: (m) => this.opts.statePush.postRequestError(m),
    })
  }

  async handleAcceptDiff(blockId: string, sessionId?: string): Promise<void> {
    // C1-a: dead subsystem removed (server applies edits directly). No-op.
    log.warn("handleAcceptDiff: no-op (dead diff subsystem removed for C1-a)")
  }

  syncActiveSession(): void {
    const session = this.opts.sessionStore.getActive()
    if (session) {
      this.opts.statePush.postMessage({ type: "active_session_changed", sessionId: session.id })
    }
  }
}
