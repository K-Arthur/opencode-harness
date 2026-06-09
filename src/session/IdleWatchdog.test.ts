import { describe, it, afterEach } from "node:test"
import assert from "node:assert/strict"
import { IdleWatchdog } from "./IdleWatchdog"

void describe("IdleWatchdog", () => {
  let abortCount = 0

  afterEach(() => {
    abortCount = 0
  })

  void it("fires onTimeout after elapsed time", async () => {
    const wd = new IdleWatchdog({
      timeoutMs: 10,
      onTimeout: () => { abortCount++ },
    })
    wd.arm()
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(wd.timedOut, true)
    assert.equal(abortCount, 1)
  })

  void it("does not fire before timeout", () => {
    const wd = new IdleWatchdog({
      timeoutMs: 5000,
      onTimeout: () => { abortCount++ },
    })
    wd.arm()
    assert.equal(wd.timedOut, false)
    assert.equal(abortCount, 0)
    wd.clear()
  })

  void it("arm resets an existing timer", async () => {
    const wd = new IdleWatchdog({
      timeoutMs: 10,
      onTimeout: () => { abortCount++ },
    })
    wd.arm()
    wd.arm() // reset — gives another 10ms
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(wd.timedOut, true)
    assert.equal(abortCount, 1)
  })

  void it("clear prevents timeout from firing", async () => {
    const wd = new IdleWatchdog({
      timeoutMs: 10,
      onTimeout: () => { abortCount++ },
    })
    wd.arm()
    wd.clear()
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(wd.timedOut, false)
    assert.equal(abortCount, 0)
  })

  void it("clear is safe when no timer is active", () => {
    const wd = new IdleWatchdog({ timeoutMs: 1000, onTimeout: () => {} })
    wd.clear() // should not throw
    assert.equal(wd.timedOut, false)
  })
})