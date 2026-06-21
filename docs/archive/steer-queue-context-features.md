# Implementation Prompt: Steer Prompts (Mid-Generation), Enhanced Queue, and Context Usage Counter

## Overview

Implement three interconnected features for the opencode-harness VS Code extension:
1. **Steer Prompts**: Mid-generation prompts to correct, redirect, or add context during active AI streaming
2. **Enhanced Queue Management**: Improved prompt queue with visibility, reordering, and batch operations
3. **Context Usage Counter**: Real-time context usage visualization with breakdown and alerts

---

## Feature 1: Steer Prompts (Mid-Generation Intervention)

### Background
Steer prompts are user inputs sent during active AI generation to correct the model, provide additional context, or change the course of what the AI is doing. Unlike regular queued prompts (which wait for the current turn to complete), steer prompts can interrupt the current stream or be injected into the ongoing conversation.

### Requirements

#### Data Model
```typescript
// src/chat/webview/types.ts
export interface SteerPrompt {
  id: string
  text: string
  attachments: Attachment[]
  mode: 'interrupt' | 'append' | 'queue'
  timestamp: number
  sessionId: string
}

// mode meanings:
// - interrupt: Abort current stream and send steer prompt immediately
// - append: Send after current stream completes (without waiting for user input)
// - queue: Add to regular prompt queue (same as normal queued prompts)
```

#### Backend Implementation
- Create `src/chat/handlers/SteerPromptHandler.ts`
  - Methods: `sendSteerPrompt()`, `abortForSteer()`, `appendAfterStream()`
  - Integration with `StreamCoordinator`:
    - For `interrupt` mode: Call `session.abort()` then send steer prompt
    - For `append` mode: Register callback on `stream_end` to auto-send
    - For `queue` mode: Add to existing `PromptQueue`
  - Track steer prompts in session metadata for export/history

#### Webview UI
- **Steer Input Area**: Separate input field below main input (or toggle mode)
  - Distinct visual style (e.g., different border color, "Steer" badge)
  - Always visible during streaming
  - Disabled when not streaming (unless queue mode)
- **Mode Selector**: Dropdown or radio buttons for interrupt/append/queue
- **Quick Actions**:
  - "Stop & Steer" button (interrupt mode preset)
  - "Add Context" button (append mode preset)
- **Steer History**: Small panel showing recent steer prompts in current session

#### Integration Points
- `StreamCoordinator`: Monitor streaming state to enable/disable steer input
- `MessageRouter`: Handle `send_steer_prompt` message from webview
- `SessionStore`: Persist steer prompts with session history
- Timeline: Mark steer prompts with special icon/timestamp

#### User Flow Examples
1. **Interrupt flow**: User sees AI going wrong direction → types steer prompt → selects "interrupt" → current stream aborts → steer prompt sent immediately
2. **Append flow**: User realizes missing context → types steer prompt → selects "append" → current stream completes → steer prompt auto-sent
3. **Queue flow**: User has follow-up question → types steer prompt → selects "queue" → added to prompt queue after current response

---

## Feature 2: Enhanced Queue Management

### Current State
Basic queue exists in `src/chat/webview/queue.ts` with:
- Enqueue, remove, edit operations
- State tracking (queued, sending, streaming, completed, failed)
- Per-tab queue storage

### Enhancement Requirements

#### Queue Visibility UI
- Add queue indicator in input area (badge showing count)
- Expandable queue panel showing all queued prompts
- Each item shows: text preview, state, timestamp, position
- Drag-and-drop reordering of queued items
- Bulk actions: "Send All", "Clear Queue", "Move to Top"

#### Queue Persistence
- Persist queue state to webview state per session
- Restore queue on session resume
- Handle queue overflow (max 10 items per session)

#### Queue Integration with Steer Prompts
- Steer prompts in "queue" mode add to regular prompt queue
- Visual distinction between steer-queued vs regular-queued items
- Option to convert queued item to steer prompt

#### Queue State Machine Enhancements
```typescript
// src/chat/webview/queue.ts enhancements
export interface QueueItem {
  id: string
  text: string
  attachments: Attachment[]
  state: QueueItemState
  createdAt: number
  error?: string
  position: number // For ordering
  isSteerPrompt?: boolean // Distinguish steer-queued items
  estimatedTokens?: number // Pre-calculated token count
}

export interface PromptQueue {
  // Existing methods...
  reorder: (fromIndex: number, toIndex: number) => boolean
  moveToFront: (id: string) => boolean
  moveToBack: (id: string) => boolean
  getEstimatedTokens: (id: string) => number
  getTotalEstimatedTokens: () => number
  markAsSteer: (id: string) => boolean
}
```

#### Queue Context Usage
- Calculate estimated tokens for queued items using `estimateTokens()`
- Show total queued tokens in context usage display
- Warn if queue would exceed context limit

---

## Feature 3: Context Usage Counter

### Current State
`ContextMonitor.ts` exists with:
- Basic token tracking
- Percentage calculation
- Event emission on change
- Breakdown support (system, history, workspace)

### Enhancement Requirements

#### Real-Time Visualization
- Add context usage bar in status strip (similar to rate limit monitor)
- Color-coded zones:
  - Green: 0-50%
  - Yellow: 50-80%
  - Red: 80-95%
  - Critical: 95%+ (pulsing animation)
- Show absolute token count and percentage
- Tooltip with detailed breakdown

#### Context Breakdown Display
```typescript
// Enhanced ContextUsage interface
export interface ContextUsage {
  tokens: number
  maxTokens: number
  percentage: number
  breakdown: {
    system: number
    history: number
    workspace: number
    queued: number // New: tokens from prompt queue
    steer: number // New: tokens from active steer prompts (if any)
  }
  projected?: {
    withQueue: number // Tokens if queue is sent
    overflow: boolean
  }
}
```

#### Context Usage Panel
- Add "Context Usage" panel in secondary nav
- Visual breakdown bar chart (stacked segments)
- Per-category toggle to include/exclude from context
- "Compact History" button to reduce history tokens
- "Clear Queue" button if queue tokens are significant

#### Predictive Warnings
- Calculate projected usage before sending queued items
- Show warning if sending queue would exceed limit
- Suggest actions: "Compact History", "Clear Queue"

#### Integration Points
- `ContextMonitor.updateTokens()`: Enhanced to include queue breakdown
- `AutoCompactor`: Trigger at 80% threshold with new breakdown data
- `ChatProvider`: Check context usage before sending from queue
- Webview: Update context usage display on every queue change

---

## Implementation Priority

### Phase 1: Foundation (P0)
1. Implement `SteerPromptHandler` with interrupt and append modes
2. Enhance `ContextMonitor` with detailed breakdown
3. Add context usage bar to status strip
4. Add steer input UI with mode selector

### Phase 2: UI Integration (P1)
1. Build queue visibility UI with badge and panel
2. Implement context usage breakdown panel
3. Add drag-and-drop queue reordering
4. Add steer history panel

### Phase 3: Advanced Features (P2)
1. Queue persistence and restore
2. Predictive context warnings
3. Queue-steer prompt conversion
4. Bulk queue operations

---

## Keyboard Shortcuts

### Steer Prompt Shortcuts
| Shortcut | Action | Context |
|-----------|--------|---------|
| `Ctrl+Shift+S` | Focus steer input | Always available when streaming |
| `Ctrl+Shift+I` | Send steer prompt (interrupt mode) | When steer input focused |
| `Ctrl+Shift+A` | Send steer prompt (append mode) | When steer input focused |
| `Ctrl+Shift+Q` | Add to queue (queue mode) | When steer input focused |
| `Escape` | Clear steer input / hide steer panel | When steer input focused |
| `Ctrl+/` | Toggle steer input visibility | Always available |

### Queue Management Shortcuts
| Shortcut | Action | Context |
|-----------|--------|---------|
| `Ctrl+Alt+Q` | Toggle queue panel | Always available |
| `Ctrl+Alt+N` | Send next queued item | When queue panel open |
| `Ctrl+Alt+C` | Clear queue | When queue panel open |
| `Ctrl+Alt+T` | Move selected item to top | When queue panel open |
| `Ctrl+Alt+B` | Move selected item to bottom | When queue panel open |
| `Ctrl+Alt+D` | Delete selected item | When queue panel open |
| `Ctrl+Alt+Enter` | Send all queued items | When queue panel open |

### Context Usage Shortcuts
| Shortcut | Action | Context |
|-----------|--------|---------|
| `Ctrl+Alt+U` | Toggle context usage panel | Always available |
| `Ctrl+Alt+H` | Compact history | When context panel open |
| `Ctrl+Alt+R` | Reset context breakdown defaults | When context panel open |

### Global Shortcuts (Extension Commands)
Add to `package.json` `contributes.keybindings`:
```json
{
  "command": "opencode-harness.focusSteerInput",
  "key": "ctrl+shift+s",
  "when": "opencodeStreaming"
},
{
  "command": "opencode-harness.toggleQueuePanel",
  "key": "ctrl+alt+q",
  "when": "opencodeChatActive"
},
{
  "command": "opencode-harness.toggleContextUsage",
  "key": "ctrl+alt+u",
  "when": "opencodeChatActive"
}
```

### Shortcut Conflicts & Fallbacks
- If `Ctrl+Shift+S` conflicts with user's system, allow remapping in settings
- Provide alternative shortcuts for macOS (use `Cmd` instead of `Ctrl`)
- Show shortcut hints in UI tooltips
- Allow disabling specific shortcuts in settings

### Webview Keyboard Handler
Create `src/chat/webview/keyboardShortcuts.ts`:
- Centralized keyboard event listener
- Prevent default behavior when shortcuts are triggered
- Context-aware activation (check streaming state, panel visibility)
- Integration with existing `onInputKeydown` in `main.ts`

---

## Testing Requirements

### Unit Tests
- `SteerPromptHandler.test.ts`: Interrupt, append, queue modes
- `ContextMonitor.test.ts`: Breakdown calculation, projection logic
- `queue.test.ts`: Reordering, token estimation, steer marking

### Integration Tests
- Steer prompt interrupt aborts current stream
- Steer prompt append auto-sends after stream end
- Queue persistence across session resume
- Context usage updates on queue changes
- Auto-compact trigger with new breakdown

### Visual Tests
- Context usage bar color zones
- Queue panel rendering and states
- Steer input visibility during streaming

---

## Dependencies
- No new external dependencies required
- Uses existing `estimateTokens()` from `src/utils/tokenCounter.ts`
- Leverages existing webview state persistence
- Integrates with existing `StreamCoordinator` for abort/append logic

---

## Success Criteria
1. Users can send steer prompts during active streaming (interrupt/append/queue)
2. Queue is visible and manageable from the input area
3. Context usage shows real-time breakdown with predictive warnings
4. All features persist across VS Code restarts
5. No performance regression (context calculation <50ms)
6. Tests achieve >80% coverage for new code
