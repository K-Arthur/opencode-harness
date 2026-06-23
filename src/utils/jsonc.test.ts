import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseJsonc } from "./jsonc"

describe("parseJsonc", () => {
  it("parses clean JSON object", () => {
    const result = parseJsonc('{"key":"value"}')
    assert.deepEqual(result.config, { key: "value" })
    assert.equal(result.errors.length, 0)
  })

  it("parses clean JSON array", () => {
    const result = parseJsonc("[1,2,3]")
    assert.deepEqual(result.config, [1, 2, 3])
    assert.equal(result.errors.length, 0)
  })

  it("parses // line comments (leading)", () => {
    const result = parseJsonc("// comment\n{\"key\":\"value\"}")
    assert.deepEqual(result.config, { key: "value" })
    assert.equal(result.errors.length, 0)
  })

  it("parses // line comments (trailing)", () => {
    const result = parseJsonc('{"key":"value"} // comment')
    assert.deepEqual(result.config, { key: "value" })
    assert.equal(result.errors.length, 0)
  })

  it("parses // line comments (mid-line)", () => {
    const result = parseJsonc('{"key":"value" // comment\n}')
    assert.deepEqual(result.config, { key: "value" })
    assert.equal(result.errors.length, 0)
  })

  it("parses /* */ block comments (single-line)", () => {
    const result = parseJsonc('/* comment */ {"key":"value"}')
    assert.deepEqual(result.config, { key: "value" })
    assert.equal(result.errors.length, 0)
  })

  it("parses /* */ block comments (multi-line)", () => {
    const result = parseJsonc('/* line1\nline2\nline3 */ {"key":"value"}')
    assert.deepEqual(result.config, { key: "value" })
    assert.equal(result.errors.length, 0)
  })

  it("parses /* */ block comments (adjacent)", () => {
    const result = parseJsonc('/* a *//* b */ {"key":"value"}')
    assert.deepEqual(result.config, { key: "value" })
    assert.equal(result.errors.length, 0)
  })

  it("parses trailing commas in objects", () => {
    const result = parseJsonc('{"a":1,"b":2,}')
    assert.deepEqual(result.config, { a: 1, b: 2 })
    assert.equal(result.errors.length, 0)
  })

  it("parses trailing commas in arrays", () => {
    const result = parseJsonc('[1,2,3,]')
    assert.deepEqual(result.config, [1, 2, 3])
    assert.equal(result.errors.length, 0)
  })

  it("parses trailing commas in nested structures", () => {
    const result = parseJsonc('{"outer":{"inner":1,},"arr":[1,2,],}')
    assert.deepEqual(result.config, { outer: { inner: 1 }, arr: [1, 2] })
    assert.equal(result.errors.length, 0)
  })

  it("returns empty config for empty string", () => {
    const result = parseJsonc("")
    assert.deepEqual(result.config, {})
    assert.equal(result.errors.length, 0)
  })

  it("returns empty config for whitespace-only string", () => {
    const result = parseJsonc("   \n\t  \n  ")
    assert.deepEqual(result.config, {})
    assert.equal(result.errors.length, 0)
  })

  it("returns empty config for comments-only file (graceful, may report parse error)", () => {
    const result = parseJsonc("// just a comment\n/* block\ncomment */")
    assert.deepEqual(result.config, {})
  })

  it("handles BOM prefix", () => {
    const result = parseJsonc("\uFEFF{\"key\":\"value\"}")
    assert.deepEqual(result.config, { key: "value" })
    assert.equal(result.errors.length, 0)
  })

  it("collects parse errors for invalid JSON (does not throw)", () => {
    const result = parseJsonc('{"key":}')
    assert.deepEqual(result.config, {})
    assert.ok(result.errors.length > 0, "must collect parse errors")
  })

  it("handles deeply nested objects", () => {
    const deep = '{"a":{"b":{"c":{"d":{"e":{"f":{"g":1}}}}}}}'
    const result = parseJsonc(deep)
    assert.deepEqual(result.config, { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } })
    assert.equal(result.errors.length, 0)
  })

  it("preserves strings containing // (not treated as comment)", () => {
    const result = parseJsonc('{"url":"https://example.com"}')
    assert.deepEqual(result.config, { url: "https://example.com" })
  })

  it("preserves strings containing /* (not treated as comment)", () => {
    const result = parseJsonc('{"path":"/*not a comment*/"}')
    assert.deepEqual(result.config, { path: "/*not a comment*/" })
  })

  it("handles escaped quotes inside strings", () => {
    const result = parseJsonc('{"key":"value with \\"quotes\\""}')
    assert.deepEqual(result.config, { key: 'value with "quotes"' })
  })

  it("handles Unicode content", () => {
    const result = parseJsonc('{"emoji":"🎉","cjk":"日本語"}')
    assert.deepEqual(result.config, { emoji: "🎉", cjk: "日本語" })
  })

  it("returns empty config for null input", () => {
    const result = parseJsonc(null as unknown as string)
    assert.deepEqual(result.config, {})
    assert.equal(result.errors.length, 0)
  })

  it("returns empty config for undefined input", () => {
    const result = parseJsonc(undefined as unknown as string)
    assert.deepEqual(result.config, {})
    assert.equal(result.errors.length, 0)
  })

  it("handles mixed comments and trailing commas", () => {
    const input = `{
      // This is a comment
      "key": "value", /* block comment */
      "num": 42,
    }`
    const result = parseJsonc(input)
    assert.deepEqual(result.config, { key: "value", num: 42 })
    assert.equal(result.errors.length, 0)
  })

  it("handles numbers, booleans, and null values", () => {
    const result = parseJsonc('{"num":3.14,"bool":true,"flag":false,"nil":null}')
    assert.deepEqual(result.config, { num: 3.14, bool: true, flag: false, nil: null })
  })

  it("handles empty object and empty array", () => {
    assert.deepEqual(parseJsonc("{}").config, {})
    assert.deepEqual(parseJsonc("[]").config, [])
  })
})
