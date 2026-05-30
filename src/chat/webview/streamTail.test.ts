import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { splitAtStableBoundary } from "./streamTail"

/**
 * P1/A — splitAtStableBoundary divides a streaming buffer into a "stable"
 * prefix (closed markdown blocks that will not change as more text arrives) and
 * an unstable "tail". The prefix can be rendered once and frozen; only the tail
 * is re-rendered per flush.
 *
 * Invariant for every case: stable + tail === buf (lossless).
 */
describe("splitAtStableBoundary", () => {
  const check = (buf: string, stable: string, tail: string) => {
    const r = splitAtStableBoundary(buf)
    assert.equal(r.stable + r.tail, buf, "split must be lossless")
    assert.equal(r.stable, stable, "stable mismatch")
    assert.equal(r.tail, tail, "tail mismatch")
  }

  it("empty buffer → empty/empty", () => check("", "", ""))

  it("no blank line → everything is tail", () =>
    check("a single line still typing", "", "a single line still typing"))

  it("splits after a completed paragraph", () =>
    check("Para one.\n\nPara two stil", "Para one.\n\n", "Para two stil"))

  it("splits at the LAST stable boundary", () =>
    check("A.\n\nB.\n\nC still", "A.\n\nB.\n\n", "C still"))

  it("an open code fence keeps everything in the tail", () =>
    check("intro\n\n```ts\nconst x = 1", "", "intro\n\n```ts\nconst x = 1"))

  it("does not split on a blank line that is INSIDE a closed fence", () => {
    // The only \n\n is between two lines of code within a balanced fence.
    const buf = "```ts\ncode1\n\ncode2\n```"
    check(buf, "", buf)
  })

  it("splits after a closed fence followed by a blank line", () => {
    const buf = "```ts\ncode\n```\n\nprose after"
    check(buf, "```ts\ncode\n```\n\n", "prose after")
  })

  it("prefers an outside-fence boundary over an inside-fence one", () => {
    // boundary after the first paragraph is valid; the \n\n inside the fence is not.
    const buf = "intro\n\n```\na\n\nb\n```"
    check(buf, "intro\n\n", "```\na\n\nb\n```")
  })

  // ── Safety: do NOT split inside block constructs that legitimately contain
  //    blank lines, or the two halves would render as fragmented blocks.

  it("does not split a loose list (tail begins with a list marker)", () => {
    const buf = "- item one\n\n- item two stil"
    check(buf, "", buf)
  })

  it("does not split a numbered loose list", () => {
    const buf = "1. first\n\n2. second"
    check(buf, "", buf)
  })

  it("does not split a multi-paragraph blockquote", () => {
    const buf = "> quote line one\n\n> quote line two"
    check(buf, "", buf)
  })

  it("does not split before an indented continuation paragraph", () => {
    const buf = "- item\n\n  continuation paragraph"
    check(buf, "", buf)
  })

  it("does not split when the stable side ends in a list item", () => {
    // prose paragraph after a list — the blank after the list item is unsafe
    // because the list could still be extended; keep it all in the tail.
    const buf = "- only item\n\nnow a paragraph"
    check(buf, "", buf)
  })

  it("still splits between two ordinary paragraphs", () => {
    check("Para 1.\n\nPara 2.", "Para 1.\n\n", "Para 2.")
  })

  it("splits after a heading followed by a paragraph", () => {
    check("# Title\n\nBody text", "# Title\n\n", "Body text")
  })
})
