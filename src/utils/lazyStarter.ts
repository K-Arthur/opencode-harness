/**
 * Wraps an idempotent async `start` so it runs lazily and at most once on
 * success, while de-duplicating concurrent callers to a single in-flight run.
 *
 * Used to defer spawning the opencode server until the user actually engages the
 * extension (first time the chat view is resolved), instead of spawning a server
 * process in every window on activation. A failed start re-arms so a later
 * trigger can retry; the underlying `start` is expected to be idempotent (e.g.
 * SessionManager.start() early-returns when already connected).
 */
export function createLazyStarter(start: () => Promise<void>): () => Promise<void> {
  let settledOk = false
  let inflight: Promise<void> | null = null

  return function ensure(): Promise<void> {
    if (settledOk) return Promise.resolve()
    if (inflight) return inflight
    inflight = start().then(
      () => {
        settledOk = true
        inflight = null
      },
      (err) => {
        // Re-arm: a transient failure (e.g. CLI not yet installed) must not
        // permanently latch the starter off.
        inflight = null
        throw err
      },
    )
    return inflight
  }
}
