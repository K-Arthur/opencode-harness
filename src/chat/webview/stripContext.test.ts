import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { stripContextFromText, mergeStreamText } from "./streamHandlers"

describe("M1: stripContextFromText fast path preserves behavior", () => {
  const cases: Array<[string, string, string]> = [
    ["no marker returns trimmed input", "  hello world  ", "hello world"],
    ["empty stays empty", "", ""],
    ["removes a complete context block", "before<context>secret</context>after", "beforeafter"],
    ["removes a multiline context block", "a\n<context>\nx\ny\n</context>\nb", "a\n\nb"],
    ["truncates at a partial (unclosed) context tag", "visible text <context>partial", "visible text"],
    ["case-insensitive tag", "x<CONTEXT>y</CONTEXT>z", "xz"],
  ]
  for (const [name, input, expected] of cases) {
    it(name, () => {
      assert.equal(stripContextFromText(input), expected)
    })
  }

  it("does not scan with the regex when no marker is present (identity-after-trim)", () => {
    // A large no-marker string must come back trimmed and unchanged in content.
    const big = "x".repeat(100_000)
    assert.equal(stripContextFromText(big), big)
  })
})

describe("M4: mergeStreamText bounded overlap stays correct", () => {
  it("dedups an overlapping retransmitted suffix", () => {
    assert.equal(mergeStreamText("Hello wor", "wor" + "ld"), "Hello world")
  })

  it("appends when there is no overlap", () => {
    assert.equal(mergeStreamText("Hello", " world"), "Hello world")
  })

  it("returns existing when chunk is already fully contained", () => {
    assert.equal(mergeStreamText("Hello world", "world"), "Hello world")
  })

  it("handles a large non-overlapping append without scanning full length", () => {
    const existing = "a".repeat(50_000)
    const chunk = "b".repeat(50_000)
    assert.equal(mergeStreamText(existing, chunk), existing + chunk)
  })
})
