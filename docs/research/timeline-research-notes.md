# Timeline & Tool-Call Rendering — Research Notes

> Produced: 2026-06-06
> Sources: Upstream OpenCode SDK types.gen.ts, OpenCode specs (v2/session.md, v2/todo.md), opencode-ai/opencode GitHub issues, competitor tool docs/changelogs.

---

## 1. Upstream OpenCode SDK Data Model

### 1.1 Part Types (`packages/sdk/js/src/v2/gen/types.gen.ts`)

```typescript
type Part =
  | TextPart      // { type: "text", text, synthetic?, ignored? }
  | SubtaskPart   // { type: "subtask", prompt, description, agent, model?, command? }
  | ReasoningPart // { type: "reasoning", text, time: { start, end? } }
  | FilePart      // { type: "file", mime, url, filename?, source? }
  | ToolPart      // { type: "tool", callID, tool, state: ToolState }
  | StepStartPart // { type: "step-start", snapshot? }
  | StepFinishPart// { type: "step-finish", reason, cost, tokens }
  | SnapshotPart  // { type: "snapshot", snapshot }
  | PatchPart     // { type: "patch", hash, files }
  | AgentPart     // { type: "agent", name, source? }
  | RetryPart     // { type: "retry", attempt, error }
  | CompactionPart// { type: "compaction", auto, overflow?, tail_start_id? }
```

### 1.2 ToolState (Canonical SDK — 4 states only)

```typescript
type ToolState = ToolStatePending    // { status: "pending", input, raw }
               | ToolStateRunning    // { status: "running", input, title?, time: { start } }
               | ToolStateCompleted  // { status: "completed", input, output, title, time: { start, end } }
               | ToolStateError      // { status: "error", input, error, time: { start, end } }
```

The SDK never emits `cancelled`, `timed_out`, or `retried`. These are UI-layer synthetic states set by the extension (e.g. `finishUnresolvedToolCalls` sets `unresolved`).

### 1.3 Event System (`Event` union, ~80+ event types)

Rich v2 event set including granular tool lifecycle:
- `EventSessionNextToolCalled` / `EventSessionNextToolProgress` / `EventSessionNextToolSuccess` / `EventSessionNextToolFailed`
- `EventSessionNextRetried`
- `EventSessionNextToolInputStarted` / `EventSessionNextToolInputDelta` / `EventSessionNextToolInputEnded`
- `EventSessionNextStepStarted` / `EventSessionNextStepEnded` / `EventSessionNextStepFailed`

Plus legacy events the extension currently consumes:
- `EventMessagePartUpdated` (replaces a part by id)  
- `EventMessageUpdated` / `EventMessagePartRemoved`
- `EventPermissionAsked` / `EventSessionUpdated` / `EventSessionDiff`

**Key insight:** The v2 granular events are richer than what the extension currently processes. Extension normalizes `message.part.updated` into `tool_start`/`tool_update`/`tool_end`.

### 1.4 Session Model

```typescript
type Session = {
  id, slug, projectID, directory, title, parentID?, version,
  summary?: { additions, deletions, files, diffs? },
  time: { created, updated, compacting?, archived? },
  permission?: PermissionRuleset,
  revert?: { messageID, partID?, snapshot?, diff? }
}
```

Sessions have `parentID` for subagent/fork relationships.

---

## 2. Competitor Timeline & Tool-Call Rendering Patterns

| Feature | Claude Code | Cursor | Cline | Copilot |
|---------|------------|--------|-------|---------|
| **Tool calls default** | Collapsible | Collapsed ✅ | Expanded ❌ | Collapsed |
| **Tool call icons** | Per-type ✅ | Slim icons | Colored headers | Basic |
| **Status badges** | Spinner/check/X | Dot/check/X | 5-state ✅ | Dot/check |
| **Inline diff** | ✅ Yes | ❌ Side panel | ✅ Yes | ❌ Side-by-side |
| **Stdout/stderr** | Merged | Merged | Merged | Merged |
| **Subagent display** | Nested card | Separate session | Nested collapsible | N/A |
| **Scroll markers** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Error retry** | Partial | ❌ No | ❌ No | ❌ No |

### Key Patterns to Adopt

1. **Collapsed-by-default tool calls** (Cursor) — reduces timeline clutter
2. **Inline diffs with per-edit accept/reject** (Cline) — gold standard
3. **"Accept All" bulk approval** (Cursor)
4. **Scroll markers** (Claude Code) — already implemented
5. **Subagent summary cards** (Cline) — show purpose/status/tools without expanding
6. **Tool call grouping** — group consecutive same-type calls

### Pain Points to Avoid

1. **Expanded tool calls by default** — Cline's #1 complaint
2. **No subagent visibility** — Copilot/Continue complaint
3. **Merged stdout/stderr** — all tools do this, but it's confusing
4. **No error retry** — most tools lack this
5. **No conversation search** — Cline, Cursor, Copilot lack this

---

## 3. User Feedback Patterns

### From OpenCode GitHub Issues

| Issue | Problem |
|-------|---------|
| #8868 | Agents/Commands not shown in timeline (fixed) |
| #31072 | Subagent session projection race on first message |
| #31129 | Background subagent shortcut endpoint returns false |
| #31141 | Subagent tool-using task failures |
| #31020 | Context limit ignores variant → wrong overflow % |
| #31032 | Session fork double-counts pre-fork costs |
| #30899 | Sub-agent nesting feature request |

### Common Themes

1. **Subagent visibility** — users consistently want to see what subagents are doing
2. **Tool call noise** — "wall of tool rows" when many tools execute
3. **Streaming performance** — jank when switching between text and tool rendering
4. **Large output handling** — oversized tool results need better truncation
5. **Timeline navigation** — long sessions need search and jump-to-turn

---

## 4. Requirements Derived from Research

### R1 — Stable, Typed Event Model
- Match the extension's `ToolCallBlock`/`Block` types to upstream SDK `Part` states
- Normalize all ~80 event types through a single pipeline
- Handle both legacy `message.part.updated` and v2 granular events

### R2 — Tool Call Rendering
- Show tool name, status (pending/running/completed/error/cancelled), duration, key args
- Collapse by default with smart auto-expand (errors, active tools)
- Categorize: read, edit, shell, git, search, network, subagent, planning, unknown
- Separated stdout/stderr for command tools
- Exit code badges for shell commands
- "Show full output" with truncation guard against large outputs

### R3 — File Edit / Diff Rendering
- Inline diff with file path, +/- counts, and "Open file"/"Open diff" VS Code actions
- Accept/reject per edit and bulk "Accept All"
- Status badges for pending/accepted/discarded/failed
- Plan-document detection with progress bar + approve/revise

### R4 — Command Output
- Truncated preview with "Show full" expand
- Exit code display (green 0, red non-zero)
- Duration badge
- Copy command / copy output buttons
- Stderr separated from stdout

### R5 — Subagent Timeline Support
- Inline subagent card in main timeline with purpose, status, duration
- Parent-child relationship visual (indentation / badge)
- Subagent panel with live tool-call streaming
- Multiple concurrent subagent support
- Subagent error surfacing in parent context

### R6 — Streaming Reliability
- Event coalescer (RAF batch) for hot streams
- SSE reconnect with state reconciliation
- Duplicate event prevention
- Render signature-based skip (already implemented in `shouldRenderHydratedMessages`)

### R7 — Timeline UI/UX
- VS Code theme token integration via `tokens.css`
- Keyboard navigation across tool calls (Tab, ArrowUp/Down, Home/End — already implemented)
- Focus rings on interactive elements
- ARIA live regions for streaming text
- Status badges with text labels + icons (not color-only)
- Compact and expanded density modes
- Stable loading skeletons

### R8 — Performance
- Virtual list for >300-message timelines
- Memoized render with stable block keys
- Batched state updates via RAF coalescing
- Perf budget: <16ms per frame for 1000-tool-call sessions
