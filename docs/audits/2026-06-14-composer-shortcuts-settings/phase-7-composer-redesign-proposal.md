# Composer UX Redesign Proposal — Phase 7 Batch 2

**Status:** Proposed, not implemented. Based on source audit + VS Code UX guidelines.

## Current architecture

The composer is well-decomposed (286 lines, 4 sub-modules):
- `sendLogic.ts` — send flow, steer mode, button state
- `inputHandlers.ts` — keyboard, paste, resize
- `queueRenderer.ts` — queue chips
- `slashCommands.ts` — slash command dispatch

Primary issues found:
1. **D5 (fixed):** Draft text unsaved between tab switches — now persisted
2. **Draft text unsaved on page reload:** `vscode.getState()` restores session state but NOT current prompt text (still open)
3. **No auto-focus on new tab:** User must click or press Ctrl+L after `createNewTab`
4. **Composer resize is capped at 200px:** `Math.min(el.scrollHeight, 200)` in inputHandlers.ts:43 — 4-5 lines max; fine for single prompts but tight for multi-line edits
5. **No drag-and-drop file reorder:** Attachment chips support drag within the chip list but not into/out of
6. **Steer-mode toggle visible only during stream:** Good — follows progressive disclosure principle

## Proposed improvements (evidence-driven)

### 1. Auto-focus prompt on new tab

**Current:** `createNewTab()` creates the tab and renders it but doesn't focus the prompt.

**Evidence:** Claude Code CLI auto-focuses the input. Cursor auto-selects the input. This is the expected behavior across the industry.

**Change:** Add `els.promptInput.focus()` at the end of `createNewTab` in `main.ts`.

**Risk:** None. Focus is a benign operation.

### 2. Dynamic placeholder text

**Current:** Static `"Ask OpenCode a question about your code…"` and streaming `"Guide the AI…"`.

**Evidence:** VS Code's own chat (GitHub Copilot Chat) shows context-aware placeholders. Cursor shows model name.

**Change:** Append model short name and stream capacity to placeholder, e.g. `"Ask about your code (claude-sonnet-4, 3/5 streams)"`.

**Risk:** String length. Placeholder must not overflow the textarea.

### 3. Auto-resize cap increase (200px → 300px)

**Current:** `Math.min(el.scrollHeight, 200)` limits the composer to ~5 lines.

**Evidence:** Claude Code CLI terminal supports effectively unlimited multi-line. Cursor's textarea grows taller. 200px is restrictive for pasting code blocks.

**Change:** Change `200` to `300` in `inputHandlers.ts:43`.

**Risk:** Takes more vertical space. Mitigation: 300px is still modest (7-8 lines max); user can always scroll.

### 4. Clear draft on message send

**Current:** Draft is saved on tab switch but never cleared on send.

**Change:** In `sendLogic.sendMessage()`, call `stateManager.setDraftText(tabId, "")` after successful send.

**Risk:** None. The webview `stateManager` reference needs threading through `sendLogic.deps`.

## Not recommended (evidence insufficient)

| Feature | Why not |
|---|---|
| Floating composer | No evidence it improves UX for sidebar webviews |
| Bottom-anchored in-message-list composer | Used by Cursor but requires full layout restructure |
| Collapsed composer | No competitor uses this in a chat sidebar |
| Inline code editor | Too complex; shift+enter is sufficient |
| Voice-first redesign | Voice is already a separate component; no need to restructure |

## Priority order

1. Auto-focus on new tab (trivial, high impact)
2. Clear draft on send (correctness, prevents stale draft)
3. Dynamic placeholder (discoverability)
4. Resize cap 200→300 (power-user ergonomics)

All four are small, low-risk changes suitable for a single follow-up commit.
