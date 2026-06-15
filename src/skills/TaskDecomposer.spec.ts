/**
 * Structural tests for the Sprint 3 spec-aware TaskDecomposer integration.
 *
 * Phase 3 of the SADD/TDD integration: when a Spec is passed to
 * `decompose(analysis, repo, spec)`, the decomposer should:
 *   - inject one task per spec.verificationCriteria entry
 *   - inject one task per spec.taskBreakdown item
 *   - prefer the spec's first in-scope item that mentions the domain
 *     when generating the domain task title
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "TaskDecomposer.ts"), "utf8")

describe("TaskDecomposer.ts (spec integration Phase 3)", () => {
  it("exports SpecContext, SpecTaskBreakdownItem, SpecVerificationCriterion", () => {
    assert.ok(source.includes("export interface SpecContext"), "SpecContext must be exported")
    assert.ok(source.includes("export interface SpecTaskBreakdownItem"), "SpecTaskBreakdownItem must be exported")
    assert.ok(source.includes("export interface SpecVerificationCriterion"), "SpecVerificationCriterion must be exported")
  })

  it("decompose accepts an optional spec argument", () => {
    const idx = source.indexOf("async decompose(")
    const sig = source.slice(idx, idx + 200)
    assert.ok(
      sig.includes("spec?: SpecContext"),
      "decompose must accept an optional spec?: SpecContext parameter"
    )
  })

  it("generateTasks passes spec through to createDomainTask", () => {
    const idx = source.indexOf("private async generateTasks(")
    const block = source.slice(idx, idx + 800)
    assert.ok(
      block.includes("spec?: SpecContext"),
      "generateTasks must accept an optional spec"
    )
    assert.ok(
      block.includes("createDomainTask(analysis, 'frontend', repo, spec)"),
      "frontend domain task must receive spec"
    )
    assert.ok(
      block.includes("createDomainTask(analysis, 'backend', repo, spec)"),
      "backend domain task must receive spec"
    )
  })

  it("injects one task per verification criterion", () => {
    const idx = source.indexOf("private createSpecVerificationTask(")
    assert.ok(idx > 0, "createSpecVerificationTask helper must exist")
    const block = source.slice(idx, idx + 800)
    assert.ok(block.includes("domain: 'shared'"), "spec verification task domain is 'shared'")
    assert.ok(
      block.includes("testType: TddScope['testType']") ||
        block.includes("testType,"),
      "spec verification task sets a testType"
    )
  })

  it("injects one task per taskBreakdown item", () => {
    const idx = source.indexOf("private createSpecTaskBreakdownItem(")
    assert.ok(idx > 0, "createSpecTaskBreakdownItem helper must exist")
    const block = source.slice(idx, idx + 800)
    assert.ok(
      block.includes("item.title"),
      "spec task title must come from the item.title"
    )
    assert.ok(block.includes("domain: 'shared'"), "spec task domain is 'shared'")
  })

  it("domain task title prefers spec in-scope match when present", () => {
    const idx = source.indexOf("private generateTaskTitle(")
    const block = source.slice(idx, idx + 600)
    assert.ok(
      block.includes("spec?: SpecContext"),
      "generateTaskTitle must accept spec"
    )
    assert.ok(
      block.includes("spec.scope.inScope.find"),
      "must look up in-scope items for the domain"
    )
  })
})
