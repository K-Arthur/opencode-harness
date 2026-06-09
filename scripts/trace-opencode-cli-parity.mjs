#!/usr/bin/env node
import { spawn } from "node:child_process"
import { createWriteStream, existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

function usage() {
  console.log(`Usage:
  node scripts/trace-opencode-cli-parity.mjs --attach <server-url> --session <id> [--prompt <text>] [--out <jsonl>] [--extension-trace <file>]

Runs:
  opencode run --attach <server-url> --session <id> --format json [prompt]

The script writes raw CLI JSONL to --out when provided and prints a compact
event/part summary that can be compared with opencode.debugLogging traces.`)
}

function argValue(args, name) {
  const idx = args.indexOf(name)
  if (idx < 0) return undefined
  return args[idx + 1]
}

function summarizeJsonl(text) {
  const summary = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      const type = typeof parsed.type === "string"
        ? parsed.type
        : typeof parsed.event === "string"
          ? parsed.event
          : typeof parsed.part?.type === "string"
            ? `part:${parsed.part.type}`
            : "unknown"
      summary.set(type, (summary.get(type) ?? 0) + 1)
    } catch {
      summary.set("non-json", (summary.get("non-json") ?? 0) + 1)
    }
  }
  return Array.from(summary.entries()).sort(([a], [b]) => a.localeCompare(b))
}

function printSummary(label, text) {
  console.log(`\n${label}`)
  for (const [type, count] of summarizeJsonl(text)) {
    console.log(`${String(count).padStart(5)}  ${type}`)
  }
}

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  usage()
  process.exit(0)
}

const attach = argValue(args, "--attach")
const session = argValue(args, "--session")
const prompt = argValue(args, "--prompt")
const outPath = argValue(args, "--out")
const extensionTracePath = argValue(args, "--extension-trace")

if (!attach || !session) {
  usage()
  process.exit(1)
}

const cliArgs = ["run", "--attach", attach, "--session", session, "--format", "json"]
if (prompt) cliArgs.push(prompt)

const outStream = outPath ? createWriteStream(resolve(outPath), { encoding: "utf8" }) : null
let raw = ""

const child = spawn("opencode", cliArgs, {
  stdio: ["ignore", "pipe", "inherit"],
})

child.stdout.setEncoding("utf8")
child.stdout.on("data", (chunk) => {
  raw += chunk
  process.stdout.write(chunk)
  outStream?.write(chunk)
})

child.on("error", (err) => {
  console.error(`Failed to run opencode CLI: ${err.message}`)
  process.exitCode = 1
})

child.on("close", (code) => {
  outStream?.end()
  printSummary("CLI JSONL summary", raw)
  if (extensionTracePath) {
    const fullPath = resolve(extensionTracePath)
    if (existsSync(fullPath)) {
      printSummary("Extension trace summary", readFileSync(fullPath, "utf8"))
    } else {
      console.error(`Extension trace file not found: ${fullPath}`)
      process.exitCode = 1
    }
  }
  if (code !== 0) process.exitCode = code ?? 1
})
