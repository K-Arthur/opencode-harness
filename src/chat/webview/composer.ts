import type { WebviewState, ChatMessage } from "./types"
import type { CommandEntry } from "./commands-modal"
import type { PromptQueue } from "./queue"
import type { ElementRefs } from "./dom"
import { createQueueRenderer } from "./queueRenderer"
import { createInputHandlers, type InputHandlerDeps } from "./inputHandlers"
import { createSlashCommandHandler } from "./slashCommands"
import { createSendLogic, type StreamCapacityState } from "./sendLogic"
import type { RemoteCommandInfo } from "./slash-commands"

export interface ComposerDeps {
  els: ElementRefs
  vscode: {
    postMessage: (msg: Record<string, unknown>) => void
    getState: <T>() => T | undefined
    setState: (state: WebviewState) => void
  }
  stateManager: {
    getState: () => WebviewState
    getActiveSession: () => { id: string; isStreaming: boolean; model?: string; mode?: string; name?: string } | null
    getSession: (id: string) => { id: string; isStreaming: boolean; model?: string; mode?: string; name?: string; messages: any[] } | undefined
    getAllSessions: () => Array<{ id: string; isStreaming: boolean }>
    getActiveSessionId: () => string | undefined
    setStreaming: (id: string, streaming: boolean) => void
    setSessionModel: (id: string, model: string) => void
    setSessionSteerMode: (id: string, mode: "interrupt" | "queue") => void
    setGlobalModel: (model: string) => void
    save: () => void
    ensureSession: (init: any) => any
  }
  attachmentManager: {
    onPaste: (e: ClipboardEvent) => void
    getAttachments: () => Array<{ data: string; mimeType: string }>
    clearAttachments: () => void
    updatePromptContextChips: () => void
    renderAttachmentChips: () => void
    attachImageBlob: (file: File) => void
  }
  mention: {
    handleTrigger: () => void
    handleKeydown: (e: KeyboardEvent) => void
  }
  modelDropdown: {
    getCurrentModel: () => string | undefined
    open: () => void
    render: (models: any[], currentModel?: string) => void
    setCurrentModel: (model: string) => void
  }
  modelManager: {
    getAllModels: () => any[]
    setModels: (models: any[]) => void
    open: () => void
  }
  commandsModal: {
    open: () => void
  }
  /** Returns the cached remote command list for MCP namespace resolution. */
  getServerCommands?: () => ReadonlyArray<RemoteCommandInfo>
  streamHandlers: {
    get: (id: string) => { showTypingIndicator: (msg: string) => void } | undefined
  }
  tabBar: {
    renderTabs: (sessions: any[]) => void
  }
  timers: {
    setTimeout: (fn: (...args: any[]) => void, ms: number) => any
  }
  promptQueues: Map<string, PromptQueue>
  hideWelcomeView: () => void
  showSystemMessage: (sessionId: string, msg: string) => void
  handleRequestError: (sessionId: string, msg: string) => void
  addMessage: (sessionId: string, msg: ChatMessage) => void
  updateTabBar: () => void
  switchTab: (id: string) => void
  switchToTab: (id: string) => void
  createTabUI: (id: string, name: string) => void
  createNewTab: (name?: string) => { id: string; name: string; mode?: string } | undefined
  closeTab: (id: string) => void
  updateAgentStatus: (status: string) => void
  syncModelViews: (models?: any[]) => void
  updateModeSelectorState: () => void
  renderRecentSessionsList: () => void
  debouncedUpdateScrollMarkers: (sessionId: string) => void
  STREAM_LIMIT_TOOLTIP: string
  getAllSessions: () => Array<{ id: string; isStreaming: boolean }>
}

export interface ComposerAPI {
  setupInput: () => void
  sendMessage: () => void
  abortStream: () => void
  sendSteerPrompt: () => void
  persistQueues: () => void
  restoreQueues: () => void
  renderQueue: (tabId: string) => void
  updateSendButton: () => void
  updateSendButtonIcon: (isStreaming?: boolean, streamCapacity?: StreamCapacityState) => void
  updateQueueSendButton: () => void
  autoResizeTextarea: () => void
  getStreamCapacityState: () => StreamCapacityState
  isAutoSessionName: (name?: string) => boolean
  insertTextAtCursor: (text: string) => void
  runCommandEntry: (entry: CommandEntry) => void
  insertIntoPrompt: (text: string) => void
  setSteerMode: (mode: "interrupt" | "queue") => void
  syncSteerModeUI: () => void
  getSteerMode: () => "interrupt" | "queue"
  onInputChange: () => void
  onInputKeydown: (e: KeyboardEvent) => void
  onPaste: (e: ClipboardEvent) => void
  updatePromptContextChips: () => void
  renderAttachmentChips: () => void
  generateTitle: (text: string) => string
  wireChipReorderHandlers: (chip: HTMLElement, itemId: string, tabId: string, queue: PromptQueue) => void
}

export function createComposer(deps: ComposerDeps): ComposerAPI {
  const {
    els, vscode, stateManager, attachmentManager, mention,
    modelDropdown, modelManager, commandsModal, streamHandlers,
    tabBar, timers, promptQueues,
    hideWelcomeView, showSystemMessage, handleRequestError,
    addMessage, updateTabBar, switchTab, switchToTab,
    createTabUI, createNewTab, closeTab,
    updateAgentStatus, syncModelViews, updateModeSelectorState,
    renderRecentSessionsList, debouncedUpdateScrollMarkers,
    STREAM_LIMIT_TOOLTIP,
  } = deps

  let _autoResizeTextarea: () => void = () => {}
  let _runSlashCommandText: (
    text: string,
    active: { id: string; isStreaming: boolean; model?: string; mode?: string; name?: string },
  ) => void = () => {}

  const sendLogic = createSendLogic({
    els,
    stateManager: {
      getState: stateManager.getState,
      getActiveSession: stateManager.getActiveSession,
      getSession: stateManager.getSession,
      getAllSessions: stateManager.getAllSessions,
      setStreaming: stateManager.setStreaming,
      setSessionSteerMode: stateManager.setSessionSteerMode,
    },
    vscode: { postMessage: vscode.postMessage },
    attachmentManager: {
      getAttachments: attachmentManager.getAttachments,
      clearAttachments: attachmentManager.clearAttachments,
    },
    streamHandlers,
    modelDropdown: { getCurrentModel: modelDropdown.getCurrentModel },
    hideWelcomeView,
    handleRequestError,
    addMessage,
    updateTabBar,
    switchTab,
    switchToTab,
    createTabUI,
    createNewTab,
    updateAgentStatus,
    updateModeSelectorState,
    renderAttachmentChips: () => attachmentManager.renderAttachmentChips(),
    autoResizeTextarea: () => _autoResizeTextarea(),
    runSlashCommandText: (text, active) => _runSlashCommandText(text, active),
    openModelManager: () => modelManager.open(),
    STREAM_LIMIT_TOOLTIP,
  })

  const queueRenderer = createQueueRenderer({
    els: { inputArea: els.inputArea, inputWrapper: els.inputWrapper },
    vscode,
    stateManager,
    promptQueues,
  })

  const inputHandlers = createInputHandlers({
    els,
    vscode,
    stateManager,
    attachmentManager,
    mention,
    commandsModal,
    timers,
    sendMessage: () => sendLogic.sendMessage(),
    sendSteerPrompt: () => sendLogic.sendSteerPrompt(),
    setSteerMode: sendLogic.setSteerMode,
    updateSendButton: sendLogic.updateSendButton,
    createNewTab,
    closeTab,
    switchTab,
  })

  _autoResizeTextarea = () => inputHandlers.autoResizeTextarea()

  function autoResizeTextarea(): void {
    inputHandlers.autoResizeTextarea()
  }

  function clearPromptInput(): void {
    els.promptInput.value = ""
    autoResizeTextarea()
    sendLogic.updateSendButton()
  }

  const { runSlashCommandText, runCommandEntry } = createSlashCommandHandler({
    stateManager,
    vscode,
    modelDropdown,
    commandsModal,
    clearPromptInput,
    createNewTab,
    showSystemMessage,
    syncModelViews,
    renderQueue: (tabId: string) => queueRenderer.renderQueue(tabId),
    getServerCommands: deps.getServerCommands,
  })

  _runSlashCommandText = runSlashCommandText

  function insertIntoPrompt(text: string): void {
    inputHandlers.insertIntoPrompt(text)
  }

  function onInputChange(): void {
    inputHandlers.onInputChange()
  }

  function onInputKeydown(e: KeyboardEvent): void {
    inputHandlers.onInputKeydown(e)
  }

  function onPaste(e: ClipboardEvent): void {
    inputHandlers.onPaste(e)
  }

  function insertTextAtCursor(text: string): void {
    inputHandlers.insertTextAtCursor(text)
  }

  function setupInput() {
    inputHandlers.setupInput()
  }

  function updatePromptContextChips() {
    attachmentManager.updatePromptContextChips()
  }

  function renderAttachmentChips() {
    attachmentManager.renderAttachmentChips()
  }

  return {
    setupInput,
    sendMessage: sendLogic.sendMessage,
    abortStream: sendLogic.abortStream,
    sendSteerPrompt: sendLogic.sendSteerPrompt,
    persistQueues: () => queueRenderer.persistQueues(),
    restoreQueues: () => queueRenderer.restoreQueues(),
    renderQueue: (tabId: string) => queueRenderer.renderQueue(tabId),
    updateSendButton: sendLogic.updateSendButton,
    updateSendButtonIcon: sendLogic.updateSendButtonIcon,
    updateQueueSendButton: () => queueRenderer.updateQueueSendButton(),
    autoResizeTextarea,
    getStreamCapacityState: sendLogic.getStreamCapacityState,
    isAutoSessionName: sendLogic.isAutoSessionName,
    insertTextAtCursor,
    runCommandEntry,
    insertIntoPrompt,
    setSteerMode: sendLogic.setSteerMode,
    syncSteerModeUI: sendLogic.syncSteerModeUI,
    getSteerMode: sendLogic.getSteerMode,
    onInputChange,
    onInputKeydown,
    onPaste,
    updatePromptContextChips,
    renderAttachmentChips,
    generateTitle: sendLogic.generateTitle,
    wireChipReorderHandlers: (
      chip: HTMLElement,
      itemId: string,
      tabId: string,
      queue: PromptQueue,
    ) => queueRenderer.wireChipReorderHandlers(chip, itemId, tabId, queue),
  }
}
