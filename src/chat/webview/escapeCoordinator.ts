/**
 * Central Escape-key coordinator for the chat webview.
 *
 * Historically every overlay (modals, dropdowns, side region, detail views,
 * search bar) attached its own document-level Escape listener. A single key
 * press could close several surfaces at once, and — because most handlers
 * never called preventDefault() — the event was also forwarded to the host,
 * where a `escape → opencode-harness.stop` keybinding aborted the running
 * stream. Closing a dropdown could cancel the user's task.
 *
 * The coordinator restores one invariant: **one Escape press affects exactly
 * one surface**, resolved in priority order. Only when nothing is open does
 * Escape mean "stop the active stream" (the documented affordance), and the
 * event is always consumed when acted upon so nothing else double-fires.
 *
 * Surfaces that manage Escape correctly on their own (combobox autocompletes
 * anchored to the prompt input, aria-modal dialogs not registered here) are
 * detected via the `hasDeferredOverlay` / `hasUnmanagedModal` predicates and
 * the coordinator steps aside entirely for them.
 */

export interface OverlayDescriptor {
  /** Stable identifier, used for logging/tests. */
  id: string
  /** Higher closes first. Modals ≈ 100, dropdowns ≈ 80, nested detail views ≈ 60,
   *  transient bars ≈ 40, side panels ≈ 20. Ties: most recently registered wins. */
  priority: number
  /** Whether the surface is currently visible. A throwing implementation is
   *  treated as closed (detached DOM must never break the key handler). */
  isOpen: () => boolean
  /** Close the surface. Must restore focus to the invoker where applicable. */
  close: () => void
}

export type EscapeAction =
  | { type: "defer" }
  | { type: "close-overlay"; id: string }
  | { type: "stop-stream" }
  | { type: "none" }

export interface EscapeContext {
  /** A self-managed popup (e.g. mention/slash autocomplete) is visible — its
   *  own handler owns Escape; the coordinator must not act. */
  hasDeferredOverlay: boolean
  /** An aria-modal dialog the coordinator does not manage is open. */
  hasUnmanagedModal: boolean
  /** The active session is currently streaming. */
  isStreaming: boolean
}

/** Pure resolution: given the overlay registry (in registration order) and the
 *  current context, decide what a single Escape press should do. */
export function resolveEscapeAction(
  overlays: readonly OverlayDescriptor[],
  ctx: EscapeContext
): EscapeAction {
  if (ctx.hasDeferredOverlay || ctx.hasUnmanagedModal) return { type: "defer" }

  let best: OverlayDescriptor | undefined
  for (const overlay of overlays) {
    let open = false
    try {
      open = overlay.isOpen()
    } catch {
      open = false
    }
    if (!open) continue
    // `>=` so later registration wins ties — the most recently wired surface
    // is treated as topmost.
    if (!best || overlay.priority >= best.priority) best = overlay
  }
  if (best) return { type: "close-overlay", id: best.id }
  if (ctx.isStreaming) return { type: "stop-stream" }
  return { type: "none" }
}

export interface EscapeRegistryOptions {
  isStreaming: () => boolean
  onStop: () => void
  hasDeferredOverlay: () => boolean
  hasUnmanagedModal: () => boolean
}

export interface EscapeRegistry {
  /** Add an overlay. Returns an unregister function. */
  register(overlay: OverlayDescriptor): () => void
  /** Keydown handler — attach once, document capture phase, before any other
   *  Escape listeners are wired. Exposed directly so tests can drive it. */
  handleKeydown(e: KeyboardEvent): void
}

export function createEscapeRegistry(options: EscapeRegistryOptions): EscapeRegistry {
  const overlays: OverlayDescriptor[] = []

  function register(overlay: OverlayDescriptor): () => void {
    overlays.push(overlay)
    return () => {
      const idx = overlays.indexOf(overlay)
      if (idx >= 0) overlays.splice(idx, 1)
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key !== "Escape" || e.defaultPrevented) return
    const action = resolveEscapeAction(overlays, {
      hasDeferredOverlay: options.hasDeferredOverlay(),
      hasUnmanagedModal: options.hasUnmanagedModal(),
      isStreaming: options.isStreaming(),
    })
    switch (action.type) {
      case "close-overlay": {
        const target = overlays.find((o) => o.id === action.id)
        target?.close()
        e.preventDefault()
        e.stopPropagation()
        break
      }
      case "stop-stream":
        options.onStop()
        e.preventDefault()
        e.stopPropagation()
        break
      case "defer":
      case "none":
        break
    }
  }

  return { register, handleKeydown }
}

/** Build an `isOpen` predicate for an element that signals visibility with the
 *  `hidden` class (the webview-wide convention). */
export function visibleByClass(el: () => HTMLElement | null): () => boolean {
  return () => {
    const node = el()
    return Boolean(node && !node.classList.contains("hidden"))
  }
}
