# Message Model & Counting Semantics

## Overview

This document defines the extension's message model — how OpenCode SDK events are
transformed into internal `ChatMessage` and `Block` types, and how message counts
are derived for display. The goal is to ensure that a single logical user/assistant
turn is never counted as multiple messages.

## Layer Model

```
SDK Event                Extension Internal          Webview State           UI Display
─────────                ──────────────────          ─────────────           ──────────

message.updated          ChatMessage (role)           ChatMessage[]           Message bubble
message.part.updated     └─ Block[]                   └─ Block[]             └─ Block cards
  (text, tool, ...)         (text, tool-call,               (same)              (text, tool,
                             reasoning, step,                                    reasoning, ...)
                             activity, ...)

  SessionEvent (raw)     EventNormalizer →         (not stored              Dev-only log
                         NormalizedOpencodeEvent   in webview)
```

## Key Distinctions

### LogicalMessage — A Conversational Turn
- A `ChatMessage` with `role === "user"` or `role === "assistant"`
- Each has a stable `id` from the SDK
- One per user input or assistant response
- **Counts as one turn regardless of how many parts/chunks/events it contains**

### MessagePart — Content Within a Message
- A `Block` inside a `ChatMessage.blocks[]`
- Types: `text`, `reasoning`, `tool-call`, `step-start`, `step-finish`, `snapshot`, `patch`, `agent`, `retry`, `compaction`, `activity`, `file`
- Many parts may belong to one LogicalMessage
- **Parts do NOT count as separate messages**

### System/Activity Card
- A `ChatMessage` with `role === "system"`
- Represents status info: agent switches, model changes, compaction events, subagent activity
- **Counted separately from turns** — shown as compact cards, not conversational turns

### StreamDelta
- A `text_chunk` event during streaming
- Merged into the single in-flight assistant message
- **Never creates a new ChatMessage**

### ToolCall / ToolResult
- A `Block` with `type === "tool-call"` within an assistant message
- **Part of the assistant turn, not a separate message**

### Subagent Activity
- System messages with activity blocks describing subagent work
- **Not counted as user or assistant turns**

## Message Counts API

The `computeMessageCounts()` function in `src/chat/webview/messageCounter.ts`
provides a single, centralized way to compute counts from a `ChatMessage[]`.

```typescript
interface MessageCounts {
  userTurns: number       // messages with role "user"
  assistantTurns: number  // messages with role "assistant"
  systemMessages: number  // messages with role "system"
  toolCallBlocks: number  // blocks with type "tool-call" across all messages
  totalMessages: number   // raw array length (all roles)
}
```

### What Each Count Is Used For

| Field | Display Use | Example |
|-------|------------|---------|
| `userTurns` | Session list "messageCount" | "3 turns" |
| `assistantTurns` | Timeline, history condensity | "2 assistant replies" |
| `userTurns + assistantTurns` | Session picker description | "5 turns" |
| `systemMessages` | Session picker sub-label | "(3 events)" |
| `toolCallBlocks` | Timeline turn detail | "2 tools" |
| `totalMessages` | Pagination offset | internal |

### Display Conventions

- **Session picker**: shows `"N turns"` with optional `"(M events)"` for system
  messages
- **Recent session cards**: shows `"N messages"` counting only user turns
- **Timeline**: shows per-turn tool counts and patch counts
- **History condensation**: shows `"X user, Y assistant, Z tools"` per group

## Deduplication

### Message-Level (Host Side)
`SessionStore.appendMessage()` uses **upsert by ID**: if a `ChatMessage` has a
non-empty `id` that already exists in the session's message array, it replaces
the existing entry in-place rather than pushing a duplicate. This prevents
duplicates from:
- `stream_end` replacing a `stream_start` placeholder
- Backfill re-delivery of already-known messages
- Reconnect / event replay re-emitting finalized messages

### Message-Level (Webview Side)
`upsertMessageById()` provides the same upsert logic on the webview side for
messages arriving via `addMessage()`.

### Activity-Level
`appendOrCoalesceActivity()` collapses identical consecutive activity messages
into the previous card by incrementing `repeatCount`.

### Event-Level (Normalizer)
The `EventNormalizer` tracks text part lengths, tool statuses, and message IDs
to suppress redundant normalized events from the raw SSE stream.

## What Is NOT a Separate Message

| Event | Why Not |
|-------|---------|
| `text_chunk` (stream delta) | Merged into existing assistant message |
| `tool_start` / `tool_update` / `tool_end` | Part of assistant turn as a `tool-call` block |
| `thinking` / `reasoning` | Block within assistant message |
| `step-start` / `step-finish` | Block within assistant message |
| `compaction` | System activity card, not a turn |
| `agent_switch` | System activity card, not a turn |
| `subagent_update` | System activity card, not a turn |
| `retry_activity` | Replaces prior attempt via upsert |
