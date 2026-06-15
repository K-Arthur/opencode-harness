import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createLazyStarter } from "./lazyStarter"

const tick = () => new Promise<void>((r) => setTimeout(r, 5))

void describe("createLazyStarter", () => {
  void it("invokes start at most once across concurrent calls (single in-flight)", async () => {
    let calls = 0
    const ensure = createLazyStarter(async () => {
      calls++
      await tick()
    })
    await Promise.all([ensure(), ensure(), ensure()])
    assert.equal(calls, 1)
  })

  void it("memoizes success — does not start again after it has settled", async () => {
    let calls = 0
    const ensure = createLazyStarter(async () => {
      calls++
    })
    await ensure()
    await ensure()
    await ensure()
    assert.equal(calls, 1)
  })

  void it("re-arms after a failure so a later call can retry", async () => {
    let calls = 0
    let shouldFail = true
    const ensure = createLazyStarter(async () => {
      calls++
      if (shouldFail) throw new Error("server spawn failed")
    })
    await assert.rejects(ensure(), /server spawn failed/)
    assert.equal(calls, 1)
    shouldFail = false
    await ensure()
    assert.equal(calls, 2)
    // now that it succeeded, it is memoized again
    await ensure()
    assert.equal(calls, 2)
  })

  void it("returns a resolved promise for callers after success without re-invoking start", async () => {
    let calls = 0
    const ensure = createLazyStarter(async () => {
      calls++
      await tick()
    })
    await ensure()
    const p = ensure()
    assert.ok(p instanceof Promise)
    await p
    assert.equal(calls, 1)
  })
})
