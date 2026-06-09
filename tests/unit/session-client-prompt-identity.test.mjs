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

test("SessionClient.sendPromptAsync sends prompt identity and routing fields", async () => {
  const { SessionClient } = loadSessionClient()
  const calls = []
  const client = {
    session: {
      promptAsync: async (payload) => {
        calls.push(payload)
        return {}
      },
    },
  }
  const sessionClient = new SessionClient(() => client)

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

  assert.equal(calls.length, 1)
  assert.equal(calls[0].path.id, "ses_123")
  assert.match(calls[0].headers["Idempotency-Key"], /^ses_123-/)
  assert.deepEqual(calls[0].body, {
    parts: [{ type: "text", text: "hello" }],
    messageID: "user-msg-1",
    model: { providerID: "anthropic", modelID: "claude-sonnet" },
    agent: "build",
    variant: "fast",
  })
})
