# Webview Token & Accessibility Gap Inventory

**Date:** 2026-06-19  
**Scope:** All registered views, modals, panels, and dropdowns in the OpenCode VS Code extension webview  
**Methodology:** Static analysis of TypeScript, CSS, and HTML files; grep-based pattern matching for hardcoded values

## Executive Summary

The webview frontend is **highly mature** with a robust cascade-layer CSS architecture, comprehensive `--vscode-*` token mapping, and established accessibility patterns. However, **verified gaps** exist in:
- **170 inline-style/hardcoded-hex matches** in the TypeScript render layer
- **Inconsistent z-index fallbacks** and raw numeric values
- **418 CSS hex matches** requiring triage (many are legitimate shadows/fallbacks)
- **Dynamic surfaces** needing ARIA/focus verification

**No Tailwind** — the codebase uses hand-authored CSS with cascade layers. This is a **gap-fix against a working foundation**, not a rewrite.

---

## Architecture Overview

### CSS Architecture (Existing Foundation)
- **Cascade layers:** `@layer tokens, base, layout, components, messages, blocks, animations, themes, utilities, accessibility` (styles.css:12)
- **Token system:** 593-line `tokens.css` with `--vscode-*` mapping, spacing grid, typography scale, z-index scale
- **Protected focus:** `accessibility.css` layer guarantees focus rings via `--color-accent`, WCAG 2.5.8 touch targets, skip link
- **ARIA foundation:** Roles, labels, live regions, focus traps (`trapModalFocus`), escape coordinator

### File Structure
- **HTML:** `src/chat/webview/index.html` (1246 lines) — declarative structure for all modals/panels
- **CSS:** 20 files in `src/chat/webview/css/` (~600KB total)
- **TypeScript:** 40+ modules in `src/chat/webview/` and `src/chat/webview/ui/`

---

## Component Inventory & Deficiencies

### 1. Popout Detail Renderer (Dynamic Surface)
**File:** `src/chat/webview/main.ts:870-919`  
**Purpose:** Renders subagent detail in popout mode (dedicated VS Code editor panel)  
**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| Color-token | Hardcoded status colors: `#22c55e` (completed), `#ef4444` (failed), `#3b82f6` (running), `#888` (unknown), `#fff` (text) | Line 883, 887, 912 | HIGH |
| Color-token | Hardcoded user role border: `#3b82f6`, `#888` | Line 912 | HIGH |
| ARIA/semantics | No semantic HTML structure (all `div`/`span`), no `role` declarations on dynamic content | Lines 886-918 | MEDIUM |
| Focus/keyboard | No focus management (popout mode lacks focus trap or return logic) | N/A | MEDIUM |

**Recommendation:** Extract status colors to semantic tokens (e.g., `--oc-status-success`, `--oc-status-error`, `--oc-status-running`) mapped to VS Code's `--vscode-terminal-ansi-*` or error foreground tokens. Add `role="article"` and `aria-label` to the container.

---

### 2. Error Components Module
**File:** `src/chat/webview/errorComponents.ts` (604 lines)  
**Purpose:** Progressive disclosure error display with severity levels  
**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| Color-token | Hardcoded severity colors in `DEFAULT_THEME.colors`: `#3b82f6` (low), `#f59e0b` (medium), `#ef4444` (high), `#dc2626` (critical) | Lines 65-68 | HIGH |
| Color-token | Inline style assignments throughout render functions (27 matches total) | Throughout | HIGH |
| ARIA/semantics | Severity glyphs use `aria-hidden="true"` but no alternative text for screen readers | Lines 80-83 | LOW |
| Layout/overflow | No explicit text-overflow or max-height constraints on error details | N/A | LOW |

**Recommendation:** Map severity colors to VS Code tokens (`--vscode-errorForeground`, `--vscode-warningForeground`, `--vscode-infoForeground`). Replace inline styles with CSS classes. Add `aria-label` to severity icons.

---

### 3. Provider/Connect Panel
**File:** `src/chat/webview/ui/providerPanel.ts` (466 lines) + HTML structure  
**Purpose:** AI provider discovery, OAuth flow, API key entry  
**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| ARIA/semantics | Tab switching lacks `role="tablist"`, `role="tab"`, `aria-selected` on tab buttons | Lines 89-95 | MEDIUM |
| Focus/keyboard | Focus trap exists but may conflict with step wizard navigation | Lines 77-87 | LOW |
| Layout/overflow | No explicit overflow handling on credential/discovery lists | N/A | LOW |
| Color-token | Status classes (`provider-status-connected`, etc.) may use hardcoded colors | CSS needs audit | TBD |

**Recommendation:** Add proper tablist ARIA pattern. Verify status classes use tokens. Ensure credential lists have `overflow-y: auto` and text ellipsis.

---

### 4. Changed Files Dropdown
**File:** `src/chat/webview/changed-files-dropdown.ts` (1168 lines)  
**Purpose:** Toolbar button → floating dropdown for changed files with diff hunks  
**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| Z-index | Uses `var(--z-dropdown)` but may conflict with other dropdowns | CSS context-usage.css:244 | LOW |
| ARIA/semantics | Has roving tabindex and `role="tree"` — generally good, but verify `aria-expanded` on parent | Lines 61-78 | LOW |
| Layout/overflow | Tree structure needs `overflow-y: auto` and text ellipsis on long file paths | CSS needs audit | TBD |
| Focus/keyboard | Focus return on close exists (`_previouslyFocused`) — verify it works reliably | Line 70 | LOW |

**Recommendation:** CSS audit for overflow/ellipsis. Verify z-index doesn't occlude other dropdowns. Test keyboard navigation end-to-end.

---

### 5. Sidebar Panels (Todos, Activity, Tasks, Subagents)
**Files:** 
- `todos-panel.ts` 
- `activity-panel.ts` 
- `tasks-panel.ts` 
- `subagent-panel.ts`
- HTML structure in `index.html:281-369`

**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| ARIA/semantics | Panels have `role="region"` but may lack `aria-labelledby` pointing to titles | HTML lines 281, 309, 328, 347 | MEDIUM |
| Focus/keyboard | Collapsed panels may not remove children from tab order (no `display:none` on hide) | TS close() methods | MEDIUM |
| Color-token | Subagent panel has hardcoded TDD phase colors: `#ef4444` (red), `#22c55e` (green), `#8b5cf6` (refactor), `#f59e0b` (coverage) | subagent-panel.ts:58-63 | HIGH |
| Layout/overflow | Panel content areas may lack `overflow-y: auto` and text ellipsis | CSS needs audit | TBD |

**Recommendation:** Add `aria-labelledby` to panel containers. Ensure `display: none` on hidden panels. Extract TDD colors to tokens. CSS audit for overflow.

---

### 6. Skills Modal
**File:** `src/chat/webview/skills-modal.ts` (209 lines) + HTML  
**Purpose:** Toggle skill suggestions, search/filter by category  
**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| ARIA/semantics | Filter buttons have `aria-pressed` but container lacks `role="group"` with proper label | Line 44, 86 | LOW |
| Focus/keyboard | Has focus trap (`createFocusTrap`) — verify focus return on close | Lines 22-30 | LOW |
| Layout/overflow | Skills list may lack `overflow-y: auto` and text ellipsis | CSS needs audit | TBD |

**Recommendation:** Add `role="group"` and `aria-label` to filter container. CSS audit for overflow.

---

### 7. Model Dropdown
**File:** `src/chat/webview/model-dropdown.ts` (423 lines)  
**Purpose:** Model selection with provider grouping, favorites, recent rank  
**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| Color-token | Hardcoded offline status colors: `border: var(--oc-accent-border, #f44336)`, `color: var(--usage-red, #f44336)`, `background: rgba(244, 67, 54, 0.1)` | Lines 86-88 | HIGH |
| Z-index | Uses `var(--z-dropdown)` — verify consistent fallback | N/A | LOW |
| ARIA/semantics | Has `role="option"`, `aria-selected` — good combobox pattern | Lines 63-64 | NONE |
| Focus/keyboard | Roving tabindex exists — verify arrow key navigation | Lines 48-59 | LOW |

**Recommendation:** Extract offline status colors to tokens (`--oc-status-offline-bg`, etc.). Verify z-index fallback consistency.

---

### 8. Mode Dropdown
**File:** `src/chat/webview/ui/modeDropdown.ts` (341 lines)  
**Purpose:** Session mode selector (Plan/Auto/Build)  
**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| Z-index | Uses inline positioning without explicit z-index token | Lines 82-87 | MEDIUM |
| ARIA/semantics | Has mode icons but may lack `aria-label` on options | Lines 38-42 | LOW |
| Focus/keyboard | Has keyboard navigation — verify focus return on close | N/A | LOW |
| Layout/overflow | Dropdown has `max-height` but may lack `overflow-y: auto` | Line 87 | LOW |

**Recommendation:** Add z-index token to positioned dropdown. Ensure `overflow-y: auto`. Verify ARIA labels.

---

### 9. Variant Selector
**File:** `src/chat/webview/variant-selector.ts` (241 lines)  
**Purpose:** Model variant selection (Default/Low/Medium/High)  
**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| Z-index | Uses inline positioning without explicit z-index token | Lines 82-87 | MEDIUM |
| ARIA/semantics | Has `role="option"`, `aria-activedescendant` — good | Lines 22, 57 | NONE |
| Focus/keyboard | Has roving tabindex — verify arrow key navigation | Lines 47-59 | LOW |
| Layout/overflow | Has `max-height` but may lack `overflow-y: auto` | Line 87 | LOW |

**Recommendation:** Add z-index token to positioned dropdown. Ensure `overflow-y: auto`.

---

### 10. Mentions Dropdown
**File:** `src/chat/webview/mentions.ts` (397 lines)  
**Purpose:** Slash command and @mention autocomplete  
**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| Z-index | Uses inline positioning without explicit z-index token | Lines 80-85 | MEDIUM |
| ARIA/semantics | Has `aria-expanded` on prompt input — verify combobox pattern | Line 90 | LOW |
| Focus/keyboard | Has keyboard navigation — verify arrow key + Enter behavior | N/A | LOW |
| Layout/overflow | Has `max-height` but may lack `overflow-y: auto` | Line 85 | LOW |

**Recommendation:** Add z-index token to positioned dropdown. Ensure `overflow-y: auto`. Verify combobox ARIA pattern.

---

### 11. Theme Customizer
**File:** `src/chat/webview/ui/themeCustomizer.ts` (283 lines)  
**Purpose:** Override theme colors with preset selection  
**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| ARIA/semantics | Preset cards have `data-preset` and `aria-pressed` — good pattern | Lines 93-95 | NONE |
| Focus/keyboard | Has focus trap (`mountModalFocus`) — verify focus return | Line 2, 77 | LOW |
| Color-token | Comprehensive token mapping already exists (lines 25-74) — no gaps | N/A | NONE |

**Recommendation:** No changes needed — this component is already well-structured.

---

### 12. Session Modal
**File:** `src/chat/webview/ui/sessionModal.ts` (447 lines) + HTML  
**Purpose:** Session history with search, unified local/server sessions  
**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| ARIA/semantics | Has `role="listbox"`, `aria-label` — good | Lines 80-81 | NONE |
| Focus/keyboard | Has `trapModalFocus` — verify focus return on close | Lines 19-36 | LOW |
| Z-index | Uses `var(--z-modal)` — verify fallback | N/A | LOW |

**Recommendation:** Verify focus trap works reliably. Test keyboard navigation.

---

### 13. Commands Modal
**File:** `src/chat/webview/commands-modal.ts` (511 lines) + HTML  
**Purpose:** Command palette for slash commands, stashes, templates  
**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| ARIA/semantics | Has `role="listbox"`, filter chips have `aria-pressed` — good | Lines 112, 118 | NONE |
| Focus/keyboard | Has roving tabindex and keyboard navigation — verify arrow key + Enter | Lines 102-126 | LOW |
| Z-index | Uses `var(--z-modal)` — verify fallback | N/A | LOW |

**Recommendation:** Verify keyboard navigation end-to-end. Test focus return.

---

### 14. Keyboard Shortcuts Modal
**File:** `src/chat/webview/ui/keyboardShortcutsModal.ts` (828 lines) + HTML  
**Purpose:** Display keyboard shortcuts in a modal  
**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| ARIA/semantics | Modal has `role="dialog"`, `aria-label` — good | HTML | NONE |
| Focus/keyboard | Has focus trap — verify focus return | TS module | LOW |
| Layout/overflow | Modal content may lack `overflow-y: auto` | CSS needs audit | TBD |

**Recommendation:** CSS audit for overflow. Verify focus trap.

---

### 15. MCP Configuration
**File:** `src/chat/webview/mcp-config.ts`  
**Purpose:** Manage MCP servers  
**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| ARIA/semantics | Needs audit for form labels, error announcements | N/A | TBD |
| Focus/keyboard | Needs audit for form validation focus management | N/A | TBD |
| Layout/overflow | Needs audit for form overflow handling | N/A | TBD |

**Recommendation:** Conduct full audit for form accessibility patterns.

---

### 16. Permission Configuration
**File:** `src/chat/webview/permissionConfig.ts`  
**Purpose:** Configure tool permissions  
**Deficiencies:**

| Category | Issue | Location | Severity |
|----------|-------|----------|----------|
| ARIA/semantics | Needs audit for form labels, error announcements | N/A | TBD |
| Focus/keyboard | Needs audit for form validation focus management | N/A | TBD |
| Layout/overflow | Needs audit for form overflow handling | N/A | TBD |

**Recommendation:** Conduct full audit for form accessibility patterns.

---

## Z-Index Scale Inconsistencies

**Documented scale in `tokens.css:347`:**
```css
--z-base: 0;
--z-dropdown: 150;
--z-sticky: 100;
--z-modal: 300;
--z-tooltip: 400;
--z-toast: 1000;
```

**Inconsistent fallbacks found:**

| Token | Actual Value | Incorrect Fallback | Location |
|-------|--------------|-------------------|----------|
| `--z-dropdown` | 150 | 100 | `layout.css:965`, `components.css:800` |
| `--z-dropdown` | 150 | 200 | `accessibility.css`, `blocks.css:3195` |
| Raw values | N/A | `z-index: 1` | `components.css:2843` |
| Raw values | N/A | `z-index: 5` | `layout.css:584` |

**Recommendation:** Normalize all `var(--z-dropdown)` to remove fallbacks (token has value). Replace raw `z-index: 1/5` with scale tokens or remove if unnecessary.

---

## Hardcoded Color Summary

### TypeScript Layer (170 matches across 38 files)
**Worst offenders:**
- `errorComponents.ts`: 27 matches (severity colors)
- `model-dropdown.ts`: 12 matches (offline status colors)
- `subagent-panel.ts`: 6 matches (TDD phase colors)
- `main.ts`: 8 matches (popout status colors)
- Remaining 117 matches across 34 other files (need triage)

### CSS Layer (418 matches across 11 files)
**Distribution:**
- `blocks.css`: 112 matches
- `components.css`: 75 matches
- `tokens.css`: 59 matches (legitimate token definitions)
- `context-usage.css`: 47 matches
- `question-bar.css`: 42 matches
- `layout.css`: 39 matches
- Others: 44 matches

**Note:** Many CSS hex values are legitimate (rgba shadows, token fallbacks). Need line-by-line triage to separate violations from acceptable usage.

---

## Priority Fix Order (Per Plan)

### Phase 3 — Component-by-Component (One Module Per Commit)

1. **Popout + status colors** (`main.ts:870-919`) — Extract hardcoded hex to semantic tokens
2. **errorComponents.ts** — Replace inline styles with CSS classes/tokens
3. **Provider/Connect panel** — Add proper tablist ARIA, verify status classes
4. **Changed Files dropdown** — CSS audit for overflow/ellipsis, verify z-index
5. **Sidebar panels** — Add `aria-labelledby`, ensure `display:none` on hide, extract TDD colors
6. **Dropdowns** (model/mode/variant/mentions) — Normalize z-index, verify ARIA combobox pattern
7. **Remaining components** — MCP config, permission config, keyboard shortcuts modal

---

## Verification Checklist (Per Phase)

After each fix, verify:
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npm run test:unit` passes
- [ ] `npx eslint src/` passes
- [ ] `node scripts/check-architecture.mjs` passes
- [ ] `npm run test:visual` (Playwright) passes
- [ ] Manual verification against Light, Dark, and High Contrast themes
- [ ] Commit each verified module (working tree is ephemeral per AGENTS.md)

---

## Appendix: Token Mapping Recommendations

### Status Colors (to add to `tokens.css`)
```css
--oc-status-success: var(--vscode-terminal-ansiGreen, #22c55e);
--oc-status-error: var(--vscode-errorForeground, #ef4444);
--oc-status-running: var(--vscode-terminal-ansiBlue, #3b82f6);
--oc-status-unknown: var(--vscode-descriptionForeground, #888);
--oc-status-offline-bg: rgba(244, 67, 54, 0.1);
--oc-status-offline-fg: var(--vscode-errorForeground, #f44336);
--oc-status-offline-border: var(--vscode-errorBorder, #f44336);
```

### TDD Phase Colors (to add to `tokens.css`)
```css
--oc-tdd-red: var(--vscode-errorForeground, #ef4444);
--oc-tdd-green: var(--vscode-terminal-ansiGreen, #22c55e);
--oc-tdd-refactor: var(--vscode-terminal-ansiMagenta, #8b5cf6);
--oc-tdd-coverage: var(--vscode-terminal-ansiYellow, #f59e0b);
```

---

**End of Inventory Document**
