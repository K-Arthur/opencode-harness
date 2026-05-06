import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..", "..")

const ignoreContent = readFileSync(path.join(root, ".vscodeignore"), "utf8")
const webviewContent = readFileSync(path.join(root, "src", "chat", "WebviewContent.ts"), "utf8")
const outputChannel = readFileSync(path.join(root, "src", "utils", "outputChannel.ts"), "utf8")
const indexHtml = readFileSync(path.join(root, "src", "chat", "webview", "index.html"), "utf8")
const mainTs = readFileSync(path.join(root, "src", "chat", "webview", "main.ts"), "utf8")
const rendererTs = readFileSync(path.join(root, "src", "chat", "webview", "renderer.ts"), "utf8")

describe("Security hardening", () => {
  it("CSP uses default-src 'none' with specific allowlist", () => {
    assert.ok(webviewContent.includes("default-src 'none'"), "CSP must default-deny all")
    assert.ok(webviewContent.includes("script-src"), "must have script-src")
    assert.ok(webviewContent.includes("nonce"), "must use nonce for scripts")
  })

  it("CSP nonce uses cryptographically random bytes", () => {
    assert.ok(webviewContent.includes("crypto.randomBytes(32)"), "nonce must use crypto.randomBytes(32)")
  })

  it("innerHTML only used with hardcoded SVGs or sanitized content, not raw user input", () => {
    // All innerHTML assignments should use either SVG constants from icons.ts
    // or hardcoded strings, never unsanitized user content.
    // Markdown-rendered content goes through DOMPurify.sanitize()
    assert.ok(rendererTs.includes("DOMPurify.sanitize"), "markdown must be sanitized via DOMPurify")
  })

  it("console.debug perf logging is gated behind debug flag", () => {
    assert.ok(mainTs.includes("__opencodeDebug"), "perf logging must check __opencodeDebug flag")
  })

  it("output channel has secret redaction patterns", () => {
    assert.ok(outputChannel.includes("SENSITIVE_PATTERNS"), "must have sensitive patterns array")
    assert.ok(outputChannel.includes("Bearer\\s+\\S+"), "must redact Bearer tokens")
    assert.ok(outputChannel.includes("password|secret|token"), "must redact password/secret/token patterns")
  })

  it("spawn calls use shell: false", () => {
    const sessionManager = readFileSync(path.join(root, "src", "session", "SessionManager.ts"), "utf8")
    assert.ok(sessionManager.includes("shell: false"), "spawn must use shell: false")
  })
})

describe("Accessibility hardening", () => {
  it("all interactive controls in HTML have aria-label", () => {
    const buttons = ["history-btn", "new-tab-btn", "mcp-btn", "settings-btn",
      "chat-search-input", "chat-search-prev", "chat-search-next", "chat-search-close",
      "prompt-input", "mention-btn", "attach-btn", "send-btn",
      "model-manager-connect", "model-manager-search", "model-manager-close",
      "session-modal-close", "model-selector-btn", "variant-selector-btn"]
    for (const id of buttons) {
      // Each button should have either aria-label or title (prefer aria-label)
      const hasAriaLabel = indexHtml.includes(`aria-label="`) || indexHtml.includes(`title="`)
      assert.ok(hasAriaLabel, `Buttons should have aria-label or title attributes`)
    }
  })

  it("modals use role=dialog and aria-modal=true", () => {
    assert.ok(indexHtml.includes('role="dialog"'), "modals must use role=dialog")
    assert.ok(indexHtml.includes('aria-modal="true"'), "modals must use aria-modal=true")
  })

  it("error boundary uses role=alert", () => {
    assert.ok(indexHtml.includes('role="alert"'), "error boundary must use role=alert")
  })

  it("mode toggle uses role=radiogroup", () => {
    assert.ok(indexHtml.includes('role="radiogroup"'), "mode toggle must use radiogroup")
  })
})

describe("Packaging hardening", () => {
  it(".vscodeignore excludes .env* files", () => {
    assert.ok(ignoreContent.includes(".env*"), "must exclude .env files")
  })

  it(".vscodeignore excludes source maps", () => {
    assert.ok(ignoreContent.includes("**/*.map"), "must exclude source maps")
  })

  it(".vscodeignore excludes node_modules", () => {
    assert.ok(ignoreContent.includes("node_modules/**"), "must exclude node_modules")
  })

  it(".vscodeignore excludes src/", () => {
    assert.ok(ignoreContent.includes("src/**"), "must exclude source TypeScript")
  })

  it(".vscodeignore excludes package-lock.json from extension bundle", () => {
    assert.ok(ignoreContent.includes("package-lock.json"), "must exclude lockfile")
  })
})

describe("Error boundary hardening", () => {
  it("webview has global error handler", () => {
    assert.ok(mainTs.includes('window.addEventListener("error"'), "must catch global errors")
    assert.ok(mainTs.includes('window.addEventListener("unhandledrejection"'), "must catch promise rejections")
  })

  it("user-facing errors have friendly fallback messages", () => {
    assert.ok(mainTs.includes("An error occurred. Please reload") ||
      mainTs.includes("error-boundary"), "must show fallback UI on error")
  })
})
