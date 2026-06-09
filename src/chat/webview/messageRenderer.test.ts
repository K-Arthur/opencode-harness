import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "messageRenderer.ts"), "utf8")

void describe("messageRenderer.ts", () => {
  void it("exports renderMessage", () => {
    assert.ok(source.includes("export function renderMessage"))
  })

  void it("renderMessage sets role-based class on container", () => {
    // The class string is `message ${role}` plus a conditional plan-mode
    // suffix added in Batch 3e. We just assert the role-derived portion.
    assert.ok(/className\s*=\s*`message \$\{role\}/.test(source))
    assert.ok(source.includes("roleSpan.textContent = role === \"user\" ? \"You\" : \"OpenCode\""))
  })

  void it("renderMessage sets stable data attributes for markers", () => {
    assert.ok(source.includes("dataset.messageId = msg.id"))
    assert.ok(source.includes("dataset.role = role"))
  })

  void it("renderMessage includes edit button for user messages", () => {
    assert.ok(source.includes("message-edit-btn"))
    assert.ok(source.includes('type: "edit_message"'))
  })

  void it("renderMessage includes revert button for assistant messages", () => {
    assert.ok(source.includes("message-revert-btn"))
    assert.ok(source.includes('type: "revert_message"'))
  })
})