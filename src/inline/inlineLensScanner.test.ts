import { describe, it } from "node:test"
import assert from "node:assert/strict"

// Module under test (doesn't exist yet — RED phase)
import { scanLensTargets, type LensTarget } from "./inlineLensScanner"

describe("scanLensTargets", () => {
  it("finds_named_function_declarations", () => {
    const text = `function greet(name: string): string {
  return "hello " + name
}`
    const targets: LensTarget[] = scanLensTargets(text)
    assert.equal(targets.length, 1)
    assert.ok(targets[0] !== undefined)
    assert.equal(targets[0].startOffset, text.indexOf("function greet"))
  })

  it("finds_exported_async_functions", () => {
    const text = `export async function fetchData() {
  return await fetch("/api")
}`
    const targets = scanLensTargets(text)
    assert.equal(targets.length, 1)
  })

  it("finds_arrow_function_const_assignments", () => {
    const text = `const handler = (req: Request) => {
  return "ok"
}`
    const targets = scanLensTargets(text)
    assert.equal(targets.length, 1)
  })

  it("finds_class_declarations", () => {
    const text = `export class MyService {
  doWork() { return 42 }
}`
    const targets = scanLensTargets(text)
    assert.ok(targets.length >= 1, "should find the class")
  })

  it("returns_empty_for_empty_text", () => {
    const targets = scanLensTargets("")
    assert.equal(targets.length, 0)
  })

  it("returns_empty_for_text_with_no_symbols", () => {
    const targets = scanLensTargets("const x = 42\nconst y = true")
    assert.equal(targets.length, 0)
  })

  it("finds_multiple_functions", () => {
    const text = `function a() { return 1 }\nfunction b() { return 2 }`
    const targets = scanLensTargets(text)
    assert.equal(targets.length, 2)
  })

  it("each_target_has_startOffset_and_endOffset", () => {
    const text = `function foo() { return "bar" }`
    const targets = scanLensTargets(text)
    assert.equal(targets.length, 1)
    const t = targets[0]!
    assert.ok(typeof t.startOffset === "number")
    assert.ok(typeof t.endOffset === "number")
    assert.ok(t.endOffset > t.startOffset)
  })
})
