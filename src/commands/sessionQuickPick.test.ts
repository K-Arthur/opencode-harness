import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildSessionPickItems,
  formatRelativeTime,
  pickRunningSession,
  type SessionPickCandidate,
} from "./sessionQuickPick"

const NOW = 1_750_000_000_000

function candidate(over: Partial<SessionPickCandidate>): SessionPickCandidate {
  return {
    id: "s1",
    title: "Untitled session",
    lastActiveAt: NOW - 60_000,
    messageCount: 0,
    isActive: false,
    isStreaming: false,
    ...over,
  }
}

void describe("formatRelativeTime", () => {
  void it("renders sub-minute as 'just now'", () => {
    assert.equal(formatRelativeTime(NOW - 20_000, NOW), "just now")
  })
  void it("renders minutes and hours", () => {
    assert.equal(formatRelativeTime(NOW - 5 * 60_000, NOW), "5m ago")
    assert.equal(formatRelativeTime(NOW - 3 * 3_600_000, NOW), "3h ago")
  })
  void it("renders days under a week, dates beyond", () => {
    assert.equal(formatRelativeTime(NOW - 2 * 86_400_000, NOW), "2d ago")
    const old = formatRelativeTime(NOW - 30 * 86_400_000, NOW)
    assert.doesNotMatch(old, /ago/)
    assert.ok(old.length > 0)
  })
})

void describe("buildSessionPickItems", () => {
  void it("sorts streaming sessions first, then most recently active", () => {
    const items = buildSessionPickItems(
      [
        candidate({ id: "old", title: "Old", lastActiveAt: NOW - 9_000_000 }),
        candidate({ id: "fresh", title: "Fresh", lastActiveAt: NOW - 1_000 }),
        candidate({ id: "run", title: "Running", lastActiveAt: NOW - 8_000_000, isStreaming: true }),
      ],
      NOW
    )
    assert.deepEqual(items.map((i) => i.id), ["run", "fresh", "old"])
  })

  void it("marks the active session and streaming sessions with codicons", () => {
    const items = buildSessionPickItems(
      [
        candidate({ id: "a", title: "Active one", isActive: true }),
        candidate({ id: "b", title: "Streamer", isStreaming: true }),
        candidate({ id: "c", title: "Plain" }),
      ],
      NOW
    )
    const byId = new Map(items.map((i) => [i.id, i]))
    assert.match(byId.get("a")!.label, /\$\(check\)/)
    assert.match(byId.get("b")!.label, /\$\(sync~spin\)/)
    assert.doesNotMatch(byId.get("c")!.label, /\$\(/)
  })

  void it("describes message count and recency; detail carries the model", () => {
    const [item] = buildSessionPickItems(
      [candidate({ id: "a", title: "T", messageCount: 7, model: "anthropic/claude", lastActiveAt: NOW - 120_000 })],
      NOW
    )
    assert.match(item!.description, /7 messages/)
    assert.match(item!.description, /2m ago/)
    assert.equal(item!.detail, "anthropic/claude")
  })

  void it("singularizes one message and omits detail when model is unknown", () => {
    const [item] = buildSessionPickItems([candidate({ messageCount: 1 })], NOW)
    assert.match(item!.description, /1 message(?!s)/)
    assert.equal(item!.detail, undefined)
  })
})

void describe("pickRunningSession", () => {
  void it("reports none when nothing is streaming", () => {
    assert.deepEqual(
      pickRunningSession([{ id: "a", isStreaming: false }]),
      { kind: "none" }
    )
  })
  void it("returns the single streaming session directly", () => {
    assert.deepEqual(
      pickRunningSession([
        { id: "a", isStreaming: false },
        { id: "b", isStreaming: true },
      ]),
      { kind: "single", id: "b" }
    )
  })
  void it("returns all ids when multiple sessions stream", () => {
    assert.deepEqual(
      pickRunningSession([
        { id: "a", isStreaming: true },
        { id: "b", isStreaming: true },
      ]),
      { kind: "multiple", ids: ["a", "b"] }
    )
  })
})
