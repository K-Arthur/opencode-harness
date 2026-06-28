import type { ChatMessage } from "./types"
import type { ElementRefs } from "./dom"
import { TOOLTIPS } from "./tooltips"
import { generateUserMessageId } from "../../session/messageId"
import { classifyComposerInput } from "./slash-commands"
import { shouldForceFocusOnSend } from "./sessionFocus"
import type { SendLogicDeps, SendMessageDeps, StreamCapacityState } from "./sendTypes"
import type { AttachedContextItem } from "./types"

/** G8: how long to wait for the host to ack a send_prompt before probing.
 *  The host normally posts `prompt_accepted` within ~1s and
 *  `streaming_state:true` within another second. 5s accommodates slow
 *  server starts and provider warmups; anything beyond that is most likely
 *  a lost message or a host that rejected the prompt without telling us. */
export const SEND_ACK_WATCHDOG_MS = 5000

function createWebviewId(prefix: string): string {
  const randomUUID = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID
  const id = randomUUID
    ? randomUUID.call(globalThis.crypto)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${id}`
}

export function generateTitle(text: string): string {
  if (!text.trim()) return ""
  const firstSentence = text.split(/[.!?\n]/)[0] || text
  const trimmed = firstSentence.trim()
  if (trimmed.length > 40) return trimmed.slice(0, 37).trimEnd() + "..."
  return trimmed
}

export function isAutoSessionName(name?: string): boolean {
  const raw = (name || "").trim()
  return /^New Chat\b/i.test(raw) || /^Tab session\b/i.test(raw)
}

export function handleNoModelSelected(
  els: ElementRefs,
  openModelManager: () => void,
  updateSendButton: () => void,
): void {
  openModelManager()
  els.promptInput.placeholder = "Select a model to continue..."
  updateSendButton()
}

/** Trigger a host probe of the active run's status. Used when local state is
 *  suspected stale (after errors, reconnects, tab switches to a tab whose
 *  backend may still be running). The host replies via `run_status_result`,
 *  which reconciles both streaming flags authoritatively. */
export function probeActiveRun(
  stateManager: SendLogicDeps["stateManager"],
  vscode: SendLogicDeps["vscode"],
): void {
  const active = stateManager.getActiveSession()
  if (!active) return
  // Only probe when there's genuine ambiguity: either we are not streaming
  // (host might disagree) or we are streaming but haven't seen host ack in a
  // while. Cheap to fire — host dedupes.
  vscode.postMessage({
    type: "probe_run_status",
    sessionId: active.id,
    // cliSessionId is optional; host knows its own mapping.
  })
}

export function abortStream(
  stateManager: SendLogicDeps["stateManager"],
  streamHandlers: SendLogicDeps["streamHandlers"],
  updateAgentStatus: SendLogicDeps["updateAgentStatus"],
  vscode: SendLogicDeps["vscode"],
): void {
  const active = stateManager.getActiveSession()
  if (!active) return
  streamHandlers.get(active.id)?.showTypingIndicator("Stopping...")
  updateAgentStatus("idle")
  vscode.postMessage({ type: "abort", sessionId: active.id })
}

export function sendMessage(deps: SendMessageDeps): void {
  const {
    els,
    stateManager,
    vscode,
    attachmentManager,
    streamHandlers,
    hideWelcomeView,
    handleRequestError,
    addMessage,
    updateTabBar,
    switchToTab,
    createTabUI,
    createNewTab,
    updateAgentStatus,
    updateModeSelectorState,
    renderAttachmentChips,
    autoResizeTextarea,
    runSlashCommandText,
    STREAM_LIMIT_TOOLTIP,
    getStreamCapacityState,
    isServerStreaming,
    resolveSendModel,
    updateSendButton,
    sendSteerPrompt,
  } = deps

  const text = els.promptInput.value.trim()
  let active = stateManager.getActiveSession()

  if (active?.isStreaming || (active && isServerStreaming(active))) {
    const kind = classifyComposerInput(text, true)
    if (kind === "slash-blocked") {
      // Never steer-leak a command to the model as literal text. Keep the
      // input intact so the user can run it once the stream stops.
      handleRequestError(
        active.id,
        "Slash commands can't run while a response is streaming — press Stop or wait for completion, then try again.",
      )
      return
    }
    if (kind === "steer" || attachmentManager.getAttachments().length > 0) {
      sendSteerPrompt()
    } else {
      abortStream(stateManager, streamHandlers, updateAgentStatus, vscode)
    }
    return
  }

  if (!text && attachmentManager.getAttachments().length === 0) return

  // Resolve model before any mutations — if missing, open picker without losing prompt
  const sendModel = resolveSendModel(active)
  if (!sendModel) {
    handleNoModelSelected(els, deps.openModelManager, updateSendButton)
    return
  }

  if (!active) {
    const title = generateTitle(text)
    const tab = createNewTab(title)
    if (!tab) return
    active = stateManager.getSession(tab.id) || (tab as ReturnType<typeof stateManager.getActiveSession>)
  }

  if (!active) return

  hideWelcomeView()

  const streamCapacity = getStreamCapacityState()
  if (streamCapacity.isFull) {
    updateSendButton()
    handleRequestError(
      active.id,
      streamCapacity.streamingNames
        ? TOOLTIPS.limits.streamCapWithNames(streamCapacity.streamingNames)
        : `${STREAM_LIMIT_TOOLTIP}. Stop a streaming tab to free a slot.`,
    )
    return
  }

  if (!els.tabPanels.querySelector(`.tab-panel[data-tab-id="${active.id}"]`)) {
    createTabUI(active.id, active.name || "")
    // Auto-switch ONLY when the user has nothing valid to look at (welcome
    // screen or no current tab). Previously this yanked focus onto active.id
    // whenever its panel was missing — even if the user was deliberately
    // viewing another valid tab (a state desync could fire this during a
    // generation, hijacking the user's view). See sessionFocus.ts.
    const currentActiveId = stateManager.getState().activeSessionId
    const currentValid = currentActiveId
      ? Boolean(stateManager.getSession(currentActiveId))
      : false
    const welcomeVisible = !els.welcomeView.classList.contains("hidden")
    if (
      shouldForceFocusOnSend({
        welcomeVisible,
        currentActiveId,
        currentActiveValid: currentValid,
        targetId: active.id,
      })
    ) {
      switchToTab(active.id)
    }
    updateTabBar()
  }

  if (text.startsWith("/") || /^@\S+\s+\//.test(text)) {
    runSlashCommandText(text, active)
    return
  }

  const attachments = attachmentManager.getAttachments()
  const contextItems = attachmentManager.getContextItems().filter(
    (item: AttachedContextItem) => item.isActive && (item.type === "active_file" || item.type === "picked_file"),
  )

  // Separate image attachments (sent as base64 to the server) from document
  // attachments (decoded and injected into the prompt text). The opencode
  // server only supports image/* media types as file attachments — sending
  // text/markdown or text/plain as a file part produces
  // "'media type: text/markdown' functionality not supported" errors.
  const imageAttachments = attachments.filter((a) => a.mimeType.startsWith("image/"))
  const documentAttachments = attachments.filter((a) => !a.mimeType.startsWith("image/"))

  // Inject active file @file: mention into the prompt text so the backend
  // knows which file to read. The contextItems array carries metadata but
  // the @file: token in the text is what triggers the backend file reader.
  let sendText = text
  const activeFilePath = attachmentManager.isActiveFileIncluded() ? attachmentManager.getActiveFile() : null
  if (activeFilePath && !sendText.includes(`@file:${activeFilePath}`)) {
    const quotedPath = /\s/.test(activeFilePath) ? `"${activeFilePath}"` : activeFilePath
    sendText = `@file:${quotedPath}\n${sendText}`
  }

  // Decode document attachments and inject their content into the prompt text
  // as fenced code blocks. This avoids the server's "media type not supported"
  // error for non-image MIME types while still making the file content
  // available to the model.
  for (const doc of documentAttachments) {
    try {
      const decoded = atob(doc.data)
      const filename = doc.filename || "document"
      const langTag = filename.split(".").pop() || ""
      sendText += `\n\n<file name="${filename}">\n\`\`\`${langTag}\n${decoded}\n\`\`\`\n</file>`
    } catch {
      // If base64 decoding fails, skip silently — the user can retry
    }
  }

  els.promptInput.value = ""
  autoResizeTextarea()
  updateSendButton()

  const msgObj: ChatMessage = {
    role: "user",
    // opencode rejects user-message ids not starting with "msg"; this id is reused as
    // both the local optimistic bubble id and the server messageID, so they stay equal.
    id: generateUserMessageId(),
    blocks: [
      ...(sendText ? [{ type: "text" as const, text: sendText }] : []),
      ...imageAttachments.map((a) => ({ type: "image" as const, data: a.data, mimeType: a.mimeType })),
    ],
    timestamp: Date.now(),
    sessionId: active.id,
  }

  attachmentManager.clearAttachments()
  attachmentManager.clearSentContextItems()
  renderAttachmentChips()

  addMessage(active.id, msgObj)
  stateManager.setStreaming(active.id, true)
  updateTabBar()
  updateModeSelectorState()
  updateSendButton()

  const stream = streamHandlers.get(active.id)
  if (stream) stream.showTypingIndicator("Thinking...")
  updateAgentStatus("thinking")

  const sendVariant = stateManager.getState().sessions[active.id]?.variant || stateManager.getState().globalVariant || undefined
  const clientRequestId = createWebviewId("req")

  vscode.postMessage({
    type: "send_prompt",
    text: sendText,
    sessionId: active.id,
    messageId: msgObj.id,
    clientRequestId,
    model: sendModel,
    mode: active.mode,
    ...(sendVariant ? { variant: sendVariant } : {}),
    ...(imageAttachments.length > 0 ? { attachments: imageAttachments } : {}),
    ...(contextItems.length > 0 ? { contextItems } : {}),
  })

  // G8: optimistic-local safety. The host should ack the send within a few
  // seconds (prompt_accepted → streaming_state:true). If that never arrives
  // (lost message, host crashed mid-send, race with the host rejecting the
  // prompt silently), the user would be stuck looking at a Stop button with
  // no backend run. Arm a one-shot probe; if the host confirms no run is
  // active, the run_status_result handler clears the optimistic flag and
  // resets the UI. If the host says active=true (we just missed the ack),
  // no-op. The timer fires once and clears itself.
  const sendSessionId = active.id
  const ackWatchdog = setTimeout(() => {
    // Only probe if we still think we're streaming AND the host hasn't
    // pushed isServerStreaming=true (which would mean we did get an ack).
    const sess = stateManager.getSession(sendSessionId)
    if (!sess) return
    if (sess.isServerStreaming === true) return // host already acked
    if (!sess.isStreaming) return // something else cleared it
    // Still optimistic after the watchdog — ask the host.
    vscode.postMessage({ type: "probe_run_status", sessionId: sendSessionId })
  }, SEND_ACK_WATCHDOG_MS)
  // Ensure the timer doesn't keep the process alive if the webview unloads.
  if (typeof (ackWatchdog as unknown as { unref?: () => void }).unref === "function") {
    ;(ackWatchdog as unknown as { unref: () => void }).unref()
  }
}
