import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createState } from "./state"

function captureVsCode() {
  let saved: any = null
  return {
    api: {
      getState: () => saved,
      setState: (s: unknown) => { saved = s },
      postMessage: () => {},
    } as any,
    get saved() { return saved },
  }
}

describe("webview state ephemeral sessions", () => {
  it("creates sessions with an ephemeral flag when requested", () => {
    const cap = captureVsCode()
    const sm = createState(cap.api)
    const session = sm.createSession("Temp", "", "build", { ephemeral: true })

    assert.equal(sm.getSession(session.id)?.ephemeral, true)
  })

  it("flush skips ephemeral sessions from vscode persisted state", () => {
    const cap = captureVsCode()
    const sm = createState(cap.api)
    const persistent = sm.createSession("Keep")
    const temporary = sm.createSession("Temp", "", "build", { ephemeral: true })

    sm.appendMessage(persistent.id, { role: "user", blocks: [{ type: "text", text: "keep" }] } as any)
    sm.appendMessage(temporary.id, { role: "user", blocks: [{ type: "text", text: "secret" }] } as any)
    sm.setActiveSession(temporary.id)
    sm.flush()

    assert.ok(cap.saved.sessions[persistent.id])
    assert.equal(cap.saved.sessions[temporary.id], undefined)
    assert.equal(cap.saved.activeSessionId, persistent.id)
    assert.deepEqual(cap.saved.sessionOrder, [persistent.id])
  })
})
