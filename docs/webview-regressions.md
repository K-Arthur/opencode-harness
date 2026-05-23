# Webview Regression Notes

## Tool Call Reduction

Assistant turns render all tool calls through one grouped `details.tool-group` row. The group is collapsed by default, including when the turn contains a single SDK `tool` block, and expanding it reveals the individual tool details.

Runtime SDK tool blocks can arrive as `type: "tool"`; legacy blocks may arrive as `tool_call` or `tool-call`. The webview tool type guard accepts all three shapes so canonical server history and live stream output follow the same grouped UI path.

## Conversation Timeline Snippets

Timeline snippets prefer visible text from `message.blocks`, but runtime and recovered messages may also carry text on `message.text`, `message.content`, `message.message`, or `message.parts[]`. The snippet extractor checks those fallbacks before using the generic user fallback, which prevents real user turns from showing as `Sent a message`.

## Context Status Strip

The status strip keeps separate DOM children for model, context, tokens, and cost. Context rendering updates the existing `#context-label` and `#context-progress-bar` nodes instead of replacing the whole strip with text. Zero-token sessions and unknown context windows remain hidden until useful context data is available.

## Checkpoint Panel

An empty checkpoint response leaves the panel open and shows `No checkpoints yet`. This makes the toolbar action visibly responsive even when the active session has not produced restorable checkpoints.
