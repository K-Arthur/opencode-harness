# Agent-Visibility UX — Audit, Capability Re-Analysis, and Roadmap

> **Date:** 2026-06-15
> **Author:** Architecture/DX research pass
> **Scope:** "Make users continuously informed about what the agent is doing" — file changes,
> terminal activity, tool calls, reasoning, progress, subagents, approvals, review/audit.
> **Status:** Research + design + partial implementation. See §14 (implementation log).
> **Supersedes / extends:** [`docs/frontend-ux-audit.md`](frontend-ux-audit.md) (2026-06-06/07),
> [`docs/research/ai-coding-ux-patterns-report.md`](research/ai-coding-ux-patterns-report.md),
> [`docs/research/timeline-research-notes.md`](research/timeline-research-notes.md).

---

## 0. TL;DR — what changed since the last audit, and what to do

Two premises in the brief are **out of date for this codebase and SDK version**, and getting
them right changes the entire plan:

1. **"OpenCode does not appear to expose traditional git-style diffs."**
   **False as of `@opencode-ai/sdk` 1.17.7.** The SDK exposes a first-class `FileDiff`
   (`{ file, before, after, additions, deletions }`), a `session.diff` SSE event carrying
   `Array<FileDiff>`, a `GET /session/{id}/diff` endpoint, `PatchPart`/`SnapshotPart`, and
   `session/revert` + `session/unrevert`. Because `before` **and** `after` full contents are
   provided, a real unified/side-by-side diff (and hunk-level staging) is computable
   **entirely in the extension** — no SDK change required. The extension already consumes
   this (see [`changed-files-dropdown.ts`](../src/chat/webview/changed-files-dropdown.ts),
   [`SessionDiffHandler.ts`](../src/session/eventHandlers/SessionDiffHandler.ts),
   [`sdkFileContentToDiffLines.ts`](../src/chat/diff/sdkFileContentToDiffLines.ts)).

2. **"Current subagent / file-change / terminal UX is insufficient / missing."**
   Mostly already **built**. [`docs/frontend-ux-audit.md`](frontend-ux-audit.md) shipped its
   Phases 0–6: Activity Timeline, interactive plan cards, a Commands/Tasks panel, session
   pin/rename/tags, open-applied-diff in VS Code, and the question bar. The honest gap list
   is small and specific, and **most of it is now unblocked** by SDK capabilities that landed
   after that audit.

**The new strategic fact:** SDK 1.17.7 added a **full PTY API** (`client.pty.create/connect/
remove/get/update` + `pty.created/updated/exited/deleted` events) and **`session.shell()`**,
and the **v2 SDK** adds a fine-grained `session.next.*` streaming protocol (tool input deltas,
`tool.progress`, `shell.started`/`shell.ended`, step lifecycle, reasoning deltas), worktree
isolation, and background sessions. Three of the five "server-gated" gaps in the previous
audit's §14 are therefore **no longer server-gated**.

**Recommendation in one sentence:** Do **not** rebuild panels. Instead (a) close the now-unblocked
gaps — **live terminal stdout + true per-command cancel via PTY**, **client-side hunk staging**,
**snapshot/checkpoint restore via revert** — (b) **unify the existing scattered panels into one
coherent "Agent Activity" command surface**, and (c) **re-point the activity/event model at the
v2 `session.next.*` protocol** so it stops reconstructing structure from coarse v1 events. All of
this must respect two hard constraints the brief omits: a **near-full webview bundle (734.5 / 736 KB)**
and an **in-flight v1→v2 migration** ([ADR](../docs/adrs/2026-06-15-v1-to-v2-sdk-migration.md)).

---

## 1. UX Audit — current state (evidence-based)

The webview is a ~70-module, no-framework TS/HTML/CSS app with a mature streaming renderer,
a tool-call lifecycle state machine, and ~2200 passing tests. What already exists for *agent
visibility*, with the file that implements it:

| Visibility need | Today | Implementation |
|---|---|---|
| **Reasoning visibility** | ✅ streamed thinking blocks, toggle | [`thinkingToggle.ts`](../src/chat/webview/thinkingToggle.ts), `renderer.ts` |
| **Tool calls** | ✅ per-tool cards w/ pending→running→completed/error, timers, output, per-tool icons | [`toolCallRenderer.ts`](../src/chat/webview/toolCallRenderer.ts), [`toolState.ts`](../src/chat/webview/toolState.ts), `toolLifecycle.test.ts` |
| **File changes** | ✅ changed-files dropdown + strip; accept/reject/revert; open-in-VS-Code diff; per-file add/del counts | [`changed-files-dropdown.ts`](../src/chat/webview/changed-files-dropdown.ts), [`DiffApplier.ts`](../src/diff/DiffApplier.ts), [`DiffAcceptService.ts`](../src/chat/DiffAcceptService.ts) |
| **Activity feed** | ✅ filterable event feed (All/Messages/Plans/Commands/Files/Errors/Approvals), keyboard nav, row→scroll | [`activityModel.ts`](../src/chat/webview/activityModel.ts), [`activity-panel.ts`](../src/chat/webview/activity-panel.ts) |
| **Timeline** | ✅ jump-to-turn minimap (note: *not* a full event timeline) | [`timeline.ts`](../src/chat/webview/timeline.ts) |
| **Commands / terminal** | ⚠️ Tasks panel with metadata, copy/re-run/open-terminal; **live stdout via polling fallback ("Hybrid A")**; **no true per-command cancel** | [`tasks-panel.ts`](../src/chat/webview/tasks-panel.ts), [`commandModel.ts`](../src/chat/webview/commandModel.ts), [`TerminalBridge.ts`](../src/terminal/TerminalBridge.ts) |
| **Subagents** | ✅ panel + cards + detail view + reconciler; first-class entity | [`subagent-panel.ts`](../src/chat/webview/subagent-panel.ts), [`subagentCard.ts`](../src/chat/webview/subagentCard.ts), [`subagentDetailView.ts`](../src/chat/webview/subagentDetailView.ts), [ADR](../docs/adrs/2026-06-06-subagent-as-first-class-entity.md) |
| **Tasks / todos** | ✅ todos panel, tasks panel | [`todos-panel.ts`](../src/chat/webview/todos-panel.ts), [`tasks-panel.ts`](../src/chat/webview/tasks-panel.ts) |
| **Plans** | ✅ interactive plan cards (progress, Approve/Revise) | [`planDetector.ts`](../src/chat/webview/planDetector.ts), `toolCallRenderer.ts` |
| **Approvals** | ✅ permission cards + cost-approval modal + question bar | [`permissionConfig.ts`](../src/chat/webview/permissionConfig.ts), [`questionBar.ts`](../src/chat/webview/questionBar.ts) |
| **Session history** | ✅ recent sessions, search, pin/rename/tags | [`sessionListRenderer.ts`](../src/chat/webview/sessionListRenderer.ts), [`recent-sessions.ts`](../src/chat/webview/recent-sessions.ts) |
| **Change auditing** | ⚠️ accept/reject/revert at **file** level; no hunk staging; no run-level "what changed this turn" rollup beyond diff dropdown | as above |

### 1.1 Real weaknesses (the honest gap list)

- **Information architecture is fragmented.** Activity, Tasks, Todos, Subagents, Changed-Files,
  Timeline are each a separate toggle/dropdown. There is no single "what is the agent doing
  right now" surface; the user assembles the picture from 5–6 controls. This is the biggest
  *felt* gap and it is an IA/consolidation problem, not a missing-feature problem.
- **Terminal visibility is a polling approximation.** Live stdout is reconstructed via a 500 ms
  `session.messages` poll ("Hybrid A", audit §14.1) because the old path had no live buffer;
  per-command cancel falls back to aborting the whole turn (§14.2). **Now fixable natively.**
- **Diff review is file-level only.** No hunk staging, no side-by-side *inside* the panel
  (it delegates to `vscode.diff`). Competitors (Roo Code) make side-by-side the default.
- **The "Timeline" is a minimap, not a timeline.** A true chronological, filterable,
  cross-turn event stream with durations would match Claude Code / DevOps-console expectations.
- **Activity model reconstructs structure from coarse v1 events.** `buildActivityEvents()` maps
  *rendered blocks* → events. v2's `session.next.*` gives the structure directly (input deltas,
  progress, shell start/end), which is cleaner, cheaper, and live.

---

## 2. Competitive Analysis (2026 refresh)

The repo already has a thorough 2026-06-06 tool-by-tool report
([`ai-coding-ux-patterns-report.md`](research/ai-coding-ux-patterns-report.md)); this is a
delta refresh focused on the four target surfaces, with current sources.

| Tool | File-change UX | Terminal visibility | Subagent visibility | Pattern worth stealing |
|---|---|---|---|---|
| **Claude Code** | Inline editor diffs; plan-review for multi-file; Y/n/always approval | TUI streamed output, inline approval | Natural-language spawn; Explore/Plan subagents | Approval *gradient* ("always" / autonomy slider); plan mode as a first-class read-only phase |
| **Cline** | Plans→previews→applies multi-file; **shows every diff before apply**; **workspace snapshot before run + one-click restore/undo per step** | Streams command output in chat with approval | Personas | **Checkpoint-per-step with restore** is the gold standard for change auditing |
| **Roo Code** (Cline fork) | **Side-by-side diff by default** (easier than Cline inline blocks); diff-based editing | similar | multi-agent personas, custom modes | **Side-by-side as default**, custom modes |
| **Cursor** (2.4–3.2) | Agent-mode inline edits; review queue | Foreground watch in Chat panel; **known pain: terminal output handling bugs in agent mode** | **Subagent trees**; background subagents write state to `~/.cursor/subagents/`; parent reads progress; async subagents + Canvases | **Isolate subagent intermediate output; surface a summary + on-demand drill-in** (keeps main view clean) |
| **Windsurf** | Cascade diffs | Devin-in-terminal (2026) | Cascade flows | Terminal-native long-running agent |
| **Codex** | PR-style review | sandboxed exec logs | task-based | PR/review-centric change framing |

**Cross-tool convergence (and where this extension stands):**

1. **Approval gradient / autonomy slider** — ✅ have modes + permission cards; could add
   per-tool "always allow" gradient.
2. **Snapshot-per-step + restore** — ⚠️ have checkpoint manager + revert; **not surfaced as
   a per-step "restore to here" timeline** (Cline's signature). *Biggest differentiator gap.*
3. **Side-by-side diff default** — ⚠️ file-level, delegates out to `vscode.diff`.
4. **Subagent output isolation + drill-in** — ✅ already first-class (ahead of most).
5. **Clean primary surface, progressive disclosure** — ⚠️ fragmented panels dilute this.

> Sources: [Cline vs Windsurf (Qodo, 2026)](https://www.qodo.ai/blog/cline-vs-windsurf/),
> [Roo Code vs Cline (morphllm, 2026)](https://www.morphllm.com/comparisons/roo-code-vs-cline),
> [Cline (GitHub)](https://github.com/cline/cline),
> [Cursor Subagents docs](https://cursor.com/docs/subagents),
> [Cursor 2.4 Subagents & Skills](https://www.aimakers.co/blog/cursor-2-4-subagents/),
> [Cursor terminal output handling issues (forum)](https://forum.cursor.com/t/terminal-output-handling-issues-in-agent-mode/58317),
> [Windsurf Devin terminal (Pondero, 2026)](https://pondero.ai/coding/guides/windsurf-devin-terminal-april-2026/),
> [Codex/Claude/Cursor/Windsurf map (Kingy, 2026)](https://kingy.ai/ai/codex-vs-claude-code-vs-cursor-vs-windsurf-vs-manus-a-practical-map-of-ai-coding-agents-for-2026/).

---

## 3. OpenCode Capability Matrix (verified against installed SDK 1.17.7 + v2)

Verified by reading `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts` (v1) and
`dist/v2/gen/types.gen.d.ts` (v2). Columns: **Native** = server/SDK provides directly;
**Derived** = computable from existing events/data; **Ext** = build in extension; **SDK Δ** =
needs an SDK/server change.

| Feature | Native | Derived | Ext | SDK Δ | Evidence |
|---|:--:|:--:|:--:|:--:|---|
| File diffs (before/after, +/−) | ✅ | | | | `FileDiff`; `session.diff` event; `GET /session/{id}/diff` |
| Unified/side-by-side render | | ✅ | ✅ | | from `FileDiff.before/after` |
| **Hunk-level staging** | | ✅ | ✅ | | reconstruct hunks from before/after; apply via `WorkspaceEdit` |
| File-level accept/reject/revert | ✅ | | ✅ | | `session/revert`, `session/unrevert` |
| **Snapshot / checkpoint restore** | ✅ | | ✅ | | `SnapshotPart`, `StepStart/Finish.snapshot`, `session/revert{messageID,partID,snapshot}` |
| Tool call lifecycle | ✅ | | | | `ToolState` pending→running→completed/error w/ `time`, `title`, `metadata`, `output` |
| Tool **input streaming (deltas)** | ✅(v2) | | | | v2 `session.next.tool.input.{started,delta,ended}` |
| Tool **progress** | ✅(v2) | | | | v2 `session.next.tool.progress` |
| Command executed | ✅ | | | | `command.executed` event |
| **Live terminal stdout** | ✅ | | ✅ | | **PTY API** `pty.create/connect/get`; `pty.{created,updated,exited}` events |
| **Run a shell command** | ✅ | | | | `session.shell()`; v2 `session.next.shell.{started,ended}` |
| **Per-command cancel** | ✅ | | ✅ | | `pty.remove` (kill PTY) — true per-tool cancel |
| Reasoning stream | ✅ | | | | `ReasoningPart`; v2 `session.next.reasoning.{started,delta,ended}` |
| Step lifecycle (cost/tokens) | ✅ | | | | `StepFinishPart{reason,cost,tokens}`; v2 `step.{started,ended,failed}` |
| Subagents / subtasks | ✅ | ✅ | ✅ | | `subtask` part; `AgentPart`; v2 `agent.switched`; child sessions (`session.children`) |
| Todos / tasks | ✅ | | | | `todo.updated` event, `Todo[]` |
| Permissions / approvals | ✅ | | | | `permission.updated/replied`; v2 `permission.v2.*` |
| Questions (clarification) | ✅(v2) | | | | v2 `question.v2.{asked,replied,rejected}`, `question.reply/reject` |
| Session diff summary (totals) | ✅ | | | | `Session.summary{additions,deletions,files,diffs}` |
| Compaction visibility | ✅ | | | | `CompactionPart`, `session.compacted`, v2 `compaction.{started,delta,ended}` |
| LSP diagnostics | ✅ | | ✅ | | `lsp.client.diagnostics` event (unused surface!) |
| VCS branch state | ✅ | | ✅ | | `vcs.branch.updated` event (unused surface!) |
| File watcher (external edits) | ✅ | | ✅ | | `file.watcher.updated`, `file.edited` |
| **Worktree isolation** | ✅(v2) | | ✅ | | v2 `Workspace`/`Worktree` API + `worktree.{ready,failed}` events |
| **Background sessions** | ✅(v2) | | ✅ | | v2 `session.background()` |

**Net:** Almost nothing the brief asks for requires an SDK change. The work is **extension-layer
rendering + IA**, plus **adopting newer SDK surfaces** (PTY, v2 `next` protocol) the existing
code predates.

### 3.1 Re-audit of the previous "server-gated" gaps (`frontend-ux-audit.md` §14)

| Prev. gap (2026-06-06) | Then | **Now (SDK 1.17.7 / v2)** |
|---|---|---|
| 1. Live command stdout | "server-gated → Hybrid A polling" | **Unblocked** — `pty.connect` + `pty.updated` stream live output |
| 2. Mid-command cancel | "needs server handle" | **Unblocked** — `pty.remove` kills the specific PTY |
| 3. Hunk-level apply/revert | "needs server support" | **Unblocked client-side** — reconstruct hunks from `FileDiff.before/after`, apply via `WorkspaceEdit`; file-level revert via `session/revert` |
| 4. Plan step write-back | "needs agent to consume plan edits" | **Still agent-gated** (genuinely needs the model/server to treat plan edits as actions) |
| 5. Checkpoint restore granularity | "depends on checkpoint API" | **Partially unblocked** — `session/revert{messageID,partID,snapshot}` enables per-message/per-step restore (Cline-style) |

---

## 4. Architectural Recommendations

### R-A. Consolidate, don't add: one "Agent Activity" surface
Fold Activity + Tasks + Changed-Files + Subagents + Todos into a **single tabbed side region**
("Activity / Changes / Terminal / Agents") rather than 5–6 independent toggles. This is the
highest user-perceived win and is **bundle-neutral-to-negative** (shared chrome replaces
duplicated chrome). Keep the transcript as the narrative; the side region is the *control
surface* (this is exactly the framing in [`frontend-ux-audit.md`](frontend-ux-audit.md) §1).

### R-B. Make the v2 `session.next.*` protocol the activity source of truth
The current activity model reconstructs events from *rendered blocks*. The v2 protocol emits
the structure directly. Sequence this **with** the existing v1→v2 migration (event pipeline is
Phase 4 of that ADR) so it's one migration, not two. Until then, keep the v1 derivation behind
the same `ActivityEvent` interface (it already is) so the swap is internal.

### R-C. Adopt PTY for terminal, behind a capability probe
Replace Hybrid-A polling with a PTY-backed live terminal *when the server advertises PTY*
(graceful degradation per constitution rule #6 — fall back to polling if `pty.list` 404s).
This closes gaps §14.1 and §14.2 at once.

### R-D. Snapshot timeline ("restore to here") as the change-audit spine
Surface `SnapshotPart` / step snapshots as a chronological "restore to this point" rail backed
by `session/revert`/`unrevert`. This is the single biggest *competitive* differentiator gap
(Cline's signature) and is now SDK-supported.

### R-E. Respect the two hard constraints
- **Bundle:** webview `main` is **734.5 / 736 KB**. Any net-new UI must (a) displace something,
  (b) lazy-load (dynamic `import()` on first panel open), or (c) ride the consolidation in R-A
  which removes duplicated chrome. Treat **bundle delta as a first-class acceptance gate**
  (`scripts/check-bundle-size.mjs` already enforces it).
- **Migration:** do not introduce new *v1* event consumers; new event-driven features target
  the v2 `next` protocol or the shared domain types from the migration's mapping layer.

---

## 5. Component & Data-Model Designs (top 3 priorities)

### 5.1 Live Terminal (PTY) — closes §14.1/§14.2

**Data flow:**
```
session.shell()/tool runs bash ──► server PTY ──► pty.created {info: Pty}
                                                └► pty.updated {info: Pty}  (live chunks)
                                                └► pty.exited  {exitCode}
extension host: client.pty.connect(id) ──► stream ──► host→webview "pty_data" {ptyId, chunk}
webview: append to TerminalCard buffer (ansiUtils already exists) ; Cancel ─► host client.pty.remove(id)
```
**Model (host):** `PtySession { id; sessionId; command; status: running|exited; exitCode?; startedAt; endedAt? }`.
**Webview:** extend the existing bash tool card / Tasks panel; reuse [`ansiUtils.ts`](../src/chat/webview/ansiUtils.ts).
**Degradation:** if `pty.*` unavailable, keep Hybrid-A. **Capability probe once per server.**
**Tests (RED first):** PTY event→buffer reducer (pure); cancel→`pty.remove` call; fallback when PTY 404.

### 5.2 Client-side hunk staging — closes §14.3
`FileDiff{before,after}` → compute hunks (Myers/`diff` already used in `sdkFileContentToDiffLines.ts`) →
render per-hunk accept/reject → apply accepted hunks via `vscode.WorkspaceEdit` (undoable, satisfies
constitution rule #3 "transactional writes"). File-level revert still uses `session/revert`.
**Pure core:** `reconstructHunks(before, after): Hunk[]` and `applyHunks(original, accepted): string` —
both pure, property-testable (fast-check), zero DOM. UI is a thin renderer.

### 5.3 Snapshot/Restore timeline — R-D differentiator
Collect `SnapshotPart` + `StepFinishPart.snapshot` per turn → render a vertical "restore to here"
rail in the Changes tab → action calls `session/revert{messageID|partID|snapshot}`; `unrevert` = redo.
Confirm-on-restore (destructive). Reuse [`CheckpointManager.ts`](../src/checkpoint/CheckpointManager.ts).

---

## 6. Event-Flow & State Notes
- **Single normalizer.** The activity/timeline/terminal surfaces should all read one normalized
  event stream (today: `ActivityEvent`; future: v2 `next`), not each re-parse SSE. This also
  de-risks the memory's noted **R1 "unify stream state"** P0.
- **Coalescing & caps.** Reuse existing [`activityCoalesce.ts`](../src/session/activityCoalesce.ts)
  and the bounded-persistence machinery (`buildPersistedSessions`, 200 msgs/session) so long
  sessions don't blow memory. PTY buffers must be **transient + ring-buffered** (cap per command),
  matching how Hybrid-A already keeps stdout transient.
- **Virtualize.** Long terminal logs and the snapshot rail must use the existing
  [`virtualList.ts`](../src/chat/webview/virtualList.ts) (audit §5 deferred this; PTY makes it real).

---

## 7. Performance & Scalability
- **Backpressure on `pty.updated`:** coalesce chunks per animation frame (the render-queue
  pattern already exists) — never one DOM write per chunk.
- **Ring buffers:** cap terminal scrollback (e.g. last N KB) with "open full terminal" escape hatch
  to a real VS Code terminal via [`TerminalBridge.ts`](../src/terminal/TerminalBridge.ts).
- **Bundle:** lazy-`import()` the snapshot timeline and hunk-staging renderers; they're not needed
  until a panel opens. Measure delta against the 736 KB gate per change.
- **v2 deltas are smaller** than re-deriving from full message refetches (the §14.1 poll), so the
  PTY/v2 path is also a perf win, not just a feature win.

---

## 8. Accessibility
- New surfaces inherit the audit's a11y baseline: ARIA list semantics, arrow-key nav, focus-visible,
  reduced-motion guard, themed via `--vscode-*` tokens (no raw px/hex — enforced by `tokens.css`
  discipline + tests).
- Terminal output: `role="log"` + `aria-live="polite"` (announce *completion/error*, not every chunk).
- Restore actions are destructive → require explicit confirm + `aria-describedby` warning.

---

## 9. Testing Strategy (TDD, per constitution)
- **Pure cores first (RED→GREEN):** `ptyBufferReducer`, `reconstructHunks`/`applyHunks`,
  `collectSnapshots`, capability-probe predicate. Add **fast-check** property tests for the diff/hunk
  round-trip (`applyHunks(before, allHunks) === after`).
- **DOM/behavior:** jsdom tests for each renderer (render, cancel, empty/streaming, dispose cleanup).
- **Contract:** extend the SSE event-coverage contract test to classify `pty.*` and v2 `next.*`.
- **Gates:** typecheck clean, ≥90% on new code, bundle-size gate green, message-contract + roundtrip green.

---

## 10. Prioritized Roadmap

Sequenced by **(user-visible value) × (now-unblocked) ÷ (bundle/migration risk)**. Each is an
independent vertical (UI + state + messages + tests + a11y) behind a toggle, degrading gracefully.

| # | Item | Value | Effort | Risk | Notes |
|---|---|---|---|---|---|
| **P0** | **IA consolidation** — one tabbed Activity/Changes/Terminal/Agents side region | ★★★★★ | M | Low (bundle-neutral) | Biggest *felt* win; precondition for the rest |
| **P1** | **Live Terminal via PTY** + true per-command cancel | ★★★★★ | M | Med (capability probe + fallback) | Closes §14.1/§14.2; removes the polling hack |
| **P2** | **Snapshot "restore to here" timeline** | ★★★★☆ | M | Med (destructive → confirm) | Cline-parity differentiator; uses `session/revert` |
| **P3** | **Client-side hunk staging** + in-panel side-by-side | ★★★★☆ | M | Low (pure core) | Closes §14.3; matches Roo Code default |
| **P4** | **Activity model on v2 `next.*`** | ★★★☆☆ | L | Med (couples to migration Phase 4) | Do *with* the event-pipeline migration, not before |
| **P5** | **Latent-event surfaces** — LSP diagnostics + VCS branch chips in the Activity feed | ★★★☆☆ | S | Low | Free signal already on the wire, currently dropped |
| **P6** | **True chronological event timeline** (replace minimap) | ★★★☆☆ | M | Low | Folds into P0's Activity tab |

**Explicitly deferred / out of scope now:** plan step write-back (§14.4 — genuinely agent-gated);
worktree isolation & background sessions (v2-only, large, post-migration); a full DevOps-style
multi-session "command center" (premature until P0 lands).

---

## 11. Risks, Limitations, Fallbacks
- **PTY availability varies by server version** → probe `pty.list` once; fall back to Hybrid-A.
- **Bundle ceiling** is the dominant constraint → lazy-load + displace; if a feature can't fit,
  it doesn't ship until consolidation frees room.
- **v2 migration churn** → don't fork the event model; new consumers target v2/shared domain types.
- **Destructive restore** → confirm + clear "this discards changes after point X" copy; never auto.
- **`before`/`after` payload size** for huge files → diff/hunk computation must stream/cap (the
  existing `diff-line-cap` logic already guards this).

---

## 12. Deliverables checklist (maps to the brief's Phase 10)
1. UX Audit → §1  • 2. Competitive Analysis → §2  • 3. OpenCode Capability Analysis → §3
4. Architectural Recommendations → §4  • 5. Component Designs → §5  • 6. Data Models → §5
7. Event Flow → §5–6  • 8. State Management → §6  • 9. Backend Changes → **none required** (§3 net)
10. Frontend Changes → §5, §10  • 11. Migration Plan → §4 R-B, §10 P4  • 12. Testing → §9
13. Accessibility → §8  • 14. Performance → §7  • 15. Prioritized Roadmap → §10.

---

## 13. Review of the alternative (Phase 2A/2B/2C) plan + reconciliation

A second model produced a detailed Phase 2A/2B/2C plan. It is well-structured and its
file-by-file change tables, panel-registration pattern, and throttling guidance are useful and
adoptable. However, several of its core premises **contradict verified SDK/codebase facts**, and
adopting it as-is would build redundant systems and miss the biggest opportunity. Verdict:
**merge the concrete engineering scaffolding; reject the redundant infrastructure; re-base on
the native SDK surfaces.**

### 13.1 Critical corrections (evidence-backed)

| Alt-plan item | Issue | Evidence / correct approach |
|---|---|---|
| **2B-1 File Snapshot System** (`FileSnapshotManager` snapshots via `vscode.workspace.fs` before each tool, diffs after) | **Reinvents a native capability** on the brief's false premise. Racy (competes with agent writes + external edits), adds bundle weight, and is unnecessary. | SDK already gives `FileDiff{before,after,additions,deletions}` via `session.diff` + `GET /session/{id}/diff`; already consumed by [`SessionDiffHandler.ts`](../src/session/eventHandlers/SessionDiffHandler.ts) / [`changed-files-dropdown.ts`](../src/chat/webview/changed-files-dropdown.ts). **Do not build a snapshot manager.** Use `FileDiff`. |
| **2C-1 Unified Activity Center** ("NEW activityCenter.ts") | **Already exists.** | [`activity-panel.ts`](../src/chat/webview/activity-panel.ts) + [`activityModel.ts`](../src/chat/webview/activityModel.ts) (filterable feed, keyboard nav). Enhance/consolidate (P0), don't recreate. |
| **2A-1 Tool Call Live Status Panel** ("NEW infra") | Lifecycle **already implemented**; only the *panel surfacing* is new. | [`toolCallRenderer.ts`](../src/chat/webview/toolCallRenderer.ts), [`toolState.ts`](../src/chat/webview/toolState.ts), `toolLifecycle.test.ts`. Reuse the state machine; this is the "Activity tab" in P0, not new infra. |
| **2A-2 File Change Tree** ("NEW fileChangesPanel.ts") | Overlaps the existing changed-files dropdown/strip. | [`changed-files-dropdown.ts`](../src/chat/webview/changed-files-dropdown.ts). Enhance to a tree; don't fork. |
| **2C-3 Session History Browser** ("no UI exists") | **Exists** with search/pin/rename/tags. | [`sessionListRenderer.ts`](../src/chat/webview/sessionListRenderer.ts), [`recent-sessions.ts`](../src/chat/webview/recent-sessions.ts). |
| **2A-3 Subagent Commands** ("may need SDK changes") | Command/invocation **is already on the wire**. | `subtask` part carries `prompt`/`description`/`agent`; v2 `SubtaskPart` adds `command`. Subagent UI already first-class ([ADR](../docs/adrs/2026-06-06-subagent-as-first-class-entity.md)). Just render the existing field. |
| **2C-4 Progress Dashboard** ("step events not in SDK; may need SDK changes; infer from tool calls") | **Wrong** — steps are native. Inference fallback is unnecessary. | `StepStartPart`/`StepFinishPart{reason,cost,tokens,snapshot}` (v1); v2 `session.next.step.{started,ended,failed}`. Use real steps. |
| **2B-3 hunk accept/reject** ("add `accept_hunk`/`reject_hunk` messages") | Messages **already exist**; the gap is the *apply*, which is client-side. | Audit §14.3: "`accept_hunk`/`reject_hunk` messages exist." Reconstruct hunks from `FileDiff.before/after`, apply via `WorkspaceEdit`. No snapshot system needed (kills the 2B-1 dependency). |
| **2B-2 Streamed File Previews via `tool_partial` parsing** | Fragile (parsing code blocks out of partial tool output). | Prefer v2 `tool.input.delta` / `tool.progress`, or the file-write tool's structured input. `tool_partial` is the polling-era crutch. |
| **All panels: "receive full-state updates (not incremental)"** | **Known perf anti-pattern in this repo.** | The 2026-06-11 fix (`Status.md` RC1) found full-state `setState` churn was a top lag source. Use bounded/incremental updates, not "send everything each change." |

### 13.2 The alternative plan's biggest omissions

1. **No terminal/PTY.** The single most valuable now-unblocked capability — live terminal stdout
   + true per-command cancel via the SDK **PTY API** (`pty.connect`/`pty.remove`, `pty.*` events) —
   is absent. This closes the two oldest §14 gaps. It belongs at **P1** (see §10), above most of 2A/2B.
2. **No bundle-size awareness.** It proposes ~10 new panels + 3–4 new CSS files. The webview
   bundle is at **734.5 / 736 KB** (`scripts/check-bundle-size.mjs`). "Add 10 panels" is not
   viable without consolidation (P0) + lazy-loading. Bundle delta must be an acceptance gate.
3. **No v2-migration alignment.** It wires new emitters into `StreamCoordinator` as v1-shaped
   messages, ignoring the in-flight [v1→v2 migration](../docs/adrs/2026-06-15-v1-to-v2-sdk-migration.md)
   whose event pipeline (Phase 4) is the natural home for a richer activity model.

### 13.3 What to adopt from the alternative plan
- **Per-block thinking controls** (2A-4): per-block collapse + token count + elapsed time. Genuine,
  small, not yet done. Good low-effort win (verify bundle delta).
- **Streamed file preview** (2B-2 *concept*): valuable Cline-style pattern — but sourced from v2
  `tool.input.delta`/`tool.progress`, not `tool_partial` regex.
- **File-by-file change tables + panel-registration consistency + throttling strategy:** good
  engineering discipline; reuse for the reconciled items (corrected to *enhance* existing files).

### 13.4 Reconciled roadmap (merge of §10 and the alternative plan)
| Priority | Item | From | Build vs. enhance |
|---|---|---|---|
| **P0** | IA consolidation (Activity/Changes/Terminal/Agents tabs) | mine; absorbs alt 2A-1/2A-2/2C-1 | **enhance** existing panels |
| **P1** | Live Terminal + per-command cancel (PTY) | mine only | new (alt missed it) |
| **P2** | Snapshot "restore to here" (`session/revert`) | mine; replaces alt 2C-2's bespoke restore | enhance `CheckpointManager` |
| **P3** | Client-side hunk staging from `FileDiff` | mine; replaces alt 2B-1+2B-3 (no snapshot mgr) | enhance `DiffAcceptService` |
| **P4** | Activity model on v2 `next.*` | mine; absorbs alt 2C-4 (real steps) | with migration Phase 4 |
| **P5** | Per-block thinking controls | **alt 2A-4** (adopted) | enhance `thinkingToggle`/`renderer` |
| **P6** | Streamed file preview (v2 deltas) | alt 2B-2 concept, re-sourced | enhance tool card |
| **P7** | LSP diagnostics + VCS branch chips | mine | enhance Activity feed |

**Dropped entirely:** `FileSnapshotManager` (2B-1), `activityCenter.ts` as new (2C-1),
`sessionHistoryPanel.ts` as new (2C-3), step-inference fallback (2C-4) — each redundant with
existing code or native SDK data.

---

## 14. Implementation log (2026-06-15 session)

### 14a. Requested-feature status (verified)
| Feature | Status | Where |
|---|---|---|
| Show changed file lines when edits are made | ✅ Present | edit-tool cards render added/removed/context diff lines ([`toolCallRenderer.ts`](../src/chat/webview/toolCallRenderer.ts)); changed-files dropdown per-file expansion; **new:** edit/write inputs now preview as a diff/code block instead of JSON |
| Show commands + view running bash in the VS Code terminal | ⚠️ Partial | "Open in terminal" re-runs the command in a real VS Code terminal ([`WebviewEventRouter.ts:835`](../src/chat/WebviewEventRouter.ts)); **true live attach** to the already-running command needs the PTY wiring (§14d) |
| Recent prompts pinned to the top | ✅ Implemented this session | [`recentPromptsRail.ts`](../src/chat/webview/recentPromptsRail.ts) + [`recentPrompts.ts`](../src/prompts/recentPrompts.ts) core; per-session `pinnedPrompts` persisted |

### 14b. Multi-session bleed — root causes fixed (TDD)
- **Question bar / context-usage on wrong session:** webview attributed per-session events to the *viewed* session when the explicit `sessionId` was absent. Fix: `resolveEventSessionTarget` (explicit → envelope `sid` → active) + `addQuestion(…, sid)`. ([`sessionTarget.ts`](../src/chat/webview/sessionTarget.ts), `questionBar.ts`, `main.ts`)
- **Context-usage persistence bleed:** `ContextMonitor` kept a single shared `tokenLimit`; two tabs on different-context models corrupted each other's percentage. Fix: per-session `limitBySession`. ([`ContextMonitor.ts`](../src/monitor/ContextMonitor.ts))
- **Host session/tab routing audited:** robust — `resolveServerEventTab` resolves by cliSessionId → child-session map, **buffers** during the registration race (ADR-009), **drops ambiguous** sessionless edits, and never falls back to the active tab. The bug was webview-side attribution, now fixed. `set_mode`/`get_context_usage`/all three `question_asked` emitters already stamp the authoritative sessionId.

### 14c. Hunk staging — the *correct* design (answering "what would achieve the feature")
**The feature's real goal:** let the user keep some of an agent's edit and discard the rest
(partial acceptance), instead of all-or-nothing accept/revert.

**Why naive "apply a diff" is wrong here:** opencode is **server-authoritative** — it applies
edits to disk itself and the old client diff-*generation/apply* subsystem was removed (C1-a)
because the server never emitted a client-appliable "diff part". Resurrecting that would make
client and server fight over file ownership.

**What the model actually offers:** `session.diff` → `FileDiff{before, after}` (full contents);
`session/revert{messageID, partID, snapshot}` + `unrevert` (revert to a **snapshot**, i.e. a
whole-workspace point — *not* sub-file); a **file watcher** (`file.watcher.updated`/`file.edited`)
that reconciles external edits. There is **no hunk-level server API**.

**Correct way to achieve the feature (ranked):**
1. **Rejecting a hunk = a normal, user-initiated, undoable edit.** The edit is already on disk;
   discarding a hunk means reverting *those specific lines* via a VS Code `WorkspaceEdit`
   (undoable, satisfies constitution rule #3). This is *not* the C1-a subsystem — it's the user
   editing their own file, which is always allowed, and opencode's file watcher reconciles its
   diff view afterward (refresh changed-files on completion). The pure `applyHunkSelection`
   ([`hunkStaging.ts`](../src/chat/diff/hunkStaging.ts)) computes the resulting content; the host
   applies it as one `WorkspaceEdit`. **This is achievable and the recommended path.**
2. **Pre-apply permission gating (whole edit):** opencode's `edit: ask` permission already lets
   the user approve/deny a *whole* edit before apply — coarser, but server-native. Good for
   "review before it touches my files"; not per-hunk.
3. **Agent-mediated undo:** ask the agent to revert a specific change — indirect, costs a turn.

**Verdict:** the feature *is* achievable. Implement reject-hunk as a host `WorkspaceEdit` driven
by `applyHunkSelection` over the cached `FileDiff.before/after`, then refresh changed-files so
opencode's reconciled view and the panel agree. (Accept-all/revert-file already exist server-side.)

### 14d. PTY live terminal — wiring plan (user will manually verify against a live server)
Manual verification resolves the only blocker (no server in this dev env). Correct wiring:
1. **Capability probe** once per server: `client.pty.list()` → `isPtySupported` ([`ptyModel.ts`](../src/terminal/ptyModel.ts)); if unsupported, keep Hybrid-A.
2. **Host:** on `pty.created/updated/exited/deleted` SSE events, fold through `ptyReducer`; call
   `client.pty.connect(id)` to stream live output → forward `pty_data{ptyId, chunk}` to the webview
   (coalesced per frame); **Cancel** → `client.pty.remove(id)` (true per-command cancel).
3. **Webview:** render the `ptyReducer` state in the bash tool card / Tasks panel (reuse
   `ansiUtils` for ANSI), ring-buffered (`PTY_OUTPUT_CAP`).
4. **Degradation:** fall back to Hybrid-A polling when PTY is absent (constitution rule #6).

### 14e. Cores delivered this session (all RED→GREEN, committed)
| Core | Status | Wiring |
|---|---|---|
| `recentPrompts` / rail | ✅ wired + rendered | done |
| `hunkStaging` (computeHunks/applyHunkSelection) | ✅ core; design in §14c | host reject-hunk WorkspaceEdit = next concrete step |
| `ptyModel` (reducer + probe) | ✅ core | host connect/forward + render (§14d) — pending live verify |
| `restorePoints` (collector + revert builder) | ✅ core | needs a restore-rail UI + partID revert call |
