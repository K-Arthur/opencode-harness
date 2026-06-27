import { afterEach, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { createAttachmentManager, parsePromptMentions } from "./attachments"

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

  it("setActiveFile with selection info stores selection and resets to included", () => {
    const { manager } = setupManager()
    manager.setActiveFile({ path: "src/main.ts", selection: { startLine: 5, endLine: 10, text: "selected" } })
    assert.equal(manager.getActiveFile(), "src/main.ts")
    assert.equal(manager.isActiveFileIncluded(), true)
    const sel = manager.getActiveFileSelection()
    assert.ok(sel)
    assert.equal(sel!.startLine, 5)
    assert.equal(sel!.endLine, 10)
  })

  it("toggleActiveFileInclude flips state without posting (inclusion is gated webview-side)", () => {
    const { manager, posted } = setupManager()
    manager.setActiveFile({ path: "src/main.ts" })
    assert.equal(manager.isActiveFileIncluded(), true)

    manager.toggleActiveFileInclude()
    assert.equal(manager.isActiveFileIncluded(), false)
    // The host keeps no per-session inclusion state, so no message is posted
    // this previously posted with an empty sessionId, the bug we removed.
    assert.equal(posted.filter((m) => m.type === "toggle_active_file").length, 0)

    manager.toggleActiveFileInclude()
    assert.equal(manager.isActiveFileIncluded(), true)
    assert.equal(posted.filter((m) => m.type === "toggle_active_file").length, 0)
  })

  it("isActiveFileIncluded returns false when active file is dismissed", () => {
    const { manager } = setupManager()
    manager.setActiveFile({ path: "src/main.ts" })
    assert.equal(manager.isActiveFileIncluded(), true)

    // Dismiss by setting to null (simulates remove chip)
    manager.setActiveFile({ path: null })
    assert.equal(manager.isActiveFileIncluded(), false)
  })

  it("setActiveFile resets to included when switching files", () => {
    const { manager } = setupManager()
    manager.setActiveFile({ path: "src/a.ts" })
    manager.toggleActiveFileInclude()
    assert.equal(manager.isActiveFileIncluded(), false)

    manager.setActiveFile({ path: "src/b.ts" })
    assert.equal(manager.isActiveFileIncluded(), true, "switching files should reset to included")
  })

  it("isActiveFileIncluded returns false when no active file exists", () => {
    const { manager } = setupManager()
    assert.equal(manager.isActiveFileIncluded(), false)
  })
})

describe("parsePromptMentions", () => {
  it("uses the basename as the file chip label and keeps the full path as title", () => {
    const [m] = parsePromptMentions("see @file:src/chat/webview/GEMINI.md please")
    assert.ok(m)
    assert.equal(m!.kind, "file")
    assert.equal(m!.label, "GEMINI.md")
    assert.equal(m!.title, "src/chat/webview/GEMINI.md")
    assert.equal(m!.token, "@file:src/chat/webview/GEMINI.md")
  })

  it("switches file mentions with an image extension to the image kind", () => {
    const [m] = parsePromptMentions("@file:assets/diagram.PNG")
    assert.equal(m!.kind, "image")
    assert.equal(m!.label, "diagram.PNG")
  })

  it("renders folder mentions with a trailing slash", () => {
    const [m] = parsePromptMentions("@folder:src/utils")
    assert.equal(m!.kind, "folder")
    assert.equal(m!.label, "utils/")
  })

  it("renders url mentions as the hostname", () => {
    const [m] = parsePromptMentions("@url:https://example.com/a/b?c=1")
    assert.equal(m!.kind, "url")
    assert.equal(m!.label, "example.com")
    assert.equal(m!.title, "https://example.com/a/b?c=1")
  })

  it("gives problems and terminal mentions friendly labels", () => {
    const labels = parsePromptMentions("@problems:all and @terminal:foo").map((m) => `${m.kind}:${m.label}`)
    assert.deepEqual(labels, ["problems:Problems", "terminal:Terminal"])
  })

  it("unquotes quoted paths containing spaces", () => {
    const [m] = parsePromptMentions('@file:"my folder/a b.ts"')
    assert.equal(m!.label, "a b.ts")
    assert.equal(m!.title, "my folder/a b.ts")
  })

  it("de-duplicates identical mention tokens", () => {
    assert.equal(parsePromptMentions("@file:a.ts @file:a.ts").length, 1)
  })
})
