import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { validateWebviewMessage } from "./WebviewMessageValidator"

function validate(runtime: unknown): { accepted: boolean; warnings: string[] } {
  const warnings: string[] = []
  return {
    accepted: validateWebviewMessage({ type: "set_runtime", runtime }, "set_runtime", {
      hasPromptContent: () => false,
      isValidThemeConfigPayload: () => true,
      warn: (message) => warnings.push(message),
    }),
    warnings,
  }
}

describe("runtime selection message validation", () => {
  it("accepts only the supported runtime preferences", () => {
    for (const runtime of ["auto", "opencode", "opencode2"]) {
      assert.equal(validate(runtime).accepted, true)
    }
  })

  it("rejects malformed or unknown runtime preferences", () => {
    for (const runtime of ["", "OpenCode 2", null, 2, "other"]) {
      const result = validate(runtime)
      assert.equal(result.accepted, false)
      assert.equal(result.warnings.length, 1)
    }
  })
})
