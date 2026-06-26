/**
 * Unit tests for drag-and-drop file upload module.
 */

import assert from "node:assert"
import { describe, it, mock, beforeEach, afterEach } from "node:test"
import type { Mock } from "node:test"
import { setupDragDrop, type DragDropDeps } from "./dragDrop"

describe("dragDrop module", () => {
  let mockApp: HTMLElement
  let mockInputArea: HTMLElement
  let mockPostMessage: Mock<(msg: Record<string, unknown>) => void>
  let mockAttachImageBlob: Mock<(blob: Blob) => void>
  let mockAttachFileBlob: Mock<(blob: Blob, mimeType: string) => void>
  let mockAddPickedFile: Mock<(path: string) => void>

  beforeEach(() => {
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
    document.body.innerHTML = ""
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

    // Create mock file
    const mockFile = new Blob(["test"], { type: "image/png" }) as any
    mockFile.name = "test.png"
    mockFile.size = 1024

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

    // Create mock file
    const mockFile = new Blob(["test"], { type: "application/json" }) as any
    mockFile.name = "test.json"
    mockFile.size = 1024

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

    // Create mock file larger than 10MB
    const mockFile = new Blob(["test"], { type: "image/png" }) as any
    mockFile.name = "huge.png"
    mockFile.size = 11 * 1024 * 1024

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

    // Create mock file with unsupported type
    const mockFile = new Blob(["test"], { type: "application/zip" }) as any
    mockFile.name = "test.zip"
    mockFile.size = 1024

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

  it("should not decrement counter on dragleave when related target is inside app", () => {
    setupDragDrop(makeDeps())

    // Create a child element inside app
    const child = document.createElement("div")
    mockApp.appendChild(child)

    // Trigger dragenter
    const dragEnterEvent = new DragEvent("dragenter", {
      bubbles: true,
      cancelable: true,
    })
    mockApp.dispatchEvent(dragEnterEvent)

    // Trigger dragleave to child (relatedTarget is child, which is inside app)
    const dragLeaveEvent = new DragEvent("dragleave", {
      bubbles: true,
      cancelable: true,
      relatedTarget: child,
    })
    mockApp.dispatchEvent(dragLeaveEvent)

    // Overlay should still be visible (counter not decremented)
    assert.ok(document.querySelector(".drop-overlay"), "Overlay should remain visible when dragleave to child")
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

  it("should trigger emergency hide timeout after dragleave outside app", () => {
    setupDragDrop(makeDeps())

    // Trigger dragenter to show overlay
    const dragEnterEvent = new DragEvent("dragenter", {
      bubbles: true,
      cancelable: true,
    })
    mockApp.dispatchEvent(dragEnterEvent)

    // Trigger dragleave outside app
    const dragLeaveEvent = new DragEvent("dragleave", {
      bubbles: true,
      cancelable: true,
      relatedTarget: document.body, // Outside app
    })
    mockApp.dispatchEvent(dragLeaveEvent)

    // Overlay should be removed after emergency timeout (3s)
    return new Promise((resolve) => {
      setTimeout(() => {
        assert.ok(!document.querySelector(".drop-overlay"), "Overlay should be removed by emergency timeout")
        resolve(undefined)
      }, 3100)
    })
  })
})
