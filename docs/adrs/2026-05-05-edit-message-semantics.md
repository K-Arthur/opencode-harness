# ADR: Edit Message Semantics

**Date:** 2026-05-05  
**Status:** Accepted  
**Deciders:** Engineering Team  

## Context

The chat webview has an "edit message" button on user messages. When clicked, it allows the user to edit their previous prompt. The implementation must decide what happens to downstream assistant/tool messages when a past message is edited.

## Decision

### Conservative Behavior (Chosen)

1. **Editing a past user message truncates** — all messages after the edited message are removed from the local session store and webview DOM. They are NOT deleted from the server (the server may retain them as session history).

2. **The user must explicitly resend** — editing prefills the input with the original message text. The user modifies it and presses Send. This creates a brand-new server prompt via `sendPromptAsync`.

3. **No branching** — truncation is the only behavior. There is no branch/explanation UI for downstream messages. The user sees a gap: "what was there is gone, send a new message to continue."

4. **Edits during streaming are blocked** — the `promptsInFlight` set prevents editing while the assistant is generating.

5. **Timestamps are preserved** — the original `timestamp` field of the edited message is retained. No `editedTimestamp` field is added at this time (the user is creating a new prompt, not modifying the old one).

### Rationale

- Branching conversations requires a visible branch indicator, branch switching, and merging UX that is out of scope for v0.2.0.
- Truncation is the simplest correct behavior: the user's new prompt is sent to the server, the server has context of the edited message, and a fresh response is generated.
- The server-side session (`ses_*`) retains the full conversation history even after local truncation. The user can recover the old flow by resuming the server session directly.

### Future Considerations

- A "regenerate from here" button could be added that creates a server-side fork without truncating downstream messages.
- A branch indicator could show: "3 messages were removed by editing a previous message."

## Consequences

Positive:
- Simple, predictable behavior.
- No data loss on server side.
- Easy to implement and test.

Negative:
- Users lose downstream assistant messages when editing a past message (documented in help text).
- No way to compare old vs new response side by side.
