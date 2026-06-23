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
})
