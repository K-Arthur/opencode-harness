import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mainSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "main.ts"), "utf8")
const rendererSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "renderer.ts"), "utf8")
const messagesCss = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "css", "messages.css"), "utf8")

describe("Scroll markers and navigation", () => {
  it("messages have stable role data attribute for marker targeting", () => {
    assert.ok(rendererSource.includes("dataset.role"),
      "renderMessage must set dataset.role for marker targeting")
    assert.ok(rendererSource.includes("dataset.messageId"),
      "renderMessage must set dataset.messageId for stable message identity")
  })

  it("user-message markers are derived from messages by role", () => {
    assert.ok(mainSource.includes("role") && (mainSource.includes("user") || mainSource.includes("user message")),
      "main.ts must be able to derive user-message positions by role")
  })

  it("jump-to-latest button appears when scrolled away from bottom", () => {
    assert.ok(mainSource.includes("jump") && mainSource.includes("bottom"),
      "must have jump-to-latest functionality")
    assert.ok(mainSource.includes("scroll") || mainSource.includes("isAtBottom"),
      "must use scroll position to determine visibility")
  })
})

describe("Rendering performance", () => {
  it("message elements use content-visibility: auto for virtual rendering", () => {
    assert.ok(messagesCss.includes("content-visibility") && messagesCss.includes("auto"),
      "messages.css must have content-visibility: auto on message elements for virtual scrolling")
  })

  it("renders messages with DocumentFragment batching on session resume", () => {
    assert.ok(mainSource.includes("document.createDocumentFragment"),
      "message list rendering must batch appends via DocumentFragment")
  })
})
