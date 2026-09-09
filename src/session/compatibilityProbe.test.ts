import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { V2OpencodeClient } from "./opencodeClientFactory.js"
import { probeServerCompatibility, serverIdentityCacheKey } from "./compatibilityProbe.js"

function health(version: string, status = 200): Response {
  return new Response(JSON.stringify({ healthy: true, version, pid: 42 }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function fakeClient(overrides: {
  legacyList?: () => Promise<unknown>
  openCode2List?: () => Promise<unknown>
} = {}): V2OpencodeClient {
  return {
    session: { list: overrides.legacyList ?? (async () => ({ data: [] })) },
    v2: { session: { list: overrides.openCode2List ?? (async () => ({ data: { data: [], cursor: {} } })) } },
  } as unknown as V2OpencodeClient
}

describe("probeServerCompatibility", () => {
  it("recognizes OpenCode 2 from its API health route and awaits an endpoint probe", async () => {
    const calls: string[] = []
    const result = await probeServerCompatibility({
      baseUrl: "http://127.0.0.1:4096/",
      v2Client: fakeClient({
        openCode2List: async () => {
          calls.push("session.list")
          return { data: { data: [], cursor: {} } }
        },
      }),
      isRemote: false,
      runtimePreference: "opencode2",
      fetchFn: async (input) => {
        calls.push(String(input))
        return health("1.18.4")
      },
    })

    assert.equal(result.supported, true)
    assert.equal(result.identity.runtime, "opencode2")
    assert.equal(result.identity.apiSurface, "opencode2")
    assert.equal(result.identity.instanceId, "42")
    assert.equal(result.metadata?.healthPath, "/api/health")
    assert.equal(result.capabilities.evidence?.supportsSessions?.state, "supported")
    assert.deepEqual(calls, ["http://127.0.0.1:4096/api/health", "session.list"])
  })

  it("falls back from an unidentifying OpenCode 2 route to the legacy route in auto mode", async () => {
    const paths: string[] = []
    const result = await probeServerCompatibility({
      baseUrl: "http://localhost:4096",
      v2Client: fakeClient({ legacyList: async () => ({ data: [] }) }),
      isRemote: true,
      runtimePreference: "auto",
      fetchFn: async (input) => {
        const url = String(input)
        paths.push(new URL(url).pathname)
        return url.endsWith("/api/health")
          ? new Response(JSON.stringify({ healthy: true }), { status: 200, headers: { "content-type": "application/json" } })
          : health("1.16.0")
      },
    })

    assert.equal(result.supported, true)
    assert.equal(result.legacy, true)
    assert.equal(result.identity.runtime, "opencode")
    assert.equal(result.identity.apiSurface, "legacy")
    assert.deepEqual(paths, ["/api/health", "/global/health"])
  })

  it("does not silently downgrade after an authentication failure", async () => {
    const paths: string[] = []
    const result = await probeServerCompatibility({
      baseUrl: "http://localhost:4096",
      v2Client: null,
      isRemote: true,
      runtimePreference: "auto",
      fetchFn: async (input) => {
        paths.push(new URL(String(input)).pathname)
        return new Response("unauthorized", { status: 401 })
      },
    })

    assert.equal(result.supported, false)
    assert.match(result.reason ?? "", /Authentication rejected/)
    assert.deepEqual(paths, ["/api/health"])
    assert.equal(result.capabilities.evidence?.supportsSessions?.state, "temporarily-unavailable")
  })

  it("does not mark a health-only OpenCode 2 server as supported", async () => {
    const result = await probeServerCompatibility({
      baseUrl: "http://localhost:4096",
      v2Client: fakeClient({ openCode2List: async () => ({ error: { message: "not implemented" } }) }),
      isRemote: true,
      runtimePreference: "opencode2",
      fetchFn: async () => health("0.0.0-next-1"),
    })

    assert.equal(result.supported, false)
    assert.equal(result.capabilities.supportsSessions, false)
    assert.match(result.reason ?? "", /session endpoint was not compatible/)
  })

  it("marks an unrecognized future legacy version as unknown instead of inheriting v2", async () => {
    const result = await probeServerCompatibility({
      baseUrl: "http://localhost:4096",
      v2Client: fakeClient({ legacyList: async () => ({ data: [] }) }),
      isRemote: false,
      runtimePreference: "opencode",
      fetchFn: async () => health("2.0.0"),
    })

    assert.equal(result.supported, false)
    assert.equal(result.identity.protocolGeneration, "unknown")
    assert.match(result.reason ?? "", /Unrecognized OpenCode version/)
  })
})

describe("serverIdentityCacheKey", () => {
  it("separates runtime and process generations on the same URL", () => {
    const base = {
      url: "http://localhost:4096",
      version: "1.18.4",
      protocolGeneration: "v2" as const,
      runtime: "opencode2" as const,
      apiSurface: "opencode2" as const,
      isRemote: true,
    }
    assert.notEqual(serverIdentityCacheKey(base, "connection-1"), serverIdentityCacheKey({ ...base, runtime: "opencode" }, "connection-1"))
    assert.notEqual(serverIdentityCacheKey(base, "connection-1"), serverIdentityCacheKey(base, "connection-2"))
  })
})
