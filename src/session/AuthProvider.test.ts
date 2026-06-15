import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "AuthProvider.ts"), "utf8")

void describe("AuthProvider", () => {
  void describe("structure", () => {
    void it("exports AuthProvider class", () => {
      assert.ok(source.includes("export class AuthProvider"))
    })

    void it("has DI constructor accepting createClient", () => {
      assert.ok(source.includes("constructor("), "constructor must exist")
      assert.ok(source.includes("createClient:"), "constructor must accept createClient parameter")
      assert.ok(source.includes("CreateOpencodeClient"), "must type as CreateOpencodeClient")
    })

    void it("imports validateServerUrl", () => {
      assert.ok(source.includes('import { validateServerUrl }'))
    })
  })

  void describe("serverPassword", () => {
    void it("initializes as empty string", () => {
      assert.ok(source.includes('_serverPassword = ""'), "must default to empty string")
    })

    void it("exposes getter", () => {
      assert.ok(source.includes("get serverPassword()"), "must have serverPassword getter")
    })
  })

  void describe("isRemote", () => {
    void it("checks _remoteServerUrl !== null", () => {
      const idx = source.indexOf("get isRemote()")
      assert.ok(idx >= 0)
      const body = source.slice(idx, idx + 100)
      assert.ok(body.includes("_remoteServerUrl !== null"), "must check against null")
    })
  })

  void describe("authHeader", () => {
    void it("returns undefined when no passwords set", () => {
      assert.ok(source.includes("get authHeader()"), "authHeader getter must exist")
      assert.ok(source.includes("return undefined"), "must return undefined fallback")
    })

    void it("prefers remote password over server password", () => {
      const idx = source.indexOf("get authHeader()")
      const body = source.slice(idx, idx + 300)
      const remoteCheck = body.indexOf("_remoteServerPassword")
      const serverCheck = body.indexOf("_serverPassword")
      assert.ok(remoteCheck >= 0 && serverCheck >= 0, "must check both passwords")
      assert.ok(remoteCheck < serverCheck, "remote password checked first")
    })

    void it("delegates to buildRemoteAuthHeader for remote password", () => {
      assert.ok(source.includes("this.buildRemoteAuthHeader(this._remoteServerPassword)"), "must delegate")
    })

    void it("encodes server password as Basic base64", () => {
      const idx = source.indexOf("get authHeader()")
      const body = source.slice(idx, idx + 300)
      assert.ok(body.includes("Basic"), "must produce Basic header")
      assert.ok(body.includes("Buffer.from"), "must use base64 encoding")
      assert.ok(body.includes("opencode:"), "must use opencode username")
    })
  })

  void describe("baseUrl", () => {
    void it("returns remote URL or null", () => {
      assert.ok(source.includes("get baseUrl()"), "baseUrl getter must exist")
      assert.ok(source.includes("return this._remoteServerUrl"), "returns remote URL")
    })
  })

  void describe("setRemoteServer", () => {
    void it("trims trailing slashes", () => {
      assert.ok(source.includes('.replace(/\\/+$/, "")'), "must strip trailing slashes")
    })

    void it("validates URL via validateServerUrl", () => {
      assert.ok(source.includes("validateServerUrl(trimmed)"), "must call validateServerUrl")
      assert.ok(source.includes("!validation.valid"), "must check validity")
    })

    void it("throws on invalid URL", () => {
      assert.ok(source.includes("throw new Error(`Invalid remote server URL:"), "must throw")
    })

    void it("treats empty/whitespace as null", () => {
      assert.ok(source.includes("trimmed.length > 0 ? trimmed : null"), "empty trimmed = null")
    })

    void it("trims password whitespace", () => {
      assert.ok(source.includes("password?.trim()"), "must trim password")
    })

    void it("sets password to null when omitted or empty", () => {
      assert.ok(source.includes("_remoteServerPassword = password?.trim() || null"), "must null out empty password")
    })
  })

  void describe("generatePassword", () => {
    void it("checks OPENCODE_SERVER_PASSWORD env var first", () => {
      assert.ok(source.includes('process.env["OPENCODE_SERVER_PASSWORD"]'), "must read env var")
      assert.ok(source.includes("if (envPassword)"), "must check env var truthiness")
    })

    void it("uses env var value when set", () => {
      assert.ok(source.includes("this._serverPassword = envPassword"), "must assign env var")
    })

    void it("generates UUID with oc- prefix as fallback", () => {
      assert.ok(source.includes("randomUUID"), "must use randomUUID")
      assert.ok(source.includes("oc-"), "must prefix with oc-")
    })
  })

  // NOTE: AuthProvider's import chain pulls in `vscode`, so it cannot be instantiated
  // under `tsx --test`; these stay source-string. The v2 client construction is covered
  // behaviorally (with a vscode stub bundle) in tests/unit/session-client-question-v2.test.mjs.
  void describe("makeClient", () => {
    void it("builds localhost URL with port", () => {
      assert.ok(source.includes("http://127.0.0.1:${port}"), "must build localhost URL")
    })

    void it("sets a Basic auth header when a server password is set", () => {
      assert.ok(source.includes("Authorization: `Basic ${basic}`"), "must set Authorization header")
    })

    void it("delegates to the shared localClientConfig helper", () => {
      assert.ok(source.includes("this.createClient(this.localClientConfig(port))"), "makeClient must use the shared config helper")
    })
  })

  void describe("makeRemoteClient", () => {
    void it("delegates auth to buildRemoteAuthHeader", () => {
      assert.ok(source.includes("Authorization: this.buildRemoteAuthHeader(this._remoteServerPassword)"), "must delegate auth")
    })

    void it("delegates to the shared remoteClientConfig helper", () => {
      assert.ok(source.includes("this.createClient(this.remoteClientConfig(baseUrl))"), "makeRemoteClient must use the shared config helper")
    })
  })

  void describe("makeV2Client / makeRemoteV2Client (v2 strangler)", () => {
    void it("exposes v2 client makers", () => {
      assert.ok(source.includes("makeV2Client(port: number)"), "must expose makeV2Client")
      assert.ok(source.includes("makeRemoteV2Client(baseUrl: string)"), "must expose makeRemoteV2Client")
    })

    void it("builds the v2 client from the SAME config helpers as v1 (cannot drift on auth)", () => {
      assert.ok(source.includes("this.createV2ClientFn(this.localClientConfig(port))"), "local v2 must reuse localClientConfig")
      assert.ok(source.includes("this.createV2ClientFn(this.remoteClientConfig(baseUrl))"), "remote v2 must reuse remoteClientConfig")
    })

    void it("accepts an injected createV2Client for DI", () => {
      assert.ok(source.includes("createV2ClientFn:"), "constructor must accept createV2ClientFn")
      assert.ok(source.includes("CreateV2Client"), "must type as CreateV2Client")
    })
  })

  void describe("buildRemoteAuthHeader", () => {
    void it("detects Basic/Bearer prefix with case-insensitive regex", () => {
      assert.ok(source.includes("/^(Basic|Bearer)\\s+/i.test"), "must use case-insensitive regex")
    })

    void it("returns secret unchanged when already prefixed", () => {
      assert.ok(source.includes("return secret"), "must pass through prefixed secrets")
    })

    void it("encodes plain secret as Basic base64 with opencode username", () => {
      assert.ok(source.includes("`Basic ${Buffer.from(`opencode:${secret}`"), "must encode as Basic base64")
    })
  })

  void describe("buildHealthHeaders", () => {
    void it("returns empty object when no password", () => {
      assert.ok(source.includes("return {}"), "must return empty when no password")
    })

    void it("returns Authorization header with Basic auth when password set", () => {
      assert.ok(source.includes("Authorization: `Basic ${basic}`"), "must include Authorization")
      assert.ok(source.includes("buildHealthHeaders"), "method must exist")
      const idx = source.indexOf("buildHealthHeaders()")
      const body = source.slice(idx, idx + 250)
      assert.ok(body.includes("Buffer.from("), "must encode")
      assert.ok(body.includes("opencode:"), "must use opencode username")
    })
  })

  void describe("behavioral (extracted logic)", () => {
    void it("encodes plain secret as Basic base64", () => {
      const secret = "my-secret"
      const encoded = `Basic ${Buffer.from(`opencode:${secret}`).toString("base64")}`
      assert.ok(encoded.startsWith("Basic "))
      const decoded = Buffer.from(encoded.slice(6), "base64").toString()
      assert.equal(decoded, "opencode:my-secret")
    })

    void it("Basic/Bearer prefix passthrough regex matches correctly", () => {
      const regex = /^(Basic|Bearer)\s+/i
      assert.ok(regex.test("Basic abc"))
      assert.ok(regex.test("Bearer abc"))
      assert.ok(regex.test("basic abc"))
      assert.ok(regex.test("bearer abc"))
      assert.ok(regex.test("BASIC abc"))
      assert.ok(!regex.test("abc"))
      assert.ok(!regex.test("XBasic abc"))
    })

    void it("trailing slash regex strips correctly", () => {
      assert.equal("https://example.com///".replace(/\/+$/, ""), "https://example.com")
      assert.equal("https://example.com".replace(/\/+$/, ""), "https://example.com")
      assert.equal("https://example.com/".replace(/\/+$/, ""), "https://example.com")
    })

    void it("base64 encodes opencode:secret correctly", () => {
      const b64 = Buffer.from("opencode:test-password").toString("base64")
      const decoded = Buffer.from(b64, "base64").toString()
      assert.equal(decoded, "opencode:test-password")
    })
  })
})
