import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, "syntaxHighlighter.ts"), "utf8")

void describe("syntaxHighlighter.ts (F3-style lazy registration)", () => {
  // The main webview (main.js) is over the 600KB limit, and 78.8KB of that
  // is highlight.js — driven by 15 `hljs.registerLanguage()` calls at module
  // top-level. Each call builds the language grammar (regex compilation +
  // mode setup) on the main thread, blocking first paint. The fix: defer
  // the registrations to the first call to `highlightSyntax`.

  void it("defers hljs.registerLanguage calls out of module top-level", () => {
    const lines = source.split("\n")
    const unindentedRegisterLines = lines.filter(
      (l) => l.length > 0 && l[0] !== " " && l[0] !== "\t" && /hljs\.registerLanguage\s*\(/.test(l),
    )
    assert.equal(
      unindentedRegisterLines.length,
      0,
      `hljs.registerLanguage must not run at column 0 (module top-level) — found ${unindentedRegisterLines.length} such lines`,
    )
    // The registration code itself must still exist somewhere.
    assert.ok(/hljs\.registerLanguage\s*\(/.test(source), "registerLanguage calls must still exist (just deferred)")
  })

  void it("defers hljs.registerAliases calls out of module top-level", () => {
    const lines = source.split("\n")
    const unindentedAliasLines = lines.filter(
      (l) => l.length > 0 && l[0] !== " " && l[0] !== "\t" && /hljs\.registerAliases\s*\(/.test(l),
    )
    assert.equal(
      unindentedAliasLines.length,
      0,
      `hljs.registerAliases must not run at column 0 — found ${unindentedAliasLines.length} such lines`,
    )
  })

  void it("registers languages lazily via ensureLanguagesRegistered called from highlightSyntax", () => {
    assert.ok(
      /function\s+ensureLanguagesRegistered/.test(source),
      "worker must expose a function called ensureLanguagesRegistered",
    )
    const helperBody = source.match(/function\s+ensureLanguagesRegistered[\s\S]*?\n\}/m)
    assert.ok(helperBody, "ensureLanguagesRegistered function body must exist")
    // Helper must reference an idempotent guard flag (e.g. `languagesRegistered`).
    assert.ok(
      /\b(languagesRegistered|languages_Registered|registered)\b/.test(helperBody[0]),
      "ensureLanguagesRegistered must be guarded by an idempotent flag (e.g. languagesRegistered)",
    )
    // highlightSyntax must call it before any hljs.* call.
    const highlightBody = source.match(/export function highlightSyntax[\s\S]*?\n\}/m)
    assert.ok(highlightBody, "highlightSyntax function must exist")
    assert.ok(
      /ensureLanguagesRegistered\s*\(/.test(highlightBody[0]),
      "highlightSyntax must call ensureLanguagesRegistered() before using hljs",
    )
  })

  void it("preserves the 15 registerLanguage invocations for renderer.test.ts contract", () => {
    // renderer.test.ts asserts each `"${lang}", ${lang}` substring exists.
    // Our refactor must keep those exact strings (just inside a function).
    const languages = ["javascript", "typescript", "python", "rust", "go", "bash", "json", "css", "markdown", "sql", "diff", "java", "cpp", "yaml", "xml"]
    for (const lang of languages) {
      assert.ok(
        source.includes(`"${lang}", ${lang}`),
        `Missing ${lang} language registration pattern (must keep "${lang}", ${lang} for renderer.test.ts contract)`,
      )
    }
  })
})
