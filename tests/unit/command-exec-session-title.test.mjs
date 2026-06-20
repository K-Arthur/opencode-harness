import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..", "..")
const bundleDir = path.join(repoRoot, ".coverage-bundles")
const bundlePath = path.join(bundleDir, "command-exec.cjs")
const vscodeStubPath = path.join(bundleDir, "vscode-stub.js")

function loadCommandExec() {
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(vscodeStubPath, `
module.exports = {
  window: {
    createOutputChannel: () => ({ appendLine: () => {}, append: () => {}, show: () => {}, dispose: () => {} }),
    showInformationMessage: () => {},
    showWarningMessage: () => {},
  },
  workspace: { getConfiguration: () => ({ get: () => false }) },
}
`)
  execFileSync("npx", [
    "esbuild",
    "src/chat/CommandExecutionService.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--alias:vscode=${vscodeStubPath}`,
    `--outfile=${bundlePath}`,
  ], { cwd: repoRoot, stdio: "pipe" })

  delete createRequire(import.meta.url).cache?.[bundlePath]
  return createRequire(import.meta.url)(bundlePath)
}

/**
 * Build a CommandExecutionService whose tab has no cliSessionId yet, capturing
 * the title passed to ensureSession. `sessionName` is what SessionStore.get
 * reports for the tab.
 */
function setup(sessionName) {
  const { CommandExecutionService } = loadCommandExec()
  const ensureSessionCalls = []
  const opts = {
    tabManager: {
      getTab: () => ({ id: "session-abc12345", cliSessionId: undefined, model: undefined }),
      getActiveTab: () => undefined,
      setCliSessionId: () => {},
    },
    streamCoordinator: {},
    statePush: {},
    sessionManager: {
      isRunning: true,
      ensureSession: async (_cli, title) => { ensureSessionCalls.push(title); return "cli-session-1" },
      sendCommand: async () => ({}),
    },
    sessionStore: {
      get: () => ({ name: sessionName }),
      updateCliSessionId: () => {},
      appendMessage: () => {},
    },
    promptManager: { getPrompt: () => undefined },
    chatCommands: {},
    showWarningMessage: () => {},
    postMessage: () => {},
    postRequestError: () => {},
    sendPromptToWebview: () => {},
  }
  const svc = new CommandExecutionService(opts)
  return { svc, ensureSessionCalls }
}

test("never titles a command-created session 'Tab session-' (the slice(0,8) regression)", async () => {
  // Webview tab IDs are `session-<id>` and "session-" is exactly 8 chars, so
  // the old `Tab ${sessionId.slice(0, 8)}` produced "Tab session-" for every tab.
  const { svc, ensureSessionCalls } = setup("")
  await svc.handleExecuteCommand("session-abc12345", "/triage")

  assert.equal(ensureSessionCalls.length, 1, "ensureSession called once for a new tab")
  assert.notEqual(ensureSessionCalls[0], "Tab session-")
  assert.ok(
    !String(ensureSessionCalls[0] ?? "").startsWith("Tab session-"),
    "title must not be the broken 'Tab session-' placeholder",
  )
  // With no local name, defer to the server's auto-title (undefined).
  assert.equal(ensureSessionCalls[0], undefined)
})

test("uses the tab's own name as the server session title when present", async () => {
  const { svc, ensureSessionCalls } = setup("Refactor the parser")
  await svc.handleExecuteCommand("session-abc12345", "/triage")

  assert.equal(ensureSessionCalls.length, 1)
  assert.equal(ensureSessionCalls[0], "Refactor the parser")
})
