/**
 * Ephemeral modal state for the theme customizer.
 *
 * Holds the currently-selected preset, the working set of color overrides,
 * a dirty flag, and an undo snapshot. This state is per-modal-session — it
 * does NOT survive panel hide/show cycles. The host's VS Code settings
 * (`opencode.theme`) are the source of truth; this state is hydrated from the
 * host on every open via `get_theme_config`.
 */

export type ThemePreset =
  | "cli-default"
  | "light"
  | "dark"
  | "high-contrast"
  | "high-contrast-dark"
  | "high-contrast-light"

export interface ThemeConfig {
  preset: ThemePreset
  overrides: Record<string, string>
}

export interface ThemeStateSnapshot {
  preset: ThemePreset
  overrides: Record<string, string>
}

/**
 * Create a new theme state manager for the customizer modal.
 *
 * @param initial - The initial config hydrated from the host (or defaults).
 * @returns A state object with methods to read/mutate/snapshot the state.
 */
export function createThemeState(initial?: Partial<ThemeConfig>) {
  let preset: ThemePreset = initial?.preset ?? "cli-default"
  let overrides: Record<string, string> = { ...(initial?.overrides ?? {}) }
  let undoSnapshot: ThemeStateSnapshot | null = null

  return {
    /** Get the current preset. */
    getPreset(): ThemePreset {
      return preset
    },

    /** Get the current overrides map (a copy to prevent external mutation). */
    getOverrides(): Record<string, string> {
      return { ...overrides }
    },

    /** Get the full config as a snapshot. */
    getConfig(): ThemeConfig {
      return { preset, overrides: { ...overrides } }
    },

    /**
     * Set the preset. Clears all overrides (matching the existing behavior —
     * switching presets resets per-color overrides).
     * @param newPreset - The preset to switch to.
     */
    setPreset(newPreset: ThemePreset): void {
      preset = newPreset
      overrides = {}
    },

    /**
     * Set a single color override. Empty/whitespace values remove the override.
     * @param key - The override key (e.g. `accentColor`).
     * @param value - The color value (hex, rgba, var, transparent, color-mix).
     */
    setOverride(key: string, value: string): void {
      const trimmed = value.trim()
      if (trimmed) {
        overrides[key] = trimmed
      } else {
        delete overrides[key]
      }
    },

    /**
     * Remove a single color override.
     * @param key - The override key to remove.
     */
    removeOverride(key: string): void {
      delete overrides[key]
    },

    /** Clear all overrides, keeping the current preset. */
    clearOverrides(): void {
      overrides = {}
    },

    /**
     * Check whether the state differs from the last snapshot.
     * @returns `true` if there are unsaved changes.
     */
    isDirty(): boolean {
      if (!undoSnapshot) return Object.keys(overrides).length > 0
      if (undoSnapshot.preset !== preset) return true
      const snapKeys = Object.keys(undoSnapshot.overrides)
      const curKeys = Object.keys(overrides)
      if (snapKeys.length !== curKeys.length) return true
      for (const key of curKeys) {
        if (undoSnapshot.overrides[key] !== overrides[key]) return true
      }
      return false
    },

    /**
     * Take a snapshot of the current state for undo. Call this before an
     * action that mutates state (e.g. before "Restore Defaults") so the user
     * can undo.
     */
    snapshot(): ThemeStateSnapshot {
      undoSnapshot = { preset, overrides: { ...overrides } }
      return undoSnapshot
    },

    /**
     * Restore the last snapshot taken by `snapshot()`.
     * @returns `true` if a snapshot was restored, `false` if none existed.
     */
    restore(): boolean {
      if (!undoSnapshot) return false
      preset = undoSnapshot.preset
      overrides = { ...undoSnapshot.overrides }
      return true
    },

    /**
     * Hydrate the state from a host config (called on modal open).
     * @param config - The config from the host.
     */
    hydrate(config: Partial<ThemeConfig> | undefined): void {
      preset = config?.preset ?? "cli-default"
      overrides = { ...(config?.overrides ?? {}) }
      undoSnapshot = null
    },
  }
}

export type ThemeState = ReturnType<typeof createThemeState>
