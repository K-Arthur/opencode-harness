import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { selectPendingBackfill, SingleFlight } from "./backfillPlanner"

describe("selectPendingBackfill", () => {
  const base = { id: "x", cliSessionId: "ses_a", messages: [] as unknown[], needsBackfill: true }

  it("includes a flagged, empty, real-cli session", () => {
    assert.equal(selectPendingBackfill([{ ...base }]).length, 1)
  })

  it("excludes sessions not flagged for backfill", () => {
    assert.equal(selectPendingBackfill([{ ...base, needsBackfill: false }]).length, 0)
  })

  it("excludes sessions that already have messages", () => {
    assert.equal(selectPendingBackfill([{ ...base, messages: [{}] }]).length, 0)
  })

  it("excludes placeholder cli ids", () => {
    assert.equal(selectPendingBackfill([{ ...base, cliSessionId: "session-deadbeef" }]).length, 0)
  })

  it("excludes sessions with no cli id", () => {
    assert.equal(selectPendingBackfill([{ ...base, cliSessionId: undefined }]).length, 0)
  })

  it("B2: returns ALL pending, not a capped slice", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...base, id: `s${i}`, cliSessionId: `ses_${i}` }))
    assert.equal(selectPendingBackfill(many).length, 12)
  })
})

describe("SingleFlight (B3: dedup by key)", () => {
  it("shares one in-flight promise for the same key", async () => {
    const sf = new SingleFlight<number>()
    let runs = 0
    const work = () => new Promise<number>((r) => { runs++; setTimeout(() => r(runs), 5) })

    const [a, b] = await Promise.all([sf.run("k", work), sf.run("k", work)])

    assert.equal(runs, 1, "the underlying work runs once")
    assert.equal(a, b, "both callers receive the same result")
  })

  it("re-runs after the previous call settles", async () => {
    const sf = new SingleFlight<number>()
    let runs = 0
    const work = () => Promise.resolve(++runs)

    await sf.run("k", work)
    await sf.run("k", work)

    assert.equal(runs, 2, "a settled key is cleared so it can run again")
  })

  it("keys are independent", async () => {
    const sf = new SingleFlight<string>()
    const [a, b] = await Promise.all([
      sf.run("a", async () => "A"),
      sf.run("b", async () => "B"),
    ])
    assert.equal(a, "A")
    assert.equal(b, "B")
  })
})
