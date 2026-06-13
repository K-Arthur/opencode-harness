# ADR-015: Central Escape Coordinator and Webview Navigation Safety

**Status:** Accepted (2026-06-12)

**Related:** docs/specs/2026-06-12-navigation-audit-and-plan.md (full audit + plan)

## Context

The chat webview accumulated **12+ independent `Escape` handlers** — one per
overlay (session/skills/commands/shortcuts modals, settings menu, mode/model
dropdowns, side region, subagent detail, search bar, prompt stash, context-usage
and changed-files dropdowns, mention/slash autocompletes, instructions editor).
They were attached at the document level and, with few exceptions, did **not**
call `preventDefault()`/`stopPropagation()`.

Separately, `package.json` bound a bare `escape` keybinding (scoped
`focusedView == 'opencode-harness.chat'`) to `opencode-harness.stop`, which
aborts the active stream.

The two layers collided. A single `Escape` press intended to dismiss a dropdown
also propagated to the host keybinding and **aborted the running task**.
Multiple webview listeners could also fire on the same press (e.g. side region
*and* subagent detail closing together). There was already a shortcut registry
(`keyboardShortcuts.ts`) with `skipInModal` semantics, but it was dead code —
`main.ts` used its own raw listener.

This violated the project's navigation goals (predictable Escape, error
prevention, no accidental loss of work) and WCAG 2.2 expectations for consistent,
non-destructive keyboard behavior.

## Decision

**One Escape press affects exactly one surface, resolved by priority.** A single
coordinator owns the decision; individual overlays no longer race each other or
the host.

1. **`escapeCoordinator.ts`** — a pure resolver (`resolveEscapeAction`) plus a
   thin stateful registry (`createEscapeRegistry`). Overlays register
   `{ id, priority, isOpen, close }`. On `Escape` the coordinator closes the
   single highest-priority open overlay (ties: most-recently-registered wins —
   "topmost") and **consumes the event** (`preventDefault` + `stopPropagation`)
   so no legacy document handler double-fires.

2. **Capture-phase listener.** The coordinator's handler is attached with
   `addEventListener("keydown", h, true)` so it runs *before* every
   component-level Escape listener. Consumed events never reach them.

3. **Escape stops the stream only when nothing is open.** When no managed
   overlay is open and the active session is streaming, the coordinator calls
   the in-webview `abortStream()`. The destructive host-level `escape → stop`
   keybinding is **removed**. `Ctrl+Shift+Escape` remains as the always-on,
   unambiguous stop.

4. **Deferral, not seizure.** The coordinator steps aside (`defer`) for surfaces
   that legitimately own Escape: combobox-style popups anchored to the prompt
   input (mention/slash autocomplete, mode/model/variant menus), any
   `aria-modal` dialog it does **not** manage (instructions editor, model
   manager, MCP config, theme customizer, permission config, mode warning), and
   non-prompt text fields (queue inline edit, todo input, modal search). Those
   keep their own component-level handling unchanged.

5. **Priority bands.** modals ≈ 100, dropdowns/menus ≈ 80, nested detail
   views ≈ 60, transient bars ≈ 40, side panels ≈ 20. So with the subagent
   detail open inside the side region, the first Escape returns to the list
   (detail, 60) and the second closes the region (20) — never both at once.
   A pinned side region reports itself closed to the coordinator (pin opts out).

**Keybinding hygiene (same change set):** the `F1` override inside the chat view
is removed (F1 is VS Code "Show All Commands" per the UX guidelines;
`Ctrl+Shift+/` still opens the in-webview palette).

## Alternatives considered

- **Adopt the existing `keyboardShortcuts.ts` registry instead.** It models
  `skipInModal` but not an *ordered* overlay stack, and does not consume events
  in a capture phase. Retrofitting an ordered, deferral-aware stack onto it was
  larger than a focused module. Folding all in-webview shortcuts into one
  registry remains a tracked follow-up (S-6 in the plan).
- **Keep the host `escape → stop` keybinding and only fix webview handlers.**
  Rejected: VS Code delivers the keybinding independently of webview listeners,
  so the abort-on-dismiss race cannot be closed from inside the webview alone.
- **Per-overlay `stopPropagation` everywhere.** Rejected: still leaves N
  uncoordinated handlers (multi-close races) and is easy to regress.

## Consequences

- **Positive:** Escape is predictable and non-destructive; closing an overlay
  can never cancel a run. Focus restoration is owned by each `close()` fn, so
  closes route focus back to the invoker (shortcuts modal + subagent detail
  fixed in this change). New overlays opt in with one `register()` call.
- **Cost:** A new overlay that forgets to register will fall through to
  stop-stream/none on Escape; the registry is the single place to wire it.
- **Compat:** No command IDs, settings, or persisted state change.
  `Ctrl+Shift+Escape` stop is preserved. ~0.5KB minified added to the webview
  bundle (bundle gate re-baselined 705→712KB with rationale).
- **Tested:** `escapeCoordinator.test.ts` (14 cases — resolution + registry
  contract); `keyboardShortcutsModal.dom.test.ts` (focus trap + restoration).
