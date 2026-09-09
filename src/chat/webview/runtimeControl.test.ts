import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { setupRuntimeControl } from "./runtimeControl"

interface FakeSelect {
  value: string
  disabled: boolean
  listeners: Map<string, () => void>
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

function select(value = "auto"): FakeSelect {
  return {
    value,
    disabled: false,
    listeners: new Map(),
    addEventListener(type, listener) { this.listeners.set(type, listener) },
    removeEventListener(type) { this.listeners.delete(type) },
  }
}

function badge(): HTMLElement {
  return {
    dataset: {},
    setAttribute() {},
    textContent: "",
    title: "",
  } as unknown as HTMLElement
}

describe("runtime control", () => {
  it("posts a validated runtime selection and locks the control while switching", () => {
    const element = select()
    const posted: Record<string, unknown>[] = []
    const control = setupRuntimeControl({
      select: element as unknown as HTMLSelectElement,
      badge: badge(),
      postMessage: (message) => posted.push(message),
    })

    element.value = "opencode2"
    element.listeners.get("change")?.()

    assert.deepEqual(posted, [{ type: "set_runtime", runtime: "opencode2" }])
    assert.equal(element.disabled, true)
    control.applySwitchResult({ ok: true, runtime: "opencode2" })
    assert.equal(element.disabled, false)
    control.dispose()
  })

  it("shows the verified runtime independently from the Auto preference", () => {
    const element = select()
    const target = badge()
    const control = setupRuntimeControl({
      select: element as unknown as HTMLSelectElement,
      badge: target,
      postMessage: () => {},
    })

    control.applyStatus({ connected: true, runtime: "opencode2", preference: "auto", version: "2.0.0" })
    assert.equal(element.value, "auto")
    assert.equal(target.textContent, "OpenCode 2 · verified")
    assert.match(target.title, /2\.0\.0/)
  })

  it("restores the current preference after a failed switch", () => {
    const element = select("opencode")
    const target = badge()
    const control = setupRuntimeControl({
      select: element as unknown as HTMLSelectElement,
      badge: target,
      postMessage: () => {},
    })
    element.value = "opencode2"
    element.listeners.get("change")?.()
    control.applySwitchResult({ ok: false, error: "A stream is active" })
    assert.equal(element.value, "opencode")
    assert.equal(element.disabled, false)
    assert.equal(target.textContent, "Switch failed")
  })
})
