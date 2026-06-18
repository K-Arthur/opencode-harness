/**
 * Cross-surface coordination for the chat webview.
 *
 * When a dropdown or modal opens, any other registered surface that is
 * currently open is closed first. This prevents z-index conflicts where a
 * lower-z surface (e.g. the changed-files dropdown at z=150) sits behind
 * a freshly-opened modal (z=300) — both surfaces would otherwise be visible
 * simultaneously, with the modal obscured.
 *
 * The escape coordinator handles Escape-key dismiss; this module handles
 * *mutual exclusion on open* — a simpler concern that the escape coordinator
 * does not address.
 */

export interface Surface {
  /** Stable identifier for logging / exclusion. */
  id: string
  /** Close the surface. */
  close: () => void
}

export interface SurfaceCoordinator {
  /** Register a surface. Returns an unregister function. */
  register(surface: Surface): () => void
  /** Close every registered surface except the one with `excludeId`. */
  closeOthers(excludeId: string): void
}

export function createSurfaceCoordinator(): SurfaceCoordinator {
  const surfaces: Surface[] = []

  function register(surface: Surface): () => void {
    surfaces.push(surface)
    return () => {
      const idx = surfaces.indexOf(surface)
      if (idx >= 0) surfaces.splice(idx, 1)
    }
  }

  function closeOthers(excludeId: string): void {
    for (const s of surfaces) {
      if (s.id === excludeId) continue
      try { s.close() } catch { /* surface may be detached */ }
    }
  }

  return { register, closeOthers }
}
