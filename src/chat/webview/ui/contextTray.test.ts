import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { createContextTrayManager } from "./contextTray"
import type { AttachedContextItem } from "../types"

function setupDom() {
  const dom = new JSDOM(`<!DOCTYPE html><div id="context-tray"><div id="context-tray-summary"></div><div id="context-tray-items" class="hidden"></div></div>`)
  globalThis.document = dom.window.document
}

describe("ContextTrayManager", () => {
  it("starts empty with no items", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    assert.deepEqual(manager.getItems(), [])
  })

  it("setActiveFile adds an active_file item with isActive=true", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    manager.setActiveFile({ path: "src/main.ts", languageId: "typescript", lineCount: 42 })
    const items = manager.getItems()
    assert.equal(items.length, 1)
    assert.equal(items[0]!.type, "active_file")
    assert.equal(items[0]!.path, "src/main.ts")
    assert.equal(items[0]!.isActive, true)
    assert.equal(items[0]!.lineCount, 42)
  })

  it("setActiveFile replaces previous active file, keeping other items", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    manager.setActiveFile({ path: "src/a.ts", languageId: "typescript", lineCount: 10 })
    manager.addImage({ data: "base64data", mimeType: "image/png", sizeBytes: 1024 })
    manager.setActiveFile({ path: "src/b.ts", languageId: "typescript", lineCount: 20 })
    const items = manager.getItems()
    assert.equal(items.length, 2)
    assert.equal(items[0]!.type, "image")
    assert.equal(items[1]!.type, "active_file")
    assert.equal(items[1]!.path, "src/b.ts")
  })

  it("setActiveFile(null) removes the active file item", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    manager.setActiveFile({ path: "src/main.ts", languageId: "typescript", lineCount: 42 })
    manager.setActiveFile(null)
    assert.equal(manager.getItems().length, 0)
  })

  it("toggleActiveFile flips isActive without posting (inclusion is gated webview-side)", () => {
    setupDom()
    const posted: Array<Record<string, unknown>> = []
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: (m) => posted.push(m),
    })
    manager.setActiveFile({ path: "src/main.ts", languageId: "typescript", lineCount: 42 })
    assert.equal(manager.getItems()[0]!.isActive, true)

    manager.toggleActiveFile(false)
    assert.equal(manager.getItems()[0]!.isActive, false)

    manager.toggleActiveFile(true)
    assert.equal(manager.getItems()[0]!.isActive, true)

    // The host keeps no per-session inclusion state, so no message is posted —
    // this previously posted with an empty sessionId, the bug we removed.
    assert.equal(posted.filter((m) => m.type === "toggle_active_file").length, 0)
  })

  it("addImage adds an image item with token estimate", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    manager.addImage({ data: "base64data", mimeType: "image/png", sizeBytes: 1024 })
    const items = manager.getItems()
    assert.equal(items.length, 1)
    assert.equal(items[0]!.type, "image")
    assert.equal(items[0]!.mimeType, "image/png")
    assert.ok((items[0]!.tokenEstimate ?? 0) > 0, "image should have a token estimate")
  })

  it("addDocument adds a document item with line count and token estimate", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    manager.addDocument({ data: "SGVsbG8gV29ybGQ=", mimeType: "text/plain", sizeBytes: 11, lineCount: 1 })
    const items = manager.getItems()
    assert.equal(items.length, 1)
    assert.equal(items[0]!.type, "document")
    assert.equal(items[0]!.lineCount, 1)
    assert.ok((items[0]!.tokenEstimate ?? 0) > 0)
  })

  it("removeItem removes the item with the given id", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    manager.addImage({ data: "abc", mimeType: "image/png", sizeBytes: 3 })
    const id = manager.getItems()[0]!.id
    manager.removeItem(id)
    assert.equal(manager.getItems().length, 0)
  })

  it("clear removes all items", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    manager.setActiveFile({ path: "src/a.ts", languageId: "typescript", lineCount: 10 })
    manager.addImage({ data: "abc", mimeType: "image/png", sizeBytes: 3 })
    manager.clear()
    assert.equal(manager.getItems().length, 0)
  })

  it("getActiveFileContent returns the active file item when isActive, undefined otherwise", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    manager.setActiveFile({ path: "src/main.ts", languageId: "typescript", lineCount: 42 })
    assert.ok(manager.getActiveFileItem())
    assert.equal(manager.getActiveFileItem()!.path, "src/main.ts")

    manager.toggleActiveFile(false)
    assert.equal(manager.getActiveFileItem(), undefined)
  })

  it("getSummary returns correct counts for mixed items", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    manager.setActiveFile({ path: "src/a.ts", languageId: "typescript", lineCount: 10 })
    manager.addImage({ data: "abc", mimeType: "image/png", sizeBytes: 3 })
    manager.addDocument({ data: "SGVsbG8=", mimeType: "text/plain", sizeBytes: 5, lineCount: 1 })
    manager.addPickedFile("src/b.ts")

    const summary = manager.getSummary()
    assert.equal(summary.fileCount, 2) // active_file + picked_file
    assert.equal(summary.imageCount, 1)
    assert.equal(summary.documentCount, 1)
    assert.ok(summary.totalTokens > 0)
  })

  it("getSummary returns zero counts when empty", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    const summary = manager.getSummary()
    assert.equal(summary.fileCount, 0)
    assert.equal(summary.imageCount, 0)
    assert.equal(summary.documentCount, 0)
    assert.equal(summary.totalTokens, 0)
  })

  it("getAttachmentsForPayload returns only image/document items as Attachment[]", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    manager.setActiveFile({ path: "src/a.ts", languageId: "typescript", lineCount: 10 })
    manager.addImage({ data: "imgdata", mimeType: "image/png", sizeBytes: 7 })
    manager.addDocument({ data: "ZG9jZGF0YQ==", mimeType: "application/pdf", sizeBytes: 7, lineCount: 3 })

    const attachments = manager.getAttachmentsForPayload()
    assert.equal(attachments.length, 2)
    assert.equal(attachments[0]!.data, "imgdata")
    assert.equal(attachments[0]!.mimeType, "image/png")
    assert.equal(attachments[1]!.data, "ZG9jZGF0YQ==")
    assert.equal(attachments[1]!.mimeType, "application/pdf")
  })

  it("getActiveFilePath returns path when active file is included, undefined otherwise", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    manager.setActiveFile({ path: "src/main.ts", languageId: "typescript", lineCount: 42 })
    assert.equal(manager.getActiveFilePath(), "src/main.ts")

    manager.toggleActiveFile(false)
    assert.equal(manager.getActiveFilePath(), undefined)
  })

  it("removed image item is excluded from getAttachmentsForPayload", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    manager.addImage({ data: "img1", mimeType: "image/png", sizeBytes: 4 })
    const id = manager.getItems()[0]!.id
    manager.removeItem(id)
    assert.equal(manager.getAttachmentsForPayload().length, 0)
  })

  it("removed document item is excluded from getAttachmentsForPayload", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    manager.addDocument({ data: "ZG9jMQ==", mimeType: "application/pdf", sizeBytes: 4, lineCount: 2 })
    const id = manager.getItems()[0]!.id
    manager.removeItem(id)
    assert.equal(manager.getAttachmentsForPayload().length, 0)
  })

  it("removed active file is excluded from getActiveFilePath", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    manager.setActiveFile({ path: "src/main.ts", languageId: "typescript", lineCount: 42 })
    manager.setActiveFile(null)
    assert.equal(manager.getActiveFilePath(), undefined)
  })

  it("getAttachmentsForPayload excludes active_file and picked_file items", () => {
    setupDom()
    const manager = createContextTrayManager({
      trayEl: document.getElementById("context-tray") as HTMLElement,
      summaryEl: document.getElementById("context-tray-summary") as HTMLElement,
      itemsEl: document.getElementById("context-tray-items") as HTMLElement,
      postMessage: () => {},
    })
    manager.setActiveFile({ path: "src/a.ts", languageId: "typescript", lineCount: 10 })
    manager.addPickedFile("src/b.ts")
    manager.addImage({ data: "img", mimeType: "image/png", sizeBytes: 3 })
    const attachments = manager.getAttachmentsForPayload()
    assert.equal(attachments.length, 1)
    assert.equal(attachments[0]!.data, "img")
  })
})
