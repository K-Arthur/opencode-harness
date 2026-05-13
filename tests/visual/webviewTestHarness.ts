import type { Page } from "@playwright/test"

interface PostedMessage {
  type: string
  [key: string]: unknown
}

interface WebviewError extends PostedMessage {
  type: "webview_error"
  source?: string
  message: string
  stack?: string
  sessionId?: string
}

interface WebviewLog extends PostedMessage {
  type: "webview_log"
  level: "info" | "warn" | "error"
  message: string
}

/**
 * Install a mock VS Code API shim for Playwright tests.
 * Captures postMessage calls and state changes for verification.
 */
export async function installVsCodeApi(page: Page) {
  await page.addInitScript(() => {
    const vscodeWindow = window as typeof window & {
      __vscodeMessages?: PostedMessage[]
      __vscodeState?: unknown
      acquireVsCodeApi?: () => unknown
    }
    vscodeWindow.__vscodeMessages = []
    vscodeWindow.__vscodeState = undefined
    vscodeWindow.acquireVsCodeApi = () => ({
      postMessage(message: Record<string, unknown>) {
        vscodeWindow.__vscodeMessages = [
          ...(vscodeWindow.__vscodeMessages || []),
          JSON.parse(JSON.stringify(message)),
        ]
      },
      getState() {
        return vscodeWindow.__vscodeState
      },
      setState(state: unknown) {
        vscodeWindow.__vscodeState = JSON.parse(JSON.stringify(state))
      },
    })
  })
}

/**
 * Get all messages posted via the mock VS Code API.
 */
export async function postedMessages(page: Page): Promise<PostedMessage[]> {
  return page.evaluate(() => {
    const vscodeWindow = window as typeof window & { __vscodeMessages?: PostedMessage[] }
    return vscodeWindow.__vscodeMessages || []
  })
}

/**
 * Dispatch a host message to the webview (simulating extension host → webview).
 */
export async function dispatchHostMessage(page: Page, message: Record<string, unknown>) {
  await page.evaluate((msg) => {
    window.dispatchEvent(new MessageEvent("message", { data: msg }))
  }, message)
}

/**
 * Capture page errors and console errors for test verification.
 * Returns a cleanup function to remove the listeners.
 */
export function captureErrors(page: Page): {
  pageErrors: Error[]
  consoleErrors: { type: string; text: string }[]
  cleanup: () => void
} {
  const pageErrors: Error[] = []
  const consoleErrors: { type: string; text: string }[] = []

  page.on("pageerror", (error) => {
    pageErrors.push(error)
  })

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ type: msg.type(), text: msg.text() })
    }
  })

  const cleanup = () => {
    page.removeAllListeners()
  }

  return { pageErrors, consoleErrors, cleanup }
}

/**
 * Assert that no webview errors were posted during the test.
 * Fails with a readable list of errors if any were found.
 */
export async function expectNoWebviewErrors(page: Page) {
  const messages = await postedMessages(page)
  const webviewErrors = messages.filter((msg): msg is WebviewError => {
    return msg.type === "webview_error" && typeof msg.message === "string"
  })

  if (webviewErrors.length > 0) {
    const errorList = webviewErrors
      .map(
        (err) => {
          const stackLine = typeof err.stack === "string" ? err.stack.split("\n")[0] : ""
          return `- [${err.source || "unknown"}] ${err.message}${err.sessionId ? ` (session: ${err.sessionId})` : ""}${stackLine ? `\n  Stack: ${stackLine}` : ""}`
        }
      )
      .join("\n")
    throw new Error(`Webview errors detected:\n${errorList}`)
  }
}

/**
 * Assert that no page errors or console errors occurred during the test.
 * Fails with a readable list of errors if any were found.
 */
export function expectNoBrowserErrors(
  captured: ReturnType<typeof captureErrors>
): void {
  const { pageErrors, consoleErrors } = captured

  if (pageErrors.length > 0) {
    const errorList = pageErrors.map((err) => `- ${err.message}`).join("\n")
    throw new Error(`Page errors detected:\n${errorList}`)
  }

  if (consoleErrors.length > 0) {
    const errorList = consoleErrors.map((err) => `- [${err.type}] ${err.text}`).join("\n")
    throw new Error(`Console errors detected:\n${errorList}`)
  }
}
