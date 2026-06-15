/**
 * Resolve which session a per-session host event targets.
 *
 * Multi-session bug class: components (question bar, context-usage bar, …) were
 * updating the *viewed* session whenever an event's explicit sessionId was
 * missing. The dispatcher always supplies an envelope `sid`
 * (`msg.message?.sessionId || msg.sessionId`), so the correct precedence is:
 *
 *   explicit msg.sessionId  →  envelope sid  →  active (last resort)
 *
 * Falling back to `active` is only safe for genuinely session-less single-tab
 * flows; for any event that names a session, this returns THAT session so a
 * background session can never paint over the tab the user is looking at.
 */
export function resolveEventSessionTarget(
  explicit: unknown,
  envelope: string | undefined,
  active: string | null,
  isValid: (s: unknown) => boolean,
): string | null {
  if (isValid(explicit)) return explicit as string
  if (isValid(envelope)) return envelope as string
  return active
}
