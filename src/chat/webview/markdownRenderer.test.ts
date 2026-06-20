import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeMarkdownLanguage, escapeHtml } from "./htmlUtils"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rendererSource = readFileSync(resolve(__dirname, "renderer.ts"), "utf8")
const workerSource = readFileSync(resolve(__dirname, "markdownWorker.ts"), "utf8")
// MarkdownWorkerClient was extracted out of renderer.ts into its own module.
const workerClientSource = readFileSync(resolve(__dirname, "markdownWorkerClient.ts"), "utf8")

function normalizeMarkdownText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^(\s*(?:\d+\.|[-*+]))\s*\n{2,}(?=\S)/gm, "$1 ")
    .replace(/^(#{1,6})([^\s#])/gm, "$1 $2")
    .replace(/\n{3,}/g, "\n\n")
}

function normalizeStreamingMarkdown(text: string): string {
  const normalized = normalizeMarkdownText(text)

  let fenceCount = 0
  let inInlineCode = false
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch !== "`") continue
    if (!inInlineCode && normalized.slice(i, i + 3) === "```") {
      fenceCount++
      i += 2
      continue
    }
    inInlineCode = !inInlineCode
  }

  let result = normalized
  if (fenceCount % 2 !== 0) result += "\n```"
  if (inInlineCode) result += "`"

  return result
}

void describe("markdown normalization", () => {
  void describe("normalizeStreamingMarkdown — fence closing (M1 fix)", () => {
    void it("does not append closer for already-closed fences", () => {
      const input = "```js\nconst x = 1\n```\nSome text"
      const result = normalizeStreamingMarkdown(input)
      assert.ok(!result.endsWith("```"), "already-closed fence must not get an extra closer")
      assert.equal(result, input)
    })

    void it("appends closer for a single unclosed fence", () => {
      const input = "```js\nconst x = 1"
      const result = normalizeStreamingMarkdown(input)
      assert.ok(result.endsWith("```"), "must close unclosed fence")
      assert.ok(result.includes("const x = 1"), "must preserve original content")
    })

    void it("does not close fences on backticks inside inline code", () => {
      const input = "Use ` ``` ` to start a code block"
      const result = normalizeStreamingMarkdown(input)
      assert.ok(!result.endsWith("```"), "must not append fence closer for inline backticks")
    })

    void it("handles triple backticks inside inline code without false fence detection", () => {
      const input = "Type ` ``` ` for a fence"
      const result = normalizeStreamingMarkdown(input)
      assert.ok(!result.includes("\n```"), "must not close fences from inline code backticks")
    })

    void it("closes unclosed inline code", () => {
      const input = "Use `code here without closing"
      const result = normalizeStreamingMarkdown(input)
      assert.ok(result.endsWith("`"), "must close unclosed inline code")
    })

    void it("does not close already-closed inline code", () => {
      const input = "Use `code` here"
      const result = normalizeStreamingMarkdown(input)
      assert.ok(!result.endsWith("`"), "must not add extra backtick for closed inline code")
    })

    void it("handles mixed fences and inline code correctly", () => {
      const input = "```js\ncode\n```\n\nSome `inline` text"
      const result = normalizeStreamingMarkdown(input)
      assert.equal(result, input, "balanced input must pass through unchanged")
    })

    void it("handles empty input", () => {
      assert.equal(normalizeStreamingMarkdown(""), "")
    })

    void it("handles two separate code blocks without false closing", () => {
      const input = "```js\na\n```\n\n```ts\nb\n```"
      const result = normalizeStreamingMarkdown(input)
      assert.equal(result, input, "two closed fences must be unchanged")
    })

    void it("handles multiple unclosed fences (even count = balanced, no closer)", () => {
      const input = "```js\na\n\n```ts\nb"
      const result = normalizeStreamingMarkdown(input)
      assert.equal(result, input, "even fence count (2) is balanced, no closer needed")
    })

    void it("handles three unclosed fences (odd count = adds closer)", () => {
      const input = "```js\na\n\n```ts\nb\n\n```py\nc"
      const result = normalizeStreamingMarkdown(input)
      assert.ok(result.endsWith("```"), "odd fence count (3) must get a closer")
    })

    void it("source uses state-machine approach, not regex counting", () => {
      assert.ok(
        !rendererSource.includes("normalized.match(/```/g)"),
        "must not use naive regex fence counting"
      )
      assert.ok(
        !rendererSource.includes("normalized.match(/`/g)"),
        "must not use naive regex inline code counting"
      )
      assert.ok(
        rendererSource.includes("inInlineCode"),
        "must track inline code state"
      )
      assert.ok(
        rendererSource.includes("fenceCount"),
        "must track fence count"
      )
    })
  })
})

void describe("highlight callback — no double normalization (C1 fix)", () => {
  void it("renderer.md highlight callback uses escapeHtml (sync, no hljs)", () => {
    assert.match(
      rendererSource,
      /highlight:\s*\(\s*str\s*,\s*_lang\s*\)\s*=>\s*escapeHtml\(\s*str\s*\)/,
      "renderer highlight callback must use escapeHtml (sync, no highlight.js on main thread)"
    )
  })

  void it("worker.md highlight callback passes lang directly to highlightSyntax", () => {
    assert.match(
      workerSource,
      /highlight:\s*\(\s*str\s*,\s*lang\s*\)\s*=>\s*highlightSyntax\(\s*str\s*,\s*lang\s*\|\|\s*""\s*\)/,
      "worker highlight callback must not call normalizeMarkdownLanguage"
    )
  })
})

void describe("MarkdownWorkerClient — nextId overflow guard (M2 fix)", () => {
  void it("wraps nextId using modulo instead of unbounded increment", () => {
    assert.match(
      workerClientSource,
      /this\.nextId\s*=\s*\(this\.nextId\s*%\s*0x7fffffff\)\s*\+\s*1/,
      "nextId must use bounded modulo increment"
    )
  })
})

void describe("worker error logging (m2 fix)", () => {
  void it("logs worker error responses via console.warn", () => {
    assert.match(
      workerClientSource,
      /"error"\s+in\s+message/,
      "worker onmessage must check for error property"
    )
    assert.match(
      workerClientSource,
      /console\.warn\(\s*"\[opencode\]\s+Markdown\s+worker\s+error:"/,
      "worker onmessage must log error via console.warn"
    )
  })
})

void describe("normalizeMarkdownLanguage — extended aliases (m4 fix)", () => {
  void it("maps C# aliases to cpp (closest available highlighter)", () => {
    assert.equal(normalizeMarkdownLanguage("c#"), "cpp")
    assert.equal(normalizeMarkdownLanguage("C#"), "cpp")
    assert.equal(normalizeMarkdownLanguage("cs"), "cpp")
  })

  void it("maps C++ to cpp", () => {
    assert.equal(normalizeMarkdownLanguage("c++"), "cpp")
  })

  void it("maps rb to ruby", () => {
    assert.equal(normalizeMarkdownLanguage("rb"), "ruby")
  })

  void it("maps kt to kotlin", () => {
    assert.equal(normalizeMarkdownLanguage("kt"), "kotlin")
  })

  void it("maps py to python", () => {
    assert.equal(normalizeMarkdownLanguage("py"), "python")
  })

  void it("maps js/node to javascript", () => {
    assert.equal(normalizeMarkdownLanguage("js"), "javascript")
    assert.equal(normalizeMarkdownLanguage("node"), "javascript")
  })

  void it("maps ts to typescript", () => {
    assert.equal(normalizeMarkdownLanguage("ts"), "typescript")
  })

  void it("maps htm to xml", () => {
    assert.equal(normalizeMarkdownLanguage("htm"), "xml")
  })

  void it("preserves existing aliases", () => {
    assert.equal(normalizeMarkdownLanguage("tsx"), "typescript")
    assert.equal(normalizeMarkdownLanguage("JSX"), "typescript")
    assert.equal(normalizeMarkdownLanguage("shell"), "bash")
    assert.equal(normalizeMarkdownLanguage("zsh"), "bash")
    assert.equal(normalizeMarkdownLanguage("yml"), "yaml")
    assert.equal(normalizeMarkdownLanguage("html"), "xml")
    assert.equal(normalizeMarkdownLanguage(" rust "), "rust")
  })

  void it("returns unknown languages as-is", () => {
    assert.equal(normalizeMarkdownLanguage("solidity"), "solidity")
    assert.equal(normalizeMarkdownLanguage(""), "")
  })
})

void describe("renderCodeBlock — multi-line highlighting (M4 fix)", () => {
  void it("dispatches async highlight via worker for line-numbered code blocks", () => {
    assert.match(
      rendererSource,
      /getMarkdownWorkerClient\(\)\.highlight\(code,\s*language\)/,
      "renderCodeBlock must dispatch highlight to the markdown worker"
    )
    assert.match(
      rendererSource,
      /lineEls\.forEach/,
      "must update line elements after worker highlight resolves"
    )
  })
})

void describe("escapeHtml", () => {
  void it("escapes all five HTML-sensitive characters", () => {
    assert.equal(escapeHtml(`<div data-x="1">'&</div>`), "&lt;div data-x=&quot;1&quot;&gt;&#39;&amp;&lt;/div&gt;")
  })

  void it("returns empty string for non-string inputs", () => {
    assert.equal(escapeHtml(undefined), "")
    assert.equal(escapeHtml(42), "")
    assert.equal(escapeHtml(null as any), "")
  })
})

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}
