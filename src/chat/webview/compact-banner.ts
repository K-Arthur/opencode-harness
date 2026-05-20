/**
 * Compact-session banner UI.
 *
 * Surfaced by the host when the active session crosses the auto-compact
 * threshold AND the user's `opencode.autoCompact` setting is "ask"
 * (the default). The previous version of this feature shipped without
 * a webview-side handler — the host emitted compact_banner messages and
 * the webview dropped them on the floor, so users never saw the prompt
 * and could not opt in to compaction without the explicit /compact command.
 *
 * Lifecycle:
 *   host → "compact_banner"           → showCompactBanner()
 *   user click "Compact now"          → post compact_banner_action
 *   user click "Remind me later"      → post compact_banner_action (dismiss)
 *   host → "compact_banner_dismissed" → hideCompactBanner()
 *   host → "session_compacted"        → hideCompactBanner()
 */

export interface CompactBannerPayload {
  sessionId: string
  percent: number
  tokens: number
  maxTokens: number
  actions?: string[]
}

export interface CompactBannerDeps {
  /** Container the banner is appended into (typically the active tab panel). */
  getContainer: (sessionId: string) => HTMLElement | null
  postMessage: (msg: Record<string, unknown>) => void
}

const BANNER_ID = "compact-banner"

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "?"
  return n.toLocaleString()
}

export function showCompactBanner(deps: CompactBannerDeps, payload: CompactBannerPayload): void {
  const container = deps.getContainer(payload.sessionId)
  if (!container) return

  // Re-render if a banner already exists for this session (e.g. percent ticked up).
  hideCompactBanner(payload.sessionId)

  const banner = document.createElement("div")
  banner.id = BANNER_ID
  banner.dataset.sessionId = payload.sessionId
  banner.className = "compact-banner"
  banner.setAttribute("role", "alert")
  banner.setAttribute("aria-live", "polite")

  const percent = clamp(Math.round(payload.percent), 0, 100)
  const tokens = formatTokens(payload.tokens)
  const maxTokens = formatTokens(payload.maxTokens)

  const headline = document.createElement("div")
  headline.className = "compact-banner-headline"
  headline.textContent = `Context ${percent}% full — ${tokens} / ${maxTokens} tokens`
  banner.appendChild(headline)

  const body = document.createElement("div")
  body.className = "compact-banner-body"
  body.textContent =
    "Compacting will summarise older messages to free up tokens. Recent context is preserved."
  banner.appendChild(body)

  const actions = document.createElement("div")
  actions.className = "compact-banner-actions"

  const actionList = Array.isArray(payload.actions) && payload.actions.length > 0
    ? payload.actions
    : ["compact_now", "remind_later"]

  for (const action of actionList) {
    const btn = document.createElement("button")
    btn.className =
      action === "compact_now"
        ? "compact-banner-btn compact-banner-btn--primary"
        : "compact-banner-btn"
    btn.textContent = action === "compact_now" ? "Compact now" : "Remind me later"
    btn.dataset.action = action
    btn.addEventListener("click", () => {
      deps.postMessage({
        type: "compact_banner_action",
        action,
        sessionId: payload.sessionId,
      })
      // Optimistic: hide immediately so a slow round-trip doesn't leave the
      // banner sitting with both buttons clickable for further actions.
      hideCompactBanner(payload.sessionId)
    })
    actions.appendChild(btn)
  }

  banner.appendChild(actions)
  container.insertBefore(banner, container.firstChild)
}

export function hideCompactBanner(sessionId?: string): void {
  // If sessionId is omitted, hide any banner. Otherwise only the one matching.
  const banners = document.querySelectorAll<HTMLElement>(`#${BANNER_ID}, .compact-banner`)
  banners.forEach((b) => {
    if (!sessionId || b.dataset.sessionId === sessionId) {
      b.remove()
    }
  })
}
