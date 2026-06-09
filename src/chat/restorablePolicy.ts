/**
 * Pure policy for which sessions the extension host should re-send to the
 * webview when rebuilding `init_state`.
 *
 * `init_state` is used both for cold-start hydration and for live visibility
 * refreshes. The "active session" fallback (re-adding `sessionStore.activeId`
 * even when it is not in the open-tab set) is correct at cold start but
 * resurrects tabs the user has already closed when it runs on a refresh —
 * the closed session still lingers in `sessionStore` as the active id until
 * something else replaces it.
 */
export interface StoreActiveFallbackContext {
  /** True only for the first `init_state` push of this extension lifetime. */
  hydrating: boolean
  /** Whether the active session still has a live tab open in TabManager. */
  activeHasOpenTab: boolean
}

/**
 * Decide whether the store's active session should be force-included in the
 * restorable set even when it is not among the currently-open tabs.
 *
 * Cold start: always include it (restore the user's last active session).
 * Live refresh: only include it if it actually has an open tab, so a session
 * whose tab the user already closed is not silently restored.
 */
export function shouldIncludeStoreActiveFallback(ctx: StoreActiveFallbackContext): boolean {
  return ctx.hydrating || ctx.activeHasOpenTab
}
