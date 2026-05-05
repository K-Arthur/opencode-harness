# Rendering Pipeline

```mermaid
flowchart TD
    subgraph Backend["VS Code Extension Backend"]
        SDK[opencode-ai/sdk SSE Events]
        MR[MessageRouter.routeSseEvent]
        SC[StreamCoordinator]
        DH[DiffHandler]
    end

    subgraph Frontend["Webview Frontend"]
        SH[stream.ts handlers]
        R[renderer.ts RENDERER_MAP]
        DOM[Browser DOM]
    end

    SDK -->|stream_start, stream_token, stream_end,<br/>tool_start, tool_update, tool_end,<br/>diff, error, etc.| MR
    MR -->|_exhaustiveCheck guard| MR
    MR -->|dispatch via KnownSseEventType| SC
    SC -->|postMessage to webview| SH
    SC -->|register/edit lifecycle| DH

    DH -->|emitToWebview: diff:accepted, diff:discarded, diff:error| SH

    SH -->|isDuplicateEvent guard| SH
    SH -->|handleStreamStart| DOM
    SH -->|handleStreamToken: targeted textContent update| DOM
    SH -->|handleToolStart/Update/End| R
    SH -->|handleDiff| R
    SH -->|handleStreamEnd: finalize + reRenderMessage| R
    SH -->|handleStreamError| R

    R -->|RENDERER_MAP dispatch| R
    R -->|renderTextBlock| DOM
    R -->|renderCodeBlock| DOM
    R -->|renderThinkingBlock| DOM
    R -->|renderToolCallBlock| DOM
    R -->|renderNewDiffBlock / renderDiffBlock| DOM
    R -->|renderErrorBlock| DOM
    R -->|renderPermissionBlock| DOM
    R -->|renderTaskBanner| DOM
    R -->|renderContextBlock| DOM
    R -->|renderSkillBadge| DOM

    DOM -->|click events| DH
    DH -->|accept/reject/openFile| SC
```

## Key Data Flow

1. **SSE Event → MessageRouter**: `routeSseEvent()` receives raw events from the opencode server. A `switch` on `KnownSseEventType` dispatches each type. The `_exhaustiveCheck(never)` guard catches compile-time if a type is missing.

2. **MessageRouter → StreamCoordinator**: Events are forwarded via `postMessage` to the webview. StreamCoordinator manages per-tab lifecycle (watchdog, buffer, completion timeout).

3. **StreamCoordinator → Webview**: `postMessage()` calls hit `stream.ts` handlers in the webview. Each handler type has a dedicated function.

4. **stream.ts → DOM**: `handleStreamToken` does targeted `textContent` updates (no full re-render). All other handlers call `renderBlock()` from `renderer.ts`.

5. **renderer.ts → DOM**: The `RENDERER_MAP` dispatch table maps `block.type` to a renderer function. Each renderer returns an `HTMLElement` with ARIA attributes, sanitized content, and event listeners.

6. **DOM → DiffHandler**: Click events on accept/discard/open buttons post messages back to the extension backend. DiffHandler applies the edit and emits status updates via `emitToWebview`.

## State Flow

```
Streaming IDLE → stream_start → STREAMING
STREAMING → stream_token → STREAMING (targeted textContent update)
STREAMING → tool_start → STREAMING (pending tool call appended)
STREAMING → tool_update → STREAMING (tool call state updated)
STREAMING → tool_end → STREAMING (tool call → result state)
STREAMING → diff → STREAMING (diff block appended)
STREAMING → stream_end → IDLE (cursor removed, blocks finalized)
STREAMING → stream_error → IDLE (placeholder removed, error block shown)
STREAMING → abort → IDLE (stream:end with reason:aborted)
```
