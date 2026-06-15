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
const bundlePath = path.join(bundleDir, "session-client.cjs")
const vscodeStubPath = path.join(bundleDir, "vscode-stub.js")

function loadSessionClient() {
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(vscodeStubPath, `
module.exports = {
  window: {
    createOutputChannel: () => ({
      appendLine: () => {},
      append: () => {},
      show: () => {},
      dispose: () => {},
    }),
  },
  workspace: {
    getConfiguration: () => ({ get: () => false }),
  },
}
`)
  execFileSync("npx", [
    "esbuild",
    "src/session/SessionClient.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--alias:vscode=${vscodeStubPath}`,
    `--outfile=${bundlePath}`,
  ], {
    cwd: repoRoot,
    stdio: "pipe",
  })

  delete createRequire(import.meta.url).cache?.[bundlePath]
  return createRequire(import.meta.url)(bundlePath)
}

test("SessionClient.sendPromptAsync sends prompt identity and routing fields (v2)", async () => {
  const { SessionClient } = loadSessionClient()
  const callArgs = []
  const callOptions = []
  const v2Client = {
    session: {
      promptAsync: async (params, options) => {
        callArgs.push(params)
        callOptions.push(options)
        return {}
      },
    },
  }
  // Provide a throwaway v1 client (required by constructor) and the mock v2 client
  const sessionClient = new SessionClient(
    () => ({ session: {} }),
    undefined,
    () => false,
    () => v2Client,
  )

  await sessionClient.sendPromptAsync(
    "ses_123",
    [{ type: "text", text: "hello" }],
    {
      messageID: "user-msg-1",
      clientRequestId: "req-1",
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
      agent: "build",
      variant: "fast",
    },
  )

  assert.equal(callArgs.length, 1)
  // v2: flat sessionID instead of nested path.id
  assert.equal(callArgs[0].sessionID, "ses_123")
  // v2: headers in the options (2nd arg) instead of the params
  assert.match(callOptions[0].headers["Idempotency-Key"], /^ses_123-/)
  assert.deepEqual(callArgs[0].parts, [{ type: "text", text: "hello" }])
  assert.deepEqual(callArgs[0].model, { providerID: "anthropic", modelID: "claude-sonnet" })
  assert.equal(callArgs[0].agent, "build")
  assert.equal(callArgs[0].variant, "fast")
  assert.equal(callArgs[0].messageID, "user-msg-1")
})
