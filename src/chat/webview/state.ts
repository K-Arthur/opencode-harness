import type { WebviewState, SessionState, ChatMessage, VsCodeApi } from "./types"

const DEFAULT_STATE: WebviewState = {
  sessions: {},
  activeSessionId: null,
  nextSessionNum: 1,
  globalModel: "",
}

function migrateState(old: any): WebviewState {
  // Already migrated
  if (old && old.sessions) return old as WebviewState

  // Old format: { messages, currentMode, currentSessionId }
  const sessionId = old?.currentSessionId || "session-1"
  const session: SessionState = {
    id: sessionId,
    name: "Session 1",
    model: "",
    mode: old?.currentMode || "normal",
    messages: old?.messages || [],
    isStreaming: false,
  }

  return {
    sessions: { [sessionId]: session },
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
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const sessionName = name || `Session ${state.nextSessionNum}`
    const session: SessionState = {
      id,
      name: sessionName,
      model: model || state.globalModel || "",
      mode: "normal",
      messages: [],
      isStreaming: false,
    }
    state.sessions[id] = session
    state.nextSessionNum++
    state.activeSessionId = id
    save()
    return session
  }

  function ensureSession(session: SessionState): SessionState {
    const existing = state.sessions[session.id]
    if (existing) {
      existing.name = session.name || existing.name
      existing.model = session.model || existing.model
      existing.mode = session.mode || existing.mode
      existing.messages = session.messages || existing.messages
      existing.isStreaming = session.isStreaming
      state.activeSessionId = session.id
      save()
      return existing
    }
    state.sessions[session.id] = session
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
    if (state.activeSessionId === id) {
      const remaining = Object.keys(state.sessions)
      state.activeSessionId = remaining.length > 0 ? remaining[0] : null
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
    state.sessions = {}
    sessions.forEach((s) => {
      state.sessions[s.id] = { ...s, isStreaming: false }
    })
    state.activeSessionId = activeId && state.sessions[activeId] ? activeId : null
    state.globalModel = globalModel
    if (!state.activeSessionId && Object.keys(state.sessions).length > 0) {
      state.activeSessionId = Object.keys(state.sessions)[0]
    }
    save()
  }

  function getAllSessions(): SessionState[] {
    return Object.values(state.sessions)
  }

  function getSessionCount(): number {
    return Object.keys(state.sessions).length
  }

  function setGlobalModel(model: string) {
    state.globalModel = model
    save()
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
    loadSessions,
  }
}
