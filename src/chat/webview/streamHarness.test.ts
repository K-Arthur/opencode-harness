/**
 * streamHarness teardown (test-infra regression, 2026-07-03).
 *
 * Modules under test (e.g. streamHandlers' elapsed-time ticker) call the bare
 * `setInterval`, which resolves to NODE's global timer — not the JSDOM
 * window's. `restore()` closed the JSDOM window but left those Node timers
 * running, so any test that started a stream without ending it kept the event
 * loop alive forever: the file's tests all passed, then the process hung,
 * stalling the entire sequential `npm run test:unit` run (observed: 57 min on
 * streamHandlers.restart.test.ts before manual kill).
 *
 * installDom() must track timers created while the harness DOM is installed
 * and clear them in restore().
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { installDom } from "./streamHarness"

describe("streamHarness restore() timer hygiene", () => {
  it("clears intervals created while the harness DOM was installed", async () => {
    const dom = installDom()
    let ticked = 0
    // Simulates a module under test leaking a ticker (no clearInterval).
    setInterval(() => {
      ticked++
    }, 5)
    dom.restore()

    await new Promise((r) => setTimeout(r, 30))
    assert.equal(ticked, 0, "a leaked interval must not survive restore() — it pins the event loop and hangs the test file")
  })

  it("clears pending timeouts created while the harness DOM was installed", async () => {
    const dom = installDom()
    let fired = false
    setTimeout(() => {
      fired = true
    }, 10)
    dom.restore()

    await new Promise((r) => setTimeout(r, 30))
    assert.equal(fired, false, "a pending timeout must not survive restore()")
  })

  it("restores the original global timer functions", () => {
    const originalSetInterval = globalThis.setInterval
    const originalSetTimeout = globalThis.setTimeout
    const originalClearInterval = globalThis.clearInterval
    const originalClearTimeout = globalThis.clearTimeout

    const dom = installDom()
    assert.notEqual(globalThis.setInterval, originalSetInterval, "harness must interpose setInterval to track handles")
    dom.restore()

    assert.equal(globalThis.setInterval, originalSetInterval)
    assert.equal(globalThis.setTimeout, originalSetTimeout)
    assert.equal(globalThis.clearInterval, originalClearInterval)
    assert.equal(globalThis.clearTimeout, originalClearTimeout)
  })

  it("clearing a timer through the wrapper untracks it (no double-clear on restore)", async () => {
    const dom = installDom()
    let ticked = 0
    const h = setInterval(() => {
      ticked++
    }, 5)
    clearInterval(h)
    dom.restore()

    await new Promise((r) => setTimeout(r, 20))
    assert.equal(ticked, 0)
  })
})
