# Webview Regression Notes

## Streaming Text/Tool Interleave (v0.2.16)

Text chunks streamed before and between tool calls must appear live and stay correctly ordered relative to tool elements. Three distinct failure modes were fixed:

**Problem 1 — Text finalized late, appears all at once.** `handleToolStart` cleared `state.currentBlockBuffer` and `state.currentBlockEl` before the RenderQueue or RAF flush had committed the pending text. The deferred flush fired, found no current element, called `insertStreamingTextAfterLastBlock`, and created a new block — but by then the flush had nothing to render (the buffer was empty). The text accumulated in the buffer never became a finalized markdown block until the whole stream ended, so it appeared to "blink in" at the end.

**Fix**: `finalizeCurrentTextBlock(state, els, messages)` is now called at the top of `handleToolStart`, before any state is cleared. This immediately converts the live streaming `<div class="streaming-text">` element to a finalized `<div class="msg-text markdown-content">` with full markdown rendering. The RenderQueue callback and RAF `doUpdate` path both have a matching guard (`if (!state.currentBlockBuffer.trim()) return`) that skips execution when the buffer was already cleared, preventing spurious empty-block creation.

**Problem 2 — Post-tool text positioned at bubble tail, not after last tool.** `insertStreamingTextAfterLastBlock` appended the new text element with `bubble.appendChild()`, placing it after any existing trailing children (e.g. diff blocks, skill badges) rather than immediately after the last tool element.

**Fix**: The helper now scans `bubble.children` in reverse for the last element matching `details.tool-call, details.tool-group, .diff-block, .skill-badge` and uses `bubble.insertBefore(textEl, insertAfter.nextSibling)` to splice the new text element into the correct position. A new `createTextBlock("")` entry is pushed to `msgObj.blocks` and `state.currentBlockIndex` is set to track it.

**Problem 3 — Diff blocks cut live text.** `handleDiff` appended the diff element without first finalizing any in-progress text block, producing the same visual reordering.

**Fix**: `finalizeCurrentTextBlock(state, els, messages)` call added at the start of `handleDiff`.

## Session-Scoped Chat Bar (v0.2.16)

Opening a new tab while another session is streaming previously showed the "Stop" button in the new (idle) tab. Root cause: `createNewTab()` called only `switchToTab()` (which only applies CSS `active` class to the tab panel) without calling `updateSendButton()`. The send button therefore retained whatever streaming state the previously-active tab had left. Fix: explicit `updateSendButton()` call added to `createNewTab()` immediately after `switchToTab`.

## Context Usage Singleton (v0.2.16)

Context usage was visible in two places simultaneously — the per-tab `.context-monitor` bar (inside each `tab-panel`) and the `#context-usage` status strip below the tab bar — because the `context_usage` message handler updated both. Additionally, switching tabs wiped the displayed usage because `SessionState` had no field to hold it between switches.

**Fix**: The canonical context usage UI is now exclusively the `#context-usage-btn` toolbar button with `#context-usage-dropdown` panel (`context-usage-dropdown.ts`). The `context_usage` and `context_window_known` handlers route only to `ctxDropdownApi.updateUsage()`. `SessionState` gains a `contextUsage: { percent, tokens, maxTokens }` field; `switchTab()` restores it on activation.

The `.context-monitor` bar remains in the DOM but stays `hidden` at all times. It should be removed in a future cleanup pass once any indirect CSS dependencies are confirmed absent.

## Tool Call Reduction

Assistant turns render all tool calls through one grouped `details.tool-group` row. The group is collapsed by default, including when the turn contains a single SDK `tool` block, and expanding it reveals the individual tool details.

Runtime SDK tool blocks can arrive as `type: "tool"`; legacy blocks may arrive as `tool_call` or `tool-call`. The webview tool type guard accepts all three shapes so canonical server history and live stream output follow the same grouped UI path.

## Conversation Timeline Snippets

Timeline snippets prefer visible text from `message.blocks`, but runtime and recovered messages may also carry text on `message.text`, `message.content`, `message.message`, or `message.parts[]`. The snippet extractor checks those fallbacks before using the generic user fallback, which prevents real user turns from showing as `Sent a message`.

## Context Status Strip

The status strip keeps separate DOM children for model, context, tokens, and cost. Context rendering updates the existing `#context-label` and `#context-progress-bar` nodes instead of replacing the whole strip with text. Zero-token sessions and unknown context windows remain hidden until useful context data is available.

## Checkpoint Panel

An empty checkpoint response leaves the panel open and shows `No checkpoints yet`. This makes the toolbar action visibly responsive even when the active session has not produced restorable checkpoints.
