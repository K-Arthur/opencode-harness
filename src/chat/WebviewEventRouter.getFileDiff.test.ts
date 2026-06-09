/**
 * Structure tests for the `get_file_diff` route in WebviewEventRouter.
 *
 * This route was previously unhandled, so the changed-files dropdown's per-file
 * expansion silently rendered nothing. The handler must:
 *   - be a recognized webview message type
 *   - guard an empty path and a stopped server
 *   - read the file from the server and normalize it via sdkFileContentToDiffLines
 *   - always answer with a file_diff_response (lines on success, error otherwise)
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(__dirname, "WebviewEventRouter.ts"), "utf8")

function blockBetween(startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle)
  assert.ok(start >= 0, `${startNeedle} must exist in WebviewEventRouter.ts`)
  const end = source.indexOf(endNeedle, start)
  assert.ok(end > start, `${endNeedle} must follow ${startNeedle}`)
  return source.slice(start, end)
}

describe("WebviewEventRouter — get_file_diff routing", () => {
  it("registers get_file_diff in VALID_WEBVIEW_TYPES", () => {
    const block = blockBetween("VALID_WEBVIEW_TYPES = new Set([", "])")
    assert.ok(block.includes(`"get_file_diff"`), "get_file_diff must be a recognized webview type")
  })

  it("imports the SDK→DiffLine normalizer", () => {
    assert.ok(source.includes("sdkFileContentToDiffLines"), "must use the pure converter")
  })

  const handler = blockBetween(`["get_file_diff",`, `["open_file",`)

  it("guards an empty path", () => {
    assert.ok(handler.includes(`typeof msg.path === "string"`), "must string-check path")
    assert.ok(handler.includes("if (!path) return"), "must drop empty path")
  })

  it("guards a stopped server and reports it as an error response", () => {
    assert.ok(handler.includes("this.opts.sessionManager.isRunning"), "must check server is running")
    assert.ok(handler.includes("not running"), "must report server-down as a diff error")
  })

  it("reads the file from the server and normalizes it to DiffLine[]", () => {
    assert.ok(handler.includes("this.opts.sessionManager.getFileContent(path)"),
      "must fetch the file (and its server diff) by path")
    assert.ok(handler.includes("sdkFileContentToDiffLines("), "must normalize via the pure converter")
  })

  it("always answers with a file_diff_response (success or error)", () => {
    assert.ok(handler.includes(`type: "file_diff_response"`), "must post a file_diff_response")
    assert.ok(handler.includes("catch"), "must catch and surface read failures")
  })
})
