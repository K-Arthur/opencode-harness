import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  validateSession,
  validateAgent,
  validateHealthResponse,
  ValidationError,
  expectString,
  expectNumber,
  expectBoolean,
  expectObject,
  expectArray,
  expectEnum,
} from "../../src/session/responseValidator.js"

describe("responseValidator", () => {
  describe("expectString", () => {
    it("returns the string value", () => {
      assert.equal(expectString("hello", "test"), "hello")
    })
    it("returns undefined for null", () => {
      assert.equal(expectString(null, "test"), undefined)
    })
    it("returns undefined for undefined", () => {
      assert.equal(expectString(undefined, "test"), undefined)
    })
    it("converts number to string", () => {
      assert.equal(expectString(42, "test"), "42")
    })
  })

  describe("expectNumber", () => {
    it("returns the number", () => {
      assert.equal(expectNumber(42, "test"), 42)
    })
    it("returns undefined for null", () => {
      assert.equal(expectNumber(null, "test"), undefined)
    })
    it("parses numeric string", () => {
      assert.equal(expectNumber("42", "test"), 42)
    })
    it("returns undefined for non-numeric string", () => {
      assert.equal(expectNumber("abc", "test"), undefined)
    })
  })

  describe("expectBoolean", () => {
    it("returns true", () => {
      assert.equal(expectBoolean(true, "test"), true)
    })
    it("returns undefined for string", () => {
      assert.equal(expectBoolean("true", "test"), undefined)
    })
  })

  describe("expectObject", () => {
    it("returns the object", () => {
      const obj = { a: 1 }
      assert.equal(expectObject(obj, "test"), obj)
    })
    it("returns undefined for array", () => {
      assert.equal(expectObject([], "test"), undefined)
    })
    it("returns undefined for null", () => {
      assert.equal(expectObject(null, "test"), undefined)
    })
  })

  describe("expectArray", () => {
    it("returns the array", () => {
      assert.deepEqual(expectArray([1, 2], "test"), [1, 2])
    })
    it("returns empty array for null", () => {
      assert.deepEqual(expectArray(null, "test"), [])
    })
  })

  describe("expectEnum", () => {
    it("returns matching value", () => {
      assert.equal(expectEnum("added", ["added", "deleted"] as const, "test", undefined), "added")
    })
    it("returns fallback for unknown value", () => {
      assert.equal(expectEnum("unknown", ["added", "deleted"] as const, "test", undefined as any), undefined)
    })
  })

  describe("validateSession", () => {
    it("validates a complete session object", () => {
      const raw = {
        id: "sess_123",
        title: "Test Session",
        directory: "/home/project",
        projectID: "proj_456",
        version: "1.0",
        time: { created: 1000, updated: 2000 },
        summary: {
          additions: 10,
          deletions: 5,
          files: 3,
          diffs: [{ file: "test.ts", additions: 10, deletions: 5 }],
        },
      }
      const result = validateSession(raw)
      assert.equal(result.id, "sess_123")
      assert.equal(result.title, "Test Session")
      assert.equal(result.summary?.additions, 10)
      assert.equal(result.summary?.diffs?.length, 1)
    })

    it("handles null/undefined fields gracefully", () => {
      const raw = {
        id: null,
        title: undefined,
        time: null,
      }
      const result = validateSession(raw)
      assert.equal(result.id, "")
      assert.equal(result.title, "")
      assert.equal(result.time.created, 0)
    })

    it("handles missing revert and share", () => {
      const raw = {
        id: "sess_1",
        title: "Test",
        projectID: "p1",
        directory: "/d",
        version: "1",
        time: { created: 1, updated: 2 },
      }
      const result = validateSession(raw)
      assert.equal(result.revert, undefined)
      assert.equal(result.share, undefined)
    })

    it("handles agent and model fields", () => {
      const raw = {
        id: "sess_1",
        title: "Test",
        projectID: "p1",
        directory: "/d",
        version: "1",
        time: { created: 1, updated: 2 },
        agent: "custom-agent",
        model: { id: "claude-3", providerID: "anthropic", variant: "thinking" },
      }
      const result = validateSession(raw)
      assert.equal(result.agent, "custom-agent")
      assert.equal(result.model?.id, "claude-3")
      assert.equal(result.model?.variant, "thinking")
    })
  })

  describe("validateAgent", () => {
    it("validates a complete agent", () => {
      const result = validateAgent({ name: "test", description: "desc", mode: "auto", native: true })
      assert.equal(result.name, "test")
      assert.equal(result.description, "desc")
      assert.equal(result.mode, "auto")
      assert.equal(result.builtIn, true)
    })

    it("defaults builtIn to false when native is missing", () => {
      const result = validateAgent({ name: "test", mode: "auto" })
      assert.equal(result.name, "test")
      assert.equal(result.builtIn, false)
    })

    it("handles null/undefined gracefully", () => {
      const result = validateAgent(null)
      assert.equal(result.name, "")
      assert.equal(result.description, undefined)
      assert.equal(result.mode, "")
      assert.equal(result.builtIn, false)
    })
  })

  describe("validateHealthResponse", () => {
    it("validates a healthy response", () => {
      const result = validateHealthResponse({ healthy: true, version: "1.18.7" })
      assert.equal(result?.healthy, true)
      assert.equal(result?.version, "1.18.7")
    })

    it("returns null for non-object", () => {
      assert.equal(validateHealthResponse(null), null)
      assert.equal(validateHealthResponse("string"), null)
    })
  })
})
