/**
 * CSS coverage structural test — asserts that every CSS class emitted by the
 * subagent card, subagent panel, and file-edit card renderers has at least
 * one matching rule in the bundled CSS files.
 *
 * Why this exists: the ephemeral working-tree process (`git stash`/`git reset`)
 * can silently wipe uncommitted CSS changes. Visual tests only assert DOM
 * structure and text content, not computed styles, so missing CSS rules go
 * undetected until a user notices the visual regression. This test catches
 * the exact failure mode: a renderer emits a class that has no CSS rule.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const cssDir = __dirname
const rendererDir = path.join(__dirname, "..")

// Read all bundled CSS files (the same ones esbuild concatenates).
function readAllCss(): string {
  const files = readdirSync(cssDir).filter((f) => f.endsWith(".css"))
  return files.map((f) => readFileSync(path.join(cssDir, f), "utf8")).join("\n")
}

// Tool class values from ToolCallBlock.class — not CSS classes.
const NON_CSS_CLASSES = new Set(["read", "write", "exec", "mixed", "tool"])

// Extract class names from a TypeScript renderer file.
function extractClasses(filePath: string): Set<string> {
  const src = readFileSync(filePath, "utf8")
  const classes = new Set<string>()
  // Match className = "...", classList.add("..."), classList.toggle("..."),
  // createElement("...").className = "...", and template literals with class="..."
  const patterns = [
    /className\s*=\s*["'`]([^"'`]+)["'`]/g,
    /classList\.add\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /classList\.toggle\(\s*["'`]([^"'`]+)["'`]/g,
    /class="([^"]+)"/g,
    /class:\s*["'`]([^"'`]+)["'`]/g,
  ]
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(src)) !== null) {
      const captured = match[1]
      if (!captured) continue
      for (const cls of captured.split(/\s+/)) {
        const trimmed = cls.trim()
        if (trimmed && !trimmed.includes("${") && !NON_CSS_CLASSES.has(trimmed)) {
          classes.add(trimmed)
        }
      }
    }
  }
  return classes
}

describe("CSS coverage — renderer classes must have CSS rules", () => {
  const allCss = readAllCss()

  const renderers = [
    { name: "subagentCard.ts", file: path.join(rendererDir, "subagentCard.ts") },
    { name: "fileEditCard.ts", file: path.join(rendererDir, "fileEditCard.ts") },
  ]

  for (const { name, file } of renderers) {
    it(`${name} — every class has at least one CSS rule`, () => {
      const classes = extractClasses(file)
      const missing: string[] = []
      for (const cls of classes) {
        // Skip generic utility classes and dynamic state classes that are
        // constructed at runtime (e.g. `subagent-card--${state}`).
        if (cls.includes("--") && !allCss.includes(cls)) {
          // Check if the base pattern exists (e.g. "subagent-card--completed")
          // by looking for the class selector in CSS.
          const selector = `.${cls}`
          if (!allCss.includes(selector)) {
            missing.push(cls)
          }
        } else if (!allCss.includes(`.${cls}`)) {
          missing.push(cls)
        }
      }
      if (missing.length > 0) {
        assert.fail(
          `${name} emits classes with no CSS rule (CSS may have been wiped by ephemeral-tree reset):\n` +
            missing.map((c) => `  .${c}`).join("\n")
        )
      }
    })
  }

  it("subagent panel state classes have CSS rules", () => {
    const stateClasses = [
      "subagent-item--running",
      "subagent-item--completed",
      "subagent-item--failed",
      "subagent-item--collapsed",
    ]
    const missing = stateClasses.filter((cls) => !allCss.includes(`.${cls}`))
    if (missing.length > 0) {
      assert.fail(
        `Subagent panel state classes missing CSS rules:\n` +
          missing.map((c) => `  .${c}`).join("\n")
      )
    }
  })

  it("subagent TDD-layout classes have CSS rules", () => {
    const tddClasses = [
      "subagent-header",
      "subagent-status",
      "subagent-name-wrap",
      "subagent-name",
      "subagent-tdd-bar",
      "subagent-tdd-phase",
      "subagent-domain-badge",
      "subagent-output",
    ]
    const missing = tddClasses.filter((cls) => !allCss.includes(`.${cls}`))
    if (missing.length > 0) {
      assert.fail(
        `Subagent TDD-layout classes missing CSS rules:\n` +
          missing.map((c) => `  .${c}`).join("\n")
      )
    }
  })

  it("file-edit-card duration class has a CSS rule", () => {
    assert.ok(
      allCss.includes(".file-edit-card__duration"),
      "file-edit-card__duration must have a CSS rule (used by streamHandlers.ts)"
    )
  })
})
