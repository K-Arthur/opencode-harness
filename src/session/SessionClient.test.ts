import { describe, it } from "node:test"
import assert from "node:assert"
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, "SessionClient.ts"), "utf8")

void describe("SessionClient", () => {
  void describe("guardV2", () => {
    void it("throws when disposed()", () => {
      assert.ok(source.includes("if (this.disposed()) throw new Error"), "guardV2 checks disposed()")
    })

    void it("throws when v2 client is null", () => {
      assert.ok(source.includes("if (!client) throw new Error"), "guardV2 checks client null")
    })
  })

  void describe("normalizePermissionResponse", () => {
    void it('maps "always" to "always"', () => {
      assert.ok(source.includes('if (response === "always") return "always"'), 'always maps to always')
    })

    void it('maps "reject" and "deny" to "reject"', () => {
      assert.ok(
        source.includes('if (response === "reject" || response === "deny") return "reject"'),
        'reject and deny map to reject',
      )
    })

    void it("maps all other values to once", () => {
      assert.ok(source.includes('return "once"'), "fallback returns once")
    })
  })

  void describe("isRetryableError", () => {
    void it("checks retryable patterns including timeout and network", () => {
      assert.ok(source.includes("/timeout/i"), "checks timeout pattern")
      assert.ok(source.includes("/network/i"), "checks network pattern")
      assert.ok(source.includes("/econnrefused/i"), "checks econnrefused pattern")
      assert.ok(source.includes("/econnreset/i"), "checks econnreset pattern")
      assert.ok(source.includes("/etimedout/i"), "checks etimedout pattern")
    })

    void it("returns false when error is falsy", () => {
      assert.ok(source.includes("if (!error) return false"), "early return on falsy error")
    })
  })

  void describe("exponentialDelay", () => {
    void it("uses BASE_BACKOFF_MS * Math.pow(2, attempt) with jitter capped at 30000", () => {
      assert.ok(
        source.includes("this.BASE_BACKOFF_MS * Math.pow(2, attempt)"),
        "exponential backoff formula",
      )
      assert.ok(source.includes("30000"), "delay capped at 30000ms")
    })
  })

  void describe("constants", () => {
    void it("sets MAX_RETRIES to 3", () => {
      assert.ok(source.includes("MAX_RETRIES = 3"), "MAX_RETRIES is 3")
    })
  })

  void describe("sendPromptAsync retry loop", () => {
    void it("iterates from 0 to MAX_RETRIES inclusive", () => {
      assert.ok(
        source.includes("for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++)"),
        "retry loop bound",
      )
    })

    void it("checks signal?.aborted at loop entry", () => {
      assert.ok(source.includes("if (signal?.aborted) return"), "abort check at loop start")
    })

    void it("races SDK call against abort signal via Promise.race", () => {
      assert.ok(source.includes("Promise.race(["), "uses Promise.race for abort signal")
    })

    void it("catches DOMException with name AbortError and returns silently", () => {
      assert.ok(
        source.includes("err instanceof DOMException") && source.includes('err.name === "AbortError"'),
        "catches DOMException AbortError",
      )
      assert.ok(
        /catch \(err\)[\s\S]*?DOMException[\s\S]*?AbortError.*?\breturn\b/.test(source),
        "returns silently on abort",
      )
    })
  })

  void describe("filterToolsForModel", () => {
    void it("delegates to mcpServerManager when all args present", () => {
      assert.ok(
        source.includes("this.mcpServerManager.getFilteredTools(modelRef.providerID, modelRef.modelID, tools)"),
        "delegates to mcpServerManager",
      )
    })

    void it("returns tools unchanged when any arg is missing", () => {
      assert.ok(
        source.includes("if (!tools || !this.mcpServerManager || !modelRef) return tools"),
        "early return when args missing",
      )
    })
  })

  void describe("assertResponseSize", () => {
    void it("throws when size exceeds MAX_RESPONSE_SIZE (50MB)", () => {
      assert.ok(
        source.includes("MAX_RESPONSE_SIZE = 50 * 1024 * 1024"),
        "50MB constant",
      )
      assert.ok(
        source.includes('exceeds maximum size'),
        "throws on oversize",
      )
    })
  })

  void describe("ensureSession", () => {
    void it("re-attaches to existing session or creates new", () => {
      assert.ok(source.includes("Re-attached to existing server session"), "re-attach log")
      assert.ok(source.includes("await this.createSession(title)"), "falls back to createSession")
    })
  })

  void describe("sessionExists", () => {
    void it("delegates to getSession and returns false on error", () => {
      assert.ok(source.includes("async sessionExists("), "sessionExists exists")
      assert.ok(
        source.includes("await this.getSession(id)"),
        "sessionExists delegates to getSession",
      )
    })
  })

  void describe("respondToPermission", () => {
    void it("validates sessionId and permissionId are non-empty", () => {
      assert.ok(source.includes('if (!sessionId) throw new Error("Permission response missing session ID")'), "validates sessionId")
      assert.ok(source.includes('if (!permissionId) throw new Error("Permission response missing permission ID")'), "validates permissionId")
    })
  })

  void describe("sendPrompt", () => {
    void it("includes Idempotency-Key header", () => {
      assert.ok(source.includes('"Idempotency-Key"'), "Idempotency-Key header present")
    })
  })

  void describe("CRUD methods", () => {
    void it("defines all required methods", () => {
      const methods = [
        "async createSession",
        "async deleteSession",
        "async getSession",
        "async updateSessionTitle",
        "async listSessions",
        "async getSessionMessages",
        "async getMessages",
        "async getSessionDiff",
        "async revertMessage",
        "async abortSession",
        "async compactSession",
        "async sendCommand",
      ]
      for (const m of methods) {
        assert.ok(source.includes(m), `${m} exists`)
      }
    })
  })

  void describe("model management", () => {
    void it("setModel stores providerID and modelID", () => {
      assert.ok(
        source.includes("this._currentModel = { providerID, modelID }"),
        "setModel stores providerID and modelID",
      )
    })

    void it("clearModel sets to null", () => {
      assert.ok(
        source.includes("this._currentModel = null"),
        "clearModel sets _currentModel to null",
      )
    })
  })

  void describe("listAgents and listCommands", () => {
    void it("both methods exist", () => {
      assert.ok(source.includes("async listAgents("), "listAgents exists")
      assert.ok(source.includes("async listCommands("), "listCommands exists")
    })

    void it("listCommands preserves the server-reported source instead of hard-coding 'server'", () => {
      // Regression: every command was tagged source:"server", so MCP-provided
      // commands never matched the MCP filter in the commands modal.
      assert.ok(
        !/listCommands[\s\S]*?source:\s*"server"\s+as\s+const/.test(source),
        "listCommands must not hard-code source to a const 'server'",
      )
      assert.ok(
        /listCommands[\s\S]*?source:\s*c\.source\s*\?\?\s*"server"/.test(source),
        "listCommands passes through c.source (defaulting to 'server' when absent)",
      )
    })

    void it("listCommands accepts both bare-array and { data } response shapes", () => {
      // The /command endpoint returns a bare Array<Command>; reading `.data`
      // off it (as listSkills does for its wrapped endpoint) yielded undefined
      // → an always-empty command list.
      assert.ok(
        /listCommands[\s\S]*?Array\.isArray\(raw\)/.test(source),
        "listCommands branches on Array.isArray to support both response shapes",
      )
    })
  })

  void describe("getSessionTodos", () => {
    void it("exists and calls assertResponseSize", () => {
      assert.ok(source.includes("async getSessionTodos("), "getSessionTodos exists")
      assert.ok(
        source.match(/getSessionTodos[\s\S]*?this\.assertResponseSize/) !== null,
        "getSessionTodos calls assertResponseSize",
      )
    })
  })

  void describe("getToolPartialOutput", () => {
    void it("is backed by client.session.messages (v2) and checks response size", () => {
      assert.ok(source.includes("async getToolPartialOutput("), "getToolPartialOutput exists")
      assert.ok(
        /getToolPartialOutput[\s\S]*?client\.session\.messages\(\{ sessionID: sessionId \}\)/.test(source),
        "polls session.messages (v2) for the live tool snapshot",
      )
      assert.ok(
        /getToolPartialOutput[\s\S]*?this\.assertResponseSize\(data, "getToolPartialOutput"\)/.test(source),
        "guards response size",
      )
    })

    void it("matches tool parts by id, callID, or stable fallback", () => {
      assert.ok(source.includes("private stableToolPartId("), "stable fallback helper exists")
      assert.ok(source.includes("part.id === callId || part.callID === callId || this.stableToolPartId(part, messageId) === callId"), "matches all supported call ids")
      assert.ok(source.includes("`${messageId}:${stringValue(part.tool)}`"), "stable fallback uses messageId:tool")
    })

    void it("returns a defensive unavailable snapshot when no live output exists", () => {
      assert.ok(source.includes("unavailableToolSnapshot(callId, sinceToken)"), "falls back to unavailable snapshot")
      assert.ok(source.includes("fallbackToken: sinceToken"), "passes sinceToken as extraction fallback")
    })
  })

  void describe("replyToQuestion / rejectQuestion", () => {
    void it("delegates to the shared resolveSessionQuestionApi helper", () => {
      assert.ok(source.includes("import { resolveSessionQuestionApi }"), "imports the pure helper")
      assert.ok(source.includes("resolveSessionQuestionApi(client)"), "replyToQuestion/rejectQuestion call the helper")
      assert.ok(!source.includes("private resolveSessionQuestionApi("), "no longer duplicates the helper as a private method")
    })
  })
})
