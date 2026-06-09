/**
 * Structure tests for the `open_context_window_override_dialog` route in
 * WebviewEventRouter. The webview posts this when the user clicks the
 * "set limit" affordance in the context-usage display (or the per-tab
 * fallback). The host must route it to the registered
 * `opencode-harness.setContextWindowOverride` VS Code command so the user
 * sees the actual input-box dialog. Previously the message was posted but
 * had no host handler, so the dialog never appeared.
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

describe("WebviewEventRouter — open_context_window_override_dialog routing", () => {
  it("registers open_context_window_override_dialog in VALID_WEBVIEW_TYPES", () => {
    const block = blockBetween("VALID_WEBVIEW_TYPES = new Set([", "])")
    assert.ok(
      block.includes(`"open_context_window_override_dialog"`),
      "open_context_window_override_dialog must be a recognized webview type",
    )
  })

  it("handler invokes the registered setContextWindowOverride command", () => {
    const handler = blockBetween(
      `["open_context_window_override_dialog"`,
      `["get_skills"`,
    )
    assert.ok(
      handler.includes(`vscode.commands.executeCommand("opencode-harness.setContextWindowOverride")`),
      "handler must dispatch to the registered setContextWindowOverride VS Code command",
    )
  })

  it("handler catches and logs failures (defensive — should never break the webview)", () => {
    const handler = blockBetween(
      `["open_context_window_override_dialog"`,
      `["get_skills"`,
    )
    assert.ok(handler.includes("catch"), "must wrap the dispatch in try/catch")
    assert.ok(handler.includes("log.error"), "must log the failure")
  })
})
