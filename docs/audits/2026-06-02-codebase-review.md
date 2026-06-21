# Codebase Review — 2026-06-02

Scope: focused review of the current webview/session/provider changes needed to make the
branch buildable and reinstallable.

## Findings And TDD Coverage

| Issue | Analysis | Minimal failing test | Fix that made it pass |
|---|---|---|---|
| Activity/Tasks panels existed without real DOM/wiring | Panel modules and CSS were added, but `index.html`, `ElementRefs`, and `main.ts` did not expose or initialize them. This caused strict type failures and runtime no-ops. | `main.test.ts` → `wires Activity and Tasks panels to real HTML elements` | Added toolbar buttons, panel roots, refs, CSS imports, setup calls, active-session refresh, and unload disposal. |
| Rate-limit reset time dropped | Host message contract carries `resetAt` under `info`, but the handler read `msg.resetAt`. The banner/error could omit reset timing. | `main.test.ts` → `rate_limit_exhausted reads resetAt from the structured info payload` | Extracted `msg.info.resetAt`, normalized null to `undefined`, and passed the value through `handleRateLimitExhausted`. |
| Session pin/rename/tags were documented/tested but incomplete | Renderer types rejected `pinned`/`tags`, no UI controls existed, and host validation/handlers did not persist metadata. | `sessionListRenderer.pin.test.ts` | Added renderer metadata, pinned-first sorting, pin marker/button, inline rename/tags, `SessionStore` setters, router handlers, validators, and list payload fields. |
| Steer-mode UI left multiple active buttons | `setSteerMode` queried `.steer-option`, but the DOM uses `.steer-mode-btn`; `aria-pressed` also drifted. | `steerMode.test.ts` | Switched to `.steer-mode-btn`, synchronized `active` + `aria-pressed`, and exposed `syncSteerModeUI()` / `getSteerMode()`. |
| Provider config commands called a nonexistent API | `addProvider` and `configureOllama` attempted `SessionManager.updateConfig`, which does not exist and has no backing server contract. | `providerConfigCommands.test.ts` | Removed the fake live patch path; commands write config, refresh models, and warn that a running local server may need restart/reconnect. |
| Dead todo denial path lingered | Server todos are read-only now, but `todo_operation_denied` still appeared in the webview handler surface. | Existing `main.test.ts` regression for removed todo mutation routes | Removed the stale webview handler and stale todo mutation message types. |

## SADD Summary

Analysis: The root pattern was contract drift across module boundaries: source modules,
HTML, shared types, host validators, and docs had evolved independently.

Design: Keep each fix at its owning boundary. DOM contracts go through `ElementRefs`;
session metadata persists through `SessionStore`; host messages are validated in
`WebviewMessageValidator`; transcript panels remain pure read-models over existing session
messages.

Development:
1. Add failing contract tests first.
2. Repair shared types/HTML before implementation casts.
3. Wire host/webview messages only where a real handler exists.
4. Run targeted tests, then full `typecheck -> build -> test:unit`.

## Trade-offs

- The Tasks panel Cancel action still aborts the whole active stream, not a single command;
  per-command cancellation needs an opencode server handle.
- Provider config changes do not fake live server patching. Restart/reconnect guidance is
  more honest until opencode exposes a supported live config API.
