# RESEARCH.md — Theme Customizer Rework

> Research findings for the `Customize theme` modal redesign. Compiled from
> VS Code documentation, WAI-ARIA APG patterns, MDN, and accessibility blogs.
> No component code is written until this research is reviewed.

---

## 1. VS Code Theme-Switcher Reference (`savioserra.theme-switcher`)

**Source:** <https://marketplace.visualstudio.com/items?itemName=savioserra.theme-switcher>
**Repo:** <https://github.com/savioserra/vs-theme-switcher>

### What it does
- Schedules VS Code color themes (and optionally icon themes) to switch at
  specific times of day using a simple `HH:mm` mapping.
- Provides a command (`themeswitcher.openSettings`) that opens a settings UI
  for managing the schedule.
- Configuration lives in `settings.json` under `themeswitcher.mappings`.

### Patterns worth adopting
- **Settings-driven config** — theme choices persist in VS Code settings, not
  in ephemeral webview state. Our modal already follows this via
  `opencode.theme` in `package.json`.
- **Command-palette entry** — a command opens the customization UI. We already
  have the settings-menu button (`#theme-customizer-btn`); a command-palette
  entry would be a future enhancement.
- **Live apply** — theme changes apply immediately without a reload. Our
  `ThemeController.handleUpdateThemeConfig` already emits `theme_vars` +
  `theme_config` back to the webview on save.

### Patterns to avoid
- The extension has no in-webview color picker; it relies entirely on VS
  Code's native theme names. Our modal needs a color-override layer that this
  extension does not provide.

### Other marketplace references surveyed
- **Auto Theme Switcher (Time Based)** by DjidjelliYoucef — status-bar icon +
  simple light/dark toggle. Confirms that a status-bar indicator is a useful
  affordance but does not address per-color overrides.
- **VS Code Theme Manager** by ryanxiang — adds sunrise/sunset scheduling and
  theme history. The history-tracking concept could inspire an undo/redo
  stack for theme overrides (we already have `pushUndo` in the customizer deps).

---

## 2. VS Code CSS Variables (`--vscode-*`)

**Sources:**
- <https://github.com/microsoft/vscode-docs/blob/main/api/references/theme-color.md>
- <https://github.com/microsoft/vscode/issues/165169> (CSS variables over `registerThemingParticipant`)
- `src/vs/platform/theme/common/colorRegistry.ts` — `asCssVariableName()`:
  `--vscode-${colorIdent.replace(/\./g, '-')}`

### Naming convention
Every registered VS Code color is exposed as a CSS variable by replacing dots
with hyphens and prefixing with `--vscode-`. Examples:
- `editor.background` → `--vscode-editor-background`
- `sideBar.background` → `--vscode-sideBar-background`
- `button.background` → `--vscode-button-background`
- `focusBorder` → `--vscode-focusBorder`
- `panel.border` → `--vscode-panel-border`
- `descriptionForeground` → `--vscode-descriptionForeground`
- `errorForeground` → `--vscode-errorForeground`
- `input.background` → `--vscode-input-background`
- `list.activeSelectionBackground` → `--vscode-list-activeSelectionBackground`

### Variables already consumed in `tokens.css`
`--vscode-sideBar-background`, `--vscode-sideBar-foreground`, `--vscode-editor-background`,
`--vscode-editor-foreground`, `--vscode-button-background`, `--vscode-button-hoverBackground`,
`--vscode-focusBorder`, `--vscode-descriptionForeground`, `--vscode-errorForeground`,
`--vscode-panel-border` (via `--oc-border`), `--vscode-input-background`, etc.

### Gaps to fill for the new modal
| Token needed | VS Code variable | Current state |
|---|---|---|
| Panel background | `--vscode-panel-background` | Not directly referenced (falls back to `--oc-bg` → `--vscode-sideBar-background`) |
| Panel foreground | `--vscode-panel-foreground` | Same — falls back to `--oc-fg` |
| Panel border | `--vscode-panel-border` | Falls back to `--vscode-sideBar-border` |
| Button foreground | `--vscode-button-foreground` | Already used |
| Button secondary | `--vscode-button-secondaryBackground` | Already used |
| Focus border | `--vscode-focusBorder` | Already used |
| Description foreground | `--vscode-descriptionForeground` | Already used |
| Error foreground | `--vscode-errorForeground` | Already used |
| Input border | `--vscode-input-border` | Not referenced — needed for hex input styling |
| List hover | `--vscode-list-hoverBackground` | Already used via `--oc-list-hover` |
| Widget border | `--vscode-widget-border` | Already used via `--oc-glass-border` |

### Key takeaway
VS Code's own docs confirm that all theme colors are available as CSS variables
in webviews and update automatically when the theme changes — no JavaScript
needed to re-read colors. The new modal should rely on `--vscode-*` variables
for all its chrome (backdrop, panel, borders, focus, buttons) and only use
hardcoded hex for the preset swatch strips (which represent specific themes).

---

## 3. Webview Security Model (CSP, `acquireVsCodeApi()`, `postMessage`)

**Sources:**
- <https://github.com/microsoft/vscode-docs/blob/main/api/extension-guides/webview.md>
- <https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts>
- <https://github.com/microsoft/vscode/issues/94266>

### `acquireVsCodeApi()`
- Can only be called **once** per webview session (throws on second call
  unless `allowMultipleAPIAcquire` is set).
- The returned object must be kept private and never leaked to the global
  scope.
- Provides `postMessage()`, `setState()`, and `getState()`.
- Our codebase already handles this correctly in `main.ts` (`getVsCodeApi()`).

### Content Security Policy
- VS Code recommends `default-src 'none'` as the baseline, then re-enabling
  only what is needed.
- Inline scripts and inline styles are implicitly disabled by a strict CSP.
  All styles must be in external `.css` files (which we already do via
  `styles.css` → `tokens.css` / `layout.css` / `components.css`).
- `font-src` is restricted to `cspSource` — no CDN font loading. Our `tokens.css`
  already documents this: "no `@font-face` rules because VS Code's CSP
  prohibits CDN font loading."

### `postMessage` contract
- Extension → webview: `webview.postMessage(jsonSerializableData)` — received
  via the standard `message` event.
- Webview → extension: `vscode.postMessage(msg)` — the extension listens via
  `webview.onDidReceiveMessage`.
- Iframes inside the webview do NOT have access to `acquireVsCodeApi`; they
  must forward messages to the outer webview. (Relevant if we ever embed a
  preview iframe — we don't, but worth noting.)

### Implications for the modal
- The modal must live inside the webview root (no portal to `<body>` outside
  the webview). The `<dialog>` element is perfect for this.
- No inline `style` attributes for layout (CSP may block them). Use CSS classes.
  The existing code already violates this in a few places (e.g., preset swatch
  `style="background:#1e1e2e"`) — the new design should move these to CSS
  custom properties set via `--theme-preset-*` tokens.
- All color values sent via `postMessage` must be JSON-serializable strings.
  The existing `ThemeController` already validates this.

---

## 4. Color Picker Best Practices

**Sources:**
- <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/color>
- <https://a11ysupport.io/tech/html/input(type-color)_element>
- <https://github.com/w3c/aria-practices/issues/2742>
- UX Patterns for Developers: <https://raw.githubusercontent.com/thedaviddias/ux-patterns-for-developers/refs/heads/main/apps/web/content/patterns/forms/color-picker.mdx>

### Native `<input type="color">`
- Value is always a 7-character lowercase hex string (`#rrggbb`). No alpha,
  no named colors, no `rgba()`/`hsla()` — the native picker only produces hex.
- Default value is `#000000` if omitted or invalid.
- The `:invalid` pseudo-class is applied when the user agent cannot convert
  the value to hex notation.
- Browser support for the color picker *widget* varies: some screen readers
  (JAWS + Chrome) do not convey the role or value at all; VoiceOver (macOS) has
  the best support.

### Accessibility findings
- **JAWS + Chrome**: does not convey name, role, or value for `<input type="color">`.
- **NVDA + Chrome/Firefox**: conveys name and role but not value.
- **VoiceOver (macOS) + Safari**: conveys name, role, value, and changes.
- **TalkBack + Chrome**: conveys name, role, value, and changes.

### Best practices for pairing with a hex input
1. **Always display the current color value** (hex code) next to or below the
   swatch trigger — don't rely on the color picker alone.
2. **Pair the native color input with a text input** for hex/rgba/var values.
   The text input is the accessible fallback for screen readers that don't
   support the color picker widget.
3. **Validate hex input** with an inline error message in an `aria-live="polite"`
   region. Show the error only when the value changes from valid to invalid
   (not on every keystroke) to avoid screen-reader spam.
4. **Use `aria-label`** on the color input that includes the field name (e.g.,
   `aria-label="Accent color"`) — the native picker doesn't expose a visible
   label by default.
5. **Support `var(--*)`, `rgba()`, `hsla()`, `color-mix()`, `transparent`** in
   the text input — these are valid CSS but cannot be represented by the
   native color picker. When the text input holds a non-hex value, the picker
   should fall back to the current theme's resolved color for that token.
6. **Provide a "Reset to default" option** when a color change is reversible.
7. **Don't convey color by color alone** — always include the hex/name in text.

### Implications for the modal
- Each color row has a native `<input type="color">` (for visual picking) +
  a text `<input>` (for hex/rgba/var/transparent). The text input is the
  primary accessible path.
- When the text input holds a non-hex value (`var(...)`, `transparent`,
  `color-mix(...)`), the color picker falls back to the resolved CSS variable
  value (via `getComputedStyle`), matching the existing `syncAllColorPickers`
  behavior.
- Validation messages go in an `aria-live="polite"` region, debounced.

---

## 5. Accordion / Disclosure Pattern

**Sources:**
- WAI-ARIA APG: <https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/>
- CSS Grid accordion: <https://codepen.io/DHawku/pen/vYzLNVK>
- <https://dev.to/grahamthedev/accessible-animated-accordion-in-pure-css-no-way-5980>
- <https://medium.com/@carmeladi/solving-dynamic-height-animations-with-native-css-tools-c96723db4382>

### WAI-ARIA disclosure pattern
- Use native `<details>`/`<summary>` when possible — the browser handles
  `aria-expanded` semantics and keyboard activation for free.
- If a custom disclosure is needed (for roving tabindex or styling), use
  `aria-expanded` on the trigger button and `aria-controls` pointing to the
  content panel's `id`.

### Animation without `max-height`
The classic `max-height` transition is brittle (requires guessing a max value,
causes jumps if content exceeds it). Two modern alternatives:

1. **CSS Grid `grid-template-rows: 0fr → 1fr`** — the preferred technique:
   ```css
   .accordion__content {
     display: grid;
     grid-template-rows: 0fr;
     transition: grid-template-rows 250ms ease;
   }
   .accordion--open .accordion__content {
     grid-template-rows: 1fr;
   }
   .accordion__content > div {
     overflow: hidden;
   }
   ```
   This animates from 0 to the content's natural height without JavaScript
   measurement. Supported in all Chromium-based browsers (VS Code's webview
   is Electron/Chromium).

2. **`interpolate-size: allow-keywords`** — the newest CSS feature that lets
   you transition `height: auto` directly. Not yet widely supported; the grid
   technique is the safer choice for VS Code's Chromium webview.

### `prefers-reduced-motion`
- Disable the grid transition entirely under `@media (prefers-reduced-motion: reduce)`.
- The accordion still works (content shows/hides instantly), just without
  the sliding animation.

### Implications for the modal
- Use native `<details>`/`<summary>` for accordion sections (Common, Messages,
  Tools, Diff, Markdown, Syntax) — the browser handles ARIA and keyboard.
- Style the disclosure with the grid `0fr → 1fr` technique for smooth
  animation without `max-height`.
- Chevron rotation: use `transform: rotate(90deg)` on the summary's chevron
  when open. `transform` is compositor-only (no layout trigger).

---

## 6. Dialog Pattern (WAI-ARIA)

**Sources:**
- <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>
- <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/dialog/>
- <https://testparty.ai/blog/modal-dialog-accessibility>
- <https://www.deque.com/blog/aria-modal-alert-dialogs-a11y-support-series-part-2/>

### Required semantics
- `role="dialog"` (or `aria-modal="true"` on a `<dialog>` element).
- `aria-labelledby` pointing to the dialog's title.
- `aria-describedby` pointing to the dialog's description (optional but recommended).

### Focus management
1. **On open**: move focus to the first interactive element (or a designated
   "primary" element) inside the dialog. Record the invoker for restoration.
2. **While open**: trap Tab focus within the dialog (Tab cycles through
   focusable elements; Shift+Tab cycles backwards).
3. **On close**: restore focus to the invoker (the element that opened the
   dialog). This is WCAG 2.4.3 (Focus Order).
4. **Escape key**: closes the dialog. If there are unsaved changes, prompt
   for confirmation (WCAG 2.1.2 — No Trap).

### `inert` and `aria-modal`
- ARIA 1.1 introduced `aria-modal="true"` to inform assistive technologies
  that content outside the dialog is inert.
- The `inert` HTML attribute is the modern way to make content non-interactive
  (removes it from the tab order and accessibility tree). Apply `inert` to
  the rest of the app while the dialog is open.
- The native `<dialog>` element with `.showModal()` handles both focus
  trapping and inertness automatically in supporting browsers.

### Native `<dialog>` element
- `dialog.showModal()` — opens as a top-layer modal (above all other content,
  with a `::backdrop` pseudo-element). No `z-index` needed.
- `dialog.close()` — closes the dialog.
- The `close` event fires on close (including ESC key).
- Focus is automatically trapped within the dialog.
- `::backdrop` can be styled for the dimming overlay.
- **Fallback**: if `<dialog>` is not supported (very old browsers), fall back
  to `role="dialog"` + `aria-modal="true"` + manual focus trap (the existing
  `mountModalFocus` pattern).

### Implications for the modal
- Use `<dialog>` with `.showModal()` — this gives us native focus trapping,
  ESC handling, backdrop, and top-layer stacking without manual `z-index`.
- The existing `focus-trap.ts` / `mountModalFocus` is a known defect (per the
  prompt). The `<dialog>` element replaces it entirely.
- On open, focus the first preset card. On close, restore focus to
  `#theme-customizer-btn`.
- No `position: fixed` — `<dialog>` handles stacking context natively.

---

## 7. Roving Tabindex

**Sources:**
- <https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/>
- <https://www.w3.org/WAI/ARIA/apg/patterns/radio/examples/radio/>
- <https://www.w3.org/WAI/ARIA/apg/patterns/radio/>

### Roving tabindex strategy
1. Only one element in the composite has `tabindex="0"` (included in the Tab
   sequence). All others have `tabindex="-1"` (focusable but not in Tab sequence).
2. When focus moves within the composite (via arrow keys), the newly focused
   element gets `tabindex="0"` and the previously focused one gets `tabindex="-1"`.
3. Tab and Shift+Tab move focus into and out of the composite normally.

### Radio group pattern (for preset grid)
- Container: `role="radiogroup"` with `aria-labelledby` or `aria-label`.
- Each option: `role="radio"` with `aria-checked="true"` or `"false"`.
- **Arrow Right/Down**: moves focus to the next radio, sets it to checked.
- **Arrow Left/Up**: moves focus to the previous radio, sets it to checked.
- **Home/End**: moves focus to the first/last radio.
- If focus moves to a radio that is not checked, it becomes checked.
- Only one radio is `tabindex="0"`; the rest are `tabindex="-1"`.

### Implications for the modal
- The preset grid uses `role="radiogroup"` with `role="radio"` cards and
  roving tabindex (Arrow keys + Home/End).
- The CLI theme list uses a listbox pattern (`role="listbox"` + `role="option"`).
- The accordion sections use native `<details>`/`<summary>` (no roving
  tabindex needed — each summary is independently focusable).

---

## 8. Motion & Performance

**Sources:**
- <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion>
- <https://www.w3.org/WAI/WCAG22/Techniques/css/C39>
- <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility>
- <https://www.css-scroll-driven.com/accessibility-inclusive-motion-standards/implementing-prefers-reduced-motion/how-to-respect-prefers-reduced-motion-in-css/>

### `prefers-reduced-motion`
- Detect via `@media (prefers-reduced-motion: reduce)`.
- Disable non-essential animations: transitions, keyframe animations, scroll-
  driven animations.
- Essential motion (e.g., a loading spinner) may be kept but should be slowed
  or simplified.
- WCAG 2.3.3 (Animation from Interactions) — technique C39.
- VS Code's webview respects the OS-level reduced-motion setting.

### `content-visibility: auto`
- Allows the browser to skip rendering work for off-screen elements.
- Off-screen content remains in the DOM and the accessibility tree — no
  accessibility impact.
- Useful for long accordion sections that are collapsed (their content is
  effectively off-screen).
- Pair with `contain-intrinsic-size` to avoid scrollbar jumping.

### `@layer`
- CSS cascade layers establish a deterministic specificity order.
- Our `styles.css` already uses `@layer tokens, base, layout, components, ...`.
- The new `theme-customizer.css` should be imported under `@layer components`.

### Layout-triggering properties to avoid animating
- `width`, `height`, `top`, `left`, `margin`, `padding` — trigger layout.
- **Safe to animate**: `transform`, `opacity`, `filter`, `background-color`,
  `color` — compositor-only or paint-only.
- The accordion grid technique (`grid-template-rows: 0fr → 1fr`) is a layout
  property but is handled efficiently by the browser in Chromium.

### Implications for the modal
- All animations use `transform` (chevron rotate, card hover) and `opacity`
  (backdrop fade, focus ring).
- The accordion uses `grid-template-rows` transition (the one layout-property
  exception, handled efficiently in Chromium).
- Under `@media (prefers-reduced-motion: reduce)`, disable all transitions
  and animations.
- Use `content-visibility: auto` on collapsed accordion content panels.

---

## 9. Touch & Mixed-Input

### `pointer` media query
- `@media (hover: none) and (pointer: coarse)` — touch-only device.
- `@media (hover: hover) and (pointer: fine)` — mouse/trackpad.
- VS Code's webview reports the host device's pointer type.

### Minimum tap targets
- WCAG 2.5.5 (Target Size — AAA): 44×44 CSS pixels.
- WCAG 2.5.8 (Target Size Minimum — AA 2.2): 24×24 CSS pixels.
- Apple HIG: 44×44 pt.
- The existing `layout.css` already has a `@media (hover: none) and (pointer: coarse)`
  block that bumps `.theme-color-picker` and `.theme-customizer-actions button`
  to 44px. The new design should preserve and extend this.

### Implications for the modal
- All interactive elements (preset cards, color pickers, hex inputs, buttons,
  accordion headers) meet 44×44px minimum on touch devices.
- The preset grid collapses to 2 columns on narrow viewports.
- The action bar stacks vertically on narrow viewports.

---

## 10. Extension-Host Bridge Contract

### Existing message types (confirmed from `main.ts` + `ThemeController.ts`)

| Direction | Type | Payload | Handler |
|---|---|---|---|
| webview → host | `get_theme_config` | `{}` | `ThemeController.pushThemeConfigToWebview()` |
| webview → host | `update_theme_config` | `{ theme: { preset, overrides } }` | `ThemeController.handleUpdateThemeConfig()` |
| webview → host | `list_cli_themes` | `{}` | `ThemeManager.discoverCliThemes()` → `cli_themes_list` |
| host → webview | `theme_vars` | `{ vars: Record<string,string> }` | `applyThemeVars()` in `main.ts` |
| host → webview | `theme_config` | `{ theme: { preset, overrides } }` | `applyThemeCustomizerConfig()` |
| host → webview | `theme_config_error` | `{ error: string }` | `console.error` + `alert()` |
| host → webview | `cli_themes_list` | `{ themes: Array<{name,source}> }` | `populateCliList()` |

### Validation (from `ThemeController.ts`)
- `preset` must be one of: `cli-default`, `light`, `dark`, `high-contrast`,
  `high-contrast-dark`, `high-contrast-light`.
- `overrides` keys must match `^[A-Za-z][A-Za-z0-9]*$` (alphanumeric, max 64 chars).
- `overrides` values must be strings (max 200 chars) that pass `isValidCssColor()`.
- `isValidCssColor()` accepts: 3/6/8-digit hex, `rgba()`, `hsla()`, `var(--*)`,
  `transparent`, `color-mix()`.

### New message types needed
- **`reset_theme_config`** (webview → host): sent by the "Restore Defaults"
  button. The host clears all overrides and sets `preset` to `cli-default`.
  Alternatively, the webview can send `update_theme_config` with
  `{ preset: "cli-default", overrides: {} }` — no new message type needed.

### Implications for the modal
- Keep the existing message types; no new ones are strictly required.
- The "Restore Defaults" button sends `update_theme_config` with empty
  overrides and `preset: "cli-default"`.
- The `theme_config_error` handler should show an inline toast instead of
  `alert()` (the current `alert()` blocks the UI thread).

---

## 11. Existing Codebase Findings

### `src/chat/webview/ui/themeCustomizer.ts` (current implementation)
- **327 lines**, single module handling setup, open/close, preset selection,
  CLI search, color input sync, preview swatch, and validation.
- Uses `mountModalFocus` from `focus-trap.ts` for focus trapping (the known
  defect — no `inert`, no `<dialog>`, manual Tab trap only).
- `isValidColorFormat()` is a local duplicate of `isValidCssColor()` from
  `src/utils/colorValidation.ts` — should be replaced by the shared validator.
- `resolveCssVarToHex()` creates a temporary `<div>` to resolve CSS variables
  via `getComputedStyle` — works but is not debounced (called on every input
  change). The new implementation should debounce.
- `activePreset` is a module-level mutable variable — survives panel hide/show
  but the prompt says "never rely on webview-internal state surviving a panel
  hide/show cycle." The new implementation should re-fetch from the host on
  every open via `get_theme_config`.

### `src/chat/webview/css/layout.css` (current theme styles)
- Lines 3116–3395 contain `.theme-customizer-*` rules.
- Responsive breakpoints at 640px, 500px, and 600px (height).
- Touch-target bumps at `@media (hover: none) and (pointer: coarse)`.
- These will be replaced by the new `theme-customizer.css`.

### `src/chat/webview/css/tokens.css`
- 612 lines of design tokens, already organized with comments.
- Uses `@layer tokens` via `styles.css`.
- Has spacing, typography, radius, shadow, animation, z-index scales.
- Missing: semantic theme-customizer tokens (panel, surface, border, focus,
  swatch, preview). These will be added in Phase 2.

### `src/chat/ThemeController.ts`
- 80 lines. Validates and saves theme config to VS Code settings.
- `normalizeThemeConfig()` filters overrides by `isValidCssColor()`.
- No changes needed for the bridge contract — the new modal sends the same
  message shapes.

### `src/theme/contrast.ts`
- Pure WCAG luminance/contrast helpers (`parseHex`, `relativeLuminance`,
  `contrastRatio`, `meetsAA`).
- Already tested in `contrast.test.ts` with preset contrast-lint tests.
- The new modal can reuse `contrastRatio()` to show a live contrast warning
  when the user picks a foreground/background pair that fails WCAG AA.

---

## 12. Summary of Key Decisions

| Decision | Rationale | Source |
|---|---|---|
| Use `<dialog>.showModal()` | Native focus trap, ESC, backdrop, top-layer — no manual z-index | WAI-ARIA APG, MDN |
| Use `<details>`/`<summary>` for accordion | Browser handles ARIA + keyboard; just add styling | WAI-ARIA APG |
| CSS Grid `0fr → 1fr` for accordion animation | No `max-height` guessing; works in Chromium | CSS Grid accordion articles |
| `role="radiogroup"` for preset grid | Single-select semantics; roving tabindex | WAI-ARIA Radio Group Pattern |
| Pair `<input type="color">` with text input | Screen reader support varies; text input is the accessible fallback | MDN, a11ysupport.io |
| `:focus-visible` only (never `:focus`) | Avoids focus ring for mouse clicks; required by prompt | WCAG 2.4.7, 2.4.8 |
| `@media (prefers-reduced-motion: reduce)` | WCAG 2.3.3; VS Code respects OS setting | MDN, WAI C39 |
| 44×44px minimum tap targets on touch | WCAG 2.5.5 (AAA), Apple HIG | Existing `layout.css` already does this |
| Keep existing `postMessage` contract | No new message types needed; `update_theme_config` covers all actions | `ThemeController.ts` |
| Reuse `contrastRatio()` for live contrast warnings | Already tested; prevents inaccessible color pairs | `src/theme/contrast.ts` |
| Replace local `isValidColorFormat()` with shared `isValidCssColor()` | DRY; the shared validator is already the source of truth | `src/utils/colorValidation.ts` |
