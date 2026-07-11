# OpenCode Harness Orchestration Refactor Memory

This file is the working source of truth for the orchestration, ephemeral-session, and masking refactor. Update it whenever an architectural decision, edge case, or verification result changes.

## Current Objective

Implement production-ready agent orchestration, temporary chats, intelligent masking, and matching webview UI for OpenCode Harness.

## Research Notes

- Claude Code subagents use separate context windows and configurable tools/permissions/model, which supports context isolation for side tasks and specialized review/planning flows.
- Claude Code stores model choice on resumed sessions and exposes current model through status/model commands, so model changes must be explicit and inspectable.
- Codex exposes `/new`, `/fork`, `/side`, `/model`, `/plan`, `/status`, and `/worktree`; `/side` is the closest peer pattern for a temporary side conversation that should not pollute the main thread.
- Cline separates Plan and Act modes, supports distinct models per mode, and preserves context when switching.
- Cline uses `/newtask` and `/compact` to start a fresh task with distilled context or reduce the current thread.
- Kilo Code model precedence is session override, last picked per agent, per-agent config, global config, then automatic free routing. Its Auto Model also routes requests by difficulty and mode.
- Kilo context condensing records goal, constraints, decisions, progress, and relevant files; this is the useful shape for future compaction metadata.
- Windsurf Cascade exposes Code/Plan/Ask modes and persistent rules/memories. Temporary chats here should therefore explicitly avoid workspace memory and persisted tab/session state.

## Architecture Decisions

- Add a pure orchestration layer that resolves an `AgentRole` from explicit role, current mode, and prompt text. `ModelManager` will remain the host authority for configured model selection.
- Model routing precedence will be role override, mode override, session model, current global model. This preserves existing mode-based behavior while enabling planning/review/debugging defaults.
- Temporary chats are represented as `ephemeral: true` on host sessions, tabs, and webview session state. They are usable live but skipped by host persistence, tab restoration, and webview `setState` snapshots.
- Prompt masking runs at host ingress in `WebviewEventRouter` before the user message is appended to `SessionStore` or queued. Queued and immediate prompts must share one masking path.
- The masking layer redacts common secret shapes, masks excluded file mentions, drops excluded context items, and prunes over-budget prompt text with an explicit marker.
- Webview UI should expose temporary chat creation, a temp badge in tabs, and lightweight route/masking status instead of hiding backend features.

## Edge Cases

- A prompt sent while another stream is active must be masked before entering the host queue.
- A temporary chat that links to a server session must not be restored on reload.
- Closing a non-empty temporary chat should remove it from host memory, unlike persistent sessions that are only deleted when empty.
- If the webview reloads, local temporary sessions can be dropped; this is the intended "temporary" contract.
- Masking must not mutate image attachments, but it should still redact prompt text and remove excluded context item references.
- Prompt failures should echo the masked text back to the webview retry payload, not the original secret-bearing text.

## Completed

- Completed online research across Claude Code, Codex, Cline, Kilo Code, and Windsurf Cascade.
- Mapped the existing model, session, prompt, and context code paths with read-only subagents.
- Added pure routing and masking foundations with tests.
- Added ephemeral session persistence semantics across `SessionStore`, `TabManager`, and webview state.
- Wired role-aware routing through `ModelManager` and `StreamCoordinator`; route decisions are posted to the webview.
- Wired prompt masking at host ingress for immediate and queued prompts; masking summaries are posted to the webview.
- Added temporary chat creation paths from the host, tab strip, welcome screen, and `/temp` slash command.
- Added route/masking status chips and temporary tab badges in the webview.
- Added a composer `Route` selector that can send explicit planning/implementation/review/debugging roles.
- Added VS Code settings for `opencode.roleModels` and `opencode.masking.*`.
- Documented the architecture in `docs/architecture/orchestration-masking-ephemeral.md`.
- Verified the backend foundation with `npm run typecheck`, `npm run build`, and `npm run test:unit` before commit `f674205`.
- Verified the completed integration slice with:
  - `npm run typecheck`
  - `npm run build`
  - `node --test tests/unit/css-design-tokens.test.mjs tests/unit/session-store.test.mjs && npx tsx --test src/chat/webview/css/cssCoverage.test.ts`
  - `npm run test:unit`

## Pending

- Commit the completed integration slice without including pre-existing version-only changes.
