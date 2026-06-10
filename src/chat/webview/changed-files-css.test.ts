/**
 * Design conventions for the changed-files strip + dropdown.
 * The A/M/D badges and diff stats must derive from VS Code's git decoration
 * theme tokens (with fallbacks) instead of hardcoded palette hexes, the strip
 * must read as a contained, hoverable surface, and numeric columns must use
 * tabular numerals so stats align.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const components = readFileSync(path.join(__dirname, "css", "components.css"), "utf8")
const contextUsage = readFileSync(path.join(__dirname, "css", "context-usage.css"), "utf8")

describe("changed-files dropdown design tokens", () => {
  it("status badges use VS Code git decoration tokens", () => {
    assert.match(components, /\.cf-status-badge--A[^}]*--vscode-gitDecoration-addedResourceForeground/s)
    assert.match(components, /\.cf-status-badge--M[^}]*--vscode-gitDecoration-modifiedResourceForeground/s)
    assert.match(components, /\.cf-status-badge--D[^}]*--vscode-gitDecoration-deletedResourceForeground/s)
  })

  it("file diff stats use git decoration tokens and tabular numerals", () => {
    assert.match(components, /\.cf-stat-added[^}]*--vscode-gitDecoration-addedResourceForeground/s)
    assert.match(components, /\.cf-stat-removed[^}]*--vscode-gitDecoration-deletedResourceForeground/s)
    assert.match(components, /\.cf-file-stats[^}]*tabular-nums/s)
  })

  it("summary bar is sticky so totals stay visible while scrolling the tree", () => {
    assert.match(components, /\.cf-summary-bar[^}]*position:\s*sticky/s)
  })
})

describe("changed-files strip design", () => {
  it("strip is a contained widget surface with border and radius", () => {
    assert.match(contextUsage, /\.cf-strip[^}]*--vscode-editorWidget-background/s)
    assert.match(contextUsage, /\.cf-strip\s*\{[^}]*border:/s)
    assert.match(contextUsage, /\.cf-strip\s*\{[^}]*border-radius:/s)
  })

  it("strip aggregate stats use git decoration tokens and tabular numerals", () => {
    assert.match(contextUsage, /\.cf-strip-stats[^}]*tabular-nums/s)
    assert.match(contextUsage, /\.cf-strip-added[^}]*--vscode-gitDecoration-addedResourceForeground/s)
    assert.match(contextUsage, /\.cf-strip-removed[^}]*--vscode-gitDecoration-deletedResourceForeground/s)
  })
})
