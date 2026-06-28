import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  createGetThemeConfigMsg,
  createUpdateThemeConfigMsg,
  createListCliThemesMsg,
  isThemeMessage,
  asThemeConfigMsg,
  asCliThemesListMsg,
  asThemeConfigErrorMsg,
} from "./themeBridge"

describe("themeBridge — message factories", () => {
  it("createGetThemeConfigMsg returns correct type", () => {
    assert.deepEqual(createGetThemeConfigMsg(), { type: "get_theme_config" })
  })

  it("createUpdateThemeConfigMsg wraps preset and overrides", () => {
    const msg = createUpdateThemeConfigMsg("dark", { accentColor: "#fff" })
    assert.equal(msg.type, "update_theme_config")
    assert.equal(msg.theme.preset, "dark")
    assert.deepEqual(msg.theme.overrides, { accentColor: "#fff" })
  })

  it("createListCliThemesMsg returns correct type", () => {
    assert.deepEqual(createListCliThemesMsg(), { type: "list_cli_themes" })
  })
})

describe("themeBridge — isThemeMessage", () => {
  it("returns true for all recognized theme message types", () => {
    assert.equal(isThemeMessage({ type: "theme_vars", vars: {} }), true)
    assert.equal(isThemeMessage({ type: "theme_config", theme: {} }), true)
    assert.equal(isThemeMessage({ type: "theme_config_error", error: "x" }), true)
    assert.equal(isThemeMessage({ type: "cli_themes_list", themes: [] }), true)
  })

  it("returns false for non-theme messages", () => {
    assert.equal(isThemeMessage({ type: "stream_start" }), false)
    assert.equal(isThemeMessage({ type: "tool_start" }), false)
    assert.equal(isThemeMessage({}), false)
    assert.equal(isThemeMessage(null), false)
    assert.equal(isThemeMessage("string"), false)
  })
})

describe("themeBridge — asThemeConfigMsg", () => {
  it("narrowts a valid theme_config message", () => {
    const msg = asThemeConfigMsg({ type: "theme_config", theme: { preset: "dark" } })
    assert.ok(msg)
    assert.equal(msg!.type, "theme_config")
    assert.equal(msg!.theme.preset, "dark")
  })

  it("returns null for non-theme_config messages", () => {
    assert.equal(asThemeConfigMsg({ type: "theme_vars" }), null)
  })

  it("returns null when theme field is missing", () => {
    assert.equal(asThemeConfigMsg({ type: "theme_config" }), null)
  })
})

describe("themeBridge — asCliThemesListMsg", () => {
  it("narrows a valid cli_themes_list message", () => {
    const msg = asCliThemesListMsg({
      type: "cli_themes_list",
      themes: [{ name: "tokyonight", source: "file" }],
    })
    assert.ok(msg)
    assert.equal(msg!.themes.length, 1)
    assert.equal(msg!.themes[0]!.name, "tokyonight")
  })

  it("returns null when themes is not an array", () => {
    assert.equal(asCliThemesListMsg({ type: "cli_themes_list", themes: "not-array" }), null)
  })

  it("returns null for non-cli_themes_list messages", () => {
    assert.equal(asCliThemesListMsg({ type: "theme_config" }), null)
  })
})

describe("themeBridge — asThemeConfigErrorMsg", () => {
  it("narrows a valid theme_config_error message", () => {
    const msg = asThemeConfigErrorMsg({ type: "theme_config_error", error: "Invalid color" })
    assert.ok(msg)
    assert.equal(msg!.error, "Invalid color")
  })

  it("provides a default error string when missing", () => {
    const msg = asThemeConfigErrorMsg({ type: "theme_config_error" })
    assert.ok(msg)
    assert.equal(msg!.error, "Unknown error")
  })

  it("returns null for non-error messages", () => {
    assert.equal(asThemeConfigErrorMsg({ type: "theme_config" }), null)
  })
})
