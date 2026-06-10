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

## Refinement: Panel auto-open, status reconciliation, and detail-view architecture (2026-06-09)

Three bugs were identified and fixed:

### Bug 1 — Panel auto-opens on every activity update

`run_activity_update` auto-opened the side region whenever `activeSubagentCount > 0`,
even for activity churn on already-known subagents. During long tool chains the
panel kept popping back open after dismissal, disrupting the coding flow.

**Fix:** Track previously-known subagent IDs per session
(`knownSubagentIdsBySession`). Only auto-open when a **new** subagent ID appears
that wasn't in the previous set. Dismissal is per-session and resets on next run.

Module: [`subagentReconciler.ts`](../../src/chat/webview/subagentReconciler.ts) —
`computeNewSubagentIds()`.

### Bug 2 — Completed subagents shown as "Running"

The server drops a subagent from its snapshot once it transitions to terminal.
The webview's `mergeSubagentActivities` appended new entries but never reconciled
the status of dropped subagents — they stayed stuck on "running" forever.

**Fix:** `reconcileSubagentStatuses()` compares previous activities against incoming
snapshot. Dropped subagents whose status was live (queued/running/waiting/unknown)
are transitioned to "completed" with a synthetic `completedAt`. Already-terminal
dropped subagents keep their status (failed/cancelled).

Completed subagents are collapsed by default in the panel (only name + status badge
visible), expandable via a toggle button, and capped at 10 most-recent — with a
"Clear completed" button in the stats bar.

Module: [`subagentReconciler.ts`](../../src/chat/webview/subagentReconciler.ts) —
`reconcileSubagentStatuses()`, `capCompletedSubagents()`.

### Bug 3 — Detail view overlapped all tab panes

`#subagent-detail-view` was `position: absolute; inset: 0` and a **sibling** of
`#subagent-panel` inside `.side-region-body`. When shown, it covered all four tab
panes (todos, activity, tasks, subagent), not just the subagent pane.

**Fix:** Moved `#subagent-detail-view` to be a **child** of `#subagent-panel`.
Added `data-view="list" | "detail"` attribute on the panel. CSS rules swap list
and detail visibility based on the attribute. The panel has `position: relative`
so the detail's `absolute; inset: 0` is scoped to the subagent tab pane only.

### Additional fixes

- `mark_subagent_read` is now posted when the user clicks a panel item or opens
  the detail view, resetting the unread count badge.
- `onClearCompleted` removes terminal subagents from the panel and state.
- Cancel button is conditionally rendered (not structurally different) for
  running vs non-running items, preventing stale buttons on status transitions.

### Bug 4 — normalizeSubagentStatus mapping unknown → pending/running (root cause of Bug 2 recurrence)

Bug 2's reconciler was correct, but two upstream normalizers silently re-introduced
the "stuck running" problem:

1. **Webview** (`main.ts:normalizeSubagentStatus`) mapped `"unknown"` → `"pending"`.
   `isLiveSubagent` treats `"pending"` as live, so unknown-status subagents kept
   showing "Running" even after the reconciler fixed them.
2. **Host** (`RunActivityTracker.ts:normalizeSubagentStatus`) used `status ?? "running"`
   as the default, and `ChatProvider.ts:normalizeSubagentUpdateStatus` defaulted to
   `"running"`. Both caused unparseable server statuses to appear as live.
3. **Host** (`RunActivityTracker.ts:activeSubagentCount`) counted `"unknown"` as
   active, preventing run finalization.

**Fix:** All three normalizers now map unknown / non-canonical values to `"unknown"`
(NOT `"pending"` or `"running"`). The webview's `isLiveSubagent` only treats
`"running"` and `"pending"` as live. The reconciler correctly transitions `"unknown"`
to `"completed"` when the server drops the subagent.

Modules: `src/chat/webview/main.ts`, `src/chat/handlers/RunActivityTracker.ts`,
`src/chat/ChatProvider.ts`.

### Bug 5 — "Open in editor" button was a no-op placeholder

The popout button (`#subagent-detail-popout-btn`) only sent the parent `sessionId`
without the subagent id, and the host's `open_subagent_detail` handler only logged.

**Fix:**

1. The webview tracks the active subagent id (`activeSubagentId`) — set on panel
   click (`onOpenDetail`) and `subagent_update` events, cleared on detail close.
2. The popout button sends both `sessionId` and `subagentId`.
3. The host's `openSubagentDetailPanel` creates a new `vscode.WebviewPanel` with
   `WebviewContent.buildForPopout()`, which injects `window.__OC_POPOUT__`.
4. The popout webview detects popout mode at init, hides all chat UI, and posts
   `popout_get_subagent_detail` to fetch and render the detail.
5. The host forwards `subagent_detail` to matching popout panels via
   `postSubagentDetailToPopouts`.

Modules: `src/chat/webview/main.ts`, `src/chat/ChatProvider.ts`,
`src/chat/WebviewEventRouter.ts`, `src/chat/WebviewContent.ts`.

## Addendum (2026-06-10) — Completion-on-finalize closes the "stuck Running" gap

Three residual paths still left subagents badged "Running" forever:

1. **Run finalize never terminalized subagents.** `RunActivityTracker.
   markRunComplete()` / `markRunCancelled()` set the run phase but left
   `run.subagents` entries non-terminal; the finalize snapshot was posted and
   the run cleared, so no later snapshot could correct them. Both methods now
   close out queued/running/waiting/unknown subagents with the run outcome
   (`terminalizeActiveSubagents`).
2. **Subtask parts mislabeled the parent as the child.** SDK `subtask` parts
   carry no child-session field — `part.sessionID` is the PARENT session.
   `ActivityPartHandler` no longer reports it as `childSessionId` (it poisoned
   `SubagentHeartbeat` targeting and open-session navigation). The real child
   id continues to arrive via the task-tool bridge.
3. **Persisted webview state resurrected stale badges.** `state.restore()` now
   terminalizes non-terminal persisted `subagentActivities` alongside the
   existing `isStreaming` reset — no run survives a webview reload.

Also new: subagent cards and the detail view expose a one-click "Open session"
action (`open_subagent_session` message → `importOneServerSession` +
`handleResumeSession`) that opens the child session as a regular tab.
