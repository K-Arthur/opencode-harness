import test from "node:test"
import assert from "node:assert/strict"

// Mock the context building logic from StreamCoordinator.ts
function buildContextText(ctxPkg) {
  const openFiles = ctxPkg.openFiles.map((f) => `${f.path} (${f.language})`).join(", ") || "none"
  const gitStatus = `branch: ${ctxPkg.gitStatus.branch}, modified: ${ctxPkg.gitStatus.modified.length}, staged: ${ctxPkg.gitStatus.staged.length}`
  
  const tree = ctxPkg.workspaceTree
    .map((t) => `${t.type === "directory" ? "/" : ""}${t.name}`)
    .slice(0, 50)
    .join(", ")

  const configs = ctxPkg.projectConfigs
    .map((c) => `${c.type} at ${c.path}`)
    .join(", ")

  return `<context>
Open files: ${openFiles}
Git status: ${gitStatus}
Workspace structure: ${tree}${ctxPkg.workspaceTree.length > 50 ? " (truncated)" : ""}
Project configs: ${configs || "none"}
Diagnostics: ${Array.isArray(ctxPkg.diagnostics) ? ctxPkg.diagnostics.length : 0} files with errors or warnings
</context>`
}

test("buildContextText includes expanded info", () => {
  const mockCtx = {
    openFiles: [
      { path: "src/main.ts", language: "typescript" },
      { path: "index.html", language: "html" }
    ],
    gitStatus: {
      branch: "main",
      modified: ["file1.ts"],
      staged: ["file2.ts"]
    },
    workspaceTree: [
      { name: "src", type: "directory" },
      { name: "main.ts", type: "file" },
      { name: "utils.ts", type: "file" }
    ],
    projectConfigs: [
      { type: "package.json", path: "package.json" }
    ],
    diagnostics: [{}, {}]
  }

  const result = buildContextText(mockCtx)
  
  assert.ok(result.includes("Open files: src/main.ts (typescript), index.html (html)"))
  assert.ok(result.includes("Git status: branch: main, modified: 1, staged: 1"))
  assert.ok(result.includes("Workspace structure: /src, main.ts, utils.ts"))
  assert.ok(result.includes("Project configs: package.json at package.json"))
  assert.ok(result.includes("Diagnostics: 2 files with errors or warnings"))
})

test("buildContextText handles empty context", () => {
  const mockCtx = {
    openFiles: [],
    gitStatus: { branch: "unknown", modified: [], staged: [] },
    workspaceTree: [],
    projectConfigs: [],
    diagnostics: []
  }

  const result = buildContextText(mockCtx)
  
  assert.ok(result.includes("Open files: none"))
  assert.ok(result.includes("Git status: branch: unknown, modified: 0, staged: 0"))
  assert.ok(result.includes("Workspace structure: "))
  assert.ok(result.includes("Project configs: none"))
  assert.ok(result.includes("Diagnostics: 0 files with errors or warnings"))
})

test("buildContextText truncates large workspace tree", () => {
  const largeTree = []
  for (let i = 0; i < 60; i++) {
    largeTree.push({ name: `file${i}.ts`, type: "file" })
  }
  
  const mockCtx = {
    openFiles: [],
    gitStatus: { branch: "main", modified: [], staged: [] },
    workspaceTree: largeTree,
    projectConfigs: [],
    diagnostics: []
  }

  const result = buildContextText(mockCtx)
  assert.ok(result.includes("(truncated)"))
  assert.ok(result.includes("file49.ts"))
  assert.ok(!result.includes("file50.ts"))
})
