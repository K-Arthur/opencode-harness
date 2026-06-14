import type { WebviewState, SessionState, ChatMessage, VsCodeApi, ToolCollapseConfig, ContextUsage } from "./types"
import { timers } from "./timerRegistry"

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
  pendingMode: "build",
  initialized: false,
  isTimelineVisible: false,
  disabledModels: [],
  favoriteModels: [],
  recentModels: [],
  scrollPositions: {},
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
    scrollPositions: candidate.scrollPositions || {},
    displayPrefs: candidate.displayPrefs,
    toolCollapseConfig: candidate.toolCollapseConfig || DEFAULT_TOOL_COLLAPSE_CONFIG,
  }
}

/**
 * Schema version of the persisted WebviewState. Bumped whenever the shape
 * of `sessions[*].messages[*].blocks[*]` or session metadata changes in
 * a way that's not strictly forward-compatible.
 *
 * History:
 *   1 — Layer 5 of ADR-008. Canonical block shapes: `tool` (was tool_call/
 *       tool-call), `reasoning` (was thinking, with `text` instead of
 *       `content`). Session gains a `title` field mirroring SDK
 *       `Session.title`.
 */
export const CURRENT_SCHEMA_VERSION = 1

/**
 * Walk a persisted block and normalise its shape to the canonical
 * CanonicalBlock variants. Pure, idempotent, and runs once per block on
 * cold-load. Unknown / unrecognised block types pass through unchanged so
 * we never lose data we can't classify.
 */
function migrateBlock(input: unknown): unknown {
  if (!input || typeof input !== "object") return input
  const block = { ...(input as Record<string, unknown>) }

  // Tool blocks: tool_call / tool-call → tool. Spec ADR-008 §5.1.
  if (block.type === "tool_call" || block.type === "tool-call") {
    block.type = "tool"
  }

  // Reasoning blocks: thinking → reasoning, content → text.
  if (block.type === "thinking") {
    block.type = "reasoning"
  }
  if (block.type === "reasoning" && typeof block.content === "string" && typeof block.text !== "string") {
    block.text = block.content
    delete block.content
  }

  return block
}

function migrateMessage(input: unknown): unknown {
  if (!input || typeof input !== "object") return input
  const msg = { ...(input as Record<string, unknown>) }
  const blocks = Array.isArray(msg.blocks) ? msg.blocks : []
  msg.blocks = blocks.map(migrateBlock)
  return msg
}

function migrateSession(input: unknown): unknown {
  if (!input || typeof input !== "object") return input
  const sess = { ...(input as Record<string, unknown>) }
  // Layer 6 will rename `name` → `title` everywhere. For now, mirror the
  // value to `title` so the SDK-aligned field is populated and the legacy
  // `name` continues to satisfy current readers.
  if (typeof sess.name === "string" && typeof sess.title !== "string") {
    sess.title = sess.name
  }
  const messages = Array.isArray(sess.messages) ? sess.messages : []
  sess.messages = messages.map(migrateMessage)
  return sess
}

/**
 * Bring a persisted WebviewState up to `CURRENT_SCHEMA_VERSION`. Lossless:
 * unknown fields pass through. Idempotent: re-running on a current-version
 * state is a no-op (deep-equal). Refuses to load state from a newer schema
 * version (downgrade guard).
 *
 * Exported for testability. Used by `createState().restore()` on cold-load.
 */
export function migrateWebviewState(input: unknown): WebviewState & { schemaVersion: number } {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  const v = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0

  if (v > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `WebviewState schemaVersion ${v} unsupported — this build supports up to ${CURRENT_SCHEMA_VERSION}. Refusing to downgrade.`,
    )
  }

  let state: Record<string, unknown>

  if (raw.sessions) {
    // Already in v0+ shape (post-2026-05 architecture). Normalise blocks.
    state = { ...raw }
  } else {
    // Pre-architecture shape: { messages, currentMode, currentSessionId }.
    const sessionId = (raw.currentSessionId as string | undefined) || "session-1"
    const oldMode = (raw.currentMode as string | undefined) || "normal"
    const mode = oldMode === "normal" ? "build" : oldMode
    const session: SessionState = {
      id: sessionId,
      name: "Session 1",
      model: "",
      mode,
      messages: (raw.messages as ChatMessage[] | undefined) || [],
      isStreaming: false,
    }
    state = {
      sessions: { [sessionId]: session },
      sessionOrder: [sessionId],
      activeSessionId: sessionId,
      nextSessionNum: 2,
      globalModel: "",
    }
  }

  // Walk sessions and migrate per-block. Skip if already at current version
  // so the operation is a true no-op on idempotent re-entry.
  if (v < CURRENT_SCHEMA_VERSION) {
    const sessions = (state.sessions as Record<string, unknown> | undefined) || {}
    const migratedSessions: Record<string, unknown> = {}
    for (const [id, sess] of Object.entries(sessions)) {
      migratedSessions[id] = migrateSession(sess)
    }
    state.sessions = migratedSessions
  }

  state.schemaVersion = CURRENT_SCHEMA_VERSION
  return withDefaults(state as Partial<WebviewState>) as WebviewState & { schemaVersion: number }
}

/** Backwards-compatible export for legacy `restore()` callers. */
function migrateState(old: any): WebviewState {
  return migrateWebviewState(old)
}

function generateId(): string {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 8)
    : (() => { const chars = "0123456789abcdef"; let r = ""; for (let i = 0; i < 8; i++) r += chars[Math.floor(Math.random() * 16)]; return r })()
}

function hasContextFill(usage: ContextUsage | undefined): boolean {
  return !!usage && ((Number.isFinite(usage.tokens) && usage.tokens > 0) || (Number.isFinite(usage.percent) && usage.percent > 0))
}

function chooseContextUsage(hostUsage: ContextUsage | undefined, localUsage: ContextUsage | undefined): ContextUsage | undefined {
  if (!hostUsage) return localUsage
  if (!localUsage) return hostUsage
  if (!hasContextFill(hostUsage) && hasContextFill(localUsage)) {
    return localUsage
  }
  const hostUpdatedAt = Number.isFinite(hostUsage.updatedAt ?? NaN) ? (hostUsage.updatedAt ?? 0) : 0
  const localUpdatedAt = Number.isFinite(localUsage.updatedAt ?? NaN) ? (localUsage.updatedAt ?? 0) : 0
  if (hostUpdatedAt > 0 && localUpdatedAt > 0 && hostUpdatedAt < localUpdatedAt && hasContextFill(localUsage)) {
    return localUsage
  }
  return hostUsage
}

export function createState(vscode: VsCodeApi) {
  let state: WebviewState = withDefaults({})
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const SAVE_DEBOUNCE_MS = 300
  const MAX_STATE_BYTES = 2 * 1024 * 1024
  // Persistence cap, aligned with the host's init_state MAX_MESSAGES_PER_TAB:
  // on webview reload the extension host re-hydrates each tab with its last
  // 50 messages anyway (and "Load earlier" / resume backfill cover the rest),
  // so persisting more than that here buys nothing — but it used to cost a
  // full multi-MB serialize + IPC on EVERY debounced save once two long
  // sessions were open. setState cost must scale with the snapshot bound,
  // never with total transcript size.
  const PERSIST_MAX_MESSAGES = 50
  const PERSIST_FALLBACK_MESSAGES = 10

  function snapshotWithCap(cap: number): WebviewState {
    const sessions: Record<string, SessionState> = {}
    for (const [id, s] of Object.entries(state.sessions)) {
      sessions[id] = s.messages.length > cap ? { ...s, messages: s.messages.slice(-cap) } : s
    }
    return { ...state, sessions }
  }

  function buildPersistSnapshot(): WebviewState {
    const snapshot = snapshotWithCap(PERSIST_MAX_MESSAGES)
    try {
      // Single bounded-size probe (≤ cap messages/session, sub-ms). If giant
      // individual messages still blow the state budget, trim deeper rather
      // than handing VS Code an oversized state object.
      if (JSON.stringify(snapshot).length > MAX_STATE_BYTES) {
        return snapshotWithCap(PERSIST_FALLBACK_MESSAGES)
      }
    } catch {
      // Unserializable content is vscode.setState's problem either way;
      // persist the bounded snapshot rather than losing the save.
    }
    return snapshot
  }

  function save() {
    if (saveTimer) timers.clearTimeout(saveTimer)
    saveTimer = timers.setTimeout(() => {
      vscode.setState(buildPersistSnapshot())
      saveTimer = null
    }, SAVE_DEBOUNCE_MS)
  }

  // Force-save immediately (useful before tab close, etc.)
  function flush() {
    if (saveTimer) {
      timers.clearTimeout(saveTimer)
      saveTimer = null
    }
    vscode.setState(buildPersistSnapshot())
  }

  function restore(): boolean {
    const saved = vscode.getState()
    if (saved) {
      state = migrateState(saved)
      // No stream can possibly still be running across a webview reload.
      // Stale `isStreaming: true` flags left from a prior session (e.g. one
      // killed by a dropped message_complete event) would otherwise inflate
      // getStreamCapacityState() and cause sendMessage() to silently bail at
      // the "stream limit reached" guard — the user types, presses Enter,
      // and nothing happens.
      for (const id of Object.keys(state.sessions)) {
        const s = state.sessions[id]
        if (s && s.isStreaming) s.isStreaming = false
        // Same reasoning for subagents: no subagent run survives a webview
        // reload, and run_activity_update never fires again for a finished
        // run, so a persisted non-terminal status would stay "Running" forever.
        if (s?.subagentActivities) {
          const now = Date.now()
          for (const activity of s.subagentActivities) {
            if (activity.status === "completed" || activity.status === "failed" || activity.status === "cancelled") continue
            activity.status = "completed"
            activity.isLive = false
            activity.completedAt = activity.completedAt ?? now
          }
        }
      }
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

  function createSession(name?: string, model?: string, mode?: string): SessionState {
    const id = `session-${generateId()}`
    const session: SessionState = {
      id,
      name: name || "",
      model: model || state.globalModel || "",
      mode: mode || state.pendingMode || "build",
      messages: [],
      isStreaming: false,
      ...(state.globalVariant ? { variant: state.globalVariant } : {}),
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
      existing.tokenUsage = session.tokenUsage ?? existing.tokenUsage
      existing.cost = typeof session.cost === "number" && session.cost > 0 ? session.cost : existing.cost
      existing.contextUsage = chooseContextUsage(session.contextUsage, existing.contextUsage)
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
    if (state.scrollPositions) {
      delete state.scrollPositions[id]
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

  function setSessionSteerMode(id: string, steerMode: "interrupt" | "queue"): boolean {
    const session = state.sessions[id]
    if (!session) return false
    session.steerMode = steerMode
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
          contextUsage: chooseContextUsage(s.contextUsage, existing.contextUsage),
        }
      } else if (existing) {
        state.sessions[s.id] = {
          ...s,
          messages: existing.messages !== s.messages ? (() => { existing.messages.length = 0; existing.messages.push(...s.messages); return existing.messages })() : s.messages,
          isStreaming: existing.isStreaming,
          tokenUsage: s.tokenUsage ?? existing?.tokenUsage,
          cost: typeof s.cost === "number" && s.cost > 0 ? s.cost : existing?.cost ?? s.cost,
          contextUsage: chooseContextUsage(s.contextUsage, existing.contextUsage),
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

  /** Mode the next created session will start in (chosen on the welcome screen). */
  function getPendingMode(): string {
    return state.pendingMode || "build"
  }

  function setPendingMode(mode: string) {
    state.pendingMode = mode
    save()
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

  function setScrollPosition(id: string, scrollTop: number): boolean {
    if (!state.sessions[id]) return false
    if (!Number.isFinite(scrollTop)) return false
    if (!state.scrollPositions) state.scrollPositions = {}
    const next = Math.max(0, Math.round(scrollTop))
    if (state.scrollPositions[id] === next) return true
    state.scrollPositions[id] = next
    save()
    return true
  }

  function getScrollPosition(id: string): number {
    return state.scrollPositions?.[id] ?? 0
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
    setSessionSteerMode,
    setStreaming,
    appendMessage,
    getAllSessions,
    getSessionCount,
    setGlobalModel,
    setGlobalVariant,
    getGlobalVariant,
    getPendingMode,
    setPendingMode,
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
    setScrollPosition,
    getScrollPosition,
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
    },
    setSubagentActivities(id: string, activities: import("./types").SubagentActivity[]) {
      const session = state.sessions[id]
      if (!session) return
      session.subagentActivities = activities
      save()
    },
    setSubagentDetail(id: string, detail: unknown) {
      const session = state.sessions[id]
      if (!session) return
      session.subagentDetail = detail
      save()
    },
  }
}
