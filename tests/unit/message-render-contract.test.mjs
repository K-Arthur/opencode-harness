import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CSS = path.join(__dirname, "..", "..", "src", "chat", "webview", "css")

const blocks = readFileSync(path.join(CSS, "blocks.css"), "utf8")
const messages = readFileSync(path.join(CSS, "messages.css"), "utf8")

describe("Message render contract — CSS structural", () => {
  it("tool-call--running has no animation property", () => {
    const runningMatch = blocks.match(/\.tool-call--running[^{]*\{([^}]*)\}/)
    if (runningMatch) {
      assert.ok(
        !runningMatch[1].includes("animation:"),
        "tool-call--running must not have animation"
      )
    }
  })

  it("tool-call--pending has no animation property", () => {
    const pendingMatch = blocks.match(/\.tool-call--pending[^{]*\{([^}]*)\}/)
    if (pendingMatch) {
      assert.ok(
        !pendingMatch[1].includes("animation:"),
        "tool-call--pending must not have animation"
      )
    }
  })

  it("tool-status--running has no animation property", () => {
    const match = blocks.match(/\.tool-status--running\s*\{([^}]*)\}/)
    if (match) {
      assert.ok(!match[1].includes("animation:"), "tool-status--running must not have animation")
    }
  })

  it("subagent-card-status--running has no animation property", () => {
    const match = blocks.match(/\.subagent-card-status--running\s*\{([^}]*)\}/)
    if (match) {
      assert.ok(!match[1].includes("animation:"), "subagent-card-status--running must not have animation")
    }
  })

  it("error-display has no animation property", () => {
    const match = blocks.match(/\.error-display\s*\{([^}]*)\}/)
    if (match) {
      assert.ok(!match[1].includes("animation:"), "error-display must not have animation")
    }
  })

  it("diff-block--entered exists as a state class (not animation)", () => {
    assert.ok(blocks.includes(".diff-block--entered"), "diff-block--entered must be defined")
    const match = blocks.match(/\.diff-block--entered\s*\{([^}]*)\}/)
    if (match) {
      assert.ok(!match[1].includes("animation:"), "diff-block--entered must not have animation")
    }
  })

  it("thinking-pulse class has no animation or box-shadow", () => {
    const match = blocks.match(/\.thinking-pulse\s*\{([^}]*)\}/)
    if (match) {
      assert.ok(!match[1].includes("animation:"), "thinking-pulse must not have animation")
      assert.ok(!match[1].includes("box-shadow:"), "thinking-pulse must not have box-shadow")
    }
  })

  it("streaming-text caret uses cursor-blink animation", () => {
    assert.match(
      messages,
      /\.streaming-text::after\s*\{[^}]*animation:\s*cursor-blink/,
      "streaming-text::after must use cursor-blink"
    )
  })

  it("streaming-text caret uses --oc-stream-accent color", () => {
    assert.match(
      messages,
      /\.streaming-text::after\s*\{[^}]*var\(--oc-stream-accent/,
      "streaming-text::after must use --oc-stream-accent"
    )
  })
})
