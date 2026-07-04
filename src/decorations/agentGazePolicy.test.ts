import { describe, it } from "node:test"
import assert from "node:assert/strict"

// Module under test (doesn't exist yet — RED phase)
import { recordToolStart, resolveToolEndTarget, MAX_POLICY_MAP_SIZE } from "./agentGazePolicy"

describe("agentGazePolicy", () => {
  it("tool_end_resolves_path_recorded_at_tool_start", () => {
    const map = new Map<string, string>()
    recordToolStart(map, "id-1", { path: "/src/foo.ts" })
    const result = resolveToolEndTarget(map, "id-1")
    assert.equal(result, "/src/foo.ts")
  })

  it("tool_end_without_known_id_returns_undefined", () => {
    const map = new Map<string, string>()
    const result = resolveToolEndTarget(map, "unknown-id")
    assert.equal(result, undefined)
  })

  it("resolves_file_path_from_file_path_key", () => {
    const map = new Map<string, string>()
    recordToolStart(map, "id-2", { file_path: "/src/bar.ts" })
    assert.equal(resolveToolEndTarget(map, "id-2"), "/src/bar.ts")
  })

  it("resolves_file_path_from_filePath_camel_key", () => {
    const map = new Map<string, string>()
    recordToolStart(map, "id-3", { filePath: "/src/baz.ts" })
    assert.equal(resolveToolEndTarget(map, "id-3"), "/src/baz.ts")
  })

  it("recordToolStart_with_no_path_does_not_store_entry", () => {
    const map = new Map<string, string>()
    recordToolStart(map, "id-4", { other: "data" })
    assert.equal(map.size, 0)
  })

  it("recordToolStart_with_null_input_does_not_throw", () => {
    const map = new Map<string, string>()
    assert.doesNotThrow(() => recordToolStart(map, "id-5", null))
    assert.equal(map.size, 0)
  })

  it("resolve_consumes_entry_preventing_double_use", () => {
    const map = new Map<string, string>()
    recordToolStart(map, "id-6", { path: "/src/qux.ts" })
    resolveToolEndTarget(map, "id-6")
    const second = resolveToolEndTarget(map, "id-6")
    assert.equal(second, undefined, "entry must be consumed on first resolve")
  })

  it("map_capped_removes_oldest_entry_when_over_limit", () => {
    const map = new Map<string, string>()
    for (let i = 0; i < MAX_POLICY_MAP_SIZE + 5; i++) {
      recordToolStart(map, `id-${i}`, { path: `/src/file-${i}.ts` })
    }
    assert.ok(map.size <= MAX_POLICY_MAP_SIZE, `map size ${map.size} must not exceed cap`)
  })

  it("returns_undefined_for_tool_start_with_id_undefined", () => {
    const map = new Map<string, string>()
    recordToolStart(map, undefined as unknown as string, { path: "/src/foo.ts" })
    assert.equal(map.size, 0)
  })
})
