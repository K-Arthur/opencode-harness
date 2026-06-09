# Welcome Screen Research Notes — OpenCode VS Code Extension

## Sources Reviewed

### OpenCode SDK & Extension Internals
- `src/chat/webview/sendLogic.ts` — Prompt submission engine (shared between welcome and chat)
- `src/chat/webview/main.ts` — Webview entrypoint, welcome view wiring
- `src/chat/webview/ui/welcomeView.ts` — Welcome screen UI component
- `src/chat/WebviewEventRouter.ts` — Host-side message routing
- `src/chat/webview/errorTypes.ts` — Error type system
- `src/chat/webview/errorComponents.ts` — Error UI components
- `src/chat/webview/opencodeErrorMapper.ts` — SDK error mapping
- `src/chat/webview/types.ts` — Message type definitions
- `src/chat/handlers/StreamCoordinator.ts` — Stream lifecycle
- `src/session/SessionManager.ts` — Server lifecycle
- `src/session/SessionClient.ts` — SDK client wrapper
- `src/chat/SessionStore.ts` — Session persistence
- `src/chat/TabManager.ts` — Tab tracking
- `src/chat/webview/dom.ts` — DOM element refs
- `src/chat/webview/model-dropdown.ts` — Model selector
- `src/chat/webview/model-manager.ts` — Model manager panel
- `src/extension.ts` — Extension activation
- `src/model/ModelManager.ts` — Model resolution
- `src/chat/SessionLifecycleService.ts` — Session lifecycle
- `src/session/PendingEventBuffer.ts` — Race-condition buffer
- `tests/unit/send-logic-behavioral.test.ts` — Existing test coverage
- `src/chat/webview/welcome-mode-model.test.ts` — Existing welcome model test
- `welcome-screen-research-notes.md` (this file)

### Comparable Tools (Welcome/Empty State Handling)

#### Cursor
- Composer always enabled; if no chat model selected, opening the composer surfaces a "Configure model" inline banner
- Send button disabled until model is configured
- Starter prompts one-click send
- Empty state shows recent sessions and starter prompts

#### Windsurf
- Similar to Cursor: onboarding explicitly gates input until auth + model are present
- Welcome screen shows recent sessions prominently

#### Cline
- First-run prompts the user to pick a provider/API key in a modal BEFORE any input is accepted
- "New chat" empty state has starter prompts that one-click send
- Most defensive about configuration state — will not let user type until setup is complete

#### Claude Code
- CLI-based, no welcome screen in the traditional sense
- First prompt goes through immediately; auth/model issues surface as error messages
- No startup gating — prefers fail-fast error surfacing

#### Continue
- Welcome view shows provider config prominently
- If a provider isn't configured, the input is gated with a clear CTA

### Key Pattern Across Competitors
**Input is gated on auth + model.** All tools:
1. Detect missing model/provider before accepting input
2. Disable or block the send action
3. Show a clear, actionable message (not an error in a newly-created empty tab)
4. Provide a one-click path to resolution (open settings, pick provider, etc.)

## What OpenCode Expects for First Prompt / Session Creation

- **Sessions are created lazily** — `SessionClient.ensureSession()` is called inside `StreamCoordinator.startPrompt()`, NOT on welcome screen mount
- **SSE listeners are process-global** — set up at `SessionManager.start()` via `SseSubscriber.subscribe()`, before any prompt
- **Order is:** `server.start()` → SSE subscribe (boot time) → (user prompts) → `ensureSession()` → `sendPromptAsync()`
- **Two session IDs:** `sessionId` (local client UUID) and `cliSessionId` (server-issued ID from `client.session.create()`)
- **No server session is created for an empty tab** — `SessionLifecycleService.handleResumeSession` explicitly avoids creating a CLI session for a still-pending tab with no messages
- **PendingEventBuffer** handles the race where SSE events arrive before `cliSessionId` is registered

## What My Extension Does Differently (and Why It Fails)

### The Welcome Screen Architecture
- The welcome screen (#welcome-view) and the main input (#prompt-input in #input-area) are SEPARATE DOM elements
- #prompt-input is always rendered below the welcome view, sharing the same textarea for both screens
- The welcome screen has NO input of its own — it uses the global textarea
- Prompt-starter cards only FILL the textarea; they never auto-submit
- The user must press Enter or click the Send button to submit

### The Bug Sequence
1. User types into #prompt-input while welcome is visible
2. `sendMessage()` runs; `getActiveSession()` returns `undefined` (no tab yet)
3. `createNewTab(title)` creates a local session, calls `hideWelcomeView()` (welcome disappears)
4. `els.promptInput.value = ""` clears the textarea
5. Model resolution returns empty: `active.model || modelDropdown.getCurrentModel() || state.globalModel` → `""`
6. `handleRequestError(active.id, "No model selected...")` fires
7. **Return.** User is in an empty tab with a lost prompt and an error

### Root Causes
1. **Model resolution is deferred until too late** — happens AFTER welcome is hidden and textarea is cleared
2. **Send button is not gated on model availability** — `updateSendButton()` ignores model state, only checks text/attachments/stream-cap
3. **No auto-open model picker on model-missing error** — user has no obvious path to resolution
4. **Host model resolution can race** — `init_state` carries `globalModel: ""` until `refreshModels()` finishes

## Bugs Found

| ID | Bug | Location | Severity |
|---|---|---|---|
| B1 | `steer_prompt` vs `send_steer_prompt` type mismatch — webview posts `type: "steer_prompt"` but host only accepts `"send_steer_prompt"`. Steer-while-streaming silently dropped. | `sendLogic.ts:179` | High |
| B2 | Welcome view hidden BEFORE model check — `hideWelcomeView()` at line 235 precedes model guard at 265–269. User dropped into empty tab with lost prompt. | `sendLogic.ts:223–269` | High |
| B3 | Prompt text cleared on model-missing error — `els.promptInput.value = ""` at line 271 runs before the model check. On failure, typed text is irrecoverable. | `sendLogic.ts:271` | High |
| B4 | Send button doesn't reflect "no model" — `updateSendButton()` ignores model availability. Button stays enabled; user hits downstream error. | `sendLogic.ts:132–144` | Medium |
| B5 | Model-empty race on init — `init_state` posts `globalModel: ""` before model refresh completes. Welcome card stuck on "No model selected" until `model_list` arrives. | `welcomeView.ts:40–61`, `main.ts:2697–2700` | Medium |
| B6 | No "Pick model" action in the error block — `handleRequestError` "No model selected" error only has a generic "Retry" action, not a model-picker shortcut. | `errorComponents.ts`, `opencodeErrorMapper.ts` | Medium |
| B7 | Prompt-starter cards only fill textarea, never auto-submit — competitors one-click send starters. Click-then-Enter is unnecessary friction. | `welcomeView.ts:184–195` | Low (UX) |

## Requirements (Extracted from Research)

1. **Send button must be disabled when no model is selected**, with a tooltip explaining why
2. **Pressing Enter/Send with no model must not hide the welcome view or destroy the prompt text**
3. **Pressing Enter/Send with no model must open the model picker or surface a clear in-UI CTA**
4. **Prompt-starter cards should auto-submit on click by default**, with Shift+click for fill-only
5. **The "No model selected" error block must include a "Pick model" action button**
6. **Errors on the welcome screen must not transition the user into an empty tab**
7. **The model-empty state on the welcome card must show a clear CTA (not just a placeholder)**

## Risks

- **Steer-prompt type fix (B1) must update the existing test** at `tests/unit/send-logic-behavioral.test.ts:129,187`
- **Changing the send button disabled logic** will affect voice input (which checks `btn.disabled` at `main.ts:857`)
- **Reorder of model check vs welcome hide** must not break the happy path where model IS selected
- **Model resolution chain changes** must not cause `sendMessage` to fail when model IS available
