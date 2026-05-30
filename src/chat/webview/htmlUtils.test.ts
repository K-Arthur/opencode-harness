import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { escapeHtml, normalizeMarkdownLanguage } from "./htmlUtils"

describe("htmlUtils.ts", () => {
  it("escapes HTML-sensitive characters and ignores non-strings", () => {
    assert.equal(escapeHtml(`<div data-x="1">'&</div>`), "&lt;div data-x=&quot;1&quot;&gt;&#39;&amp;&lt;/div&gt;")
    assert.equal(escapeHtml(undefined), "")
    assert.equal(escapeHtml(42), "")
  })

  it("normalizes markdown language aliases shared by renderer and worker", () => {
    assert.equal(normalizeMarkdownLanguage("tsx"), "typescript")
    assert.equal(normalizeMarkdownLanguage("JSX"), "typescript")
    assert.equal(normalizeMarkdownLanguage("shell"), "bash")
    assert.equal(normalizeMarkdownLanguage("zsh"), "bash")
    assert.equal(normalizeMarkdownLanguage("yml"), "yaml")
    assert.equal(normalizeMarkdownLanguage("html"), "xml")
    assert.equal(normalizeMarkdownLanguage(" rust "), "rust")
    assert.equal(normalizeMarkdownLanguage("htm"), "xml")
    assert.equal(normalizeMarkdownLanguage("c#"), "cpp")
    assert.equal(normalizeMarkdownLanguage("C#"), "cpp")
    assert.equal(normalizeMarkdownLanguage("cs"), "cpp")
    assert.equal(normalizeMarkdownLanguage("c++"), "cpp")
    assert.equal(normalizeMarkdownLanguage("rb"), "ruby")
    assert.equal(normalizeMarkdownLanguage("kt"), "kotlin")
    assert.equal(normalizeMarkdownLanguage("py"), "python")
    assert.equal(normalizeMarkdownLanguage("js"), "javascript")
    assert.equal(normalizeMarkdownLanguage("ts"), "typescript")
  })
})
