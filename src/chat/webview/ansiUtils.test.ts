import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isToolOutputRenderAnsiEnabled, renderAnsiToHtml, setToolOutputRenderAnsi, stripAnsi } from "./ansiUtils"

describe("stripAnsi", () => {
  it("passes plain text through unchanged", () => {
    assert.strictEqual(stripAnsi("hello world"), "hello world")
  })

  it("strips SGR escape sequences (colors, bold, reset)", () => {
    assert.strictEqual(stripAnsi("\x1b[32mgreen\x1b[0m"), "green")
    assert.strictEqual(stripAnsi("\x1b[1;31mbold red\x1b[m"), "bold red")
  })

  it("strips multi-param sequences", () => {
    assert.strictEqual(stripAnsi("\x1b[38;5;196mred256\x1b[0m"), "red256")
  })

  it("strips cursor movement sequences", () => {
    assert.strictEqual(stripAnsi("\x1b[2Jupstart\x1b[H"), "upstart")
  })

  it("preserves newlines and tabs", () => {
    const input = "\x1b[32mline1\x1b[0m\nline2\t\x1b[1mtab\x1b[0m"
    assert.strictEqual(stripAnsi(input), "line1\nline2\ttab")
  })

  it("strips control characters except \\n and \\t", () => {
    assert.strictEqual(stripAnsi("a\x07b\x08c"), "abc")
  })

  it("empty string returns empty string", () => {
    assert.strictEqual(stripAnsi(""), "")
  })

  it("string with only ANSI escapes returns empty", () => {
    assert.strictEqual(stripAnsi("\x1b[0m\x1b[1m\x1b[32m"), "")
  })
})

describe("tool output ANSI rendering", () => {
  it("defaults to disabled", () => {
    setToolOutputRenderAnsi(false)
    assert.equal(isToolOutputRenderAnsiEnabled(), false)
  })

  it("can be toggled on and off", () => {
    setToolOutputRenderAnsi(true)
    assert.equal(isToolOutputRenderAnsiEnabled(), true)
    setToolOutputRenderAnsi(false)
    assert.equal(isToolOutputRenderAnsiEnabled(), false)
  })

  it("renders a small SGR palette as CSS classes", () => {
    const html = renderAnsiToHtml("ok \x1b[32mgreen\x1b[0m done")
    assert.equal(html, 'ok <span class="ansi-fg-green">green</span> done')
  })

  it("escapes HTML while preserving ANSI spans", () => {
    const html = renderAnsiToHtml("\x1b[31m<bad>&\"x\"\x1b[0m")
    assert.equal(html, '<span class="ansi-fg-red">&lt;bad&gt;&amp;&quot;x&quot;</span>')
  })

  it("strips non-SGR control sequences before rendering", () => {
    const html = renderAnsiToHtml("\x1b[2J\x1b[1;33mwarn\x1b[0m")
    assert.equal(html, '<span class="ansi-bold ansi-fg-yellow">warn</span>')
  })
})
