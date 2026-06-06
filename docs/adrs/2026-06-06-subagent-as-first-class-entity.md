# ADR: Subagents and Tool Calls as First-Class UI Entities

**Status:** Accepted
**Date:** 2026-06-06
**Authors:** Claude (Opus 4.8)

## Context

When the main opencode agent delegates work it calls a tool literally named
**`task`** whose args are `{ subagent_type, description, prompt }`; the subagent
then runs in a *child session*. The extension had no concept of this:

- [`classifyTool`](../../src/chat/handlers/toolClassifier.ts) mapped `task` to the
  generic `meta` class, so [`renderToolCallBlock`](../../src/chat/webview/toolCallRenderer.ts)
  rendered it as an ordinary tool and
  [`createToolArgsPanel`](../../src/chat/webview/toolCallRenderer.ts) **dumped the
  full `{subagent_type, prompt, …}` JSON into the transcript** — a raw-payload
  leak that was the most visible symptom.
- A rich subagent model already existed on the backend
  ([`RunActivityTracker.recordSubagent`](../../src/chat/handlers/RunActivityTracker.ts))
  and a side panel ([`subagent-panel.ts`](../../src/chat/webview/subagent-panel.ts)),
  but they were fed **only** by `subtask` *parts* via
  [`ActivityPartHandler`](../../src/session/eventHandlers/ActivityPartHandler.ts).
  opencode does **not** reliably emit a `subtask` part in the parent stream for a
  `task` tool call, so the panel stayed empty while the raw `task` tool was the
  only thing the user saw. **The two systems were disconnected.**
- The tab bar rendered **"N/undefined streaming"** because the stream-capacity
  object passed to the renderer was missing its `maxStreams` field.

Research into Claude Code, Codex, and Cline confirmed the target pattern:
present delegated work as a *task card* (agent name + one-line purpose + status +
duration), nest its tool calls, collapse by default, and keep raw prompt/IO
behind a debug expander — never inline.

## Decision

1. **The `task` tool IS the subagent boundary.** It is the reliable, observable
   signal in the parent stream, so it — not the optional `subtask` part — drives
   the transcript representation.

2. **Single string-match site.** Subagent detection and arg parsing live in one
   pure module, [`toolClassifier.ts`](../../src/chat/handlers/toolClassifier.ts)
   (`isSubagentToolName`, `parseSubagentInvocation`, `SUBAGENT_TOOL_NAMES =
   {task, subagent, delegate}`). Both the backend bridge and the webview import
   it, so the rule and arg shape never drift. The webview-facing wrappers
   (`isTaskTool`, `parseTaskInvocation`) live in
   [`subagentCard.ts`](../../src/chat/webview/subagentCard.ts) and delegate to it.

3. **Inline subagent card.** `renderToolCallBlock` early-returns
   `renderSubagentTaskCard` for task tools (mirroring the existing `detectPlanFile`
   pattern), so the generic args panel never renders for `task`. The card shows
   agent + purpose + status (queued/running/done/failed) + duration, a result
   summary on completion, readable errors on failure, a "View activity →" link to
   the panel, and the full prompt behind a **"Show task prompt (debug)"**
   `<details>`. Task tools are excluded from generic tool grouping so parallel
   subagents each render standalone. Live streaming updates patch the card in
   place via `applySubagentCardUpdate`.

4. **Backend bridge.** `recordToolRunActivity` — the single choke point for tool
   lifecycle — calls `bridgeSubagentFromTool`, which mirrors a `task` tool onto
   `recordSubagent` keyed by a deterministic `subagent:<toolId>` so start/update/
   end merge into one subagent. This lights up the side panel and the activity
   feed from the signal that actually exists. The `subtask`-part path is retained
   unchanged for servers that emit it.

5. **Both surfaces.** Subagents appear inline (transcript) *and* in an "Active
   Subagents" side panel, opened by a header toggle with a live count badge and
   reachable from each card. The activity feed gains a dedicated `subagent` kind.

6. **Descriptive tool labels.** Generic tools get scannable verb labels
   (`formatToolSummary`): `Ran` / `Read` / `Searched` / `Edited` / `Fetched`,
   paired with the existing clickable key-arg chip; argless/unknown tools keep
   their raw name.

## Consequences

- Subagents are no longer mistaken for tool calls; the raw-prompt leak is gone.
- Detection is centralized and unit-tested; if opencode renames the tool, update
  `SUBAGENT_TOOL_NAMES` in one place.
- **Known limitations:**
  - If a server emits *both* a `task` tool and a `subtask` part for the same
    delegation, two panel entries can appear (different id spaces). opencode emits
    one or the other in practice; documented rather than over-engineered.
  - The card→panel link opens the panel but does not scroll-to/highlight the
    specific entry (the card's block id is the tool id; the panel entry id is
    `subagent:<toolId>`). A deliberate simplification.
  - **Per-command** cancel/retry in the tasks panel remains *server-gated*
    (opencode exposes no per-command cancellation); the panel offers turn-level
    cancel only. Subagent cancellation works (`cancel_subagent`).
