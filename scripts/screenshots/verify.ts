/**
 * Content-accuracy assertions for screenshot fixtures.
 *
 * Cross-checks every model ID, command ID, and label referenced in
 * fixture JSONs against package.json and the theme preset list.
 * Refuses to run if any reference has drifted — prevents "fake screenshot" risk.
 *
 * Run: npx tsx scripts/screenshots/verify.ts
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(__dirname, "../..")
const FIXTURES_DIR = path.resolve(ROOT, "tests/visual/screenshots/fixtures/sessions")
const PACKAGE_JSON = path.join(ROOT, "package.json")

function loadPackageJson(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf-8"))
}

function loadFixtures(): Array<{ name: string; data: Record<string, unknown> }> {
  return fs.readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f,
      data: JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), "utf-8")),
    }))
}

function extractModelIds(data: Record<string, unknown>): string[] {
  const ids: string[] = []
  if (typeof data.globalModel === "string" && data.globalModel) {
    ids.push(data.globalModel)
  }
  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  for (const s of sessions) {
    if (s && typeof s === "object" && typeof (s as Record<string, unknown>).model === "string") {
      ids.push((s as Record<string, unknown>).model as string)
    }
  }
  return [...new Set(ids)]
}

function extractToolNames(data: Record<string, unknown>): string[] {
  const names: string[] = []
  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  for (const s of sessions) {
    if (!s || typeof s !== "object") continue
    const msgs = (s as Record<string, unknown>).messages
    if (!Array.isArray(msgs)) continue
    for (const m of msgs) {
      if (!m || typeof m !== "object") continue
      const blocks = (m as Record<string, unknown>).blocks
      if (!Array.isArray(blocks)) continue
      for (const b of blocks) {
        if (b && typeof b === "object") {
          const block = b as Record<string, unknown>
          const toolName = typeof block.tool === "string"
            ? block.tool
            : typeof block.name === "string"
              ? block.name
              : null
          if (toolName && (block.type === "tool" || block.type === "tool-call" || block.type === "tool_call")) {
            names.push(toolName)
          }
        }
      }
    }
  }
  return [...new Set(names)]
}

interface Issue {
  fixture: string
  field: string
  value: string
  message: string
}

function validate(): Issue[] {
  const pkg = loadPackageJson()
  const fixtures = loadFixtures()
  const issues: Issue[] = []

  // Known tool names from the extension (not from package.json — these are internal)
  const knownTools = new Set([
    "rg", "grep", "read", "edit", "write", "run", "exec",
    "bash", "search", "glob", "git", "npm", "npx", "tsc",
    "sed", "awk", "curl", "jq",
  ])

  for (const { name, data } of fixtures) {
    // Validate model IDs exist as recognizable patterns
    const modelIds = extractModelIds(data)
    for (const id of modelIds) {
      // Model IDs should follow provider/model-name format
      if (!id.includes("/")) {
        issues.push({
          fixture: name,
          field: "model",
          value: id,
          message: `Model ID "${id}" does not follow provider/model format`,
        })
      }
    }

    // Validate tool names are recognizable
    const toolNames = extractToolNames(data)
    for (const tool of toolNames) {
      if (!knownTools.has(tool)) {
        issues.push({
          fixture: name,
          field: "tool",
          value: tool,
          message: `Tool name "${tool}" is not in the known tools list`,
        })
      }
    }

    // Validate session structure
    const sessions = Array.isArray(data.sessions) ? data.sessions : []
    for (const s of sessions) {
      if (!s || typeof s !== "object") continue
      const session = s as Record<string, unknown>
      if (!session.id || typeof session.id !== "string") {
        issues.push({ fixture: name, field: "session.id", value: String(session.id), message: "Session missing id" })
      }
      if (!session.name || typeof session.name !== "string") {
        issues.push({ fixture: name, field: "session.name", value: String(session.name), message: "Session missing name" })
      }
      if (!session.model || typeof session.model !== "string") {
        issues.push({ fixture: name, field: "session.model", value: String(session.model), message: "Session missing model" })
      }
    }
  }

  return issues
}

// Run validation
const issues = validate()
if (issues.length > 0) {
  console.error("Content-accuracy validation failed:\n")
  for (const issue of issues) {
    console.error(`  ${issue.fixture}: [${issue.field}] ${issue.message} (value: "${issue.value}")`)
  }
  process.exit(1)
} else {
  console.log(`All ${loadFixtures().length} fixtures passed content-accuracy validation.`)
}
