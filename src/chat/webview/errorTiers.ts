/**
 * Spatial error-tier components and router (frontend).
 *
 * Consumes the validated {@link NormalizedError} from `errorWire.ts` and routes
 * it to one of three isolated surfaces (PLAN.md §2):
 *
 *   Tier A — {@link TierAAnchor}        hard block: composer disabled, persistent
 *   Tier B — {@link GlobalStatusBanner}  ambient top-edge banner, ephemeral, retryable
 *   Tier C — legacy in-stream bubble     (caller-supplied via `renderInStream`)
 *
 * Design rules enforced here:
 *   - The router is the ONLY place a tier chooses a surface. Call sites never
 *     decide where an error renders.
 *   - Tier A survives panel toggle / reload (persisted via {@link
 *     ErrorStateStore}). Tier B is session-scoped (setState only). Tier C is
 *     transcript-persistent (handled by the caller).
 *   - Reconnect-while-drawn: {@link applyErrorCleared} dismisses live Tier-B
 *     banners but NEVER clears Tier A (a hard cap is not resolved by reconnect).
 *
 * Dependencies are injected (and DOM access is lazy via getters) so the routing
 * logic and store are unit-testable without VS Code or a live DOM.
 */

import type { ErrorContext, ErrorAction } from "./errorTypes"
import { isErrorClearedEnvelope, type NormalizedError, type ErrorTier } from "./errorWire"
import { ERROR_SVG, WARNING_SVG, INFO_SVG, REMOVE_SVG } from "./icons"

// ---------------------------------------------------------------------------
// Dependency surfaces (injected for testability)
// ---------------------------------------------------------------------------

/** Abstracted persistence so the store runs under node:test without vscode. */
export interface ErrorPersistenceBackend {
  get(): Record<string, unknown>
  set(state: Record<string, unknown>): void
}

export interface ErrorTierDeps {
  /** Slot element that hosts both Tier-A and Tier-B banners (e.g. #global-status-banner). */
  bannerSlot: () => HTMLElement | null
  /** Composer input element, disabled while a Tier-A hard block is active. */
  composer: () => HTMLElement | null
  /** Send button — its affordance is converted to the Tier-A recovery CTA. */
  sendButton: () => HTMLElement | null
  /** Post a message back to the extension host (e.g. retry, upgrade_plan). */
  postMessage: (msg: Record<string, unknown>) => void
  /** Optional vscode getState/setState wrapper; omit for in-memory only. */
  persistence?: ErrorPersistenceBackend
  /** Tier-C fall-through: render the context as an in-stream system turn. */
  renderInStream?: (ctx: ErrorContext) => void
  /** Optional clock injection for deterministic countdown tests. */
  now?: () => number
}

export interface RouteResult {
  /** true when a tier surface claimed the error; false when it fell through unrendered. */
  handled: boolean
  tier: ErrorTier
}

// ---------------------------------------------------------------------------
// ErrorStateStore — persists Tier-A hard blocks so they survive panel toggle / reload
// ---------------------------------------------------------------------------

const TIER_A_KEY_PREFIX = "errorTierA."

function tierAKey(sessionId: string | undefined): string {
  return `${TIER_A_KEY_PREFIX}${sessionId ?? "default"}`
}

/**
 * Owns the persisted Tier-A hard-block state. Sole read source for whether the
 * composer must stay gated on load. In-memory map mirrors what is in
 * `persistence` so reads are O(1) and side-effect free.
 */
export class ErrorStateStore {
  private readonly memory = new Map<string, ErrorContext>()
  private readonly backend?: ErrorPersistenceBackend

  constructor(backend?: ErrorPersistenceBackend) {
    this.backend = backend
    this.restore()
  }

  private restore(): void {
    if (!this.backend) return
    const state = this.backend.get() as Record<string, unknown>
    for (const [key, value] of Object.entries(state)) {
      if (key.startsWith(TIER_A_KEY_PREFIX) && isPlainContext(value)) {
        this.memory.set(key, value as ErrorContext)
      }
    }
  }

  setTierA(sessionId: string | undefined, ctx: ErrorContext): void {
    const key = tierAKey(sessionId)
    this.memory.set(key, ctx)
    this.persist()
  }

  getTierA(sessionId: string | undefined): ErrorContext | undefined {
    return this.memory.get(tierAKey(sessionId))
  }

  clearTierA(sessionId: string | undefined): void {
    const key = tierAKey(sessionId)
    if (this.memory.delete(key)) this.persist()
  }

  /** True when a Tier-A hard block is active for the given session. */
  isGated(sessionId: string | undefined): boolean {
    return this.memory.has(tierAKey(sessionId))
  }

  /** All persisted Tier-A contexts (order unspecified). Used to restore gates on load. */
  snapshot(): ErrorContext[] {
    return Array.from(this.memory.values())
  }

  private persist(): void {
    if (!this.backend) return
    const obj: Record<string, unknown> = {}
    for (const [key, value] of this.memory) obj[key] = value
    this.backend.set(obj)
  }
}

function isPlainContext(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { category?: unknown }).category === "string" &&
    typeof (value as { severity?: unknown }).severity === "string" &&
    typeof (value as { code?: unknown }).code === "string"
  )
}

// ---------------------------------------------------------------------------
// GlobalStatusBanner — Tier B (ambient infrastructure banner)
// ---------------------------------------------------------------------------

export const GlobalStatusBanner = {
  /**
   * Mount (or replace) the ambient Tier-B banner. Does NOT steal focus and
   * does NOT touch the composer. Auto-clears any Tier-A anchor that happens to
   * be in the same slot — Tier A and Tier B are mutually exclusive in the
   * single slot, and a hard cap takes precedence (see {@link TierAAnchor}).
   */
  show(ctx: ErrorContext, deps: ErrorTierDeps): void {
    const slot = deps.bannerSlot()
    if (!slot) return
    // A hard cap always wins the slot.
    if (slot.firstElementChild?.classList.contains("tier-a-anchor")) return

    const banner = buildBanner(ctx, deps, "tier-b-banner")
    slot.replaceChildren(banner)
  },

  /** Remove a live Tier-B banner (e.g. on reconnect). No-op if Tier-A holds the slot. */
  clear(deps: ErrorTierDeps): void {
    const slot = deps.bannerSlot()
    if (!slot) return
    const current = slot.firstElementChild
    if (current?.classList.contains("tier-b-banner")) slot.replaceChildren()
  },
}

// ---------------------------------------------------------------------------
// TierAAnchor — Tier A (hard block: composer gate + recovery CTA)
// ---------------------------------------------------------------------------

export const TierAAnchor = {
  /**
   * Mount the hard-block anchor and gate the composer. Persists via the store
   * so the block survives sidebar toggle and window reload. The send button's
   * primary action becomes the highest-priority recovery CTA.
   */
  show(ctx: ErrorContext, deps: ErrorTierDeps, store: ErrorStateStore): void {
    store.setTierA(ctx.sessionId, ctx)
    gateComposer(deps, true)
    const slot = deps.bannerSlot()
    if (slot) {
      const anchor = buildBanner(ctx, deps, "tier-a-anchor")
      slot.replaceChildren(anchor)
    }
  },

  /** Remove the anchor, ungate the composer, and drop persisted state. */
  clear(deps: ErrorTierDeps, store: ErrorStateStore, sessionId?: string): void {
    store.clearTierA(sessionId)
    gateComposer(deps, false)
    const slot = deps.bannerSlot()
    if (slot) {
      const current = slot.firstElementChild
      if (current?.classList.contains("tier-a-anchor")) slot.replaceChildren()
    }
  },
}

function gateComposer(deps: ErrorTierDeps, gated: boolean): void {
  const composer = deps.composer() as HTMLTextAreaElement | HTMLInputElement | null
  if (composer) {
    if (gated) composer.setAttribute("disabled", "true")
    else composer.removeAttribute("disabled")
  }
}

// ---------------------------------------------------------------------------
// Router + reconnect handler
// ---------------------------------------------------------------------------

/**
 * Route a validated error to its tier surface. Returns whether a surface
 * claimed it. Tier C falls through to `deps.renderInStream` if provided
 * (otherwise returns `handled: false` so the caller can use the legacy path).
 */
export function routeErrorByTier(
  normalized: NormalizedError,
  deps: ErrorTierDeps,
  store: ErrorStateStore,
): RouteResult {
  const { context, tier } = normalized
  switch (tier) {
    case "A":
      TierAAnchor.show(context, deps, store)
      return { handled: true, tier: "A" }
    case "B":
      GlobalStatusBanner.show(context, deps)
      return { handled: true, tier: "B" }
    case "C":
      if (deps.renderInStream) {
        deps.renderInStream(context)
        return { handled: true, tier: "C" }
      }
      return { handled: false, tier: "C" }
  }
}

/**
 * Handle a host `error_cleared` envelope (abrupt connection restoration while
 * a banner is drawn). Dismisses a live Tier-B banner but deliberately leaves
 * any Tier-A hard block in place — reconnecting does not resolve a quota cap
 * or an auth failure.
 */
export function applyErrorCleared(
  raw: unknown,
  deps: ErrorTierDeps,
): void {
  if (!isErrorClearedEnvelope(raw)) return
  GlobalStatusBanner.clear(deps)
}

/**
 * Restore any persisted Tier-A hard block on webview (re)load. Call once during
 * webview init, after the banner slot and composer exist in the DOM. Re-shows
 * the most recently persisted block (cold-load behaviour; per-session restore
 * can be driven by iterating `store.snapshot()` if needed).
 */
export function restoreErrorTiers(deps: ErrorTierDeps, store: ErrorStateStore): void {
  const all = store.snapshot()
  if (all.length === 0) return
  TierAAnchor.show(all[all.length - 1]!, deps, store)
}

// ---------------------------------------------------------------------------
// DOM construction (token-driven CSS, no inline color literals)
// ---------------------------------------------------------------------------

function buildBanner(ctx: ErrorContext, deps: ErrorTierDeps, className: string): HTMLElement {
  const el = document.createElement("section")
  el.className = className
  el.setAttribute("role", "alert")
  el.setAttribute("aria-live", className === "tier-a-anchor" ? "assertive" : "polite")
  el.setAttribute("data-error-code", ctx.code)
  el.setAttribute("data-severity", ctx.severity)

  const icon = document.createElement("span")
  icon.className = `${className}__icon`
  icon.setAttribute("aria-hidden", "true")
  icon.innerHTML = severityGlyph(ctx.severity)
  el.appendChild(icon)

  const body = document.createElement("div")
  body.className = `${className}__body`

  const msg = document.createElement("p")
  msg.className = `${className}__message`
  msg.textContent = ctx.userMessage
  body.appendChild(msg)

  if (ctx.technicalDetails) {
    const detail = document.createElement("p")
    detail.className = `${className}__detail`
    detail.textContent = ctx.technicalDetails
    body.appendChild(detail)
  }
  el.appendChild(body)

  const actions = document.createElement("div")
  actions.className = `${className}__actions`
  const prioritised = [...ctx.suggestedActions].sort((a, b) =>
    a.primary === b.primary ? 0 : a.primary ? -1 : 1,
  )
  for (const action of prioritised) {
    actions.appendChild(renderActionButton(action, ctx, deps, className))
  }
  // Tier-B banners are always dismissible locally; Tier-A is not (hard block).
  if (className === "tier-b-banner" && !prioritised.some(a => a.action === "dismiss")) {
    actions.appendChild(
      renderActionButton(
        { label: "Dismiss", action: "dismiss" },
        ctx,
        deps,
        className,
      ),
    )
  }
  el.appendChild(actions)

  return el
}

function renderActionButton(
  action: ErrorAction,
  ctx: ErrorContext,
  deps: ErrorTierDeps,
  className: string,
): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.type = "button"
  btn.className = `${className}__btn${action.primary ? ` ${className}__btn--primary` : ""}`
  btn.textContent = action.label
  btn.addEventListener("click", () => handleAction(action, ctx, deps))
  return btn
}

function handleAction(action: ErrorAction, ctx: ErrorContext, deps: ErrorTierDeps): void {
  if (action.action === "dismiss") {
    // Local-only: drop the Tier-B banner. Tier-A dismiss is host-driven.
    GlobalStatusBanner.clear(deps)
    return
  }
  // Forward every other action to the host (retry / upgrade_plan / wait_for_reset /
  // pick_model / switch_model / contact_support / edit / regenerate / view_details).
  deps.postMessage({
    type: "error_action",
    action: action.action,
    actionLabel: action.label,
    correlationId: ctx.correlationId,
    code: ctx.code,
    category: ctx.category,
    metadata: action.metadata ?? {},
  })
}

function severityGlyph(severity: ErrorContext["severity"]): string {
  switch (severity) {
    case "critical":
      return ERROR_SVG
    case "high":
      return REMOVE_SVG
    case "medium":
      return WARNING_SVG
    case "low":
    default:
      return INFO_SVG
  }
}
