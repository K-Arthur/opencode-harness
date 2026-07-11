# HARNESS_MEMORY.md

## Status: Phase 1 (ephemeral cleanup) + Phase 2 (role routing) + Phase 3 (masking patterns) complete

## What was already in place
- `ephemeral: true` property on `TabState`, `SessionData`, `SessionState`
- `TabManager.persist()` filters ephemeral tabs
- `buildPersistedSessions(snapshotWithCap)` filters from webview persistence
- `TabManager.createTab()` accepts `ephemeral: true`
- `welcome-temp-btn` + `.tab-temp-badge` CSS exists
- `new_temp_session` webview message + host handler
- `modelRouting.ts` with `resolveRoutedModel()`, `inferAgentRole()`, `AgentRole` type
- `ModelManager.getRoutedModel()` wired into `StreamCoordinator.resolveModelAndAgentForPrompt()`
- `opencode.roleModels` + `opencode.modeModels` settings in `package.json`
- `opencode.masking.*` settings in `package.json`
- `PromptMasker.maskPromptPayload()` wired into `WebviewEventRouter.preparePromptPayload()`

## Phase 1: Ephemeral session cleanup (done)
- **Problem**: Temp sessions created server-side sessions that were never cleaned up
- **Fix**: `WebviewEventRouter.ts:close_tab` handler now deletes the server-side session when an ephemeral tab is closed
- Implementation captures `cliSessionId` before `closeTab`, calls `sessionManager.deleteSession()` if ephemeral
- Uses `sessionStore.delete()` (not `deleteIfEmpty`) for ephemeral to ensure full cleanup

## Phase 2: Agent orchestration / role routing (done)
- The model routing infrastructure was already complete: `resolveRoutedModel()` with 6-level priority fallback, `getRoutedModel()` reading from settings, `inferAgentRole()` with regex-based prompting
- **Added**: `/plan`, `/review`, `/debug` (`/debugging`) slash commands in `slashCommands.ts`
  - Sets the `role` field on `send_prompt` to `planning`/`review`/`debugging`
  - Routes to the model configured for that orchestration phase via `opencode.roleModels`
- **Added**: Commands registered in `LOCAL_SLASH_COMMANDS` in `slash-commands.ts` for /help + command palette
- **UI note**: A `role-route-select` element already exists in the DOM; `readSelectedAgentRole(els)` reads from it

## Phase 3: Context masking enhancements (done)
- Added regex patterns for:
  - `GITHUB_TOKEN_RE` - GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_)
  - `NPM_TOKEN_RE` - npm tokens (npm_)
  - `SSH_PRIVATE_KEY_RE` - RSA/EC/DSA/OPENSSH private keys
  - `SESSION_COOKIE_RE` - session id/token assignments with values ≥32 chars
  - `JWT_RE` - JSON Web Tokens (eyJ... format)
- Expanded `AWS_ACCESS_KEY_RE` to cover all AWS key formats (AKIA + A[KIST]...)
- All new patterns wired into `redactSecrets()` with descriptive placeholders

## Known edge cases / unresolved
- **Stale session cookie detection**: SESSION_COOKIE_RE may FP on base64-encoded data that happens to start with "session"
- **JWT detection**: Only catches uncompressed JWTs; compressed (signed-only) JWT strings are not captured
- **SSH key format**: The multi-format SSH key regex is more permissive; could match other PEM-encoded certs
- **Slash command edge case**: `/plan`, `/review`, `/debug` bypass the normal send flow and don't add optimistic local messages; the host adds them server-side

## Pending
- Full `npm test` pass (some tests may be flaky in CI)
- Webview UI for per-role model configuration (settings page)
- Visual tests for temp tab badge
