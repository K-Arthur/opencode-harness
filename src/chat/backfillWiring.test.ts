import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "BackfillService.ts"), "utf8")

describe("BackfillService wiring (B1/B2/B3)", () => {
  it("B1: both entry points hydrate through a single helper", () => {
    assert.ok(source.includes("private async hydrate("), "must define hydrate()")
    const calls = (source.match(/this\.hydrate\(session\)/g) || []).length
    assert.ok(calls >= 2, `both backfill paths must call hydrate (found ${calls})`)
    // The fetch/convert/apply chain must live in exactly one place now.
    assert.equal((source.match(/getSessionMessages\(/g) || []).length, 1, "only hydrate fetches")
  })

  it("B3: fetches are deduped by cliSessionId via SingleFlight", () => {
    assert.ok(source.includes("new SingleFlight<"), "must hold a SingleFlight")
    assert.ok(source.includes("this.fetchFlight.run(cliId"), "must key the flight by cliSessionId")
  })

  it("B2: selects all pending sessions instead of a fixed slice(0, 10)", () => {
    assert.ok(source.includes("selectPendingBackfill(sessions)"), "must use selectPendingBackfill")
    assert.ok(!source.includes(".slice(0, 10)"), "must not cap the initial batch at 10")
  })
})
