# HARNESS_MEMORY.md

## Status: All phases complete. v0.4.62 installed (bug-fix pass on top of v0.4.60).

---

## 2026-07-11 bug-fix pass (user-reported issues)

The prior pass (below, "2026-07-10") had marked orchestration/masking/ephemeral
"done", but the panel's UI never got a real end-to-end smoke test. The user
reported 6 concrete issues after actually using it; all 6 had genuine root
causes, found and fixed:

1. **Model routing had no off switch.** `inferAgentRole()` ran keyword
   sniffing (`DEBUGGING_RE`/`REVIEW_RE`/`PLANNING_RE` against the raw prompt
   text) unconditionally on every prompt, even with the Route selector on
   "Auto" — so a message containing "bug" could silently reroute to a
   different model than the one the user picked, with zero opt-out. Fix:
   added `opencode.roleModelsEnabled` setting (default `true`) +
   `ModelManager.isRoleRoutingEnabled()`. When `false`,
   `resolveRoutedModel()` skips role-map lookups and `inferAgentRole()` skips
   text sniffing (an explicit Route selection or session mode still applies —
   only the *implicit* part is suppressed). Master toggle checkbox added to
   the Model Routing panel.
2. **Model Routing panel always looked reset.** `getModels`, `getRoleModels`,
   `getModeModels` in `main.ts`'s panel wiring were hardcoded stubs
   (`() => []` / `() => ({})`) — literally never populated. Fix: added
   `get_role_models` webview→host message and `role_models_config`
   host→webview push (`WebviewEventRouter.pushRoleModelsToWebview()`), cached
   in `main.ts` as `roleModelsConfig`; `getModels` now reads
   `modelManager.getAllModels()`.
3. **Couldn't pick from available models.** The per-role input was a free
   text `<input>` with a warning banner that could never resolve (since the
   model list was always empty per #2). Fix: replaced with a real `<select>`
   populated from the live model list, "Auto (use fallback)" as the empty
   option, and a labeled fallback option if a saved model is no longer
   available (so switching to the dropdown doesn't silently drop it).
4. **Incomplete styling.** Mostly a symptom of #3 (plain unstyled-looking
   text input). Added CSS for the new `<select>` (`.model-routing-row-select`)
   and the new master-toggle row (`.model-routing-master-toggle*`,
   `.model-routing-list--disabled`). Checked `.role-route-select` (composer's
   per-message Route dropdown) and welcome-screen temp button — both already
   had complete CSS via shared classes; no changes needed there.
5. **"New temporary chat" button on welcome screen did nothing.**
   `welcomeView.ts`'s `setupWelcomeActions()` already had the click handler
   (`deps.els.welcomeTempBtn?.addEventListener(...)`), but `main.ts` never
   put `welcomeTempBtn` into the `welcomeViewDeps.els` object it passed in —
   so the optional-chained listener silently never attached. One-line fix.
   (The tab-strip's separate temp-chat button was always fine — different,
   correctly-wired code path in `tabs.ts`.)
6. **Session History polluted by the just-opened blank tab.** A new tab's
   session is registered in `SessionStore` (and gets `lastActiveAt = now`)
   the instant the tab is created — before any prompt is sent. Neither the
   History modal (`sessionListRenderer.ts` `buildUnifiedSessionItems`) nor
   the welcome screen's host-backed "Recent" list (`prepareHostRecentSessions`)
   filtered these out, so opening a new tab and then History showed
   "Untitled" pinned above real conversations (`lastActiveAt` sorts newest
   first). The welcome screen's *local*-state Recent list already had this
   filter (`prepareLocalRecentSessions`); the host-backed path and the
   History modal didn't. Fixed both to exclude zero-message sessions unless
   pinned or matched by an active search query.

### Verification
- New/updated tests: `modelRouting.test.ts` (2 new), `ModelManager.test.ts`
  (1 new), `StreamCoordinator.test.ts` (1 new), `WebviewEventRouter.test.ts`
  (5 new), `recent-sessions.test.ts` (2 new + 1 updated fixture),
  `sessionListRenderer.pin.test.ts` (4 new + fixture updates across both
  sessionListRenderer test files to add `messageCount`), `main.test.ts` (5
  new source-assertion regressions), new `modelRoutingPanel.test.ts` (6 DOM
  tests covering select population, toggle-disables-selects, applyConfig
  round-trip, stale-model preservation, reset, save payload).
- Full suite: `npm run test:unit` → 1217+4934+46 tests, 0 fail.
  `npm run test:message-contract` → 23/23. `npm run test:roundtrip` → 7/7.
  `tsc --noEmit` clean.
- Bundle size: webview main.js grew 835.1KB → still 835.1KB measured, but
  needed the *limit* bumped 835KB→838KB (see `scripts/check-bundle-size.mjs`
  re-baseline comment) since it was already sitting at the old ceiling.
- `tests/FEATURE_MANIFEST.md` + `tests/unit/feature-manifest.test.mjs`: added
  `opencode.roleModelsEnabled` to both (config-key parity test).
- Rebuilt + reinstalled via `npm run reinstall` → v0.4.62 installed. User
  asked to visually confirm after a window reload (not independently
  re-verified by an agent in a live Extension Host — no headless VS Code
  test infra was set up for this pass; the fixes were validated via
  behavioral DOM/unit tests exercising the exact reported scenarios instead).

### New wire contract (webview ⇄ host)
- `get_role_models` (webview→host, no payload): requests current
  `opencode.roleModels` / `opencode.modeModels` / `opencode.roleModelsEnabled`.
- `role_models_config` (host→webview): `{ roleModels, modeModels, enabled }`.
  Pushed on `get_role_models` and after every `set_role_models` save (so the
  panel echoes back what was actually persisted, not just what was sent).
- `set_role_models` extended with an optional `enabled: boolean` field
  (existing `roleModels` field unchanged); omitting `roleModels` no longer
  early-returns before checking `enabled` (previous code returned before the
  enabled-only case could ever be handled).

### Known gaps (not fixed, out of scope for this pass)
- No live Extension Development Host verification by an agent — relies on
  the user's manual check post-reload plus the DOM/unit test suite.
- `createTabContent()`'s `_callbacks` parameter in `tabs.ts` is unused dead
  weight (the real tab-bar buttons are wired via `createTabBar`'s
  `renderTabs`, not `createTabContent`) — noted, not touched; out of scope
  and not user-visible.
- Model routing UX could go further (e.g. surfacing *why* a role was
  inferred, not just which model was used — the existing `orchestration_route`
  → route-chip mechanism shows the resolved role/model after the fact but
  not the reason). Not reported as broken by the user; logged here as a
  possible future coherence improvement.

---

## Audit findings (2026-07-10 fix-up pass)

### What was verified as working
- **Ephemeral sessions**: `ephemeral: true` propagated through full chain: `SessionStore.create` → `buildSession` → `TabManager.createTab` → webview state. Temp badge renders correctly (`.tab-temp-badge`). Close handler captures cliSessionId before cleanup, deletes server session if ephemeral. ✅
- **Role routing**: `role-route-select` dropdown exists in HTML, read in `sendMessage()`, `role` field on `send_prompt` consumed by `WebviewEventRouter.getRequestedAgentRole()` → `StreamCoordinator.resolveModelAndAgentForPrompt()` → `ModelManager.getRoutedModel()` → `resolveRoutedModel()` with 6-level fallback. ✅
- **Masking**: `maskPromptPayload()` called BEFORE `appendMessage` in both immediate and queue paths (lines 384/334 vs 405/353). `masking_summary` handler in main.ts renders status chip. ✅
- **All tests pass**: 1216+4910+46+23+7 tests across all suites. ✅

### Issues found and fixed
1. **`GITHUB_TOKEN_RE` false negative**: `github_pat_` used `{85,}` but real tokens have ~82-char suffix. Changed to `{70,}`. (PromptMasker.ts:71)
2. **`SESSION_COOKIE_RE` false positive risk**: Minimum length increased from 32 to 40, trailing delimiter enforced to reduce FP on long identifiers. (PromptMasker.ts:74)
3. **No settings UI for per-phase model routing**: Built `modelRoutingPanel.ts` — webview dialog with per-role model inputs, fallback chain display, clear/reset, save via `set_role_models` host message. (index.html, layout.css, main.ts, dom.ts, buttonSetup.ts, WebviewEventRouter.ts, modelRoutingPanel.ts)
4. **Bundle limits**: Updated 833KB→835KB for webview after adding settings panel CSS+JS.

### Known gaps from that pass — now resolved above
- ~~Model validation in settings panel~~ → fixed 2026-07-11 (#2, #3 above).
- Session cookie regex trailing delimiter edge case: still open, low
  priority, not reported by the user in this pass.
- Multi-root workspace: `set_role_models`/`opencode.roleModelsEnabled` both
  write to `ConfigurationTarget.Workspace`; unchanged behavior.
- Migration: still no migration needed (`opencode.roleModels` defaults to
  `{}`, `opencode.roleModelsEnabled` defaults to `true` — both no-ops for
  existing configs).
