/**
 * Unit tests for drag-and-drop file upload module.
 */

import assert from "node:assert"
import { describe, it, mock, beforeEach, afterEach } from "node:test"
import type { Mock } from "node:test"
import { JSDOM } from "jsdom"
import { setupDragDrop, type DragDropDeps } from "./dragDrop"

describe("dragDrop module", () => {
  let dom: JSDOM
  let mockApp: HTMLElement
  let mockInputArea: HTMLElement
  let mockPostMessage: Mock<(msg: Record<string, unknown>) => void>
  let mockAttachImageBlob: Mock<(blob: Blob) => void>
  let mockAttachFileBlob: Mock<(blob: Blob, mimeType: string) => void>
  let mockAddPickedFile: Mock<(path: string) => void>

  beforeEach(() => {
    dom = new JSDOM("<!DOCTYPE html><body></body>")
    const win = dom.window
    globalThis.document = win.document
    ;(globalThis as unknown as { window: unknown }).window = win
    // jsdom does not implement DragEvent; provide a minimal shim that carries
    // the fields the handlers read (relatedTarget, dataTransfer) on top of the
    // jsdom Event (which supplies preventDefault/stopPropagation + dispatch).
    class DragEventShim extends win.Event {
      relatedTarget: EventTarget | null
      dataTransfer: DataTransfer | null
      constructor(
        type: string,
        init: { bubbles?: boolean; cancelable?: boolean; relatedTarget?: EventTarget | null; dataTransfer?: DataTransfer | null } = {},
      ) {
        super(type, init)
        this.relatedTarget = init.relatedTarget ?? null
        this.dataTransfer = init.dataTransfer ?? null
      }
    }
    ;(globalThis as unknown as { DragEvent: unknown }).DragEvent = DragEventShim
    ;(win as unknown as { DragEvent: unknown }).DragEvent = DragEventShim

    mockApp = document.createElement("div")
    mockApp.id = "app"
    document.body.appendChild(mockApp)

    mockInputArea = document.createElement("div")
    mockInputArea.id = "input-area"
    mockApp.appendChild(mockInputArea)

    mockPostMessage = mock.fn()
    mockAttachImageBlob = mock.fn()
    mockAttachFileBlob = mock.fn()
    mockAddPickedFile = mock.fn()
  })

  afterEach(() => {
    // Close jsdom so its pending timers (e.g. the 3s emergency hide) don't leak
    // into later tests or keep the process alive.
    dom.window.close()
  })

  function makeDeps(): DragDropDeps {
    return {
      els: { app: mockApp, inputArea: mockInputArea },
      postMessage: mockPostMessage,
      attachmentManager: {
        attachImageBlob: mockAttachImageBlob,
        attachFileBlob: mockAttachFileBlob,
        addPickedFile: mockAddPickedFile,
      },
    }
  }

  it("should create overlay on dragenter", () => {
    setupDragDrop(makeDeps())

    // Trigger dragenter event
    const dragEnterEvent = new DragEvent("dragenter", {
      bubbles: true,
      cancelable: true,
    })
    mockApp.dispatchEvent(dragEnterEvent)

    // Check that overlay was created
    const overlay = document.querySelector(".drop-overlay")
    assert.ok(overlay, "Overlay should be created on dragenter")
  })

  it("should remove overlay on dragleave when counter reaches zero", () => {
    setupDragDrop(makeDeps())

    // Trigger dragenter
    const dragEnterEvent = new DragEvent("dragenter", {
      bubbles: true,
      cancelable: true,
    })
    mockApp.dispatchEvent(dragEnterEvent)

    // Trigger dragleave
    const dragLeaveEvent = new DragEvent("dragleave", {
      bubbles: true,
      cancelable: true,
    })
    mockApp.dispatchEvent(dragLeaveEvent)

    // Wait for RAF
    return new Promise((resolve) => {
      setTimeout(() => {
        const overlay = document.querySelector(".drop-overlay")
        assert.ok(!overlay, "Overlay should be removed on dragleave")
        resolve(undefined)
      }, 100)
    })
  })

  it("should process workspace files from text/uri-list", () => {
    setupDragDrop(makeDeps())

    // Create mock dataTransfer with text/uri-list
    const mockDataTransfer = {
      types: ["text/uri-list"],
      getData: mock.fn((type: string) => {
        if (type === "text/uri-list") {
          return "file:///path/to/file1.ts\nfile:///path/to/file2.ts"
        }
        return ""
      }),
      files: [],
    }

    // Trigger drop event
    const dropEvent = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: mockDataTransfer as any,
    })
    mockApp.dispatchEvent(dropEvent)

    // Check that addPickedFile was called for workspace files
    assert.strictEqual(mockAddPickedFile.mock.calls.length, 2)
    assert.strictEqual(mockAddPickedFile.mock.calls[0]?.arguments[0], "/path/to/file1.ts")
    assert.strictEqual(mockAddPickedFile.mock.calls[1]?.arguments[0], "/path/to/file2.ts")
  })

  it("should process image files from external drag", () => {
    setupDragDrop(makeDeps())

    // Plain File-like object (Node's Blob.size is read-only, so we can't mutate one)
    const mockFile = { type: "image/png", name: "test.png", size: 1024 } as unknown as File

    const mockDataTransfer = {
      types: [],
      files: [mockFile],
    }

    // Trigger drop event
    const dropEvent = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: mockDataTransfer as any,
    })
    mockApp.dispatchEvent(dropEvent)

    // Check that attachImageBlob was called
    assert.strictEqual(mockAttachImageBlob.mock.calls.length, 1)
    assert.strictEqual(mockAttachImageBlob.mock.calls[0]?.arguments[0], mockFile)
  })

  it("should process document files from external drag", () => {
    setupDragDrop(makeDeps())

    const mockFile = { type: "application/json", name: "test.json", size: 1024 } as unknown as File

    const mockDataTransfer = {
      types: [],
      files: [mockFile],
    }

    // Trigger drop event
    const dropEvent = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: mockDataTransfer as any,
    })
    mockApp.dispatchEvent(dropEvent)

    // Check that attachFileBlob was called
    assert.strictEqual(mockAttachFileBlob.mock.calls.length, 1)
    assert.strictEqual(mockAttachFileBlob.mock.calls[0]?.arguments[0], mockFile)
    assert.strictEqual(mockAttachFileBlob.mock.calls[0]?.arguments[1], "application/json")
  })

  it("should show error for oversized files", () => {
    setupDragDrop(makeDeps())

    // File-like object larger than 10MB
    const mockFile = { type: "image/png", name: "huge.png", size: 11 * 1024 * 1024 } as unknown as File

    const mockDataTransfer = {
      types: [],
      files: [mockFile],
    }

    // Trigger drop event
    const dropEvent = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: mockDataTransfer as any,
    })
    mockApp.dispatchEvent(dropEvent)

    // Check that error was shown
    assert.strictEqual(mockPostMessage.mock.calls.length, 1)
    assert.strictEqual((mockPostMessage.mock.calls[0]?.arguments[0] as { type: string })?.type, "show_error")
    assert.ok((mockPostMessage.mock.calls[0]?.arguments[0] as { message: string })?.message?.includes("exceeds 10 MB limit"))
  })

  it("should show error for unsupported file types", () => {
    setupDragDrop(makeDeps())

    const mockFile = { type: "application/zip", name: "test.zip", size: 1024 } as unknown as File

    const mockDataTransfer = {
      types: [],
      files: [mockFile],
    }

    // Trigger drop event
    const dropEvent = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: mockDataTransfer as any,
    })
    mockApp.dispatchEvent(dropEvent)

    // Check that error was shown
    assert.strictEqual(mockPostMessage.mock.calls.length, 1)
    assert.strictEqual((mockPostMessage.mock.calls[0]?.arguments[0] as { type: string })?.type, "show_error")
    assert.ok((mockPostMessage.mock.calls[0]?.arguments[0] as { message: string })?.message?.includes("Unsupported file type"))
  })

  it("should prevent default on dragover", () => {
    setupDragDrop(makeDeps())

    // Trigger dragover event
    const dragOverEvent = new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
    })
    const preventDefaultSpy = mock.fn()
    dragOverEvent.preventDefault = preventDefaultSpy
    const stopPropagationSpy = mock.fn()
    dragOverEvent.stopPropagation = stopPropagationSpy

    mockApp.dispatchEvent(dragOverEvent)

    // Check that preventDefault was called
    assert.strictEqual(preventDefaultSpy.mock.calls.length, 1)
    assert.strictEqual(stopPropagationSpy.mock.calls.length, 1)
  })

  it("should force-hide overlay on drop immediately", () => {
    setupDragDrop(makeDeps())

    // Trigger dragenter to show overlay
    const dragEnterEvent = new DragEvent("dragenter", {
      bubbles: true,
      cancelable: true,
    })
    mockApp.dispatchEvent(dragEnterEvent)

    // Overlay should be visible
    assert.ok(document.querySelector(".drop-overlay"), "Overlay should be visible after dragenter")

    // Trigger drop
    const mockDataTransfer = {
      types: [],
      files: [],
    }
    const dropEvent = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: mockDataTransfer as any,
    })
    mockApp.dispatchEvent(dropEvent)

    // Overlay should be removed immediately (no RAF delay)
    assert.ok(!document.querySelector(".drop-overlay"), "Overlay should be removed immediately on drop")
  })

  it("keeps overlay visible while moving across child elements (paired enter/leave)", () => {
    setupDragDrop(makeDeps())

    const child = document.createElement("div")
    mockApp.appendChild(child)

    // Drag enters the app → counter 1, overlay shown.
    mockApp.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true }))
    assert.ok(document.querySelector(".drop-overlay"), "overlay visible after entering app")

    // Real browsers fire dragenter on the child BEFORE dragleave on the parent,
    // so the counter goes 1 → 2 → 1 and never reaches zero mid-panel.
    child.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true }))
    mockApp.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: true, relatedTarget: child }))

    assert.ok(document.querySelector(".drop-overlay"), "overlay remains while traversing children")
  })

  it("hides overlay after traversing children and then leaving the panel (no counter leak)", () => {
    setupDragDrop(makeDeps())

    const child = document.createElement("div")
    mockApp.appendChild(child)

    // Enter the app, then traverse several children. Each move is a paired
    // enter(child) + leave(parent), so the counter stays at 1 — it must NOT
    // leak upward (the old bug that left the overlay permanently stuck).
    mockApp.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true }))
    for (let i = 0; i < 3; i++) {
      child.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true }))
      mockApp.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: true, relatedTarget: child }))
    }
    assert.ok(document.querySelector(".drop-overlay"), "overlay still visible mid-drag")

    // Cursor leaves the panel entirely → counter reaches 0 → overlay hides.
    mockApp.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: true, relatedTarget: document.body }))
    assert.ok(!document.querySelector(".drop-overlay"), "overlay hidden once the drag leaves the panel")
  })

  it("should hide overlay on document-level dragleave (window exit)", () => {
    setupDragDrop(makeDeps())

    // Trigger dragenter to show overlay
    const dragEnterEvent = new DragEvent("dragenter", {
      bubbles: true,
      cancelable: true,
    })
    mockApp.dispatchEvent(dragEnterEvent)

    // Trigger document-level dragleave with null relatedTarget (drag left window)
    const dragLeaveEvent = new DragEvent("dragleave", {
      bubbles: true,
      cancelable: true,
      relatedTarget: null,
    })
    document.dispatchEvent(dragLeaveEvent)

    // Overlay should be removed
    assert.ok(!document.querySelector(".drop-overlay"), "Overlay should be removed on document dragleave")
  })

  it("self-heals via emergency timeout if a drag goes silent with the counter still positive", () => {
    setupDragDrop(makeDeps())

    const child = document.createElement("div")
    mockApp.appendChild(child)

    // Enter app (counter 1) then enter a child (counter 2), then a single
    // dragleave (counter 1). The counter is still > 0, so the overlay stays —
    // but if the drag now goes silent (no drop, no further events), the 3s
    // emergency timeout must remove it so it can never get stuck.
    mockApp.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true }))
    child.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true }))
    mockApp.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: true, relatedTarget: child }))

    assert.ok(document.querySelector(".drop-overlay"), "overlay still visible while counter > 0")

    return new Promise((resolve) => {
      setTimeout(() => {
        assert.ok(!document.querySelector(".drop-overlay"), "Overlay removed by emergency timeout")
        resolve(undefined)
      }, 3100)
    })
  })
})
