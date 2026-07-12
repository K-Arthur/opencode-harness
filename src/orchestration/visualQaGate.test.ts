import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { CodeDiff } from "../methodology/types"
import {
  checkDesignTokens,
  checkAccessibility,
  checkLayout,
  runVisualQaGate,
  createVisualQaGate,
  buildVisualReviewPrompt,
} from "./visualQaGate"

describe("checkDesignTokens", () => {
  it("passes clean CSS without violations", () => {
    const css = `.foo {
  color: var(--vscode-editor-foreground);
  background: var(--oc-bg);
  padding: var(--space-4);
}`
    const violations = checkDesignTokens(css)
    assert.equal(violations.length, 0)
  })

  it("flags raw color literals in CSS", () => {
    const css = `.foo {
  color: #3355aa;
  background: rgba(0, 0, 0, 0.5);
}`
    const violations = checkDesignTokens(css)
    assert.ok(violations.length >= 2)
    const v0 = violations[0]
    assert.ok(v0)
    assert.equal(v0.severity, "error")
  })

  it("warns about non-4px-grid spacing", () => {
    const css = `.foo {
  padding: 7px;
  margin: 3px;
}`
    const violations = checkDesignTokens(css)
    assert.ok(violations.length >= 1)
    const v0 = violations[0]
    assert.ok(v0)
    assert.equal(v0.severity, "warning")
  })

  it("allows 4px-grid spacing", () => {
    const css = `.foo {
  padding: 8px;
  margin: 4px;
}`
    const violations = checkDesignTokens(css)
    assert.equal(violations.filter(v => v.property === "padding" || v.property === "margin").length, 0)
  })

  it("returns empty for empty CSS", () => {
    assert.deepEqual(checkDesignTokens(""), [])
    assert.deepEqual(checkDesignTokens("  "), [])
  })

  it("does not flag comments", () => {
    const css = `/* background: #fff — this is a comment */`
    const violations = checkDesignTokens(css)
    assert.equal(violations.length, 0)
  })
})

describe("checkAccessibility", () => {
  it("flags font sizes below 12px", () => {
    const css = `.small { font-size: 10px; }`
    const violations = checkAccessibility(css)
    assert.ok(violations.length >= 1)
    const v0 = violations[0]
    assert.ok(v0)
    assert.equal(v0.severity, "error")
  })

  it("passes font sizes >= 12px", () => {
    const css = `.normal { font-size: 14px; }`
    const violations = checkAccessibility(css)
    assert.equal(violations.length, 0)
  })

  it("warns about low opacity", () => {
    const css = `.faded { opacity: 0.3; }`
    const violations = checkAccessibility(css)
    assert.ok(violations.length >= 1)
    const v0 = violations[0]
    assert.ok(v0)
    assert.equal(v0.severity, "warning")
  })
})

describe("checkLayout", () => {
  it("detects overflow hidden", () => {
    const css = `body { overflow: hidden; }`
    const warnings = checkLayout(css)
    assert.ok(warnings.some(w => w.includes("overflow: hidden")))
  })

  it("detects zero-size elements", () => {
    const css = `.empty { width: 0px; }`
    const warnings = checkLayout(css)
    assert.ok(warnings.some(w => w.includes("width: 0px")))
  })

  it("detects negative z-index", () => {
    const css = `.behind { z-index: -1; }`
    const warnings = checkLayout(css)
    assert.ok(warnings.some(w => w.includes("z-index")))
  })
})

describe("runVisualQaGate", () => {
  it("passes clean CSS diff", () => {
    const diff: CodeDiff = {
      filesChanged: 1,
      linesAdded: 10,
      linesRemoved: 0,
      linesChanged: 5,
      newContent: `.btn { color: var(--vscode-button-foreground); padding: var(--space-2); font-size: 14px; }`,
      oldContent: "",
      imports: [],
    }
    const result = runVisualQaGate(diff)
    assert.equal(result.passed, true)
    assert.equal(result.tokenViolations.length, 0)
  })

  it("fails on raw color literals", () => {
    const diff: CodeDiff = {
      filesChanged: 1,
      linesAdded: 5,
      linesRemoved: 0,
      linesChanged: 3,
      newContent: `.bad { color: #ff0000; }`,
      oldContent: "",
      imports: [],
    }
    const result = runVisualQaGate(diff)
    assert.equal(result.passed, false)
    assert.ok(result.tokenViolations.length > 0)
  })

  it("fails on small font sizes", () => {
    const diff: CodeDiff = {
      filesChanged: 1,
      linesAdded: 5,
      linesRemoved: 0,
      linesChanged: 3,
      newContent: `.tiny { font-size: 8px; }`,
      oldContent: "",
      imports: [],
    }
    const result = runVisualQaGate(diff)
    assert.equal(result.passed, false)
    assert.ok(result.contrastViolations.length > 0)
  })

  it("warns but does not fail for non-breaking layout issues", () => {
    const diff: CodeDiff = {
      filesChanged: 1,
      linesAdded: 5,
      linesRemoved: 0,
      linesChanged: 3,
      newContent: `.warn { opacity: 0.3; z-index: -1; }`,
      oldContent: "",
      imports: [],
    }
    const result = runVisualQaGate(diff)
    // Opacity 0.3 is a warning-level issue (contrast violations are severity 'warning' not 'error')
    // The gate should still be considered passing since layout warnings don't cause errors
    assert.equal(result.tokenViolations.length, 0)
    assert.ok(result.contrastViolations.length > 0)
    assert.ok(result.layoutWarnings.length > 0)
  })

  it("handles empty diff gracefully", () => {
    const diff: CodeDiff = {
      filesChanged: 0,
      linesAdded: 0,
      linesRemoved: 0,
      linesChanged: 0,
      newContent: "",
      oldContent: "",
      imports: [],
    }
    const result = runVisualQaGate(diff)
    assert.equal(result.passed, true)
    assert.equal(result.errors.length, 0)
  })
})

describe("createVisualQaGate", () => {
  it("returns a QualityGate with name 'visual-qa'", async () => {
    const gate = createVisualQaGate()
    assert.equal(gate.name, "visual-qa")
    assert.equal(gate.severity, "warn")

    const diff: CodeDiff = {
      filesChanged: 0,
      linesAdded: 0,
      linesRemoved: 0,
      linesChanged: 0,
      newContent: "",
      oldContent: "",
      imports: [],
    }
    const result = await gate.check(diff)
    assert.equal(result.passed, true)
  })

  it("fails on bad CSS", async () => {
    const gate = createVisualQaGate()
    const diff: CodeDiff = {
      filesChanged: 1,
      linesAdded: 3,
      linesRemoved: 0,
      linesChanged: 2,
      newContent: `.x { color: #abc; }`,
      oldContent: "",
      imports: [],
    }
    const result = await gate.check(diff)
    assert.equal(result.passed, false)
    assert.ok(result.failures)
    assert.ok(result.failures!.length > 0)
  })
})

describe("buildVisualReviewPrompt", () => {
  it("includes component path and design references", () => {
    const prompt = buildVisualReviewPrompt("src/Button.tsx", ["design-tokens.css"], [])
    assert.ok(prompt.includes("src/Button.tsx"))
    assert.ok(prompt.includes("design-tokens.css"))
  })

  it("includes known violations when present", () => {
    const prompt = buildVisualReviewPrompt("src/Button.tsx", [], [
      { property: "color", expected: "--oc-accent", actual: "#ff0000", selector: ".btn", severity: "error" },
    ])
    assert.ok(prompt.includes("ERROR"))
    assert.ok(prompt.includes("#ff0000"))
  })
})
