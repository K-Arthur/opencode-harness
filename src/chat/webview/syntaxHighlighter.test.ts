import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, "syntaxHighlighter.ts"), "utf8")
const workerSource = readFileSync(resolve(__dirname, "markdownWorker.ts"), "utf8")

void describe("syntaxHighlighter.ts — after highlight-worker separation", () => {
  void it("exports sanitizeHtml but NOT highlightSyntax", () => {
    assert.ok(/export function sanitizeHtml/.test(source), "must still export sanitizeHtml")
    assert.ok(!/\bhighlightSyntax\b/.test(source), "must NOT export highlightSyntax (moved to worker)")
  })

  void it("does NOT import highlight.js on main thread", () => {
    assert.ok(!source.includes("highlight.js"), "syntaxHighlighter must not import highlight.js")
  })

  void it("keeps PURIFY_CONFIG for XSS protection", () => {
    assert.ok(source.includes("ALLOWED_TAGS"), "must keep PURIFY_CONFIG for XSS protection")
  })

  void it("keeps DOMPurify import for sanitizeHtml", () => {
    assert.ok(source.includes('DOMPurify from "dompurify"'), "must keep DOMPurify import")
  })
})

void describe("markdownWorker.ts — lazy highlight registration (moved from syntaxHighlighter)", () => {
  void it("defers hljs.registerLanguage calls out of module top-level", () => {
    const lines = workerSource.split("\n")
    const unindentedRegisterLines = lines.filter(
      (l) => l.length > 0 && l[0] !== " " && l[0] !== "\t" && /hljs\.registerLanguage\s*\(/.test(l),
    )
    assert.equal(
      unindentedRegisterLines.length,
      0,
      `hljs.registerLanguage must not run at column 0 (module top-level) — found ${unindentedRegisterLines.length} such lines`,
    )
    assert.ok(/hljs\.registerLanguage\s*\(/.test(workerSource), "registerLanguage calls must still exist (just deferred)")
  })

  void it("defers hljs.registerAliases calls out of module top-level", () => {
    const lines = workerSource.split("\n")
    const unindentedAliasLines = lines.filter(
      (l) => l.length > 0 && l[0] !== " " && l[0] !== "\t" && /hljs\.registerAliases\s*\(/.test(l),
    )
    assert.equal(
      unindentedAliasLines.length,
      0,
      `hljs.registerAliases must not run at column 0 — found ${unindentedAliasLines.length} such lines`,
    )
  })

  void it("registers languages lazily via ensureLanguagesRegistered called from onmessage", () => {
    assert.ok(
      /function\s+ensureLanguagesRegistered/.test(workerSource),
      "worker must expose a function called ensureLanguagesRegistered",
    )
    const helperBody = workerSource.match(/function\s+ensureLanguagesRegistered[\s\S]*?\n\}/m)
    assert.ok(helperBody, "ensureLanguagesRegistered function body must exist")
    assert.ok(
      /\b(registered)\b/.test(helperBody[0]),
      "ensureLanguagesRegistered must be guarded by an idempotent flag",
    )
  })

  void it("preserves the 15 registerLanguage invocations for renderer.test.ts contract", () => {
    const languages = ["javascript", "typescript", "python", "rust", "go", "bash", "json", "css", "markdown", "sql", "diff", "java", "cpp", "yaml", "xml"]
    for (const lang of languages) {
      assert.ok(
        workerSource.includes(`"${lang}", ${lang}`),
        `Missing ${lang} language registration pattern in worker`,
      )
    }
  })
})

void describe("markdownWorker.ts — large-block highlight cap", () => {
  void it("defines a MAX_HIGHLIGHT_CHARS cap constant in the worker", () => {
    assert.match(
      workerSource,
      /const\s+MAX_HIGHLIGHT_CHARS\s*=\s*[\d_]+/,
      "MAX_HIGHLIGHT_CHARS constant must exist in the worker",
    )
  })

  void it("short-circuits highlightSyntax for oversized input before hljs runs", () => {
    const body = workerSource.match(/function highlightSyntax[\s\S]*?\n\}/m)
    assert.ok(body, "highlightSyntax function must exist in worker")
    const fn = body[0]
    const guardIdx = fn.search(/code\.length\s*>\s*MAX_HIGHLIGHT_CHARS/)
    assert.ok(guardIdx >= 0, "worker highlightSyntax must guard on code.length > MAX_HIGHLIGHT_CHARS")
    const autoIdx = fn.search(/highlightAuto/)
    assert.ok(autoIdx >= 0, "worker highlightSyntax must still have a highlightAuto fallback")
    assert.ok(guardIdx < autoIdx, "the size guard must precede the highlightAuto fallback")
  })
})
