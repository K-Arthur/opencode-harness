/**
 * Visibility gate for per-tab background rendering deferral.
 *
 * Hidden tab panels (display:none via lacking .active class) still receive
 * stream events. Allowing them to do full markdown re-parses, DOM mutations,
 * and scrollTop writes blocks the main thread and causes the active tab to
 * freeze. This module provides:
 *
 *   - isPanelVisible: cheap panel-visibility check (one closest() + classList)
 *   - registerActivationFlush / notifyTabActivated: deferred-flush registry so
 *     hidden tabs can catch up in a single RAF when they become visible
 */

const activationFlushes = new Map<string, Set<() => void>>()

/**
 * Returns true when `el` is inside a `.tab-panel.active`, or when there is no
 * `.tab-panel` ancestor (detached elements, unit tests). Default-true prevents
 * accidentally hiding content in edge cases.
 */
export function isPanelVisible(el: HTMLElement): boolean {
  const panel = el.closest(".tab-panel")
  if (!panel) return true
  return panel.classList.contains("active")
}

/**
 * Register a flush callback for `tabId`. Returns an unregister function.
 * When `notifyTabActivated(tabId)` fires, all registered callbacks run once
 * inside a single requestAnimationFrame.
 */
export function registerActivationFlush(tabId: string, fn: () => void): () => void {
  let set = activationFlushes.get(tabId)
  if (!set) {
    set = new Set()
    activationFlushes.set(tabId, set)
  }
  set.add(fn)
  return () => {
    activationFlushes.get(tabId)?.delete(fn)
  }
}

/**
 * Called from tabs.ts switchToTab after adding `.active` to the panel.
 * Schedules one RAF that drains all deferred flushes for the tab.
 */
export function notifyTabActivated(tabId: string): void {
  const set = activationFlushes.get(tabId)
  if (!set || set.size === 0) return
  const toRun = Array.from(set)
  requestAnimationFrame(() => {
    for (const fn of toRun) fn()
  })
}
