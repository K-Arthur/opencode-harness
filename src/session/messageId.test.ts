import test from "node:test"
import assert from "node:assert/strict"

import { generateUserMessageId } from "./messageId"

// opencode v1.16.2 validates the user message id with Identifier.schema("message"),
// a Zod refine that requires the id to start with "msg". Ids are also time-ordered
// (prefix_ + 12 hex timestamp + 14 base62 random) and session.messages()/backfill rely
// on that ordering. generateUserMessageId() must satisfy both.

const FORMAT = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/

test("generateUserMessageId starts with the opencode message prefix", () => {
  const id = generateUserMessageId()
  assert.ok(id.startsWith("msg"), `expected id to start with "msg", got ${id}`)
})

test("generateUserMessageId matches the opencode ascending id format", () => {
  for (let i = 0; i < 100; i++) {
    const id = generateUserMessageId()
    assert.match(id, FORMAT)
  }
})

test("successive ids sort ascending (preserves chronological order)", () => {
  let prev = generateUserMessageId()
  for (let i = 0; i < 1000; i++) {
    const next = generateUserMessageId()
    assert.ok(prev < next, `ids must be strictly ascending: ${prev} !< ${next}`)
    prev = next
  }
})

test("generateUserMessageId produces unique ids", () => {
  const ids = new Set<string>()
  for (let i = 0; i < 10000; i++) ids.add(generateUserMessageId())
  assert.equal(ids.size, 10000)
})
