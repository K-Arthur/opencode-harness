# Modern AI Coding Assistant UI/UX Patterns Research Report

**Date:** 2026-06-06
**Project Context:** OpenCode Harness VS Code Extension
**Research Scope:** 7 major AI coding tools + VS Code extension UX best practices

---

## Executive Summary

Modern AI coding assistants have converged on a **chat-centric, mode-switching, approval-gated** interaction model. The most successful tools (Cursor, Claude Code, Codex) share common DNA: a prominent message composer, progressive disclosure of secondary actions, contextual approval flows for file changes, and keyboard-heavy power-user workflows. **Button overload is the primary anti-pattern**—the best tools hide complexity behind modes, slash commands, and contextual menus while keeping the primary surface ruthlessly clean.

**Key insight:** The "autonomy slider" (Andrej Karpathy's term) is the defining UX metaphor—users must fluidly adjust how much independence the AI has, and the UI must make this adjustment feel natural, not frightening.

---

## 1. Tool-by-Tool Analysis

### 1.1 Claude Code (Anthropic)

**Surface Coverage:** Terminal CLI, VS Code Extension, Desktop App, Web, JetBrains Plugin, iOS

**Primary Actions (Always Visible):**
- Message input/composer (bottom of panel)
- Send button
- Mode indicator (Plan vs Act in VS Code extension)
- @-mention trigger for file context

**Secondary Actions (Hidden/Progressive):**
- Slash commands (`/review`, `/schedule`, `/desktop`, `/loop`) — typed, not buttons
- Settings via `/` menu or config files
- MCP server management — configured in files, not UI
- Model switching — via commands or dropdown
- Subagent spawning — via natural language ("spawn an agent to...")
- Auto-approve toggles — per-session, not global UI

**File Changes/Diffs:**
- CLI: Syntax-highlighted diffs in TUI with inline approval prompts (Y/n/always)
- VS Code: Inline diffs in editor, plan review mode for multi-file changes
- Desktop: Visual diff review with side-by-side comparison
- **Pattern:** Diff is shown *in context* — either in the terminal flow or the editor itself, never in a separate modal

**Mode Switching:**
- **Plan Mode:** Explores codebase, asks clarifying questions, lays out strategy. No files changed.
- **Act Mode:** Executes the plan. Every file edit and terminal command requires approval unless auto-approve is enabled.
- **Toggle:** Simple switch or command, often with visual distinction (different color or label)

**Tool Calls & Approvals:**
- Every tool call surfaces an approval prompt inline
- Options: Yes / No / Yes to all (for similar operations in this session)
- Hooks system: auto-format after edit, run lint before commit
- **Key pattern:** Approval is **interruptive but lightweight** — stops the flow but doesn't break it

**Keyboard Strategy:**
- `Ctrl+C` — abort current operation
- `Tab` — queue follow-up text/commands while AI is running
- `Enter` — inject instructions into current turn
- `Ctrl+G` — open external editor for long prompts
- `Ctrl+O` — copy latest output
- `Ctrl+R` — search prompt history
- `Up/Down` — navigate draft history
- `Esc` (×2) — edit previous message

**What Creates Clutter vs Clean:**
- **Clean:** The TUI is mostly chat history. Controls appear *only when needed* (approval prompts, plan review).
- **Clutter avoided:** No persistent button bars. No settings panels in the main view. Even model switching is a command, not a dropdown.

---

### 1.2 Cursor (cursor.com)

**Surface Coverage:** Desktop IDE (VS Code fork), Composer panel, Tab completion, CLI, Cloud Agents, Slack integration

**Primary Actions (Always Visible):**
- Composer input (bottom of right sidebar)
- Build / Plan tabs in Composer 2.5
- Model selector (dropdown in composer header)
- @-mentions and /-commands in input
- `Cmd+K` inline edit trigger (when editor text is selected)

**Secondary Actions (Hidden/Progressive):**
- Cursor Rules — configured in `.cursorrules` files, surfaced via @-mention
- Agent mode settings — behind gear icon or command palette
- Cloud agent delegation — "Run in Cloud" button appears contextually
- History — accessed via sidebar or keyboard
- Settings — command palette or gear menu
- Skills / MCP — installed via marketplace, invoked by name

**File Changes/Diffs:**
- Inline diff view in editor (green/red gutters)
- Composer shows file change summaries with "Accept" / "Reject" per file
- Multi-file changes grouped by task
- **Pattern:** Diff is **editor-native**, not webview-rendered. This feels faster and more trustworthy.

**Mode Switching:**
- **Ask Mode:** Chat only, no file changes
- **Agent Mode:** Full autonomy, file edits + commands
- **Auto Mode:** Smart delegation between Tab and Agent
- **Toggle:** Dropdown in composer header or keyboard shortcut
- **Visual:** Mode changes the composer header color/label subtly

**Tool Calls & Approvals:**
- Agent mode shows "thinking" steps with expandable details
- File edits require explicit accept (unless auto-accept is configured)
- Terminal commands run in integrated terminal with output streaming back to composer
- **Pattern:** Tool output is **collapsible** — visible but not verbose by default

**Keyboard Strategy:**
- `Cmd+K` — inline edit (the "magic" shortcut)
- `Cmd+L` — focus composer
- `Cmd+I` — quick chat (floating panel)
- `Cmd+Enter` — submit in composer
- `Tab` — accept autocomplete suggestion
- `Cmd+Shift+P` — command palette for everything else

**What Creates Clutter vs Clean:**
- **Clean:** Composer is a single text area. Mode is one dropdown. The IDE chrome handles the rest.
- **Clutter avoided:** No persistent status bars in composer. No "stop" button visible when not streaming. Cloud agents are a contextual option, not a top-level button.
- **Note:** Cursor's homepage explicitly advertises an "autonomy slider" — this is their core UX metaphor.

---

### 1.3 Cline (cline.bot)

**Surface Coverage:** VS Code Extension, CLI, JetBrains Plugin, Kanban board

**Primary Actions (Always Visible):**
- Task input area (large textarea)
- Plan / Act mode toggle (prominent switch/button)
- Send / Execute button
- Token usage counter (visible but small)

**Secondary Actions (Hidden/Progressive):**
- API provider settings — behind settings gear
- MCP server management — expandable section
- Checkpoints (Compare / Restore) — contextual buttons after actions
- Browser automation controls — appear only when relevant
- Auto-approve toggles — per-tool-type checkboxes in settings
- Task history — accessible via sidebar or dropdown

**File Changes/Diffs:**
- Diff view opens in editor tab for each file change
- "Edit or revert Cline's changes directly in the diff view editor"
- Timeline integration — all changes recorded in file Timeline for easy revert
- Checkpoints: snapshots at each step with Compare and Restore buttons
- **Pattern:** Changes are **first-class editor citizens**, not webview second-class.

**Mode Switching:**
- **Plan Mode:** Cline explores codebase, asks questions, lays out strategy. No edits.
- **Act Mode:** Executes plan. Every action requires approval unless auto-approve is on.
- **Toggle:** Explicit button/switch in the chat panel header
- **Visual:** Often color-coded or with distinct icons

**Tool Calls & Approvals:**
- Every file change and terminal command shows an approval card
- "Proceed While Running" button for long-running processes (dev servers)
- Auto-approve options: Read files, Edit files, Run commands, Use browser
- **Pattern:** Approval is **granular per tool type**, not just on/off.

**Keyboard Strategy:**
- Heavy reliance on VS Code native shortcuts
- No custom shortcut ecosystem — leverages command palette

**What Creates Clutter vs Clean:**
- **Clean:** The single Plan/Act toggle is the dominant control. Everything else is contextual.
- **Clutter risk:** Cline shows token usage and cost prominently, which can feel noisy. The approval cards stack up in the chat history.
- **Mitigation:** Checkpoints are hidden until needed. Browser controls only appear for web tasks.

---

### 1.4 Codex / OpenAI

**Surface Coverage:** CLI (TUI), IDE Extension (VS Code, Cursor, Windsurf, JetBrains), Web, GitHub/Slack/Linear integrations

**Primary Actions (Always Visible):**
- Composer input (bottom of panel)
- Model switcher (under chat input)
- Approval mode switcher: Chat / Agent / Agent (Full Access)
- @-mentions for files
- Send button

**Secondary Actions (Hidden/Progressive):**
- Reasoning effort selector (low/medium/high) — nested in model switcher
- Cloud delegation — "Run in the cloud" contextual button
- Slash commands — `/review`, `/fork`, `/side`
- Theme selector (`/theme`) — for CLI TUI
- Settings — config file or IDE settings panel
- Image generation — invoked via `$imagegen` or natural language

**File Changes/Diffs:**
- IDE extension: Shows changes in chat panel with apply/dismiss actions
- CLI: Syntax-highlighted markdown diffs in TUI
- Cloud tasks: Preview changes locally before applying
- **Pattern:** Codex emphasizes **review before apply** — you see the diff, then choose to apply it locally.

**Mode Switching:**
- **Chat:** Conversational only, no file edits
- **Agent:** Read files, make edits, run commands in working directory. Asks before network/outside-scope actions.
- **Agent (Full Access):** Network access, cross-machine operations. Requires explicit opt-in.
- **Toggle:** Dropdown under chat input in IDE; `/permissions` in CLI
- **Visual:** Mode label is prominent but not aggressive

**Tool Calls & Approvals:**
- Agent mode surfaces approval prompts for out-of-scope actions
- Full Access mode removes most approvals (dangerous operations still warn)
- Subagents spawn only on explicit request
- **Pattern:** Approval modes are **session-level safety rails**, not per-action interruptions.

**Keyboard Strategy:**
- `Ctrl+Enter` — inject instructions into current turn
- `Tab` — queue follow-up input for next turn
- `Ctrl+G` — open external editor for long prompts
- `Ctrl+O` — copy latest output
- `Ctrl+R` — search prompt history
- `Esc` (×2) — edit previous message
- `!` prefix — run local shell command

**What Creates Clutter vs Clean:**
- **Clean:** Two switchers (model + approval mode) under one dropdown area. Minimal chrome.
- **Clutter avoided:** No persistent "stop" button. No separate panels for settings. Even cloud delegation is contextual.

---

### 1.5 Windsurf / Devin Desktop (codeium.com/windsurf)

**Surface Coverage:** Desktop IDE (VS Code fork), Cascade panel, CLI

**Primary Actions (Always Visible):**
- Cascade chat panel (right sidebar)
- "New Project" button (on welcome screen)
- Send button in Cascade
- Settings button (bottom right of IDE)

**Secondary Actions (Hidden/Progressive):**
- MCP server configuration — via settings panel
- Memories / Rules — separate sections in settings
- Workflows — automation section, not main UI
- App Deploys — one-click but contextual
- Terminal — upgraded but standard IDE terminal
- Command palette (`Cmd+Shift+P`) — primary navigation

**File Changes/Diffs:**
- Cascade shows file changes in chat flow
- Diff review in editor tabs
- **Pattern:** Less emphasis on diff presentation than Cursor/Cline; more on "trust the agent"

**Mode Switching:**
- Windsurf historically had **Write** vs **Chat** modes in Cascade
- Newer versions emphasize Devin Local agent with less explicit mode switching
- **Pattern:** Mode is becoming more implicit — the agent decides whether to chat or act based on prompt

**Tool Calls & Approvals:**
- Less prominent approval UI than competitors
- Emphasizes "flow state" — fewer interruptions
- **Pattern:** Windsurf errs on the side of **less friction**, which is a product positioning choice, not necessarily a UX best practice.

**Keyboard Strategy:**
- `Cmd+Shift+P` — command palette (heavily emphasized)
- VS Code native shortcuts preserved
- `Cmd+K` — likely reserved for inline edits (competing with Cursor)

**What Creates Clutter vs Clean:**
- **Clean:** Cascade is a simple chat panel. The IDE handles the rest.
- **Clutter risk:** Settings panel has many sections (MCP, Memories, Workflows, Deploys). Can feel overwhelming.
- **Mitigation:** Good onboarding flow imports VS Code/Cursor settings to reduce initial configuration burden.

---

### 1.6 Kilo Code (kilo.ai)

**Surface Coverage:** VS Code Extension, JetBrains Plugin, CLI, Slack, Cloud

**Primary Actions (Always Visible):**
- Chat input
- Mode selector (Architect / Coder / Debugger / Custom)
- Model selector
- Send button
- Inline autocomplete suggestions (as you type)

**Secondary Actions (Hidden/Progressive):**
- MCP Server Marketplace — discoverable but not front-and-center
- API key management — in settings
- Custom modes — user-defined, accessed via dropdown
- `--auto` flag for CI/CD — CLI only
- Task automation — invoked via chat

**File Changes/Diffs:**
- Standard diff view in editor
- File creation/editing in chat flow
- **Pattern:** Similar to Cline but with more emphasis on multi-mode specialization

**Mode Switching:**
- **Architect:** Planning mode, no code generation
- **Coder:** Code generation and editing
- **Debugger:** Debugging and error fixing
- **Custom:** User-defined modes with specific instructions
- **Toggle:** Dropdown in panel header
- **Visual:** Mode cards or dropdown with descriptions

**Tool Calls & Approvals:**
- Approval required for actions (similar to Cline)
- Auto-mode available for trusted environments
- **Pattern:** Explicit approval with optional auto-override

**What Creates Clutter vs Clean:**
- **Clean:** Mode specialization reduces the need for verbose instructions.
- **Clutter risk:** 500+ model support means a huge model dropdown. Custom modes can proliferate.
- **Mitigation:** Marketplace is separate from main UI. CLI `--auto` keeps automation out of the GUI.

---

### 1.7 VS Code Extension UX Best Practices (Official Guidelines)

**Core Principles:**
1. **Native over Webview:** Use tree views, custom editors, and native panels before resorting to webviews
2. **Themeable:** All UI must respect VS Code color tokens
3. **Accessible:** ARIA labels, keyboard navigation, color contrast
4. **Contextual:** Actions should appear where they are relevant (context menus, not global toolbars)
5. **Progressive Disclosure:** Don't show all options at once

**Key Patterns for AI Extensions:**
- **Activity Bar:** Contribute an icon that opens a sidebar view (Views container)
- **Sidebar:** Primary surface for chat/history. Can be moved to secondary sidebar.
- **Editor Actions:** Icon buttons in editor toolbar for contextual actions (accept diff, etc.)
- **Command Palette:** All global commands must be accessible here
- **Quick Picks:** For model selection, mode switching, or other single-choice flows
- **Notifications:** For errors, warnings, and completion status (don't overuse)
- **Status Bar:** For persistent but unobtrusive info (token usage, connection status)
- **Webviews:** Only when absolutely necessary. If used, must be themeable and accessible.

**Do / Don't:**
- ✅ Use command actions in toolbars and views
- ✅ Use icons for clear metaphors
- ✅ Provide thoughtful icons that differentiate items
- ❌ Use webviews for promotions, wizards, or settings
- ❌ Open webviews on every window or extension update
- ❌ Add unrelated functionality
- ❌ Repeat existing functionality

---

## 2. Cross-Tool Pattern Analysis

### 2.1 Primary vs Secondary Action Hierarchy

| Primary (Always Visible) | Secondary (Hidden/Contextual) |
|---|---|
| Message composer input | Settings, configuration |
| Send/Submit button | Model management (often dropdown) |
| Mode switcher (if applicable) | History / past sessions |
| Stop/Abort (when streaming) | MCP/skills management |
| @-mention / context add | Token usage details (expandable) |
| | Keyboard shortcuts reference |
| | Theme/customization |
| | Export / share |

**Insight:** The most successful tools (Cursor, Codex) have **only 3-4 persistent controls** in the main panel: input, send, mode, model. Everything else is a command, shortcut, or contextual menu.

### 2.2 File Changes / Diff Presentation Patterns

| Tool | Diff Location | Approval Style |
|---|---|---|
| Claude Code | Editor inline / TUI inline | Per-action Y/n/always |
| Cursor | Editor gutters + composer summary | Per-file accept/reject |
| Cline | Editor diff tabs | Per-action with auto-approve options |
| Codex | Chat panel + editor | Per-action or mode-based |
| Windsurf | Chat panel + editor | Less prominent / more implicit |
| Kilo Code | Editor standard diff | Per-action |

**Best Practice:** Show diffs **in the editor**, not in a webview or chat panel. This leverages the user's existing mental model of code review and feels more trustworthy.

### 2.3 Mode Switching Patterns

| Tool | Modes | UI Pattern |
|---|---|---|
| Claude Code | Plan / Act | Toggle switch or command |
| Cursor | Ask / Agent / Auto | Dropdown or tabs |
| Cline | Plan / Act | Toggle button |
| Codex | Chat / Agent / Full Access | Dropdown |
| Windsurf | Chat / Write (legacy) | Implicit or toggle |
| Kilo Code | Architect / Coder / Debugger / Custom | Dropdown |

**Best Practice:** Mode switcher should be **one control**, not multiple. If you have plan/build/auto, use a segmented control or single dropdown. Don't split mode across multiple UI elements.

### 2.4 Tool Call & Approval Patterns

| Pattern | Used By | When to Use |
|---|---|---|
| Inline approval card | Claude Code, Cline, Codex | Per-action, high-safety environments |
| Mode-based auto-approval | Codex, Cursor | Medium-safety, trusted repos |
| Full auto + audit log | Windsurf | Low-friction, high-trust environments |
| Granular per-tool approval | Cline | When different tools have different risk levels |

**Best Practice:** Default to **ask**, allow **mode-based escalation**. Never default to full auto-approve. The approval UI should be lightweight (one-click) and not modal (inline in the flow).

### 2.5 Keyboard Shortcut Strategy

| Shortcut | Tool | Purpose |
|---|---|---|
| `Cmd/Ctrl+Enter` | Universal | Send message |
| `Cmd/Ctrl+K` | Cursor, others | Inline edit / command palette |
| `Cmd/Ctrl+L` | Cursor, Codex | Focus chat input |
| `Esc` | Universal | Close modal, cancel, stop streaming |
| `Tab` | Codex, Claude | Queue follow-up / accept autocomplete |
| `Cmd/Ctrl+Shift+P` | VS Code native | Command palette |
| `Cmd/Ctrl+1/2/3` | Custom | Steer modes (interrupt/append/queue) |

**Best Practice:** Follow VS Code conventions. Don't reinvent shortcuts that VS Code already owns. Provide command palette access to all features.

---

## 3. Visual Clutter Analysis

### 3.1 What Creates Clutter

1. **Persistent button bars with >3 buttons**
   - Bad: Send, Stop, Clear, Settings, History, New Session, Model, Mode, Tokens, MCP, Skills all as visible buttons
   - Good: Send, Mode, Model visible. Everything else behind `...` menu or keyboard shortcut.

2. **Multiple panels visible simultaneously**
   - Bad: Chat panel + Todos panel + Changed files panel + Context usage panel + Activity panel all open
   - Good: One main panel, others as dropdowns or tabs.

3. **Verbose status indicators**
   - Bad: "Connected to Claude Sonnet 4.2 via AWS Bedrock | Tokens: 4,231/200K | Cost: $0.42 | Mode: Build | 3 files changed | 2 tasks pending"
   - Good: Mode badge + expandable token/cost indicator.

4. **Modal dialogs for frequent actions**
   - Bad: Confirmation dialog every time you switch mode
   - Good: Inline confirmation or no confirmation for reversible actions.

5. **Redundant controls**
   - Bad: "New Session" button in toolbar AND menu AND welcome screen AND keyboard shortcut
   - Good: One primary entry point, others as accelerators.

### 3.2 What Stays Clean

1. **Chat-centric layout**
   - 80% of the panel is message history
   - 15% is input area
   - 5% is chrome (mode, model, minimal toolbar)

2. **Contextual action buttons**
   - "Accept" / "Reject" only appear on diff blocks
   - "Stop" only appears while streaming
   - "Proceed While Running" only appears for long commands

3. **Icon-only buttons with tooltips**
   - Settings gear icon instead of "Settings" text
   - History clock icon instead of "Session History" text
   - + icon for new session

4. **Collapsible sections**
   - Thinking blocks collapsed by default (with global toggle)
   - Tool call details collapsed by default
   - File change summaries expandable

5. **Keyboard-first power user paths**
   - `/` for commands
   - `@` for mentions
   - `!` for shell
   - `Cmd+Shift+P` for everything else

---

## 4. Actionable UX Recommendations for OpenCode Harness

### 4.1 Immediate Priority: Reduce Button Overload

**Current State (Inferred):**
Based on the project structure, OpenCode Harness has many UI modules: mode dropdown, model dropdown, settings menu, commands modal, skills modal, session modal, theme customizer, token cost display, attachments, welcome view, changed files dropdown, context usage dropdown, todos panel, tasks panel, activity panel, subagent panel, checkpoint panel, queue panel, thinking toggle, scroll markers, search, voice input, display toggles, etc.

**Risk:** This is a high clutter surface.

**Recommendations:**

#### R1. Adopt the "3-Button Rule" for the Main Toolbar
**Keep visible:**
1. **Mode Switcher** (Plan/Build/Auto dropdown or segmented control)
2. **Model Switcher** (dropdown with current model name)
3. **Overflow Menu** (`...` icon containing: Settings, History, New Session, Theme, Skills, MCP, etc.)

**Hide everything else:** Behind the overflow menu, keyboard shortcuts, or contextual appearance.

#### R2. Make the Input Area the Hero
- Input textarea should be 40-50% of the bottom chrome height
- Send button should be the most prominent visual element (primary color)
- Stop button should replace Send only while streaming (same position, different color)
- Secondary input actions (attach, mention, voice) should be icon-only, small, below or beside the input

#### R3. Contextual Panel System
Instead of always-visible panels, use a **tabbed or dropdown panel system**:
- Main tab: Chat history
- Secondary tabs (appear only when relevant): Todos, Changed Files, Activity, Subagents
- Don't show empty panels. If there are no todos, hide the todos tab.

#### R4. Collapsible Message Metadata
- Thinking blocks: collapsed by default, with a global "Show All Thinking" toggle in overflow menu
- Tool calls: show "Used 3 tools" with expand arrow, not full tool output
- Token usage: show compact bar (e.g., `██████░░ 62%`), expand on hover/click for details
- Cost: show only if configured, in muted color

#### R5. Diff Integration Strategy
- **Preferred:** Use VS Code's native diff editor. Open file changes as editor tabs, not webview blocks.
- **Fallback:** If webview diff is necessary, make it a collapsible block in the chat with "Open in Editor" button.
- **Approval:** Inline accept/reject buttons on diff blocks, not modal dialogs.

#### R6. Approval Flow Redesign
- Use **inline cards** in the chat flow, not popups
- Card shows: Tool name, brief description, "Allow" / "Deny" / "Always allow this tool" buttons
- Don't break the stream — queue the approval request but continue showing AI output above it

#### R7. Keyboard Shortcut Audit
Ensure these work and are discoverable:
- `Cmd/Ctrl+Enter` — Send
- `Cmd/Ctrl+L` — Focus input
- `Esc` — Stop streaming / Close modal / Clear selection
- `Cmd/Ctrl+Shift+P` — Open commands palette
- `Cmd/Ctrl+Alt+1/2/3` — Plan/Build/Auto mode switch (as already documented)
- `Alt+Shift+Tab` — Cycle mode (as already documented)
- `Cmd/Ctrl+K` — Open commands palette (if not conflicting)
- `Up/Down` in input — Navigate history (not multiline unless Shift is held)

#### R8. Progressive Disclosure for Settings
- **Level 1 (Visible):** Mode, Model, Send
- **Level 2 (Overflow Menu):** New Session, History, Settings, Theme
- **Level 3 (Settings Panel):** API keys, MCP servers, Auto-approve rules, Custom instructions, Keyboard shortcuts
- **Level 4 (Config Files):** Advanced hooks, skills definitions, `.opencode` project config

#### R9. Status Bar Integration
Move non-urgent persistent info to the VS Code **Status Bar**:
- Connection status (icon only)
- Token usage percentage (compact)
- Current mode (optional — if mode switcher is always visible, this is redundant)
- Cost (if enabled, compact)

**Never put in status bar:** Action buttons (send, stop, clear), chat history, error messages.

#### R10. Onboarding & Empty States
- **Welcome view:** Show only when no active session. Include: New Session button, Recent sessions list, Quick tips (3-4 keyboard shortcuts), Link to docs.
- **Empty chat:** Show suggested prompts or capabilities, not a blank screen.
- **First-run:** Highlight the mode switcher and approval flow with subtle tooltips or coach marks.

---

### 4.2 Specific Control Placement Recommendations

| Control | Recommended Location | Visibility |
|---|---|---|
| Mode Switcher | Header of chat panel, left side | Always |
| Model Switcher | Header of chat panel, right side | Always |
| Send Button | Bottom right of input area | Always |
| Stop Button | Same position as Send (replaces it) | Only while streaming |
| Attach/Image | Below input, left side | Always |
| @ Mention | Below input, left side | Always |
| Token/Cost | Below input, right side or status bar | Always (compact) |
| Settings | Overflow menu (`...`) or gear icon | Always |
| New Session | Overflow menu + keyboard shortcut | Hidden |
| Session History | Overflow menu or sidebar tab | Hidden |
| Clear Chat | Overflow menu | Hidden |
| Theme | Overflow menu → Settings | Hidden |
| Skills | Slash command or overflow menu | Hidden |
| MCP | Settings panel only | Hidden |
| Todos | Panel tab (appears when todos exist) | Contextual |
| Changed Files | Panel tab or dropdown | Contextual |
| Checkpoints | Contextual buttons in chat | Contextual |
| Activity | Panel tab | Contextual |
| Subagents | Panel tab or modal | Contextual |
| Thinking Toggle | Overflow menu or `Cmd+Shift+T` | Hidden |
| Search | `Cmd/Ctrl+F` | Hidden |
| Voice Input | Microphone icon in input area | Always (if enabled) |

---

### 4.3 Mode Switching UX Recommendation

**Current:** Plan / Build / Auto modes

**Recommended UI:**
- Use a **segmented control** (three connected buttons) if space allows:
  `[ Plan ] [ Build ] [ Auto ]`
- Or a **dropdown** if horizontal space is limited (especially in narrow sidebar)
- Place in the **panel header**, not the input area
- Use **color coding**:
  - Plan: Blue (thinking, safe)
  - Build: Green (action, creating)
  - Auto: Purple (autonomous, powerful)
- Show **brief description on hover**:
  - Plan: "Explore and strategize without making changes"
  - Build: "Execute actions with your approval"
  - Auto: "Act autonomously based on trust settings"

**Anti-patterns to avoid:**
- Don't use separate toggle + dropdown for mode
- Don't show mode description persistently (wastes space)
- Don't require confirmation to switch modes (it's reversible)

---

### 4.4 Handling File Changes (Diff UX)

**Recommended Flow:**
1. AI proposes file changes → Shows "Proposing changes to 3 files" in chat
2. User clicks "Review Changes" → Opens native VS Code diff editors for each file (or a single multi-file diff view if available)
3. In each diff:
   - "Accept" / "Reject" / "Accept All" buttons
   - "Edit in Place" option
4. After review, user returns to chat to continue

**Alternative (if native diff is not feasible):**
1. Collapsible diff block in chat
2. Syntax-highlighted diff with line numbers
3. Inline Accept/Reject per file
4. "Open in Editor" link for detailed review

**Never:**
- Show full file content in chat (too verbose)
- Use modal dialogs for approval (breaks flow)
- Auto-accept without user-configurable rules

---

### 4.5 Reducing Visual Noise: Specific Tactics

1. **Icon-Only Buttons for Secondary Actions**
   - Settings: ⚙️
   - History: 🕐
   - New Session: +
   - Clear: 🗑️
   - Search: 🔍
   - With `title` attribute for tooltip.

2. **Smart Defaults for Panels**
   - Timeline sidebar: Collapsed by default, user can pin it open
   - Todos panel: Only visible when todos exist
   - Changed files: Badge on a tab, not a persistent list
   - Activity: Log-style, collapsible, muted colors

3. **Typography Hierarchy**
   - AI messages: Normal body text
   - User messages: Slightly bolder or different background
   - System/tool messages: Muted, smaller, monospaced where appropriate
   - Error messages: Red accent, but not alarming
   - Mode indicator: Small, uppercase, letter-spaced label

4. **Color Discipline**
   - Use VS Code theme colors (`--vscode-*`) for everything
   - Only 1-2 accent colors for primary actions (Send button, mode indicator)
   - Avoid rainbow colors for different message types
   - Use opacity (not new colors) for disabled/hover states

5. **Animation Discipline**
   - Typing indicator: Subtle pulse, not bouncing
   - Message appear: 100ms fade, not slide
   - Panel open/close: 200ms ease, not spring
   - Never animate layout shifts (causes jank)

---

## 5. Implementation Roadmap

### Phase 1: Chrome Reduction (Week 1)
- [ ] Audit all visible buttons in main panel
- [ ] Implement overflow menu (`...`) for secondary actions
- [ ] Move Settings, History, New Session into overflow
- [ ] Reduce toolbar to: Mode, Model, Overflow

### Phase 2: Contextual Panels (Week 2)
- [ ] Convert Todos, Activity, Subagents to tabbed panel system
- [ ] Show tabs only when content exists
- [ ] Add "Close Panel" / hide functionality

### Phase 3: Message Streamlining (Week 3)
- [ ] Collapse thinking blocks by default
- [ ] Collapse tool call details by default
- [ ] Implement compact token/cost display
- [ ] Add expand/collapse animations

### Phase 4: Diff & Approval (Week 4)
- [ ] Integrate native VS Code diff editor for file changes
- [ ] Design inline approval cards
- [ ] Implement per-tool auto-approve settings
- [ ] Test approval flow with keyboard only

### Phase 5: Polish (Week 5)
- [ ] Keyboard shortcut audit and fixes
- [ ] Tooltip and ARIA label review
- [ ] Empty state and welcome view refinement
- [ ] Mobile/narrow sidebar responsiveness

---

## 6. Screenshot References

While I cannot embed images in this report, these are the key UI references to study:

1. **Cursor Composer 2.5:** Note the `[ Build ] [ Plan ]` tabs, minimal input chrome, and collapsible file change summaries.
2. **Codex IDE Extension:** Observe the model + approval mode switchers stacked under the input, and the clean sidebar.
3. **Cline VS Code Panel:** Study the Plan/Act toggle prominence and the diff tab integration.
4. **Claude Code TUI:** Notice how the terminal UI is 90% chat history, with controls appearing only when needed.
5. **Windsurf Cascade:** See the simple chat panel and the "New Project" button on the welcome screen.

---

## 7. Key Takeaways

1. **The composer is sacred.** The message input area and its immediate surroundings should be the most prominent, uncluttered part of the UI. Everything else is secondary.

2. **Modes are the primary organizational principle.** Plan/Build/Auto (or equivalent) should be the most visible control after the input itself. It's the "autonomy slider."

3. **Approval is a conversation, not a dialog.** Inline, lightweight approval cards that don't break the chat flow are superior to modal dialogs.

4. **Editors edit, chat chats.** File changes should be shown in the editor (native diff) whenever possible. The chat panel should summarize, not replace, the editor.

5. **Keyboard is king.** Power users live in the keyboard. Every frequent action must have a keyboard shortcut, and shortcuts should follow VS Code conventions.

6. **Hide until needed.** Todos, changed files, activity logs, thinking blocks — none of these need to be visible by default. Show them when they have content, hide them when they don't.

7. **One way to do things.** Don't provide both a button and a menu item and a keyboard shortcut and a slash command for the same action unless absolutely necessary. Make the primary path obvious and alternatives discoverable.

---

*Report compiled from official documentation, GitHub repositories, and marketplace pages of Claude Code, Cursor, Cline, OpenAI Codex, Windsurf, Kilo Code, and VS Code Extension API guidelines.*
