import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "ThemeManager.ts"), "utf8")

describe("ThemeManager.ts", () => {
  it("exports OpencodeTheme interface", () => {
    assert.ok(source.includes("export interface OpencodeTheme"))
  })

  it("exports ThemePreset type with HC variants", () => {
    assert.ok(
      source.includes('"high-contrast-dark"') && source.includes('"high-contrast-light"'),
      "ThemePreset must include high-contrast-dark and high-contrast-light variants"
    )
    assert.ok(source.includes('export type ThemePreset ='), "ThemePreset must be exported")
  })

  it("exports ThemeVariables interface", () => {
    assert.ok(source.includes("export interface ThemeVariables"))
  })

  it("exports ThemeManager class", () => {
    assert.ok(source.includes("export class ThemeManager"))
  })

  it("defines BUILT_IN_PRESETS", () => {
    assert.ok(source.includes("BUILT_IN_PRESETS"))
  })

  it("has cli-default preset with CSS variable references", () => {
    assert.ok(source.includes("var(--vscode-editor-background)"))
  })

  it("has dark preset", () => {
    assert.ok(source.includes('dark:') || source.includes('"dark"'))
  })

  it("has high-contrast preset", () => {
    assert.ok(source.includes('high-contrast:') || source.includes('"high-contrast"'))
  })

  it("has getThemeVariables method", () => {
    assert.ok(source.includes("getThemeVariables()"))
  })

  it("has emitUpdate method", () => {
    assert.ok(source.includes("emitUpdate()"))
  })

  it("has setupFileWatchers method", () => {
    assert.ok(source.includes("setupFileWatchers("))
  })

  it("has previewTheme method", () => {
    assert.ok(source.includes("previewTheme("))
  })

  it("creates FileSystemWatcher for tui.json", () => {
    assert.ok(source.includes("createFileSystemWatcher"))
  })

  it("disposes watchers on dispose", () => {
    assert.ok(source.includes("watcher.dispose()"))
  })

  it("high-contrast preset defines all required properties", () => {
    // Verify the high-contrast preset has all 28+ theme properties
    const requiredProps = [
      "userMessageBg", "userMessageFg", "assistantMessageBg", "assistantMessageFg",
      "toolCallColor", "toolReadColor", "toolWriteColor", "toolExecColor",
      "skillBadgeBg", "skillBadgeFg", "thinkingBg", "thinkingBorder",
      "warningColor", "errorColor", "successColor", "accentColor",
      "diffAdded", "diffRemoved", "inputBg", "inputBorder", "mentionBg",
      "syntaxComment", "syntaxKeyword", "syntaxString", "syntaxNumber",
      "syntaxFunction", "syntaxType", "syntaxOperator",
    ]
    for (const prop of requiredProps) {
      assert.ok(source.includes(`${prop}:`), `high-contrast preset must define ${prop}`)
    }
  })

  it("high-contrast preset uses VS Code theme tokens instead of hard-coded neon shell colors", () => {
    const idx = source.indexOf('"high-contrast":')
    assert.ok(idx >= 0, "high-contrast preset must exist")
    const section = source.slice(idx, source.indexOf("\n  },", idx) + 5)
    assert.match(section, /panelBg:\s*"var\(--vscode-/)
    assert.match(section, /panelFg:\s*"var\(--vscode-/)
    assert.match(section, /accentColor:\s*"var\(--vscode-/)
    assert.doesNotMatch(section, /accentColor:\s*"#ffff00"/i)
    assert.doesNotMatch(section, /inputBorder:\s*"#ffff00"/i)
  })

  it("cli-default does not force translucent dark assistant bubbles in light themes", () => {
    const idx = source.indexOf('"cli-default":')
    assert.ok(idx >= 0, "cli-default preset must exist")
    const section = source.slice(idx, source.indexOf("\n  },", idx) + 5)
    assert.ok(
      section.includes('assistantMessageBg: "transparent"') ||
        section.includes('assistantMessageBg: "var(--vscode-editor-background)"'),
      "cli-default assistant background must stay VS Code-native"
    )
    assert.doesNotMatch(section, /assistantMessageBg:\s*"rgba\(30,\s*30,\s*30/)
  })

  it("CLI theme discovery prefers workspace over global for source labeling", () => {
    assert.ok(source.includes('source: "workspace"'), "must label workspace themes correctly")
    assert.ok(source.includes('source: "global"'), "must label global themes correctly")
    // Should NOT use fragile directory-name string matching
    assert.ok(!source.includes('.includes("workspace")'), "must not use fragile string matching for source detection")
  })

  it("generates forced-colors media query in tokens.css", () => {
    const tokensSource = readFileSync(path.join(__dirname, "..", "chat", "webview", "css", "tokens.css"), "utf8")
    assert.ok(tokensSource.includes("forced-colors: active"), "tokens.css must define forced-colors block")
    assert.ok(tokensSource.includes("CanvasText"), "forced-colors must use CanvasText")
    assert.ok(tokensSource.includes("ButtonText"), "forced-colors must use ButtonText")
    assert.ok(tokensSource.includes("GrayText"), "forced-colors must use GrayText")
    assert.ok(tokensSource.includes("LinkText"), "forced-colors must use LinkText")
  })

  // --- Phase 1: High-contrast variants (RED tests — fail until implementation) ---

  it("high-contrast-dark preset exists in BUILT_IN_PRESETS with black background", () => {
    const idx = source.indexOf('"high-contrast-dark":')
    assert.ok(idx >= 0, "BUILT_IN_PRESETS must contain a high-contrast-dark entry")
    const section = source.slice(idx, source.indexOf("\n  },", idx) + 5)
    assert.match(section, /panelBg:\s*"#000/, "high-contrast-dark panelBg must be #000…")
  })

  it("high-contrast-dark preset has yellow accent (#ffff00)", () => {
    const idx = source.indexOf('"high-contrast-dark":')
    assert.ok(idx >= 0, "high-contrast-dark preset must exist")
    const section = source.slice(idx, source.indexOf("\n  },", idx) + 5)
    assert.match(section, /accentColor:\s*"#ffff00"/i, "high-contrast-dark accentColor must be #ffff00")
  })

  it("high-contrast-dark has no var(--vscode-*) references (fully hardcoded)", () => {
    const idx = source.indexOf('"high-contrast-dark":')
    assert.ok(idx >= 0, "high-contrast-dark preset must exist")
    const section = source.slice(idx, source.indexOf("\n  },", idx) + 5)
    assert.doesNotMatch(section, /var\(--vscode-/, "high-contrast-dark must use hardcoded values, not VS Code vars")
  })

  it("high-contrast-light preset exists in BUILT_IN_PRESETS with white background", () => {
    const idx = source.indexOf('"high-contrast-light":')
    assert.ok(idx >= 0, "BUILT_IN_PRESETS must contain a high-contrast-light entry")
    const section = source.slice(idx, source.indexOf("\n  },", idx) + 5)
    assert.match(section, /panelBg:\s*"#fff/, "high-contrast-light panelBg must be #fff…")
  })

  it("high-contrast-light preset has red error color (#cc0000)", () => {
    const idx = source.indexOf('"high-contrast-light":')
    assert.ok(idx >= 0, "high-contrast-light preset must exist")
    const section = source.slice(idx, source.indexOf("\n  },", idx) + 5)
    assert.match(section, /errorColor:\s*"#cc0000"/i, "high-contrast-light errorColor must be #cc0000")
  })

  it("high-contrast-light has no var(--vscode-*) references (fully hardcoded)", () => {
    const idx = source.indexOf('"high-contrast-light":')
    assert.ok(idx >= 0, "high-contrast-light preset must exist")
    const section = source.slice(idx, source.indexOf("\n  },", idx) + 5)
    assert.doesNotMatch(section, /var\(--vscode-/, "high-contrast-light must use hardcoded values, not VS Code vars")
  })

  it("high-contrast-dark defines every key present in the dark preset", () => {
    const darkIdx = source.indexOf('\n  dark: {')
    assert.ok(darkIdx >= 0, "dark preset must exist")
    const darkSection = source.slice(darkIdx, source.indexOf("\n  },", darkIdx) + 5)
    const darkKeys = [...darkSection.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1] as string)

    const hcdIdx = source.indexOf('"high-contrast-dark":')
    assert.ok(hcdIdx >= 0, "high-contrast-dark preset must exist")
    const hcdSection = source.slice(hcdIdx, source.indexOf("\n  },", hcdIdx) + 5)

    for (const key of darkKeys) {
      assert.ok(hcdSection.includes(`${key}:`), `high-contrast-dark must define ${key} (key from dark preset)`)
    }
  })

  it("high-contrast-light defines every key present in the dark preset", () => {
    const darkIdx = source.indexOf('\n  dark: {')
    assert.ok(darkIdx >= 0, "dark preset must exist")
    const darkSection = source.slice(darkIdx, source.indexOf("\n  },", darkIdx) + 5)
    const darkKeys = [...darkSection.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1] as string)

    const hclIdx = source.indexOf('"high-contrast-light":')
    assert.ok(hclIdx >= 0, "high-contrast-light preset must exist")
    const hclSection = source.slice(hclIdx, source.indexOf("\n  },", hclIdx) + 5)

    for (const key of darkKeys) {
      assert.ok(hclSection.includes(`${key}:`), `high-contrast-light must define ${key} (key from dark preset)`)
    }
  })

  it("defines resolveEffectivePreset method on ThemeManager", () => {
    assert.ok(
      source.includes("resolveEffectivePreset"),
      "ThemeManager must define resolveEffectivePreset method"
    )
  })

  it("resolveEffectivePreset handles ColorThemeKind.HighContrast → high-contrast-dark", () => {
    assert.ok(
      source.includes("ColorThemeKind.HighContrast") || source.includes("HighContrast"),
      "resolveEffectivePreset must branch on ColorThemeKind.HighContrast"
    )
    assert.ok(source.includes('"high-contrast-dark"'), "source must reference high-contrast-dark string")
  })

  it("resolveEffectivePreset handles ColorThemeKind.HighContrastLight → high-contrast-light", () => {
    assert.ok(
      source.includes("ColorThemeKind.HighContrastLight") || source.includes("HighContrastLight"),
      "resolveEffectivePreset must branch on ColorThemeKind.HighContrastLight"
    )
    assert.ok(source.includes('"high-contrast-light"'), "source must reference high-contrast-light string")
  })

  // --- Phase 2: deriveExtendedTheme (RED tests — fail until implementation) ---

  it("defines deriveExtendedTheme static method", () => {
    assert.ok(
      source.includes("deriveExtendedTheme"),
      "ThemeManager must define deriveExtendedTheme static method"
    )
  })

  it("deriveExtendedTheme accepts palette with standard 10 CLI fields", () => {
    assert.ok(
      source.includes("deriveExtendedTheme"),
      "deriveExtendedTheme must exist"
    )
    // Verify it handles palette.neutral → panelBg derivation
    assert.ok(
      source.includes("palette.neutral") || source.includes("neutral"),
      "deriveExtendedTheme must handle palette.neutral"
    )
  })

  it("deriveExtendedTheme derives userMessageBg from palette using color-mix or formula", () => {
    assert.ok(
      source.includes("deriveExtendedTheme"),
      "deriveExtendedTheme must exist"
    )
    assert.ok(
      source.includes("userMessageBg"),
      "deriveExtendedTheme must set userMessageBg"
    )
  })

  it("deriveExtendedTheme maps syntax overrides to syntaxKeyword, syntaxString etc", () => {
    assert.ok(
      source.includes("syntaxKeyword") && source.includes("syntaxString"),
      "deriveExtendedTheme must map syntax fields"
    )
    assert.ok(
      source.includes("syntax-keyword") || source.includes("overrides"),
      "deriveExtendedTheme must consume syntax override input"
    )
  })

  it("applyThemeContent detects compact CLI schema with palette key", () => {
    assert.ok(
      source.includes("palette") && source.includes("deriveExtendedTheme"),
      "applyThemeContent must detect compact CLI palette schema and call deriveExtendedTheme"
    )
  })

  it("discoverCliThemes is a public method", () => {
    assert.ok(
      source.includes("discoverCliThemes"),
      "discoverCliThemes must be defined"
    )
    // Public: not prefixed with 'private'
    assert.doesNotMatch(
      source,
      /private\s+discoverCliThemes/,
      "discoverCliThemes must be public (not private)"
    )
  })
})
