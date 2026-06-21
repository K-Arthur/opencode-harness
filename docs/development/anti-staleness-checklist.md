# Anti-Staleness Checklist

Use this checklist when reviewing features that display live state (token usage, command lists, model selection, cost, etc.). The goal is to catch the "silent staleness anti-pattern": a component that trusts a cached or stale value instead of re-deriving from the current source of truth.

## Red Flags

- A value is initialized once and never updated after the initial payload.
- A UI update uses a stored/cached object instead of the latest message/event.
- A handler ignores a newer event because it arrived while a previous value was still displayed.
- A list or selector is re-rendered from a stale array instead of the live registry.
- A config change does not trigger a re-push to the webview.

## Review Questions

For every live UI surface, ask:

1. **Source of truth:** What is the canonical source of this value? (e.g., `ContextMonitor`, `SessionManager`, `ModelManager`, VS Code configuration, `globalState`.)
2. **Emit path:** Does the source emit an event/message whenever the value changes?
3. **Subscribe path:** Is the webview/host subscribed to that event and does it re-derive the UI on every emission?
4. **Per-session isolation:** If the value is session-scoped, is it stored per-session and never overwritten by another session's data?
5. **Fallback behavior:** If a fallback/empty update arrives, does it downgrade a previously valid value?
6. **Tab switch behavior:** When the user switches tabs, does the UI update to the newly active session's live value?
7. **Re-sync stability:** If a selector re-syncs, does it match by canonical id rather than positional index?
8. **Config propagation:** Do settings changes immediately push the new value to the webview?

## Specific Surfaces

### Context usage bar

- `ContextMonitor` must emit on every token change.
- Webview must store usage per-session, not globally.
- Empty/estimated updates must not overwrite `actual` readings.
- Tab switch must call the dropdown/bar update functions for the new session.
- `context_window_unknown` with `maxTokens: 0` must hide the bar immediately.

### Command list / MCP tools

- `command_list` must be pushed after MCP connection changes.
- `promptManager.onChanged` must trigger a full command list refresh.
- The webview must update `cachedRemoteCommands`, `commandsModal`, and `mention` from the same payload.
- The modal must re-render if it is open when the update arrives.

### Model selector

- `model_update` must update the global preference and dropdown label, but must not call `setSessionModel` on the active session.
- `switchTab` must restore the active session's model.
- `setCurrentModel` must match by `data-model-id`, not by index.

### Layout / CSS

- Dynamic text containers must have `overflow-wrap: anywhere` or `word-break: break-word`/`break-all`.
- Containers must have `max-width: 100%` or equivalent containment.
- Fixed-width panels (timeline, sidebars) must clip/scroll rather than expand.

### Process management

- Each spawned process must receive an isolated `OPENCODE_DATA_DIR`.
- Windows `.cmd` / `.ps1` wrappers must fall back to an executable that can be spawned with `shell: false`.

## Verification Tools

- Run `npm run test:unit` — the `feature-manifest.test.mjs` anti-staleness contract tests must pass.
- In development builds, watch the webview console for `[anti-staleness]` warnings.
- Add a regression test for any new live-state UI surface before merging.

## Adding a New Anti-Staleness Contract

1. Add an `FM-ANTISTALE-NNN` entry to `tests/FEATURE_MANIFEST.md` §11.
2. Add a source-presence or behavioral test to `tests/unit/feature-manifest.test.mjs`.
3. Add a dev-only diagnostic to the relevant webview handler if possible.
4. Update this checklist with the new surface and review questions.
