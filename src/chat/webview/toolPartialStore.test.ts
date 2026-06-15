import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createToolPartialStore } from "./toolPartialStore"

describe("toolPartialStore", () => {
  it("appends stdout/stderr deltas and computes lengths/line counts", () => {
    const store = createToolPartialStore()

    const first = store.apply("s1", "t1", {
      token: 1,
      stdoutDelta: "one\n",
      stderrDelta: "warn\n",
    })
    assert.ok(first)
    assert.equal(first.stdout, "one\n")
    assert.equal(first.stderr, "warn\n")
    assert.equal(first.stdoutLineCount, 1)
    assert.equal(first.stderrLineCount, 1)

    const second = store.apply("s1", "t1", {
      token: 2,
      stdoutDelta: "two",
      stdoutLength: 7,
      stderrLength: 5,
    })
    assert.ok(second)
    assert.equal(second.stdout, "one\ntwo")
    assert.equal(second.stderr, "warn\n")
    assert.equal(second.stdoutLength, 7)
  })

  it("drops duplicate or older tokens", () => {
    const store = createToolPartialStore()
    assert.ok(store.apply("s1", "t1", { token: 2, stdoutDelta: "two" }))
    assert.equal(store.apply("s1", "t1", { token: 2, stdoutDelta: "duplicate" }), undefined)
    assert.equal(store.apply("s1", "t1", { token: 1, stdoutDelta: "old" }), undefined)
    assert.equal(store.get("s1", "t1")?.stdout, "two")
  })

  it("uses replacement snapshots to repair shorter or gapped buffers", () => {
    const store = createToolPartialStore()
    store.apply("s1", "t1", { token: 1, stdoutDelta: "abcdef", stderrDelta: "xyz" })

    const replaced = store.apply("s1", "t1", {
      token: 2,
      replace: true,
      stdout: "fresh",
      stderr: "",
      stdoutLength: 5,
      stderrLength: 0,
    })
    assert.ok(replaced)
    assert.equal(replaced.stdout, "fresh")
    assert.equal(replaced.stderr, "")

    const repaired = store.apply("s1", "t1", {
      token: 3,
      stdoutDelta: "!",
      stdout: "fresh snapshot",
      stdoutLength: 14,
    })
    assert.ok(repaired)
    assert.equal(repaired.stdout, "fresh snapshot")
  })

  it("drops stale deltas after a terminal update", () => {
    const store = createToolPartialStore()
    store.apply("s1", "t1", { token: 1, stdoutDelta: "live" })
    store.markTerminal("s1", "t1")

    assert.equal(store.apply("s1", "t1", { token: 2, stdoutDelta: "stale" }), undefined)
    assert.equal(store.get("s1", "t1")?.stdout, "live")
  })

  it("clears all partials for a session", () => {
    const store = createToolPartialStore()
    store.apply("s1", "t1", { token: 1, stdoutDelta: "a" })
    store.apply("s2", "t1", { token: 1, stdoutDelta: "b" })

    store.clearSession("s1")
    assert.equal(store.get("s1", "t1"), undefined)
    assert.equal(store.get("s2", "t1")?.stdout, "b")
  })
})
