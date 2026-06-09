# Queue & Steer Modes — Research Notes

## Sources Reviewed

- **OpenCode v2 spec** — `specs/v2/session.md` (`sessions.prompt`, `sessions.interrupt`, delivery modes)
- **OpenCode v2 schema changelog** — inbox/admitted-prompt concept
- **OpenCode AGENTS.md** — delivery vocabulary: "Prompts steer by default"
- **SDK TypeScript declarations** — `@opencode-ai/sdk@1.15.1` (`session.promptAsync`, `session.abort`)
- **Harness source** — `StreamCoordinator.ts`, `WebviewEventRouter.ts`, `SteerPromptHandler.ts`, `sendLogic.ts`
- **Claude Code docs** — [interactive-mode](https://docs.anthropic.com/en/docs/claude-code/interactive-mode)
- **Claude Code issues** — #36326 (interrupt docs mismatch), #65425 (draft lost on switch), #62856 (no send-time choice), #63143 (concurrent prompts overwrite)
- **Cline PR #7112** — Request Queuing (WIP, unmerged)
- **Cline issues** — #7908 (history disappeared), #4297 (mode switch clears input)
- **Aider docs** — sync/blocking model, no queue
- **Codex (OpenAI)** — gold-standard send-time interrupt/queue choice

## What OpenCode Supports Natively

| Capability | Native? | How |
|---|---|---|
| Send prompt while busy | **YES** | Server admits to durable inbox — no rejection |
| Steer (coalesce into active run) | **YES** | Default delivery mode — prompts coalesce at next provider-turn boundary |
| Queue (FIFO future runs) | **YES** | v2 spec defines `delivery: "queue"` (harness is v1 SDK — not yet exposed) |
| Interrupt / abort | **YES** | `client.session.abort({ path: { id } })` → `MessageAbortedError` |
| Append (send after stream_end) | **NO** | Invented by harness — `registerAppendCallback` in StreamCoordinator |
| Prompt admission ack | **YES** | `promptAsync` returns 204 on acceptance; stream_start event |

## What OpenCode Does NOT Support Natively

- Explicit "append" delivery mode (harness invention)
- Per-message delivery mode in v1 SDK (`delivery` parameter is v2)
- Application-level queue state (server has inbox, but no queue management API)

## Comparable Tools — Patterns

| Pattern | Used By | Notes |
|---|---|---|
| Block input during generation | Cursor, Aider, Continue | Simplest but frustrating |
| Auto-queue (no choice) | Claude Code (current) | Queues silently, no visible queue UI |
| Queue with visible UI | Cline (PR #7112, WIP) | Chips with edit/remove, max 5 items |
| Send-time choice (interrupt vs queue) | Codex (OpenAI) | Modifier key at send time |
| Side channel (/btw) | Claude Code | Non-interrupting side question |

## Common User Complaints

1. **"My prompt disappeared!"** — universal across Cline, Claude Code, and all tools
2. **"I can't steer mid-task without losing work"** — Escape discards everything
3. **"Mode switching clears my input"** — Cline Plan/Act switch
4. **"Docs say I can interrupt, but I can't"** — Claude Code docs-reality gap
5. **"No visible queue feedback"** — users don't know if message was captured or lost

## Requirements Extracted from Research

1. **Never silently drop user input** — must always go somewhere visible
2. **Show queue state in UI** — chips/cards with status labels
3. **Provide stable prompt IDs** — survive reloads
4. **Preserve user draft across navigation** — don't clear on tab/mode switch
5. **Distinguish interrupt (now) vs queue (later)** — clear labels
6. **Handle rapid submissions** — no race condition losses
7. **Persist queued prompts** — survive webview and VS Code reloads
8. **Document what each mode actually does** — no docs-reality gap

## Risks and Assumptions

- **OpenCode v1 SDK doesn't expose `delivery` parameter** — queue is client-side until v2
- **Per-tab steer mode** could confuse users if they expect global mode (mitigated with clear tooltips)
- **Host-side queue** creates a second queue alongside webview queue — must coordinate to prevent duplicate sends
- **drainAfterAbort default: false** — safe default; user can enable if desired
