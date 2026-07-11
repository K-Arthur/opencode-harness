import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_MASKING_EXCLUDE_GLOBS,
  maskPromptPayload,
  matchesExcludedPath,
  prunePromptToBudget,
  redactSecrets,
} from "./PromptMasker"

describe("PromptMasker", () => {
  it("redacts common secret assignments and bearer tokens", () => {
    const input = [
      "OPENAI_API_KEY=sk-test_1234567890abcdef",
      "password: super-secret-password",
      "Authorization: Bearer abc.def.ghi123456789",
      "normal_value=visible",
    ].join("\n")

    const result = redactSecrets(input)

    assert.equal(result.stats.redactedSecrets, 3)
    assert.ok(!result.text.includes("sk-test_1234567890abcdef"))
    assert.ok(!result.text.includes("super-secret-password"))
    assert.ok(!result.text.includes("abc.def.ghi123456789"))
    assert.ok(result.text.includes("normal_value=visible"))
  })

  it("matches excluded secret and dependency paths", () => {
    assert.equal(matchesExcludedPath(".env.local", DEFAULT_MASKING_EXCLUDE_GLOBS), true)
    assert.equal(matchesExcludedPath("src/.env.production", DEFAULT_MASKING_EXCLUDE_GLOBS), true)
    assert.equal(matchesExcludedPath("node_modules/pkg/index.js", DEFAULT_MASKING_EXCLUDE_GLOBS), true)
    assert.equal(matchesExcludedPath("src/app.ts", DEFAULT_MASKING_EXCLUDE_GLOBS), false)
  })

  it("masks excluded file mentions and drops excluded context items", () => {
    const result = maskPromptPayload({
      text: "@file:.env.local\n@file:src/app.ts\nPlease inspect both.",
      contextItems: [
        { id: "secret", type: "picked_file", path: ".env.local", isActive: true },
        { id: "app", type: "picked_file", path: "src/app.ts", isActive: true },
      ],
    }, {
      excludedPathGlobs: DEFAULT_MASKING_EXCLUDE_GLOBS,
      maxPromptTokens: 10_000,
    })

    assert.equal(result.stats.maskedFileMentions, 1)
    assert.equal(result.stats.removedContextItems, 1)
    assert.ok(result.text.includes("[masked @file:.env.local]"))
    assert.ok(result.text.includes("@file:src/app.ts"))
    assert.deepEqual(result.contextItems?.map((item) => item.id), ["app"])
  })

  it("redacts excluded injected document blocks by filename", () => {
    const result = maskPromptPayload({
      text: '<file name=".env.local">\n```dotenv\nSECRET=value123456789\n```\n</file>\nKeep this note.',
    }, {
      excludedPathGlobs: DEFAULT_MASKING_EXCLUDE_GLOBS,
      maxPromptTokens: 10_000,
    })

    assert.equal(result.stats.maskedDocumentBlocks, 1)
    assert.ok(!result.text.includes("value123456789"))
    assert.ok(result.text.includes("[masked file content for .env.local]"))
    assert.ok(result.text.includes("Keep this note."))
  })

  it("prunes over-budget prompts with an explicit marker", () => {
    const longText = Array.from({ length: 2000 }, (_, i) => `line ${i} important context`).join("\n")
    const result = prunePromptToBudget(longText, { maxPromptTokens: 120, reserveTokens: 20 })

    assert.equal(result.truncated, true)
    assert.ok(result.text.includes("[context pruned:"))
    assert.ok(result.outputTokens <= 120)
  })
})
