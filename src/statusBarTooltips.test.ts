import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { STATUS_BAR_TOOLTIPS } from "./statusBarTooltips"

void describe("STATUS_BAR_TOOLTIPS", () => {
  void it("connection.notConnected explains the state and click action", () => {
    const result = STATUS_BAR_TOOLTIPS.connection.notConnected
    assert.match(result, /not running/i)
    assert.match(result, /click/i)
  })

  void it("connection.connected interpolates the port number", () => {
    const result = STATUS_BAR_TOOLTIPS.connection.connected(4096)
    assert.match(result, /4096/)
    assert.match(result, /running/i)
    assert.match(result, /click/i)
  })

  void it("connection.disconnected mentions retry", () => {
    const result = STATUS_BAR_TOOLTIPS.connection.disconnected
    assert.match(result, /retry/i)
  })

  void it("connection.error points at the output channel", () => {
    const result = STATUS_BAR_TOOLTIPS.connection.error
    assert.match(result, /output channel/i)
  })

  void it("methodology.idle tells the user what to click", () => {
    const result = STATUS_BAR_TOOLTIPS.methodology.idle
    assert.match(result, /click to configure/i)
  })

  void it("methodology.active includes the label, tier, confidence, and reasoning", () => {
    const result = STATUS_BAR_TOOLTIPS.methodology.active("tdd", "L1", "85", "Plan, then implement")
    assert.match(result, /tdd/)
    assert.match(result, /L1/)
    assert.match(result, /85%/)
    assert.match(result, /Plan, then implement/)
    assert.match(result, /click to configure/i)
  })
})
