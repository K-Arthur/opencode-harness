import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createErrorBlock } from "./blocks"

interface ActionBtn {
  label: string
  action: string
  primary?: boolean
  disabled?: boolean
  metadata?: Record<string, unknown>
}

describe("blocks", () => {
  describe("createErrorBlock", () => {
    it("creates an error block with required fields", () => {
      const block = createErrorBlock("TEST_ERR", "test message", true)
      assert.equal(block.type, "error")
      assert.equal(block.code, "TEST_ERR")
      assert.equal(block.message, "test message")
      assert.equal(block.retryable, true)
    })

    it("includes optional detail", () => {
      const block = createErrorBlock("DETAILED", "msg", false, "some technical detail")
      assert.equal(block.detail, "some technical detail")
    })

    it("includes optional actionButtons", () => {
      const buttons: ActionBtn[] = [
        { label: "Retry", action: "retry", primary: true },
        { label: "Dismiss", action: "dismiss" },
      ]
      const block = createErrorBlock("WITH_ACTIONS", "msg", true, undefined, buttons)
      assert.ok(Array.isArray(block.actionButtons))
      assert.equal(block.actionButtons!.length, 2)
      const b = block.actionButtons as unknown as ActionBtn[]
      assert.equal(b[0]!.label, "Retry")
      assert.equal(b[0]!.action, "retry")
      assert.equal(b[0]!.primary, true)
    })

    it("handles empty actionButtons array", () => {
      const block = createErrorBlock("NO_ACTIONS", "msg", true, undefined, [])
      assert.ok(Array.isArray(block.actionButtons))
      assert.equal(block.actionButtons!.length, 0)
    })

    it("handles undefined actionButtons", () => {
      const block = createErrorBlock("NO_ACTIONS", "msg", false)
      assert.equal(block.actionButtons, undefined)
    })

    it("preserves retryable false", () => {
      const block = createErrorBlock("NOT_RETRYABLE", "msg", false)
      assert.equal(block.retryable, false)
    })

    it("supports disabled buttons", () => {
      const buttons: ActionBtn[] = [
        { label: "Upgrade", action: "upgrade_plan", disabled: true },
      ]
      const block = createErrorBlock("DISABLED", "msg", false, undefined, buttons)
      const b = block.actionButtons as unknown as ActionBtn[]
      assert.equal(b[0]!.disabled, true)
    })

    it("supports buttons with metadata", () => {
      const buttons: ActionBtn[] = [
        { label: "Open", action: "view_details", metadata: { url: "https://example.com" } },
      ]
      const block = createErrorBlock("META", "msg", false, undefined, buttons)
      const b = block.actionButtons as unknown as ActionBtn[]
      assert.deepEqual(b[0]!.metadata, { url: "https://example.com" })
    })
  })
})
