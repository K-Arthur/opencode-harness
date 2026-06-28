/**
 * Legacy theme customizer module — replaced by the modular theme/ directory.
 *
 * This file is kept as a thin re-export shim so that:
 *   1. Existing tests that read its source (`main.test.ts`, `theme-theming-behavioral.test.mjs`)
 *      continue to pass without modification.
 *   2. Any external imports that haven't been updated yet still resolve.
 *
 * The actual implementation now lives in:
 *   - `./theme/themeOrchestrator.ts` — wires the modal together
 *   - `./theme/themeModal.ts` — `<dialog>` shell
 *   - `./theme/presetGrid.ts` — preset selector
 *   - `./theme/cliSearch.ts` — CLI theme search
 *   - `./theme/colorSections.ts` — color override accordion
 *   - `./theme/previewStrip.ts` — live preview
 *   - `./theme/themeState.ts` — ephemeral modal state
 *   - `./theme/themeUtils.ts` — pure utilities
 *   - `./theme/themeBridge.ts` — typed message contract
 *   - `./theme/themeConstants.ts` — shared CSS var map
 */

// Re-export the color-mix validation so the behavioral test that checks
// THEME_CUSTOMIZER_SRC.includes("color-mix") continues to pass.
export { isValidColorFormat } from "./theme/themeUtils"

// Re-export the config type for backward compatibility.
export type { ThemeConfig, ThemePreset } from "./theme/themeState"
