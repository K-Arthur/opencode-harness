/**
 * Pure focus-reconciliation decisions for the chat webview.
 *
 * The extension host treats `sessionStore.activeId` as a single source of
 * truth and broadcasts it to the webview through two channels:
 *   1. `active_session_changed` — fired on *every* host-side `setActive`,
 *      including server-side session-id promotion and background cleanup.
 *   2. `init_state` — re-sent on every webview visibility change, carrying
 *      the host's notion of the active session.
 *
 * Historically the webview obeyed both unconditionally, which stole focus
 * from the tab the user had deliberately switched to (e.g. switching away
 * from a streaming session to read another tab, only to be yanked back).
 *
 * These pure helpers encode the rule "the webview owns which tab is visible;
 * the host's active id is only a hint" so the behaviour is unit-testable in
 * isolation from the DOM and the message plumbing.
 */

export interface ActiveSessionChangeContext {
  /** True when the standalone welcome view is currently shown. */
  welcomeVisible: boolean
  /** The session id the webview currently displays, if any. */
  currentActiveId: string | null | undefined
  /** Whether `currentActiveId` still maps to a known, open session. */
  currentActiveValid: boolean
  /** The session id the host is asking the webview to focus. */
  targetId: string
  /** Whether the target session is mid-stream ("doing a task"). */
  targetIsStreaming: boolean
}

/**
 * Decide whether a host-driven `active_session_changed` should move the
 * visible tab. Returns `true` only when honouring the change cannot steal
 * focus from a task the user is deliberately viewing.
 */
export function shouldHonorActiveSessionChange(ctx: ActiveSessionChangeContext): boolean {
  const { welcomeVisible, currentActiveId, currentActiveValid, targetId, targetIsStreaming } = ctx

  // No tab in focus (welcome screen, or the current tab no longer exists):
  // following the host is always safe and usually desirable.
  if (welcomeVisible || !currentActiveId || !currentActiveValid) return true

  // Already showing the requested session — honouring is a harmless no-op.
  if (currentActiveId === targetId) return true

  // The user is viewing a different, valid tab. Never yank focus onto a
  // session that is streaming — that is the "switches back to a session
  // doing a task" bug. User-intended opens of a session arrive through
  // `resume_session_data`, which switches explicitly.
  if (targetIsStreaming) return false

  // A non-streaming host-driven switch (command-palette open, deletion
  // fallback to the next session) is allowed to follow the host.
  return true
}

export interface InitStateTargetContext {
  /** True only for the very first `init_state` of this webview lifetime. */
  isFirstInit: boolean
  /** Whether the welcome view was visible immediately before this message. */
  welcomeVisibleBefore: boolean
  /** The webview's active session id captured *before* merging host state. */
  priorActiveId: string | null | undefined
  /** The active session id the host put on the `init_state` message. */
  hostActiveId: string | null | undefined
  /** Predicate: is this id a session the webview now knows about? */
  isKnownSession: (id: string | null | undefined) => boolean
  /** First session in display order, used as a last resort. */
  firstSessionId: string | null
}

/**
 * Decide which tab should be focused after an `init_state` message.
 *
 * First hydration honours the host's restored active session. Every later
 * `init_state` (visibility refresh, model load, recovery) must *preserve the
 * user's current tab* instead of snapping back to the host's active id.
 */
export function resolveInitStateTarget(ctx: InitStateTargetContext): string | null {
  const { isFirstInit, welcomeVisibleBefore, priorActiveId, hostActiveId, isKnownSession, firstSessionId } = ctx

  if (isFirstInit) {
    // Cold start: restore exactly what the host says was active.
    if (isKnownSession(hostActiveId)) return hostActiveId ?? null
    if (isKnownSession(priorActiveId)) return priorActiveId ?? null
    return firstSessionId
  }

  // Live refresh: the user's current selection wins.
  if (isKnownSession(priorActiveId)) return priorActiveId ?? null
  // The user was deliberately on the welcome screen — keep them there.
  if (welcomeVisibleBefore) return null
  if (isKnownSession(hostActiveId)) return hostActiveId ?? null
  return firstSessionId
}
