/**
 * Whole-message copy control (user prompts + assistant responses).
 *
 * Behavioral tests — real DOM via the shared stream harness, clipboard
 * injected (DI) so no global mocking is needed.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { installDom } from "./streamHarness"
import type { ChatMessage } from "./types"

const msg = (role: "user" | "assistant", blocks: ChatMessage["blocks"]): ChatMessage => ({
  role,
  id: "m-1",
  blocks,
  timestamp: 0,
})

void describe("extractMessageCopyText", () => {
  void it("joins multiple text blocks with a blank line", async () => {
    const { extractMessageCopyText } = await import("./messageCopy")
    const text = extractMessageCopyText(
      msg("assistant", [
        { type: "text", text: "First paragraph." },
        { type: "text", text: "Second paragraph." },
      ]),
    )
    assert.equal(text, "First paragraph.\n\nSecond paragraph.")
  })

  void it("ignores non-text blocks (tool calls, diffs) — copies visible prose only", async () => {
    const { extractMessageCopyText } = await import("./messageCopy")
    const text = extractMessageCopyText(
      msg("assistant", [
        { type: "text", text: "Before tool." },
        { type: "tool-call", toolName: "read", args: {} } as ChatMessage["blocks"][number],
        { type: "text", text: "After tool." },
      ]),
    )
    assert.equal(text, "Before tool.\n\nAfter tool.")
  })

  void it("returns empty string when there is nothing copyable", async () => {
    const { extractMessageCopyText } = await import("./messageCopy")
    assert.equal(extractMessageCopyText(msg("assistant", [])), "")
    assert.equal(
      extractMessageCopyText(msg("assistant", [{ type: "text", text: "   " }])),
      "",
    )
    assert.equal(
      extractMessageCopyText({ blocks: undefined as unknown as ChatMessage["blocks"] }),
      "",
    )
  })
})

void describe("createMessageCopyButton", () => {
  void it("returns null for messages with no copyable text (no dead buttons)", async () => {
    const dom = installDom()
    try {
      const { createMessageCopyButton } = await import("./messageCopy")
      const btn = createMessageCopyButton(msg("assistant", [{ type: "tool-call", toolName: "bash", args: {} } as ChatMessage["blocks"][number]]))
      assert.equal(btn, null)
    } finally {
      dom.restore()
    }
  })

  void it("builds an accessible header button and copies the message text on click", async () => {
    const dom = installDom()
    try {
      const { createMessageCopyButton } = await import("./messageCopy")
      const written: string[] = []
      const btn = createMessageCopyButton(msg("user", [{ type: "text", text: "my prompt" }]), {
        writeText: (t) => {
          written.push(t)
          return Promise.resolve()
        },
        restoreDelayMs: 5,
      })
      assert.ok(btn, "button must be created for a message with text")
      assert.equal(btn.className, "message-copy-btn")
      assert.equal(btn.getAttribute("aria-label"), "Copy message")
      assert.ok(btn.title.length > 0, "must have a tooltip")
      assert.ok(btn.querySelector("svg"), "icon must be SVG (zero-emoji policy)")

      btn.click()
      await new Promise((r) => setTimeout(r, 0))
      assert.deepEqual(written, ["my prompt"])
    } finally {
      dom.restore()
    }
  })

  void it("shows a transient copied state, then restores the idle icon", async () => {
    const dom = installDom()
    try {
      const { createMessageCopyButton } = await import("./messageCopy")
      const btn = createMessageCopyButton(msg("assistant", [{ type: "text", text: "model output" }]), {
        writeText: () => Promise.resolve(),
        restoreDelayMs: 10,
      })!
      const idleHtml = btn.innerHTML

      btn.click()
      await new Promise((r) => setTimeout(r, 0))
      assert.ok(btn.classList.contains("copied"), "copied state must be signalled for feedback")

      await new Promise((r) => setTimeout(r, 30))
      assert.ok(!btn.classList.contains("copied"), "copied state must clear")
      assert.equal(btn.innerHTML, idleHtml, "idle icon must be restored")
    } finally {
      dom.restore()
    }
  })

  void it("failed clipboard writes do not enter the copied state", async () => {
    const dom = installDom()
    try {
      const { createMessageCopyButton } = await import("./messageCopy")
      const btn = createMessageCopyButton(msg("assistant", [{ type: "text", text: "x" }]), {
        writeText: () => Promise.reject(new Error("denied")),
        restoreDelayMs: 5,
      })!
      btn.click()
      await new Promise((r) => setTimeout(r, 5))
      assert.ok(!btn.classList.contains("copied"), "must not claim success when the write failed")
    } finally {
      dom.restore()
    }
  })
})

void describe("messageRenderer wiring", () => {
  void it("renderMessage attaches the copy control to user and assistant headers", async () => {
    const { readFileSync } = await import("node:fs")
    const path = await import("node:path")
    const source = readFileSync(path.join(__dirname, "messageRenderer.ts"), "utf8")
    assert.ok(
      source.includes("createMessageCopyButton"),
      "renderMessage must delegate to messageCopy.ts (hotspot rule: extract, don't enlarge)",
    )
  })
})
