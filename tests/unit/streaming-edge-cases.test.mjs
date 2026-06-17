import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CSS = path.join(__dirname, "..", "..", "src", "chat", "webview", "css")

const blocks = readFileSync(path.join(CSS, "blocks.css"), "utf8")
const messages = readFileSync(path.join(CSS, "messages.css"), "utf8")
const tokens = readFileSync(path.join(CSS, "tokens.css"), "utf8")

describe("Streaming edge cases — CSS structural", () => {
  it(".message-content has contain: layout for layout isolation", () => {
    assert.match(messages, /\.message-content\s*\{[^}]*contain:\s*layout/, "must have contain: layout")
  })

  it(".diff-block has contain: layout paint for diff isolation", () => {
    assert.match(blocks, /\.diff-block\s*\{[^}]*contain:\s*layout\s*paint/, "must have contain: layout paint")
  })

  it("tokens.css defines --oc-stream-accent", () => {
    assert.ok(tokens.includes("--oc-stream-accent"), "must define --oc-stream-accent")
  })

  it("tokens.css defines --oc-stream-border", () => {
    assert.ok(tokens.includes("--oc-stream-border"), "must define --oc-stream-border")
  })

  it("--oc-stream-accent references --oc-accent", () => {
    assert.match(tokens, /--oc-stream-accent:\s*var\(--oc-accent\)/, "must map to --oc-accent")
  })

  it("no infinite animations remain on streaming-related elements", () => {
    const streamingSelectors = [
      ".tool-call--running",
      ".tool-call--pending",
      ".tool-status--running",
      ".thinking-block:not([open])",
      ".thinking-pulse",
      ".tool-elapsed",
      ".tool-live-indicator .codicon",
      ".tool-group--active",
      ".tool-group--idle",
      ".error-display",
      ".subagent-card-status--running",
      ".subagent-highlight-pulse",
    ]
    for (const sel of streamingSelectors) {
      const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(escaped + '[^{]*\\{([^}]*)\\}')
      const match = blocks.match(regex)
      if (match) {
        assert.ok(
          !match[1].includes("infinite"),
          `${sel} must not have infinite animation (found in blocks.css)`
        )
      }
    }
  })

  it("button transitions have no transform or box-shadow", () => {
    const btnSelectors = [".diff-btn", ".revert-modal-btn", ".permission-btn"]
    for (const sel of btnSelectors) {
      const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(escaped + '[^{]*\\{([^}]*)\\}')
      const match = blocks.match(regex)
      if (match) {
        assert.ok(
          !match[1].includes("transform"),
          `${sel} transition must not include transform`
        )
        assert.ok(
          !match[1].includes("box-shadow"),
          `${sel} transition must not include box-shadow`
        )
      }
    }
  })
})
