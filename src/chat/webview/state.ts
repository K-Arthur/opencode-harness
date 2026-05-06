import type { WebviewState, SessionState, ChatMessage, VsCodeApi } from "./types"

const DEFAULT_STATE: WebviewState = {
  sessions: {},
  sessionOrder: [],
  activeSessionId: null,
  nextSessionNum: 1,
  globalModel: "",
  globalVariant: "",
  initialized: false,
}

  function migrateState(old: any): WebviewState {
    // Already migrated
    if (old && old.sessions) return old as WebviewState

    // Old format: { messages, currentMode, currentSessionId }
    const sessionId = old?.currentSessionId || "session-1"
    const oldMode = old?.currentMode || "normal"
    // Migrate old "normal" mode to "build" (new naming)
    const mode = oldMode === "normal" ? "build" : oldMode
    const session: SessionState = {
      id: sessionId,
      name: "Session 1",
      model: "",
      mode,
      messages: old?.messages || [],
      isStreaming: false,
    }

    return {
      sessions: { [sessionId]: session },
      sessionOrder: [sessionId],
      activeSessionId: sessionId,
      nextSessionNum: 2,
      globalModel: "",
    }
  }

export function createState(vscode: VsCodeApi) {
  let state: WebviewState = DEFAULT_STATE
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const SAVE_DEBOUNCE_MS = 300 // Debounce state saves

  function save() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      vscode.setState(state)
      saveTimer = null
    }, SAVE_DEBOUNCE_MS)
  }

  // Force-save immediately (useful before tab close, etc.)
  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    vscode.setState(state)
  }

  function restore(): boolean {
    const saved = vscode.getState()
    if (saved) {
      state = migrateState(saved)
      return Object.keys(state.sessions).length > 0
    }
    return false
  }

  function clear() {
    state = { ...DEFAULT_STATE }
  }

  function getState(): WebviewState {
    return state
  }

  function createSession(name?: string, model?: string): SessionState {
    const id = `session-${crypto.randomUUID().slice(0, 8)}`
    const sessionName = name || `Session ${state.nextSessionNum}`
    const session: SessionState = {
      id,
      name: sessionName,
      model: model || state.globalModel || "",
      mode: "build",
      messages: [],
      isStreaming: false,
    }
    state.sessions[id] = session
    state.nextSessionNum++

    // Insert new session to the right of the active one
    if (state.activeSessionId && state.sessionOrder.includes(state.activeSessionId)) {
      const idx = state.sessionOrder.indexOf(state.activeSessionId)
      state.sessionOrder.splice(idx + 1, 0, id)
    } else {
      state.sessionOrder.push(id)
    }

    save()
    return session
  }

  function ensureSession(session: SessionState): SessionState {
    const existing = state.sessions[session.id]
    if (existing) {
      existing.name = session.name || existing.name
      existing.model = session.model || existing.model
      existing.mode = session.mode || existing.mode
      // Mutate messages in-place to preserve stream handler's array reference
      if (session.messages && session.messages !== existing.messages) {
        existing.messages.length = 0
        existing.messages.push(...session.messages)
      }
      existing.isStreaming = session.isStreaming
      state.activeSessionId = session.id
      save()
      return existing
    }
    state.sessions[session.id] = session
    if (!state.sessionOrder.includes(session.id)) {
      state.sessionOrder.push(session.id)
    }
    state.activeSessionId = session.id
    save()
    return session
  }

  function getSession(id: string): SessionState | undefined {
    return state.sessions[id]
  }

  function getActiveSession(): SessionState | undefined {
    if (!state.activeSessionId) return undefined
    return state.sessions[state.activeSessionId]
  }

  function setActiveSession(id: string): boolean {
    if (state.sessions[id]) {
      state.activeSessionId = id
      save()
      return true
    }
    return false
  }

  function deleteSession(id: string): boolean {
    if (!state.sessions[id]) return false
    delete state.sessions[id]
    const orderIdx = state.sessionOrder.indexOf(id)
    if (orderIdx !== -1) {
      state.sessionOrder.splice(orderIdx, 1)
    }
    if (state.activeSessionId === id) {
      state.activeSessionId = state.sessionOrder.length > 0 ? (state.sessionOrder[0] ?? null) : null
    }
    save()
    return true
  }

  function renameSession(id: string, name: string): boolean {
    const session = state.sessions[id]
    if (!session) return false
    session.name = name
    save()
    return true
  }

  function setSessionModel(id: string, model: string): boolean {
    const session = state.sessions[id]
    if (!session) return false
    session.model = model
    save()
    return true
  }

  function setSessionMode(id: string, mode: string): boolean {
    const session = state.sessions[id]
    if (!session) return false
    session.mode = mode
    save()
    return true
  }

  function setStreaming(id: string, isStreaming: boolean): boolean {
    const session = state.sessions[id]
    if (!session) return false
    session.isStreaming = isStreaming
    save()
    return true
  }

  function appendMessage(id: string, msg: ChatMessage): boolean {
    const session = state.sessions[id]
    if (!session) return false
    session.messages.push(msg)
    save()
    return true
  }

  function loadSessions(sessions: SessionState[], activeId: string | null, globalModel: string) {
    const oldSessions = { ...state.sessions }
    state.sessions = {}

    // Load new sessions from host
    sessions.forEach((s) => {
      const existing = oldSessions[s.id]
      state.sessions[s.id] = {
        ...s,
        // Preserve existing messages array reference so active stream handlers
        // don't get orphaned. Without this, any mid-stream handler pointing to
        // the old array loses its data on the next state save.
        messages: existing ? existing.messages : s.messages,
        // Preserve local isStreaming flag if session exists
        isStreaming: existing ? existing.isStreaming : false
      }
    })

    // Preserve any local-only sessions that are currently streaming
    Object.values(oldSessions).forEach(s => {
      if (s.isStreaming && !state.sessions[s.id]) {
        state.sessions[s.id] = s
      }
    })

    // Update session order
    const sessionIds = sessions.map(s => s.id)
    // Remove IDs that are no longer present
    state.sessionOrder = state.sessionOrder.filter(id => sessionIds.includes(id))
    // Add new IDs that are not in the order yet
    sessionIds.forEach(id => {
      if (!state.sessionOrder.includes(id)) {
        state.sessionOrder.push(id)
      }
    })

    state.activeSessionId = activeId && state.sessions[activeId] ? activeId : state.activeSessionId
    state.globalModel = globalModel
    if (!state.activeSessionId && state.sessionOrder.length > 0) {
      state.activeSessionId = state.sessionOrder[0] ?? null
    }
    save()
  }

  function getAllSessions(): SessionState[] {
    return state.sessionOrder
      .map(id => state.sessions[id])
      .filter((s): s is SessionState => s !== undefined)
  }

  function getSessionCount(): number {
    return Object.keys(state.sessions).length
  }

  function setGlobalModel(model: string) {
    state.globalModel = model
    save()
  }

  function setSessionVariant(id: string, variant: string): boolean {
    const session = state.sessions[id]
    if (!session) return false
    session.variant = variant
    save()
    return true
  }

  function setGlobalVariant(variant: string) {
    state.globalVariant = variant
    save()
  }

  function getGlobalVariant(): string {
    return state.globalVariant || ""
  }

  function setInitialized() {
    state.initialized = true
    save()
  }

  function isInitialized(): boolean {
    return state.initialized || false
  }

  function isModelDisabled(modelId: string): boolean {
    return state.disabledModels?.includes(modelId) ?? false
  }

  function setModelDisabled(modelId: string, disabled: boolean): void {
    if (!state.disabledModels) {
      state.disabledModels = []
    }
    const idx = state.disabledModels.indexOf(modelId)
    if (disabled && idx === -1) {
      state.disabledModels.push(modelId)
      save()
    } else if (!disabled && idx !== -1) {
      state.disabledModels.splice(idx, 1)
      save()
    }
  }

  function applyDisabledState(models: import("./types").ModelInfo[]): import("./types").ModelInfo[] {
    if (!state.disabledModels || state.disabledModels.length === 0) return models
    return models.map((m) => {
      const fullId = `${m.provider}/${m.id}`
      if (state.disabledModels!.includes(fullId)) {
        return { ...m, enabled: false }
      }
      return m
    })
  }

  return {
    getState,
    save,
    flush,
    restore,
    clear,
    createSession,
    ensureSession,
    getSession,
    getActiveSession,
    setActiveSession,
    deleteSession,
    renameSession,
    setSessionModel,
    setSessionMode,
    setStreaming,
    appendMessage,
    getAllSessions,
    getSessionCount,
    setGlobalModel,
    setGlobalVariant,
    getGlobalVariant,
    setSessionVariant,
    loadSessions,
    setInitialized,
    isInitialized,
    isModelDisabled,
    setModelDisabled,
    applyDisabledState,
  }
}
