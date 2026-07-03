# Token Tracking Architecture

## Overview

The token tracking system provides real-time context usage monitoring with reactive updates to the webview UI. It uses a throttled event system to prevent UI spam while ensuring critical updates are delivered immediately.

## Core Components

### ContextMonitor (`src/monitor/ContextMonitor.ts`)

The authoritative backend source of truth for token and context usage state.

**Responsibilities:**
- Track current token usage and context window limits per session
- Calculate usage percentages safely (handles zero limits)
- Emit reactive events via `onContextChanged`
- Support per-session limits to prevent cross-session bleed
- Provide breakdowns (system, history, workspace, queued, steer)
- Calculate costs and projections
- Track usage history for analytics

**Key Methods:**
- `updateTokens(tokens, sessionId, breakdown, options)` - Update token count with optional breakdown and options
- `setTokenLimit(limit, sessionId)` - Set context window limit for a session
- `emitLatestForSession(sessionId)` - Re-emit one session's stored snapshot (own tokens, own window, source preserved); no-op when the session has no recorded usage
- `limitFor(sessionId)` - Effective context window for a session (its own limit, else the sessionless default)
- `resetSession(sessionId)` - Drop stale usage after compaction (keeps the session's window — the model didn't change)
- `clearSession(sessionId)` - Remove usage AND window when the tab is closed/deleted
- `emitImmediate(data)` - Emit context usage immediately, bypassing throttling
- `dispose()` - Cleanup throttler and emitters

**Per-Session Attribution Invariant (2026-07-03):**

The sessionless getters (`percent`, `tokensUsed`, `limit`) reflect whichever
session updated last. They must NEVER be read on behalf of a specific tab and
stamped with that tab's `sessionId` — doing so painted every tab's context bar
with the busiest tab's figures, and mixed numerators/denominators
(`tokens_A / limit_B`) clamp to a bogus 100%. Rules enforced by
`src/chat/contextUsageAttribution.test.ts`:

- Stream boundaries re-emit via `emitLatestForSession(tabId)`, never the getters.
- `setTokenLimit(limit, sessionId)` does not refresh the sessionless default.
- `AutoCompactor` gates on `getCurrentUsage(activeTab.id)`, never the global percent.
- `ChatProvider` drops sessionless `context_usage` emits — the webview would
  attribute them to the *viewed* tab and persist them.
- `WebviewEventRouter`'s `get_context_usage` fallback resolves `limitFor(targetId)`.

**Throttling Integration:**
- Uses `ContextUsageThrottler` with 250ms debounce window
- Regular updates are throttled to prevent UI spam
- Critical events (queue changes, limit changes) use immediate emit
- Per-session tracking prevents cross-session interference

### ContextUsageThrottler (`src/chat/ContextUsageThrottler.ts`)

Debouncing utility for context usage updates per session.

**Features:**
- 250ms debounce window (configurable)
- Per-session tracking to prevent cross-session interference
- `emitImmediate()` method for critical events that bypass throttling
- Automatic cleanup of pending timers on disposal
- Safe disposal that prevents further emits

**API:**
- `emit(data)` - Throttled emit, coalesces rapid updates within debounce window
- `emitImmediate(data)` - Immediate emit, bypasses throttling
- `onEmit(callback)` - Subscribe to throttled emissions
- `dispose()` - Cleanup timers and prevent further emits

### ChatProvider Integration

**Triggers Added:**

1. **File Attachment** (`handleAttachFiles`)
   - After successful file attachment, refresh context usage
   - Ensures UI reflects new context from attached files

2. **Compaction** (`handleCompactSession`)
   - After session compaction, refresh context usage
   - Reflects reduced context after cleanup

3. **Stream Boundaries** (`StreamCoordinator`)
   - Stream start: `contextMonitor.emitLatestForSession(tabId)` — re-emits the
     tab's own stored snapshot (no-op if the tab has none yet)
   - Stream end: same per-session re-emit
   - Never reads the sessionless `percent`/`tokensUsed`/`limit` getters — those
     hold whichever session updated last (cross-tab bleed)

**Event Flow:**
```
ContextMonitor.onContextChanged → ChatProvider listener
  ↓
Update SessionStore state
  ↓
Post "context_usage" message to webview
  ↓
Webview updates context usage bar (throttled via requestAnimationFrame)
```

## Throttling Strategy

### Why Throttling?

Without throttling, rapid token updates during streaming could cause:
- UI spam and performance degradation
- Excessive message passing between backend and webview
- Visual flickering from rapid DOM updates
- Unnecessary re-renders

### Throttling Behavior

**Regular Updates (throttled):**
- Coalesced within 250ms debounce window
- Only the last value is emitted
- Prevents UI spam during rapid token changes

**Critical Events (immediate):**
- Queue changes (user adds/removes prompts)
- Context window limit changes
- Stream start/end boundaries
- File attachment completion
- Compaction completion

### Per-Session Tracking

The throttler maintains separate debounce timers per session:
- Prevents cross-session interference
- Each session's updates are independently throttled
- Maps pending updates by sessionId

## Data Flow

### Backend → Webview

```
ContextMonitor.updateTokens(tokens, sessionId, breakdown, options)
  ↓
ContextUsageThrottler.emit(data) or emitImmediate(data)
  ↓
ContextMonitor.onContextChangedEmitter.fire(usage)
  ↓
ChatProvider listener
  ↓
SessionStore.updateContextUsage(sessionId, contextUsage)
  ↓
postMessage({ type: "context_usage", ... })
  ↓
Webview "context_usage" handler
  ↓
UpdateContextUsageBar (throttled via requestAnimationFrame)
```

### Triggers Flow

```
File Attach → handleAttachFiles → pushContextUsageForSession
Compaction → handleCompactSession → pushContextUsageForSession
Stream Start → StreamCoordinator.emitStreamStart → contextMonitor.emitImmediate
Stream End → StreamCoordinator.finalizeStream → contextMonitor.emitImmediate
```

## Accessibility

### ARIA Attributes

**Context Usage Bar:**
- `role="button"` - Treats bar as interactive button
- `tabindex="0"` - Keyboard focusable
- `aria-label` - Dynamic label showing usage percentage
- `aria-haspopup="true"` - Indicates opens dropdown
- `aria-controls="context-usage-dropdown"` - References controlled dropdown

**Dropdown:**
- `role="region"` - Identifies as content region
- `aria-label="Context usage details"` - Descriptive label
- `aria-live="polite"` - Announces updates to screen readers
- `aria-hidden="true/false"` - Toggles visibility

**Keyboard Navigation:**
- Enter/Space on context bar opens dropdown
- Escape closes dropdown
- Tab trapping within dropdown when open
- Focus returns to trigger after close

## CSS Styling

### VS Code Native Integration

Uses VS Code theme variables for native appearance:
- `--vscode-descriptionForeground` - Text color
- `--vscode-toolbar-hoverBackground` - Hover state
- `--vscode-focusBorder` - Focus outline
- `--vscode-progressBar-background` - Progress fill color
- `--vscode-editorWarningForeground` - Warning state
- `--vscode-errorForeground` - Error state

### Responsive Design

Container queries for adaptive layout:
- `@container status-strip (max-width: 480px)` - Compact detail text
- `@container status-strip (max-width: 360px)` - Hide label, shrink track

## Testing

### Unit Tests

**ContextUsageThrottler Tests** (`src/chat/ContextUsageThrottler.test.ts`):
- Debounce behavior (coalesces rapid emits)
- Immediate emit bypasses debounce
- Per-session tracking prevents interference
- Disposal clears timers and prevents further emits

**ContextMonitor Throttling Tests** (`src/monitor/ContextMonitor.throttling.test.ts`):
- Constructor accepts optional debounceMs
- Has emitImmediate method for critical events
- updateTokens uses throttled emit by default
- emitImmediate bypasses throttling
- Dispose cleans up throttler timers

## Performance Considerations

### Debounce Window

- 250ms balances responsiveness and performance
- Short enough for responsive UI
- Long enough to coalesce rapid streaming updates
- Configurable via constructor parameter

### RequestAnimationFrame

Webview uses `requestAnimationFrame` for DOM updates:
- Coalesces multiple updates into single frame
- Prevents layout thrashing
- Smooth visual transitions
- Automatically throttled by browser

### Event Cleanup

All emitters and timers are disposed on:
- Session cleanup
- Extension deactivation
- Explicit disposal calls

## Future Enhancements

### Potential Improvements

1. **Adaptive Debounce**: Adjust debounce window based on update frequency
2. **Batch Updates**: Send multiple session updates in single message
3. **Predictive UI**: Show projected usage before actual updates
4. **Cost Thresholds**: Warn when approaching cost limits
5. **Session Comparison**: Compare usage across sessions

### Known Limitations

- Throttling may delay non-critical updates by up to 250ms
- Per-session tracking requires sessionId in all updates
- Immediate emits can still cause rapid updates if overused
- Webview throttling via requestAnimationFrame is separate from backend throttling

## Migration Notes

### From Previous Implementation

**Before:**
- Direct event firing without throttling
- No per-session tracking
- No immediate emit capability
- Limited trigger points

**After:**
- Throttled emits with 250ms debounce
- Per-session tracking in throttler
- Immediate emit for critical events
- Triggers at file attachment, compaction, stream boundaries

**Breaking Changes:**
- ContextMonitor constructor now accepts optional `debounceMs` parameter
- `ContextUsageUpdateOptions` now includes `immediate` flag
- Direct `onContextChangedEmitter.fire` replaced with throttled emits

**Compatibility:**
- Constructor parameter is optional (defaults to 250ms)
- `immediate` flag defaults to false
- Existing code continues to work with throttled behavior
