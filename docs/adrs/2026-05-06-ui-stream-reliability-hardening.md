# ADR 2026-05-06: UI Stream Reliability & Persistence Hardening

## Status
Accepted

## Context
Model responses were occasionally truncated or "wiped" from the UI when a stream finalized. This occurred because the `finalizeStream` logic relied on a server-side fetch (`getSessionMessages`) to replace the live streamed content. If the server-side database had not yet committed the full message or if network latency caused a delay, the fetched "final" message would be shorter than what the user saw during streaming, leading to a visual regression (flicker or loss of text).

Additionally, certain UI elements like "Skill" indicators and specific tool statuses were not being persisted, causing them to disappear on tab switch or reload.

## Decision
We implemented a multi-layered synchronization strategy to ensure UI consistency and persistence:

1.  **Local Blocks Buffer**: Introduced a `blocksBuffer` in the `TabState` on the Extension Host. This buffer captures all `Block` objects (text, tool-calls, skills, thinking) as they are emitted during a live stream.
2.  **Fallback Finalization**: Modified `finalizeStream` in `StreamCoordinator` to use the `blocksBuffer` as the "gold standard" if the server-fetched transcript is incomplete or empty.
3.  **Skill & Tool Mapping**: Updated `partsToBlocks` to explicitly support `skill` and `skill_badge` part types, ensuring server-side history correctly maps to UI badges.
4.  **Webview State Reconciliation**: Updated the webview `handleStreamEnd` to merge server-side blocks with existing real-time blocks rather than full replacement, preserving local-only state like thinking blocks and skill indicators.

## Consequences
- **Positive**: Eliminated "message wiping" race conditions during stream finalization.
- **Positive**: Tool calls and skills now persist correctly across reloads.
- **Positive**: Improved visual stability during the transition from "Streaming" to "Idle" states.
- **Negative**: Increased memory usage per tab (negligible, but proportional to conversation length).
- **Negative**: Adds complexity to the synchronization logic between server-side truth and local-side history.
