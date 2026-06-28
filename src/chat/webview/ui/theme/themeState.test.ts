import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createThemeState } from "./themeState"

describe("themeState — initial state", () => {
  it("defaults to cli-default preset with no overrides", () => {
    const state = createThemeState()
    assert.equal(state.getPreset(), "cli-default")
    assert.deepEqual(state.getOverrides(), {})
  })

  it("accepts initial config", () => {
    const state = createThemeState({ preset: "dark", overrides: { accentColor: "#ff0000" } })
    assert.equal(state.getPreset(), "dark")
    assert.deepEqual(state.getOverrides(), { accentColor: "#ff0000" })
  })
})

describe("themeState — setPreset", () => {
  it("changes the preset and clears overrides", () => {
    const state = createThemeState({ preset: "light", overrides: { accentColor: "#fff" } })
    state.setPreset("dark")
    assert.equal(state.getPreset(), "dark")
    assert.deepEqual(state.getOverrides(), {}, "overrides cleared on preset change")
  })
})

describe("themeState — setOverride", () => {
  it("adds an override", () => {
    const state = createThemeState()
    state.setOverride("accentColor", "#0078d4")
    assert.deepEqual(state.getOverrides(), { accentColor: "#0078d4" })
  })

  it("removes an override when value is empty", () => {
    const state = createThemeState({ overrides: { accentColor: "#fff" } })
    state.setOverride("accentColor", "")
    assert.deepEqual(state.getOverrides(), {})
  })

  it("trims whitespace from values", () => {
    const state = createThemeState()
    state.setOverride("panelBg", "  #1e1e2e  ")
    assert.deepEqual(state.getOverrides(), { panelBg: "#1e1e2e" })
  })
})

describe("themeState — removeOverride", () => {
  it("removes a specific override", () => {
    const state = createThemeState({ overrides: { accentColor: "#fff", panelBg: "#000" } })
    state.removeOverride("accentColor")
    assert.deepEqual(state.getOverrides(), { panelBg: "#000" })
  })
})

describe("themeState — clearOverrides", () => {
  it("clears all overrides keeping the preset", () => {
    const state = createThemeState({ preset: "dark", overrides: { a: "#1", b: "#2" } })
    state.clearOverrides()
    assert.equal(state.getPreset(), "dark")
    assert.deepEqual(state.getOverrides(), {})
  })
})

describe("themeState — isDirty", () => {
  it("is false initially with no overrides", () => {
    const state = createThemeState()
    assert.equal(state.isDirty(), false)
  })

  it("is true when overrides exist", () => {
    const state = createThemeState()
    state.setOverride("accentColor", "#fff")
    assert.equal(state.isDirty(), true)
  })

  it("is false after snapshot when state matches", () => {
    const state = createThemeState({ overrides: { accentColor: "#fff" } })
    state.snapshot()
    assert.equal(state.isDirty(), false)
  })

  it("is true after snapshot when state changes", () => {
    const state = createThemeState({ overrides: { accentColor: "#fff" } })
    state.snapshot()
    state.setOverride("accentColor", "#000")
    assert.equal(state.isDirty(), true)
  })

  it("is true when preset changes after snapshot", () => {
    const state = createThemeState({ preset: "light" })
    state.snapshot()
    state.setPreset("dark")
    assert.equal(state.isDirty(), true)
  })
})

describe("themeState — snapshot/restore", () => {
  it("snapshot captures current state", () => {
    const state = createThemeState({ preset: "dark", overrides: { a: "#1" } })
    const snap = state.snapshot()
    assert.equal(snap.preset, "dark")
    assert.deepEqual(snap.overrides, { a: "#1" })
  })

  it("restore reverts to the snapshot", () => {
    const state = createThemeState({ preset: "light", overrides: { a: "#1" } })
    state.snapshot()
    state.setPreset("dark")
    state.setOverride("b", "#2")
    const restored = state.restore()
    assert.equal(restored, true)
    assert.equal(state.getPreset(), "light")
    assert.deepEqual(state.getOverrides(), { a: "#1" })
  })

  it("restore returns false when no snapshot exists", () => {
    const state = createThemeState()
    assert.equal(state.restore(), false)
  })
})

describe("themeState — hydrate", () => {
  it("replaces state from host config", () => {
    const state = createThemeState({ preset: "light", overrides: { a: "#1" } })
    state.hydrate({ preset: "dark", overrides: { b: "#2" } })
    assert.equal(state.getPreset(), "dark")
    assert.deepEqual(state.getOverrides(), { b: "#2" })
  })

  it("clears undo snapshot on hydrate", () => {
    const state = createThemeState()
    state.snapshot()
    state.hydrate({ preset: "light" })
    assert.equal(state.restore(), false, "no snapshot after hydrate")
  })

  it("handles undefined config gracefully", () => {
    const state = createThemeState({ preset: "dark", overrides: { a: "#1" } })
    state.hydrate(undefined)
    assert.equal(state.getPreset(), "cli-default")
    assert.deepEqual(state.getOverrides(), {})
  })
})

describe("themeState — getConfig", () => {
  it("returns a copy of the full config", () => {
    const state = createThemeState({ preset: "dark", overrides: { accentColor: "#fff" } })
    const config = state.getConfig()
    assert.equal(config.preset, "dark")
    assert.deepEqual(config.overrides, { accentColor: "#fff" })
    // Mutating the returned config must not affect state
    ;(config.overrides as Record<string, string>)["newKey"] = "#000"
    assert.deepEqual(state.getOverrides(), { accentColor: "#fff" })
  })
})
