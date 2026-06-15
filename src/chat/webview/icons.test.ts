/**
 * Structural tests for the Sprint 4 icon taxonomy.
 *
 * The webview bundle's icon set must include:
 *  - per-tool-name resolver (toolIconFor) for grep, glob, ls, task,
 *    todowrite, websearch, webfetch, plan, question, skill, lsp,
 *    git_*, memory, checkpoint, edit
 *  - 4-class fallback (read/write/exec/meta) when no tool name matches
 *  - state overlays for pending/running/succeeded/failed/cancelled/
 *    timeout
 *
 * Plus the activity-kind icons (MESSAGE, THINKING, PLAN, COMMAND, etc.)
 * and the subagent domain icons (FRONTEND/BACKEND/DATABASE/API/SHARED).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "icons.ts"), "utf8")

describe("icons.ts (Sprint 4 taxonomy)", () => {
  it("exports per-tool-name SVGs", () => {
    const expected = [
      "TOOL_GREP_SVG", "TOOL_GLOB_SVG", "TOOL_LS_SVG", "TOOL_TASK_SVG",
      "TOOL_TODOWRITE_SVG", "TOOL_WEBSEARCH_SVG", "TOOL_WEBFETCH_SVG",
      "TOOL_PLAN_SVG", "TOOL_QUESTION_SVG", "TOOL_SKILL_SVG",
      "TOOL_LSP_SVG", "TOOL_GIT_SVG", "TOOL_MEMORY_SVG",
      "TOOL_CHECKPOINT_SVG", "TOOL_EDIT_SVG", "TOOL_FALLBACK_SVG",
    ]
    for (const name of expected) {
      assert.ok(
        source.includes(`export const ${name}`),
        `${name} must be exported`
      )
    }
  })

  it("exports activity-kind SVGs (replaces emoji in activity-panel)", () => {
    const expected = [
      "MESSAGE_SVG", "THINKING_SVG", "PLAN_ICON_SVG",
      "APPROVAL_SVG", "CHECKPOINT_SVG", "FILE_READ_ICON_SVG",
      "FILE_EDIT_ICON_SVG", "COMPLETION_SVG",
    ]
    for (const name of expected) {
      assert.ok(
        source.includes(`export const ${name}`),
        `${name} must be exported`
      )
    }
  })

  it("exports subagent domain SVGs (replaces emoji in subagent-panel)", () => {
    const expected = [
      "DOMAIN_FRONTEND_SVG", "DOMAIN_BACKEND_SVG", "DOMAIN_DATABASE_SVG",
      "DOMAIN_API_SVG", "DOMAIN_SHARED_SVG",
    ]
    for (const name of expected) {
      assert.ok(
        source.includes(`export const ${name}`),
        `${name} must be exported`
      )
    }
  })

  it("exports state overlay SVGs", () => {
    const expected = [
      "STATE_PENDING_SVG", "STATE_RUNNING_SVG", "STATE_SUCCESS_SVG",
      "STATE_FAILED_SVG", "STATE_CANCELLED_SVG", "STATE_TIMEOUT_SVG",
    ]
    for (const name of expected) {
      assert.ok(
        source.includes(`export const ${name}`),
        `${name} must be exported`
      )
    }
  })

  it("exports toolIconFor resolver", () => {
    assert.ok(source.includes("export function toolIconFor("), "toolIconFor must be exported")
  })

  it("exports toolStateOverlayFor resolver", () => {
    assert.ok(source.includes("export function toolStateOverlayFor("), "toolStateOverlayFor must be exported")
  })

  it("toolIconFor uses the per-tool-name map and falls back to class", () => {
    const block = source.slice(
      source.indexOf("export function toolIconFor("),
      source.indexOf("export function toolStateOverlayFor(")
    )
    assert.ok(block.includes("TOOL_NAME_ICONS"), "must use TOOL_NAME_ICONS map")
    assert.ok(block.includes("case \"write\""), "must fall back to write class")
    assert.ok(block.includes("case \"exec\""), "must fall back to exec class")
    assert.ok(block.includes("case \"meta\""), "must fall back to meta class")
  })

  it("toolStateOverlayFor covers all six states", () => {
    const block = source.slice(
      source.indexOf("export function toolStateOverlayFor(")
    )
    for (const state of ["pending", "running", "completed", "succeeded", "failed", "error", "cancelled", "timed_out", "timeout"]) {
      assert.ok(
        block.includes(`\"${state}\"`),
        `state "${state}" must be handled`
      )
    }
  })

  it("does NOT use emoji for tool/activity icons", () => {
    // Sprint 4 explicit non-goal: no emoji in icons.ts (all SVG).
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u
    assert.ok(!emojiRegex.test(source), "icons.ts must not contain emoji")
  })
})
