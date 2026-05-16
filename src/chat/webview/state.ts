import type { WebviewState, SessionState, ChatMessage, VsCodeApi, ToolCollapseConfig } from "./types"

const DEFAULT_TOOL_COLLAPSE_CONFIG: ToolCollapseConfig = {
  groupBy: 'consecutive',
  defaultCollapsed: true,
  collapseThreshold: 2,
  showTypeBreakdown: true,
  compactMode: false
}

const DEFAULT_STATE: WebviewState = {
  sessions: {},
  sessionOrder: [],
  activeSessionId: null,
  nextSessionNum: 1,
  globalModel: "",
  globalVariant: "",
  initialized: false,
  isTimelineVisible: false,
  disabledModels: [],
  favoriteModels: [],
  recentModels: [],
  toolCollapseConfig: DEFAULT_TOOL_COLLAPSE_CONFIG,
}

function withDefaults(candidate: Partial<WebviewState>): WebviewState {
  return {
    ...DEFAULT_STATE,
    ...candidate,
    sessions: candidate.sessions || {},
    sessionOrder: candidate.sessionOrder || [],
    disabledModels: candidate.disabledModels || [],
    favoriteModels: candidate.favoriteModels || [],
    recentModels: candidate.recentModels || [],
    displayPrefs: candidate.displayPrefs,
    toolCollapseConfig: candidate.toolCollapseConfig || DEFAULT_TOOL_COLLAPSE_CONFIG,
  }
}

function migrateState(old: any): WebviewState {
  // Already migrated
  if (old && old.sessions) return withDefaults(old as Partial<WebviewState>)

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

  return withDefaults({
    sessions: { [sessionId]: session },
    sessionOrder: [sessionId],
    activeSessionId: sessionId,
    nextSessionNum: 2,
    globalModel: "",
  })
}

function generateId(): string {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 8)
    : (() => { const chars = "0123456789abcdef"; let r = ""; for (let i = 0; i < 8; i++) r += chars[Math.floor(Math.random() * 16)]; return r })()
}

export function createState(vscode: VsCodeApi) {
  let state: WebviewState = withDefaults({})
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const SAVE_DEBOUNCE_MS = 300
  const MAX_STATE_BYTES = 2 * 1024 * 1024
  const MAX_MESSAGES_PER_SESSION = 200

  let lastKnownSize = 0
  let pruneScheduled = false

  function schedulePrune(): void {
    if (pruneScheduled) return
    pruneScheduled = true
    setTimeout(() => {
      pruneScheduled = false
      doPrune()
    }, 5000)
  }

  function doPrune(): void {
    try {
      const size = JSON.stringify(state).length
      lastKnownSize = size
      if (size <= MAX_STATE_BYTES) return

      const sessionsByAge = state.sessionOrder
        .map(id => state.sessions[id])
        .filter((s): s is SessionState => !!s && !s.isStreaming)
        .sort((a, b) => (a.lastActiveAt || 0) - (b.lastActiveAt || 0))

      for (const session of sessionsByAge) {
        if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
          session.messages = session.messages.slice(-MAX_MESSAGES_PER_SESSION)
        }
        if (JSON.stringify(state).length <= MAX_STATE_BYTES) return
      }

      for (const session of sessionsByAge) {
        if (session.messages.length > 50) {
          session.messages = session.messages.slice(-50)
        }
        if (JSON.stringify(state).length <= MAX_STATE_BYTES) return
      }
    } catch {
      // If pruning fails, save anyway — better a large save than data loss
    }
  }

  function pruneOversizedState(): void {
    if (lastKnownSize > 0 && lastKnownSize <= MAX_STATE_BYTES * 0.8) {
      return
    }
    schedulePrune()
  }

  function save() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      pruneOversizedState()
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
    doPrune()
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
    state = withDefaults({})
  }

  function getState(): WebviewState {
    return state
  }

  function createSession(name?: string, model?: string): SessionState {
    const id = `session-${generateId()}`
    const session: SessionState = {
      id,
      name: name || "",
      model: model || state.globalModel || "",
      mode: "build",
      messages: [],
      isStreaming: false,
    }
    state.sessions[id] = session

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
    touchRecentModel(model)
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
      if (existing && existing.isStreaming) {
        state.sessions[s.id] = {
          ...s,
          messages: existing.messages,
          isStreaming: existing.isStreaming,
          tokenUsage: s.tokenUsage ?? existing?.tokenUsage,
          cost: typeof s.cost === "number" && s.cost > 0 ? s.cost : existing?.cost ?? s.cost,
        }
      } else if (existing) {
        state.sessions[s.id] = {
          ...s,
          messages: existing.messages !== s.messages ? (() => { existing.messages.length = 0; existing.messages.push(...s.messages); return existing.messages })() : s.messages,
          isStreaming: existing.isStreaming,
          tokenUsage: s.tokenUsage ?? existing?.tokenUsage,
          cost: typeof s.cost === "number" && s.cost > 0 ? s.cost : existing?.cost ?? s.cost,
        }
      } else {
        state.sessions[s.id] = {
          ...s,
          isStreaming: false,
        }
      }
    })

    // Preserve any local-only sessions that the host didn't include but that
    // we still need: those currently streaming, those with persisted messages
    // (might be a stale init_state), or the active one (avoid dangling activeSessionId).
    // Empty, non-active, non-streaming sessions are dropped — they're either
    // deleted upstream or genuinely empty placeholders we can safely lose.
    Object.values(oldSessions).forEach(s => {
      if (state.sessions[s.id]) return
      const isActive = state.activeSessionId === s.id
      if (s.isStreaming || s.messages.length > 0 || isActive) {
        state.sessions[s.id] = s
      }
    })

    // Update session order: union of new sessions + preserved local sessions
    const sessionIds = new Set(Object.keys(state.sessions))
    state.sessionOrder = state.sessionOrder.filter(id => sessionIds.has(id))
    sessions.forEach(s => {
      if (!state.sessionOrder.includes(s.id)) {
        state.sessionOrder.push(s.id)
      }
    })
    // Add any preserved local sessions that weren't already in the order
    for (const id of sessionIds) {
      if (!state.sessionOrder.includes(id)) {
        state.sessionOrder.push(id)
      }
    }

    state.activeSessionId = activeId && state.sessions[activeId] ? activeId : state.activeSessionId
    state.globalModel = globalModel
    if (!state.activeSessionId && state.sessionOrder.length > 0) {
      state.activeSessionId = state.sessionOrder[0] ?? null
    }
    // Validate the active session actually exists in our session map
    if (state.activeSessionId && !state.sessions[state.activeSessionId]) {
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
    touchRecentModel(model)
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

  function setTimelineVisible(visible: boolean) {
    state.isTimelineVisible = visible
    save()
  }

  function isTimelineVisible(): boolean {
    return state.isTimelineVisible || false
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

  function toggleModelFavorite(modelId: string): boolean {
    if (!state.favoriteModels) state.favoriteModels = []
    const idx = state.favoriteModels.indexOf(modelId)
    if (idx >= 0) {
      state.favoriteModels.splice(idx, 1)
      save()
      return false
    }
    state.favoriteModels.unshift(modelId)
    save()
    return true
  }

  function isModelFavorite(modelId: string): boolean {
    return state.favoriteModels?.includes(modelId) ?? false
  }

  function touchRecentModel(modelId: string): void {
    if (!modelId) return
    if (!state.recentModels) state.recentModels = []
    const idx = state.recentModels.indexOf(modelId)
    if (idx >= 0) state.recentModels.splice(idx, 1)
    state.recentModels.unshift(modelId)
    state.recentModels.splice(10)
  }

  function getModelPreferences(): { favoriteModels: string[]; recentModels: string[] } {
    return {
      favoriteModels: [...(state.favoriteModels || [])],
      recentModels: [...(state.recentModels || [])],
    }
  }

  function applyModelState(models: import("./types").ModelInfo[]): import("./types").ModelInfo[] {
    const disabled = new Set(state.disabledModels || [])
    const favorites = new Set(state.favoriteModels || [])
    const recent = state.recentModels || []
    return models.map((m) => {
      const fullId = `${m.provider}/${m.id}`
      const recentRank = recent.indexOf(fullId)
      return {
        ...m,
        enabled: disabled.has(fullId) ? false : m.enabled,
        favorite: favorites.has(fullId),
        recentRank: recentRank >= 0 ? recentRank : undefined,
      }
    })
  }

  function applyDisabledState(models: import("./types").ModelInfo[]): import("./types").ModelInfo[] {
    return applyModelState(models)
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
    toggleModelFavorite,
    isModelFavorite,
    touchRecentModel,
    getModelPreferences,
    applyModelState,
    applyDisabledState,
    setTimelineVisible,
    isTimelineVisible,
    addChangedFile(id: string, filePath: string) {
      const session = state.sessions[id]
      if (!session) return
      if (!session.changedFiles) session.changedFiles = []
      if (!session.changedFiles.includes(filePath)) {
        session.changedFiles.push(filePath)
        save()
      }
    },
    updateTokenUsage(id: string, usage: { prompt: number; completion: number; total: number }) {
      const session = state.sessions[id]
      if (!session) return
      session.tokenUsage = usage
      save()
    }
  }
}
