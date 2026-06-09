import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { sanitizeCssValue } from "./cssSanitizer"

void describe("sanitizeCssValue", () => {
  void it("allows valid CSS color values", () => {
    assert.ok(sanitizeCssValue("#ff0000") !== null)
    assert.ok(sanitizeCssValue("#FF0000") !== null)
    assert.ok(sanitizeCssValue("rgb(255, 0, 0)") !== null)
    assert.ok(sanitizeCssValue("hsl(0, 100%, 50%)") !== null)
    assert.ok(sanitizeCssValue("var(--oc-accent)") !== null)
    assert.ok(sanitizeCssValue("calc(100% - 10px)") !== null)
    assert.ok(sanitizeCssValue("red") !== null)
    assert.ok(sanitizeCssValue("#1e1e2e") !== null)
    assert.ok(sanitizeCssValue("  #1e1e2e  ") !== null)
  })

  void it("blocks url() injection", () => {
    assert.equal(sanitizeCssValue("url(http://evil.com)"), null)
    assert.equal(sanitizeCssValue("url(/)"), null)
    assert.equal(sanitizeCssValue("URL(http://evil.com)"), null)
    assert.equal(sanitizeCssValue("url (http://evil.com)"), null)
  })

  void it("blocks expression() injection", () => {
    assert.equal(sanitizeCssValue("expression(alert(1))"), null)
  })

  void it("blocks @import injection", () => {
    assert.equal(sanitizeCssValue("@import url(evil.css)"), null)
  })

  void it("blocks javascript: injection", () => {
    assert.equal(sanitizeCssValue("javascript:alert(1)"), null)
  })

  void it("blocks behavior: injection", () => {
    assert.equal(sanitizeCssValue("behavior: url(#default#userData)"), null)
  })

  void it("blocks semicolons that break declaration boundaries", () => {
    assert.equal(sanitizeCssValue("red; background: url(http://evil.com)"), null)
    assert.equal(sanitizeCssValue("color;"), null)
  })

  void it("blocks curly braces that break declaration boundaries", () => {
    assert.equal(sanitizeCssValue("{ foo: bar }"), null)
    assert.equal(sanitizeCssValue("red }"), null)
  })

  void it("returns null for empty values", () => {
    assert.equal(sanitizeCssValue(""), null)
    assert.equal(sanitizeCssValue("   "), null)
  })

  void it("returns trimmed value for valid values", () => {
    assert.equal(sanitizeCssValue("  #1e1e2e  "), "#1e1e2e")
    assert.equal(sanitizeCssValue("rgb(100, 200, 50)"), "rgb(100, 200, 50)")
  })
})
