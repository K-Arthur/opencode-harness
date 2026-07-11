# HARNESS_MEMORY.md

## Status: All phases complete. v0.4.60 installed.

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

### Known gaps (not fixed)
- **Model validation in settings panel**: Panel doesn't validate model IDs against available models (needs host push of model list at panel-open time). User types model IDs manually.
- **Session cookie regex trailing delimiter**: The `(["']|(?:\s|$|,|[;`]))` guard may miss values at end of file without trailing whitespace.
- **Multi-root workspace**: `set_role_models` writes to `ConfigurationTarget.Workspace` which applies to the active workspace root. Multi-root behavior follows VS Code's native multi-root scoping rules.
- **Migration**: Prior single-model config via `opencode.model` is preserved; `opencode.roleModels` defaults to `{}` so no migration needed.
