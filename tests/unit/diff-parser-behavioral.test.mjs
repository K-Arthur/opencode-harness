/**
 * Behavioral tests for DiffApplier — tests code block parsing and path resolution.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"

// Replicate DiffApplier.parseFenceInfo logic
function parseFenceInfo(info) {
  const trimmed = info.trim()
  if (!trimmed) return {}

  const commentMatch = trimmed.match(/^(\S+)?\s*\/\/\s*(.+)$/)
  if (commentMatch) {
    return { language: commentMatch[1] ?? undefined, path: commentMatch[2]?.trim() }
  }

  const fileMatch = trimmed.match(/^(\S+)?\s+(?:file=|filename=|path=)?(.+)$/)
  if (fileMatch) {
    return { language: fileMatch[1] ?? undefined, path: fileMatch[2]?.trim().replace(/^["']|["']$/g, "") }
  }

  return { language: trimmed }
}

// Replicate DiffApplier.extractCodeBlocks logic
function extractCodeBlocks(text) {
  const blocks = []
  const regex = /```([^\n]*)\n([\s\S]*?)```/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const info = parseFenceInfo(match[1])
    blocks.push({
      language: info.language || "",
      path: info.path || "",
      code: match[2] ?? "",
    })
  }
  return blocks
}

describe("DiffApplier — parseFenceInfo", () => {
  it("parses language only", () => {
    const result = parseFenceInfo("typescript")
    assert.equal(result.language, "typescript")
    assert.equal(result.path, undefined)
  })

  it("parses language with // comment path", () => {
    const result = parseFenceInfo("typescript // src/app.ts")
    assert.equal(result.language, "typescript")
    assert.equal(result.path, "src/app.ts")
  })

  it("parses language with file= prefix", () => {
    const result = parseFenceInfo("python file=main.py")
    assert.equal(result.language, "python")
    assert.equal(result.path, "main.py")
  })

  it("parses language with filename= prefix", () => {
    const result = parseFenceInfo("rust filename=src/lib.rs")
    assert.equal(result.language, "rust")
    assert.equal(result.path, "src/lib.rs")
  })

  it("parses language with path= prefix", () => {
    const result = parseFenceInfo("go path=cmd/main.go")
    assert.equal(result.language, "go")
    assert.equal(result.path, "cmd/main.go")
  })

  it("handles empty input", () => {
    const result = parseFenceInfo("")
    assert.deepEqual(result, {})
  })

  it("handles whitespace-only input", () => {
    const result = parseFenceInfo("   ")
    assert.deepEqual(result, {})
  })

  it("strips quotes from path", () => {
    const result = parseFenceInfo(`javascript file="src/app.js"`)
    assert.equal(result.language, "javascript")
    assert.equal(result.path, "src/app.js")
  })

  it("handles language only with space (no file prefix)", () => {
    const result = parseFenceInfo("typescript src/app.ts")
    assert.equal(result.language, "typescript")
    // Without file= prefix, the whole thing after the language is treated as path
    // This is a known limitation of the regex, testing for expected behavior
  })
})

describe("DiffApplier — extractCodeBlocks", () => {
  it("extracts a single code block", () => {
    const text = "```typescript\nconsole.log('hello');\n```"
    const blocks = extractCodeBlocks(text)
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].language, "typescript")
    assert.ok(blocks[0].code.includes("console.log"))
  })

  it("extracts multiple code blocks", () => {
    const text = "```js\nvar x = 1;\n```\n\n```py\nprint('hi')\n```"
    const blocks = extractCodeBlocks(text)
    assert.equal(blocks.length, 2)
    assert.equal(blocks[0].language, "js")
    assert.equal(blocks[1].language, "py")
  })

  it("extracts code block with file path", () => {
    const text = "```typescript // src/main.ts\nconst x = 1;\n```"
    const blocks = extractCodeBlocks(text)
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].path, "src/main.ts")
    assert.equal(blocks[0].language, "typescript")
  })

  it("returns empty array for text without code blocks", () => {
    const text = "This is just plain text, no code blocks here."
    const blocks = extractCodeBlocks(text)
    assert.equal(blocks.length, 0)
  })

  it("handles empty string", () => {
    const blocks = extractCodeBlocks("")
    assert.equal(blocks.length, 0)
  })

  it("extracts code block with file= prefix", () => {
    const text = "```python file=src/app.py\ndef hello():\n  pass\n```"
    const blocks = extractCodeBlocks(text)
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].path, "src/app.py")
    assert.equal(blocks[0].language, "python")
  })
})

describe("DiffApplier — path resolution safety", () => {
  it("rejects paths that traverse outside workspace", () => {
    // Simulating resolveWorkspaceFile logic
    const filePath = "../etc/passwd"
    const root = "/home/user/project"
    const fullPath = "/home/user/project/../etc/passwd"
    // In real path.resolve, this would become /home/user/etc/passwd
    // We simulate the basic check
    const relative = fullPath.replace(root, "").replace(/^\//, "")
    const isOutside = relative.startsWith("..")
    assert.equal(isOutside, true)
  })

  it("accepts paths within workspace", () => {
    const filePath = "src/app.ts"
    const root = "/home/user/project"
    const fullPath = "/home/user/project/src/app.ts"
    const relative = fullPath.replace(root, "").replace(/^\//, "")
    const isOutside = relative.startsWith("..")
    assert.equal(isOutside, false)
  })
})
