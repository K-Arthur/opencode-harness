import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ansiToHex } from "./ansiColor"

describe("ansiToHex — ANSI 256 → hex", () => {
  it("maps the 16 base colours to xterm defaults", () => {
    assert.equal(ansiToHex(0), "#000000")
    assert.equal(ansiToHex(1), "#800000")
    assert.equal(ansiToHex(7), "#c0c0c0")
    assert.equal(ansiToHex(9), "#ff0000")
    assert.equal(ansiToHex(15), "#ffffff")
  })

  it("maps the 6×6×6 colour cube", () => {
    // index 16 is the cube origin (pure black)
    assert.equal(ansiToHex(16), "#000000")
    // index 21 is the brightest pure blue in the first row (b level 5 → 255)
    assert.equal(ansiToHex(21), "#0000ff")
    // index 196 is pure red (r level 5, g 0, b 0)
    assert.equal(ansiToHex(196), "#ff0000")
    // index 231 is the brightest cube colour (white)
    assert.equal(ansiToHex(231), "#ffffff")
  })

  it("maps the grayscale ramp (232–255)", () => {
    assert.equal(ansiToHex(232), "#080808")
    assert.equal(ansiToHex(255), "#eeeeee")
  })

  it("returns a valid 7-char hex for every index 0..255", () => {
    for (let i = 0; i < 256; i++) {
      const hex = ansiToHex(i)
      assert.match(hex ?? "", /^#[0-9a-f]{6}$/, `index ${i} produced invalid hex: ${hex}`)
    }
  })

  it("rejects out-of-range and non-integer input", () => {
    assert.equal(ansiToHex(-1), undefined)
    assert.equal(ansiToHex(256), undefined)
    assert.equal(ansiToHex(3.5), undefined)
    assert.equal(ansiToHex(NaN), undefined)
  })

  it("never produces the invalid CSS token 'ansi(...)'", () => {
    for (let i = 0; i < 256; i++) {
      assert.doesNotMatch(ansiToHex(i) ?? "", /ansi/i)
    }
  })
})
