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
  /** Whether the current (user-visible) session is mid-stream. */
  currentIsStreaming: boolean
}

/**
 * Decide whether a host-driven `active_session_changed` should move the
 * visible tab. Returns `true` only when honouring the change cannot steal
 * focus from a task the user is deliberately viewing.
 */
export function shouldHonorActiveSessionChange(ctx: ActiveSessionChangeContext): boolean {
  const { welcomeVisible, currentActiveId, currentActiveValid, targetId } = ctx

  // No tab in focus (welcome screen, or the current tab no longer exists):
  // following the host is always safe and usually desirable.
  if (welcomeVisible || !currentActiveId || !currentActiveValid) return true

  // Already showing the requested session — honouring is a harmless no-op.
  if (currentActiveId === targetId) return true

  // Tab auto-switching disabled entirely. The user is viewing a different,
  // valid tab — never yank focus away from what they are deliberately
  // reading. User-intended opens arrive through explicit tab clicks or
  // `resume_session_data` with userInitiated=true.
  return false
}

export interface SendFocusContext {
  /** True when the standalone welcome view is currently shown. */
  welcomeVisible: boolean
  /** The session id the webview currently displays, if any. */
  currentActiveId: string | null | undefined
  /** Whether `currentActiveId` still maps to a known, open session. */
  currentActiveValid: boolean
  /** The session id send is targeting (the one whose panel is missing). */
  targetId: string
}

/**
 * Decide whether `sendMessage`'s "active panel doesn't exist" fallback is
 * allowed to switchToTab the user onto the target session.
 *
 * Previously this path yanked focus onto the target whenever its panel was
 * missing — even when the user was deliberately viewing another valid tab
 * (a state desync after init/resume could trigger it mid-generation).
 * Per the "never auto-switch during generation" requirement we now only
 * switch when the user has nothing valid to look at (welcome screen or no
 * current tab); otherwise we create the panel but leave the user where
 * they are.
 */
export function shouldForceFocusOnSend(_ctx: SendFocusContext): boolean {
  // Tab auto-switching disabled entirely. Users must explicitly click tabs to switch.
  return false
}

export interface ResumeFocusContext {
  /** True when the standalone welcome view is currently shown. */
  welcomeVisible: boolean
  /** The session id the webview currently displays, if any. */
  currentActiveId: string | null | undefined
  /** Whether `currentActiveId` still maps to a known, open session. */
  currentActiveValid: boolean
  /** The session id the host just resumed. */
  targetId: string
  /** Whether the resume was triggered by an explicit user action (history click). */
  userInitiated: boolean
}

/**
 * Decide whether `resume_session_data` should switchToTab the user onto the
 * resumed session. The handler fires for both user-initiated resumes (clicking
 * a session in the history list) and background/automatic ones (state sync,
 * auto-restore). Only the user-initiated path may yank focus away from a
 * valid tab the user is currently viewing; automatic resumes must never
 * disrupt the user's view, especially when another tab is mid-stream.
 */
export function shouldHonorResumeSessionSwitch(ctx: ResumeFocusContext): boolean {
  const { welcomeVisible, currentActiveId, currentActiveValid, targetId, userInitiated } = ctx
  // Already viewing the target — honour is a no-op.
  if (currentActiveId === targetId) return true
  // No valid tab being viewed — safe to focus the resumed session.
  if (welcomeVisible || !currentActiveId || !currentActiveValid) return true
  // User is on a different valid tab. Only yank if they explicitly asked
  // for this resume (e.g. clicked a session in history). Background resumes
  // must never steal focus.
  return userInitiated
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
