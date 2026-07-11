# Orchestration, Temporary Chats, and Prompt Masking

This note records the July 2026 architecture for role-aware model routing,
temporary chats, and prompt masking in the OpenCode Harness VS Code extension.

## Research Synthesis

Peer coding agents converge on four patterns:

- Claude Code subagents run in separate context windows and can define their own
  tools, permissions, and model; resumed sessions keep an inspectable model
  choice. See Anthropic's subagent and model configuration docs:
  https://docs.anthropic.com/en/docs/claude-code/sub-agents and
  https://docs.anthropic.com/en/docs/claude-code/model-config.
- Codex exposes slash-command session control (`/new`, `/fork`, `/side`,
  `/model`, `/plan`) and subagents for parallel exploration. The relevant docs:
  https://developers.openai.com/codex/cli/slash-commands,
  https://developers.openai.com/codex/models, and
  https://developers.openai.com/codex/subagents.
- Cline separates Plan and Act workflows, supports per-mode model choices, and
  provides `/newtask` and `/compact` to start or distill context. See
  https://docs.cline.bot/core-workflows/plan-and-act and
  https://docs.cline.bot/core-workflows/using-commands.
- Kilo Code has an explicit model-precedence stack, auto model routing, and
  context condensing. See https://kilo.ai/docs/code-with-ai/agents/model-selection,
  https://kilo.ai/docs/code-with-ai/agents/auto-model, and
  https://kilo.ai/docs/customize/context/context-condensing.
- Windsurf Cascade exposes Code/Plan/Ask modes and persistent rules/memories,
  so temporary sessions should have an explicit "do not persist memory" contract.
  See https://docs.windsurf.com/windsurf/cascade/modes and
  https://docs.windsurf.com/windsurf/cascade/memories.

For a VS Code extension, the useful shape is: keep routing host-authoritative,
keep temporary state live-only, and run masking at the host ingress point before
prompts touch persistence or queues.

## Role-Aware Model Routing

The pure router lives in `src/orchestration/modelRouting.ts`.

Supported roles:

- `planning`
- `implementation`
- `review`
- `debugging`

Routing precedence:

1. Explicit prompt role from the webview (`role` or `agentRole`)
2. Inferred role from mode/prompt text
3. Workspace `opencode.jsonc` `roleModelOverrides`
4. VS Code setting `opencode.roleModels`
5. Workspace `modelOverrides` or VS Code `opencode.modeModels`
6. Session model
7. Global model

`StreamCoordinator.startPrompt` resolves the route immediately before starting
the SDK request and posts `orchestration_route` to the webview. The status strip
renders the active session's role/model chip, so mid-session model switching is
visible without changing the conversation transcript.

The composer also exposes a compact `Route` selector. `Auto` uses prompt/mode
inference; choosing `Plan`, `Build`, `Review`, or `Debug` sends an explicit
`role` on the next prompt.

`opencode.roleModelsEnabled` (default `true`) is a master switch, checked by
`ModelManager.isRoleRoutingEnabled()`. When `false`: step 3/4 above (role
overrides) are skipped by `resolveRoutedModel()`, and the prompt-text
inference in step 2 is also suppressed (`inferAgentRole()`'s
`enableTextInference` flag) — an explicit `Route` selection still wins, but
nothing reroutes silently based on prompt wording. Toggle it via the
"Enable model routing" checkbox at the top of the Model Routing settings
panel (`modelRoutingPanel.ts`), which also round-trips the panel's state
against the host via `get_role_models` / `role_models_config` so it reflects
what's actually saved instead of always rendering blank.

## Temporary Chats

Temporary chats are represented by `ephemeral: true` on:

- `OpenCodeSession` in `SessionStore`
- `TabState` in `TabManager`
- `SessionState` in the webview

Persistence rules:

- Host persisted sessions skip `ephemeral` sessions.
- Restored tab state skips `ephemeral` tabs and never restores an ephemeral
  active tab.
- Webview `setState` snapshots skip ephemeral sessions, session order, and
  scroll positions.
- Closing an ephemeral session deletes it from `SessionStore` even if it has
  messages. Persistent sessions keep the existing "delete only when empty"
  behavior.

UI entry points:

- Welcome screen `Temp chat` button posts `new_temp_session`.
- Tab strip clock button creates a local ephemeral tab.
- `/temp` and `/temporary` create an ephemeral tab from the composer.
- Ephemeral tabs render a compact `Temp` badge.

## Prompt Masking

The masker lives in `src/context/PromptMasker.ts` and runs in
`WebviewEventRouter.preparePromptPayload` before append, queue, or retry state.
Immediate and queued prompts share the same path.

Masking operations:

- Redact common secret shapes in prompt text.
- Replace excluded `@file:` references with `[masked file: ...]`.
- Drop excluded context items by path.
- Replace excluded document blocks with a marker.
- Estimate token budget and prune oversized prompts with an explicit truncation
  marker.

Settings:

- `opencode.masking.enabled` (default `true`)
- `opencode.masking.maxPromptTokens` (default `64000`)
- `opencode.masking.reserveTokens` (default `2000`)
- `opencode.masking.exclude` (default `[]`)

Workspace config may also set:

```jsonc
{
  "roleModelOverrides": {
    "review": "anthropic/claude-sonnet-4-20250514"
  },
  "masking": {
    "enabled": true,
    "maxPromptTokens": 64000,
    "reserveTokens": 2000,
    "exclude": ["secrets/", ".env"]
  }
}
```

When masking changes a payload, the host posts `masking_summary`; the webview
renders a compact `Masked` status chip for the active session.

## Race Conditions and Limits

- A prompt queued while another stream is active is masked before entering
  `HostPromptQueue`; queue replay never sees the original secret-bearing text.
- Prompt send failures rehydrate the composer with the masked prompt.
- Temporary chats intentionally disappear after webview or extension reload.
- The masker is deterministic and local. It is a safety and relevance layer,
  not a full data-loss-prevention system.
- Image binary payloads are not mutated; masking applies to prompt text and
  context metadata.

## Verification

Core tests:

- `src/orchestration/modelRouting.ts` and `src/orchestration/modelRouting.test.ts`
- `src/context/PromptMasker.ts` and `src/context/PromptMasker.test.ts`
- `src/session/sessionUtils.ephemeral.test.ts`
- `src/chat/TabManager.ephemeral.test.ts`
- `src/chat/webview/state.ephemeral.test.ts`
- `src/chat/WebviewEventRouter.test.ts`
- `src/chat/handlers/StreamCoordinator.test.ts`
- `src/chat/webview/main.test.ts`
- `src/chat/webview/tabs.test.ts`
- `src/chat/webview/ui/welcomeView.test.ts`
- `src/chat/webview/css/cssCoverage.test.ts`

Required pre-commit verification remains:

```bash
npm run typecheck
npm run build
npm run test:unit
```
