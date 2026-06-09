/**
 * In-memory cache for webview display preferences read by renderers.
 *
 * Why this module exists: renderer.ts is dependency-light (no stateManager
 * import) so that renderers stay easy to reason about. But user preferences
 * like "Show thinking" need to influence newly-rendered blocks even when
 * they arrive from a stream long after the toggle was flipped.
 *
 * Wiring: setupThinkingToggle() in main.ts mirrors the persisted pref into
 * setThinkingVisible() on boot and on each user toggle. renderThinkingBlock
 * reads getThinkingVisible() when it creates a new <details> element.
 */

let thinkingVisible = true

export function getThinkingVisible(): boolean {
  return thinkingVisible
}

export function setThinkingVisible(visible: boolean): void {
  thinkingVisible = visible
}
