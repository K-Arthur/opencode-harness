import { afterEach, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { createAttachmentManager } from "./attachments"

class FakeFileReader {
  result: string | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  readAsDataURL(_blob: Blob): void {
    this.result = "data:image/png;base64,aGVsbG8="
    this.onload?.()
  }
}

describe("attachments.ts", () => {
  let originalDocument: typeof globalThis.document | undefined
  let originalFileReader: typeof globalThis.FileReader | undefined

  beforeEach(() => {
    originalDocument = globalThis.document
    originalFileReader = globalThis.FileReader
  })

  afterEach(() => {
    if (originalDocument) globalThis.document = originalDocument
    else Reflect.deleteProperty(globalThis, "document")

    if (originalFileReader) globalThis.FileReader = originalFileReader
    else Reflect.deleteProperty(globalThis, "FileReader")
  })

  function setupManager() {
    const dom = new JSDOM(`
      <div id="input-area">
        <div id="input-wrapper"></div>
        <textarea id="prompt-input"></textarea>
      </div>
    `)
    globalThis.document = dom.window.document
    globalThis.FileReader = FakeFileReader as unknown as typeof FileReader

    const posted: Array<Record<string, unknown>> = []
    let sendButtonUpdates = 0
    const manager = createAttachmentManager({
      els: {
        inputArea: document.getElementById("input-area") as HTMLElement,
        inputWrapper: document.getElementById("input-wrapper") as HTMLElement,
        promptInput: document.getElementById("prompt-input") as HTMLTextAreaElement,
      },
      postMessage: (m) => { posted.push(m) },
      updateSendButton: () => { sendButtonUpdates += 1 },
      autoResizeTextarea: () => {},
      updateContextChips: () => {},
      getActiveSession: () => undefined,
    })
    return { manager, posted, getSendButtonUpdates: () => sendButtonUpdates }
  }

  it("accepts pasted images before an active session exists", () => {
    const { manager, getSendButtonUpdates } = setupManager()
    let prevented = false

    const pasteEvent = {
      clipboardData: {
        items: [
          {
            type: "image/png",
            getAsFile: () => new Blob(["hello"], { type: "image/png" }),
          },
        ],
      },
      preventDefault: () => { prevented = true },
    } as unknown as ClipboardEvent

    manager.onPaste(pasteEvent)

    assert.equal(prevented, true)
    assert.deepEqual(manager.getAttachments(), [{ data: "aGVsbG8=", mimeType: "image/png" }])
    assert.equal(getSendButtonUpdates(), 1)
  })

  it("keeps looking past a same-MIME item whose getAsFile() returns null", () => {
    // Some platforms expose duplicate clipboard entries — one as a string
    // (kind=string, getAsFile returns null) and one as a file. The handler
    // used to `break` on the first MIME match, so the string-typed entry
    // shadowed the real image. This test pins down the fix.
    const { manager } = setupManager()
    let prevented = false

    const pasteEvent = {
      clipboardData: {
        items: [
          { type: "image/png", getAsFile: () => null },
          { type: "image/png", getAsFile: () => new Blob(["payload"], { type: "image/png" }) },
        ],
      },
      preventDefault: () => { prevented = true },
    } as unknown as ClipboardEvent

    manager.onPaste(pasteEvent)

    assert.equal(prevented, true, "preventDefault must still fire once an image lands")
    assert.equal(manager.getAttachments().length, 1, "the real image item must be picked up")
  })

  it("falls back to clipboardData.files when items has no image", () => {
    // Some host clipboards (notably certain Linux DEs and Wayland setups)
    // surface pasted images only via DataTransfer.files, not .items.
    const { manager } = setupManager()
    let prevented = false

    const blob = new Blob(["from-files"], { type: "image/png" })
    const pasteEvent = {
      clipboardData: {
        items: [{ type: "text/plain", getAsFile: () => null }],
        files: [Object.assign(blob, { name: "screenshot.png" })],
      },
      preventDefault: () => { prevented = true },
    } as unknown as ClipboardEvent

    manager.onPaste(pasteEvent)

    assert.equal(prevented, true)
    assert.equal(manager.getAttachments().length, 1)
    assert.equal(manager.getAttachments()[0]!.mimeType, "image/png")
  })

  it("does nothing when the clipboard has no image and no image-like file", () => {
    const { manager } = setupManager()
    let prevented = false

    const pasteEvent = {
      clipboardData: {
        items: [{ type: "text/plain", getAsFile: () => null }],
        files: [],
      },
      preventDefault: () => { prevented = true },
    } as unknown as ClipboardEvent

    manager.onPaste(pasteEvent)

    assert.equal(prevented, false, "must not preventDefault when no image was attached — let the text paste through")
    assert.equal(manager.getAttachments().length, 0)
  })

  it("getAttachments returns a copy that survives clearAttachments", () => {
    const { manager } = setupManager()
    const blob = new Blob(["test"], { type: "image/png" })
    manager.attachImageBlob(blob)

    const snapshot = manager.getAttachments()
    assert.equal(snapshot.length, 1, "snapshot must capture the attachment")

    manager.clearAttachments()
    assert.equal(manager.getAttachments().length, 0, "internal state must be cleared")
    assert.equal(snapshot.length, 1, "snapshot must survive clearAttachments — this is the root cause of images showing as attached but not being sent")
    assert.equal(snapshot[0]!.mimeType, "image/png")
  })
})
