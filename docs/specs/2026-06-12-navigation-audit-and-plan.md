# Navigation, Wayfinding & Task-Flow Audit + Improvement Plan

**Date:** 2026-06-12
**Scope:** OpenCode Harness VS Code extension — all navigation surfaces (host + webview)
**Research inputs:** VS Code Extension UX Guidelines (overview, command palette), Webview
extension guide (persistence, a11y, theming), when-clause context key reference, command
naming conventions, navigation patterns observed in Cline/Roo/Copilot Chat-class tools.

---

## Phase 1 — Current-State Map

### 1.1 Extension surfaces

| Surface | What exists today |
|---|---|
| Activity Bar | One container `opencode-harness` with a single webview view `opencode-harness.chat` |
| Webview (sidebar) | Entire product: custom tab bar (sessions), status strip, message list, composer, side region (Todos / Activity / Commands / Subagents), 8+ modals/dropdowns, welcome view |
| Commands | 38 commands, all prefixed `OpenCode:`; 5 hidden from palette via `when: false` |
| Keybindings | 12 contributions; webview adds ~30 more internal shortcuts via raw `keydown` listeners |
| Status Bar | Connection item (left, → `openChat`), Methodology item (right, → settings) |
| Quick Picks | `listSessions`, `chooseHistorySession`, `deleteSession`, `renameSession`, `selectModel`, export, rollback |
| Context menus | editor (explain/refactor/tests/add-selection), explorer (add file) |
| Editor tabs | Subagent detail "popout" webview; diffs via VS Code diff editor (DiffAcceptService) |
| URI handler | `?prompt=` deep link → focuses chat + prefills |
| Settings | `opencode.*` (~35 keys) |

### 1.2 In-webview navigation model

- **Sessions = custom tabs** rendered by `tabs.ts` (APG tabs pattern, arrow keys OK).
  Host mirror: `TabManager` (max tabs, per-tab `isStreaming`, `onStreamingStateChanged`).
- **Side region** (`sideRegion.ts`): one right-hand panel hosting 4 tab panes; persists last
  pane in `sessionStorage`; pin button suppresses close; Escape closes (own listener).
- **Subagents**: list pane → nested detail view (`subagentDetailView.ts`) with Back/Close/
  Popout. Back returns to list; "Open session" can open the child session as a chat tab.
- **Welcome view**: standalone screen when no sessions; continue/new/recent/starters.
- **Focus reconciliation** (`sessionFocus.ts`): webview owns the visible tab; host active-id
  is only a hint; streaming sessions never steal the visible tab. (Good — keep.)
- **Scroll**: per-session scroll positions persisted in webview state; jump-to-bottom button;
  timeline + scroll markers for in-session navigation.
- **State**: `vscode.getState/setState` with schema version + migration; sessions also in
  `globalState` host-side; open tabs restored on reload. (Good — keep.)

### 1.3 Core journeys (clicks as measured in code today)

| Journey | Today | Target |
|---|---|---|
| New session | 1 (tab `+` / Ctrl+Alt+N / welcome btn) | ✅ ≤2 |
| Resume last session | 1 (welcome Continue / palette) | ✅ |
| Switch session (open tab) | 1 click / Ctrl+Alt+] | ✅ |
| Switch session (not open) | History modal → search → click (3+) — palette `listSessions` is a **dead end** (see P1) | ≤2 |
| Jump to the session that is currently running | **No path** — must visually scan tab bar for pulsing dot | 1 action |
| Return from subagent detail → main chat | Back→list, Close→? (panel stays) — chat never refocused | 1 action |
| Open latest diff / changed file | Changed-files strip → dropdown → file (2–3, mouse-only) | ≤2, keyboard |
| Answer a pending model question | Question bar visible only on that session's tab; from another tab **no indicator** | 1 action |
| Switch plan/build/auto | 1–2 (dropdown or Ctrl+Shift+M cycle) | ✅ |
| Stop a run | Stop button / Esc / Ctrl+Shift+Esc | ✅ but Esc is unsafe (P0) |

### 1.4 Pain points found (evidence-based)

**P0 — Escape is destructive and uncoordinated.**
`package.json` binds plain `escape` → `opencode-harness.stop` (`focusedView == 'opencode-harness.chat'`).
The webview separately implements Escape in **12+ independent listeners** (session modal,
skills modal, shortcuts modal, commands modal, side region, subagent detail, settings menu,
mode/model dropdowns, search bar, instructions editor, context-usage + changed-files
dropdowns, mentions/slash autocomplete). Most do **not** `preventDefault()`, so an Escape
meant to close an overlay can also reach the host keybinding and **abort the running
stream** — closing a dropdown can cancel your task. Multiple document-level listeners also
fire on the same press (side region + subagent detail close simultaneously). There is a
shortcut registry (`keyboardShortcuts.ts`) with `skipInModal` semantics, but it is **dead
code** — `main.ts` uses its own raw listener.

**P1 — `OpenCode: View Sessions` is a navigation dead end.**
`registerListSessionsCommand` calls `sessionStore.setActive(id)` and shows a toast, but
never opens the session in the webview nor reveals the chat view. Picking a session from
the palette visibly does nothing.

**P2 — No "what is running / what needs me" wayfinding outside the active tab.**
Streaming is shown only as a pulsing dot on the in-webview tab. No status-bar indicator,
no command to jump to the running session, no cross-tab indicator for pending questions
or permission requests. With 3+ tabs the user must scan.

**P3 — Keybinding conventions violated** (per VS Code UX guidelines "don't overwrite
existing keyboard shortcuts"):
- `F1` hijacked inside chat view (F1 = VS Code Show All Commands).
- `Ctrl+I` global-ish (`editorTextFocus`) collides with VS Code/Copilot inline chat.
- In-webview `Ctrl+W` / `Ctrl+T` / `Ctrl+Tab` shadow core editor muscle memory while the
  webview has focus (lower risk; webview-scoped; documented).

**P4 — Focus restoration gaps (WCAG 2.4.3 / 2.4.11).**
- Keyboard-shortcuts modal: no focus trap, and closing does not return focus to invoker.
- Subagent detail Back/Close: focus is dropped on body; no return to the originating card.
- Several icon-button overlays close on outside click without restoring focus.
Session modal does this correctly (`lastFocus` + trap) — the pattern exists but isn't shared.

**P5 — Hidden critical actions.** Todos/Activity/Commands/Subagents toggles live in the
"More options" gear menu (2 actions + discoverability cost) while header has spare room.
Subagent badge is inside the menu, so a running subagent is invisible until opened.

**P6 — Duplicated/ambiguous commands in palette.** `View Sessions` vs `Open Past Session`
vs `Open Stored Session` vs `Continue Last Session` vs `Continue Most Recent Session` —
five session-resumption entries with overlapping names; two ("Open Stored Session")
require arguments and shouldn't be palette-visible.

**P7 — Side-region pane state uses `sessionStorage`** — survives hide (retainContext) but
not webview reloads, while everything else persists via `getState`. Minor inconsistency.

### 1.5 What must not break (compat contract)

- All 38 command IDs; settings keys; `globalState` keys (`opencode-sessions.v*`,
  `opencode-server-port`, open-tabs key); webview state schema v1; SSE/streaming flow;
  message contract (`tests/webview/message-contract.test.ts`); activation behavior.

---

## Phase 2 — Improvement Plan

Each item: problem → change → files → tests → rollback. Priorities: **I**mmediate,
**S**hort-term, **L**ong-term.

### I-1. Central Escape coordinator (fixes P0) — IMPLEMENTED
- **Change:** New pure module `escapeCoordinator.ts`: ordered overlay registry
  `{id, isOpen(), close()}` + `resolveEscapeAction()` returning `close-overlay | stop-stream
  | none`. One document-level listener (registered first, checks `e.defaultPrevented`)
  closes exactly the topmost open overlay per press and calls
  `preventDefault()+stopPropagation()` so the host keybinding never double-fires.
  When nothing is open and the active session is streaming, Escape posts `abort`
  (preserves documented "Esc = stop") — now *only* then.
- **Keybindings:** remove host `escape→stop` (replaced in-webview; `Ctrl+Shift+Escape`
  retained as the always-on stop), remove `F1` hijack (`Ctrl+Shift+/` retained).
- **Files:** `src/chat/webview/escapeCoordinator.ts` (+ co-located test), `main.ts` wiring,
  `package.json`, shortcuts modal table.
- **A11y:** single predictable Escape per WCAG; focus restoration handled by each close fn.
- **Rollback:** delete wiring call + restore 2 keybinding entries.

### I-2. "Jump to Running Session" + status-bar running indicator (fixes P2) — IMPLEMENTED
- New command `opencode-harness.jumpToRunningTask` ("OpenCode: Jump to Running Session"):
  0 streaming → info toast; 1 → reveal chat view + open that session; >1 → Quick Pick.
  Pure selection helper + tests. Status bar shows `$(sync~spin) OpenCode: N running` while
  streams are active (existing connection item, no new item).
- **Files:** `package.json`, `src/commands/runningTask.ts` (+test), `extension.ts`,
  `ChatProvider` (expose streaming tabs), `statusBarTooltips.ts`.
- **Rollback:** unregister command; status text falls back to connected/disconnected.

### I-3. Fix `View Sessions` dead end; make it the real switcher (fixes P1, P6) — IMPLEMENTED
- `listSessions` now opens the picked session in the webview and reveals the chat view;
  items get active marker (`$(check)`), streaming marker (`$(sync~spin)`), MRU sort,
  relative time. Pure item-builder + tests. Command title stays; ID stays.
- Hide argument-only `openStoredSession` from palette (`when: false`) — it is an API
  command, not a user entry point. (ID kept; behavior kept.)
- **Rollback:** revert to `setActive`-only body.

### I-4. Focus trap + restoration for keyboard-shortcuts modal; subagent detail focus
return (fixes P4 worst cases) — IMPLEMENTED
- Shortcuts modal: reuse `focus-trap.ts`, save/restore invoker focus.
- Subagent detail Back/Close: focus returns to the subagent list pane / originating card.
- **Rollback:** isolated per-component diffs.

### S-1. Promote side-panel toggles out of the gear menu; surface subagent badge on the
header (P5). Add `aria-keyshortcuts` to toggles.
### S-2. Pending-question / permission cross-tab indicator: badge on the session tab + new
command "OpenCode: Answer Pending Question" that jumps to the oldest unanswered question.
### S-3. "OpenCode: Open Latest Diff" command — host tracks last `FileEditHandler` event per
session; command opens VS Code diff editor for the most recent change.
### S-4. Migrate side-region pane state from `sessionStorage` to webview `getState` (P7).
### S-5. Consolidate session-resumption commands: keep all IDs, but re-title for clarity
("View Sessions" → switcher; "Open Past Session" → history import) and group with
`category: "OpenCode"`.
### S-6. Adopt the existing `keyboardShortcuts.ts` registry for all in-webview shortcuts
(delete the parallel raw listener), giving uniform `skipInModal`/`skipInTextInput`.
### S-7. Breadcrumb header inside side region: `Subagents › <name>` while in detail view.

### L-1. Re-evaluate `Ctrl+I` and in-webview `Ctrl+W/T/Tab` overrides behind a
`opencode.keybindingProfile` setting (`classic | conservative`).
### L-2. Tree View for sessions/subagents in the Activity Bar container (native VS Code
hierarchy, drag-out, context menus) as a complement to the in-webview tab bar.
### L-3. Deep-link-safe route model: serialize "current surface" (tab, side pane, detail id)
into webview state so reload restores exact location, not just active tab.
### L-4. `setContext` keys (`opencode.isStreaming`, `opencode.hasPendingQuestion`) to drive
conditional keybindings and `enablement` on commands like Stop/Retry.

### Measurable goals (post-implementation)
- Switch to any session (open or stored): ≤2 actions, keyboard-only. ✅ (I-3)
- Find/jump to the running session: 1 action. ✅ (I-2)
- Escape never cancels a run unless nothing else is open. ✅ (I-1)
- All modal close paths restore focus to invoker. ✅ shortcuts modal; remaining in S-tier.
