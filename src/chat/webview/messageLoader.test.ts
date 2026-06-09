import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "messageLoader.ts"), "utf8")

describe("messageLoader.ts", () => {
  // ── Constants ──────────────────────────────────────────────────────────────

  it("exports adaptive chunk sizing defaults", () => {
    assert.ok(source.includes("export const CHUNK_SIZE = 20"), "initial CHUNK_SIZE must remain 20")
    assert.ok(source.includes("export const MIN_CHUNK_SIZE = 8"), "must clamp slow devices to a small chunk")
    assert.ok(source.includes("export const MAX_CHUNK_SIZE = 60"), "must clamp fast devices to a bounded chunk")
    assert.ok(source.includes("export const TARGET_CHUNK_MS = 8"), "must target a short frame budget")
  })

  it("exports INITIAL_LOAD_COUNT of 50", () => {
    assert.ok(source.includes("export const INITIAL_LOAD_COUNT = 50"), "INITIAL_LOAD_COUNT must be 50")
  })

  // ── createChunkedLoader ────────────────────────────────────────────────────

  it("exports createChunkedLoader function", () => {
    assert.ok(source.includes("export function createChunkedLoader"), "must export createChunkedLoader")
  })

  it("createChunkedLoader uses requestAnimationFrame for deferred rendering", () => {
    assert.ok(
      source.includes("requestAnimationFrame"),
      "chunked loader must use requestAnimationFrame to avoid blocking the main thread"
    )
  })

  it("createChunkedLoader adapts chunk size from render duration", () => {
    assert.ok(source.includes("nextChunkSize"), "must compute adaptive chunk sizes")
    assert.ok(source.includes("durationMs > targetFrameMs"), "must shrink chunks when rendering is slow")
    assert.ok(source.includes("durationMs < targetFrameMs"), "must grow chunks when rendering is fast")
  })

  it("createChunkedLoader accepts container, messages, renderFn, onChunkDone, onAllDone", () => {
    assert.ok(source.includes("container"), "must accept container")
    assert.ok(source.includes("renderFn"), "must accept renderFn")
    assert.ok(source.includes("onChunkDone"), "must accept onChunkDone callback")
    assert.ok(source.includes("onAllDone"), "must accept onAllDone callback")
  })

  it("createChunkedLoader returns object with start and cancel", () => {
    assert.ok(source.includes("start()"), "must return start method")
    assert.ok(source.includes("cancel()"), "must return cancel method")
  })

  it("createChunkedLoader cancel uses cancelAnimationFrame", () => {
    assert.ok(source.includes("cancelAnimationFrame"), "must cancel pending rAF on cancel()")
  })

  it("createChunkedLoader uses DocumentFragment for batched DOM insertion", () => {
    assert.ok(source.includes("DocumentFragment") || source.includes("createDocumentFragment"),
      "must use DocumentFragment to minimise reflows per chunk")
  })

  // ── prependMessagesPreservingScroll ───────────────────────────────────────

  it("exports prependMessagesPreservingScroll function", () => {
    assert.ok(
      source.includes("export function prependMessagesPreservingScroll"),
      "must export prependMessagesPreservingScroll"
    )
  })

  it("prependMessagesPreservingScroll saves scrollHeight before prepend", () => {
    assert.ok(
      source.includes("scrollHeight"),
      "must capture scrollHeight before prepending to compensate scroll position"
    )
  })

  it("prependMessagesPreservingScroll restores scroll position after prepend", () => {
    assert.ok(
      source.includes("scrollTop"),
      "must restore scrollTop after prepend so the user's view does not jump"
    )
  })

  // ── createLoadEarlierBanner ────────────────────────────────────────────────

  it("exports createLoadEarlierBanner function", () => {
    assert.ok(
      source.includes("export function createLoadEarlierBanner"),
      "must export createLoadEarlierBanner"
    )
  })

  it("createLoadEarlierBanner produces element with class load-earlier-banner", () => {
    assert.ok(
      source.includes("load-earlier-banner"),
      "banner element must have class load-earlier-banner"
    )
  })

  it("createLoadEarlierBanner accepts displayCount, beforeIndex, and onLoad callback", () => {
    assert.ok(source.includes("displayCount"), "must accept displayCount")
    assert.ok(source.includes("beforeIndex"), "must accept beforeIndex")
    assert.ok(source.includes("onLoad"), "must accept onLoad callback")
  })

  it("createLoadEarlierBanner shows loading state while fetching", () => {
    assert.ok(
      source.includes("loading") || source.includes("aria-busy"),
      "banner must show a loading state while earlier messages are being fetched"
    )
  })

  // ── throttleScrollMarkers ─────────────────────────────────────────────────

  it("exports throttleScrollMarkers function", () => {
    assert.ok(
      source.includes("export function throttleScrollMarkers"),
      "must export throttleScrollMarkers to debounce expensive O(n) DOM work"
    )
  })

  it("throttleScrollMarkers uses a trailing-edge timer", () => {
    assert.ok(
      source.includes("clearTimeout") && source.includes("setTimeout"),
      "throttleScrollMarkers must use setTimeout/clearTimeout for trailing-edge debounce"
    )
  })
})
