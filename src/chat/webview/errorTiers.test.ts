/**
 * Tests for the spatial error-tier components and router (`errorTiers.ts`).
 *
 * Covers the contracts the frontend error-receiving infrastructure depends on:
 *   - routeErrorByTier dispatches each tier to the correct surface
 *   - Tier A gates the composer and persists across a fresh store (reload)
 *   - Tier B is ambient + dismissible and yields the slot to a Tier-A hard cap
 *   - applyErrorCleared clears Tier B on reconnect but NEVER clears Tier A
 *   - action buttons forward to the host (except local dismiss)
 *
 * Uses JSDOM for DOM, matching the repo's `errorComponents.dom.test.ts` pattern.
 * Run: `npx tsx --test "src/chat/webview/errorTiers.test.ts"`
 */

import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

import { ErrorCategory, ErrorSeverity, type ErrorContext } from "./errorTypes"
import { type NormalizedError } from "./errorWire"
import {
  ErrorStateStore,
  GlobalStatusBanner,
  TierAAnchor,
  routeErrorByTier,
  applyErrorCleared,
  type ErrorTierDeps,
  type ErrorPersistenceBackend,
} from "./errorTiers"

// ---------- DOM + dependency harness ----------

function setupDom(): { dom: JSDOM; slot: HTMLElement; composer: HTMLTextAreaElement; send: HTMLButtonElement } {
  const dom = new JSDOM("<!doctype html><html><body></body></html>")
  ;(globalThis as { document?: Document }).document = dom.window.document
  ;(globalThis as { window?: Window }).window = dom.window as unknown as Window
  ;(globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement

  const doc = dom.window.document
  const slot = doc.createElement("div")
  slot.id = "global-status-banner"
  doc.body.appendChild(slot)
  const composer = doc.createElement("textarea")
  composer.id = "prompt-input"
  doc.body.appendChild(composer)
  const send = doc.createElement("button")
  send.id = "send-btn"
  doc.body.appendChild(send)
  return { dom, slot, composer, send }
}

function makeDeps(opts: {
  slot: HTMLElement
  composer: HTMLElement
  send: HTMLElement
  posted: Record<string, unknown>[]
  renderInStreamCalls: ErrorContext[]
  backend?: ErrorPersistenceBackend
}): ErrorTierDeps {
  return {
    bannerSlot: () => opts.slot,
    composer: () => opts.composer,
    sendButton: () => opts.send,
    postMessage: (msg) => {
      opts.posted.push(msg)
    },
    persistence: opts.backend,
    renderInStream: (ctx) => {
      opts.renderInStreamCalls.push(ctx)
    },
  }
}

function memBackend(): ErrorPersistenceBackend {
  let store: Record<string, unknown> = {}
  return {
    get: () => store,
    set: (s) => {
      store = s
    },
  }
}

function ctx(overrides: Partial<ErrorContext>): ErrorContext {
  return {
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.MEDIUM,
    code: "TEST_ERROR",
    message: "m",
    userMessage: "Something went wrong.",
    suggestedActions: [],
    retryable: false,
    timestamp: 1,
    ...overrides,
  }
}

function normalized(tier: "A" | "B" | "C", overrides: Partial<ErrorContext> = {}): NormalizedError {
  const base = ctx(overrides)
  return { context: base, tier, source: "typed-payload" }
}

// ---------- ErrorStateStore ----------

describe("ErrorStateStore", () => {
  beforeEach(() => setupDom())

  it("set/get/clear Tier-A by session", () => {
    const store = new ErrorStateStore()
    const c = ctx({ code: "QUOTA_EXCEEDED", sessionId: "s1" })
    store.setTierA("s1", c)
    assert.equal(store.isGated("s1"), true)
    assert.deepEqual(store.getTierA("s1"), c)
    store.clearTierA("s1")
    assert.equal(store.isGated("s1"), false)
    assert.equal(store.getTierA("s1"), undefined)
  })

  it("persists across a fresh store instance via the backend (simulates reload)", () => {
    const backend = memBackend()
    const store1 = new ErrorStateStore(backend)
    store1.setTierA("s1", ctx({ code: "QUOTA_EXCEEDED", sessionId: "s1" }))
    // Simulate webview reload: new store, same backend.
    const store2 = new ErrorStateStore(backend)
    assert.equal(store2.isGated("s1"), true)
    assert.equal(store2.getTierA("s1")?.code, "QUOTA_EXCEEDED")
  })

  it("ignores non-context entries in the backend on restore", () => {
    const backend = memBackend()
    backend.set({
      "errorTierA.s1": ctx({ code: "QUOTA_EXCEEDED", sessionId: "s1" }),
      "errorTierA.bogus": { not: "a context" },
      unrelatedKey: 42,
    })
    const store = new ErrorStateStore(backend)
    assert.equal(store.snapshot().length, 1)
  })

  it("snapshot returns all persisted Tier-A contexts", () => {
    const store = new ErrorStateStore()
    store.setTierA("s1", ctx({ code: "A1" }))
    store.setTierA("s2", ctx({ code: "A2" }))
    const codes = store.snapshot().map(c => c.code).sort()
    assert.deepEqual(codes, ["A1", "A2"])
  })
})

// ---------- routeErrorByTier dispatch ----------

describe("routeErrorByTier dispatch", () => {
  let harness: ReturnType<typeof setupDom>
  let posted: Record<string, unknown>[]
  let renderCalls: ErrorContext[]
  let deps: ErrorTierDeps
  let store: ErrorStateStore

  beforeEach(() => {
    harness = setupDom()
    posted = []
    renderCalls = []
    store = new ErrorStateStore(memBackend())
    deps = makeDeps({
      slot: harness.slot,
      composer: harness.composer,
      send: harness.send,
      posted,
      renderInStreamCalls: renderCalls,
      backend: memBackend(),
    })
  })

  it("Tier A → anchor mounts, composer disabled, persisted", () => {
    const res = routeErrorByTier(
      normalized("A", { code: "QUOTA_EXCEEDED", sessionId: "s1" }),
      deps,
      store,
    )
    assert.equal(res.handled, true)
    assert.equal(res.tier, "A")
    assert.ok(harness.slot.firstElementChild?.classList.contains("tier-a-anchor"))
    assert.equal(harness.composer.hasAttribute("disabled"), true, "composer gated")
    assert.equal(store.isGated("s1"), true, "persisted")
  })

  it("Tier B → banner mounts, composer NOT disabled, nothing persisted", () => {
    const res = routeErrorByTier(
      normalized("B", { code: "NETWORK_OFFLINE" }),
      deps,
      store,
    )
    assert.equal(res.handled, true)
    assert.equal(res.tier, "B")
    assert.ok(harness.slot.firstElementChild?.classList.contains("tier-b-banner"))
    assert.equal(harness.composer.hasAttribute("disabled"), false, "composer left alone")
    assert.equal(store.snapshot().length, 0, "Tier B is never persisted")
  })

  it("Tier C → falls through to renderInStream", () => {
    const res = routeErrorByTier(
      normalized("C", { code: "PROMPT_TOO_LONG" }),
      deps,
      store,
    )
    assert.equal(res.handled, true)
    assert.equal(res.tier, "C")
    assert.equal(harness.slot.children.length, 0, "no banner for Tier C")
    assert.equal(renderCalls.length, 1)
    assert.equal(renderCalls[0]?.code, "PROMPT_TOO_LONG")
  })

  it("Tier C without renderInStream → handled=false so caller uses legacy path", () => {
    const depsNoC = { ...deps, renderInStream: undefined }
    const res = routeErrorByTier(normalized("C"), depsNoC, store)
    assert.equal(res.handled, false)
    assert.equal(res.tier, "C")
  })
})

// ---------- Tier-A precedence + persistence lifecycle ----------

describe("Tier A precedence and lifecycle", () => {
  let harness: ReturnType<typeof setupDom>
  let deps: ErrorTierDeps
  let store: ErrorStateStore

  beforeEach(() => {
    harness = setupDom()
    store = new ErrorStateStore(memBackend())
    deps = makeDeps({
      slot: harness.slot,
      composer: harness.composer,
      send: harness.send,
      posted: [],
      renderInStreamCalls: [],
      backend: memBackend(),
    })
  })

  it("a Tier-A hard cap holds the slot over a later Tier-B banner", () => {
    TierAAnchor.show(ctx({ code: "QUOTA_EXCEEDED", sessionId: "s1" }), deps, store)
    GlobalStatusBanner.show(ctx({ code: "NETWORK_OFFLINE" }), deps)
    assert.ok(harness.slot.firstElementChild?.classList.contains("tier-a-anchor"))
  })

  it("clearing Tier A ungates the composer and frees the slot", () => {
    TierAAnchor.show(ctx({ code: "AUTH_EXPIRED", sessionId: "s1" }), deps, store)
    assert.equal(harness.composer.hasAttribute("disabled"), true)
    TierAAnchor.clear(deps, store, "s1")
    assert.equal(harness.composer.hasAttribute("disabled"), false)
    assert.equal(harness.slot.children.length, 0)
    assert.equal(store.isGated("s1"), false)
  })
})

// ---------- applyErrorCleared (reconnect-while-drawn) ----------

describe("applyErrorCleared — reconnect-while-drawn", () => {
  let harness: ReturnType<typeof setupDom>
  let deps: ErrorTierDeps
  let store: ErrorStateStore

  beforeEach(() => {
    harness = setupDom()
    store = new ErrorStateStore(memBackend())
    deps = makeDeps({
      slot: harness.slot,
      composer: harness.composer,
      send: harness.send,
      posted: [],
      renderInStreamCalls: [],
      backend: memBackend(),
    })
  })

  it("clears a live Tier-B banner", () => {
    GlobalStatusBanner.show(ctx({ code: "NETWORK_OFFLINE" }), deps)
    assert.ok(harness.slot.firstElementChild)
    applyErrorCleared({ type: "error_cleared", correlationIds: ["x"] }, deps)
    assert.equal(harness.slot.children.length, 0)
  })

  it("does NOT clear a Tier-A hard cap (reconnect ≠ resolved quota/auth)", () => {
    TierAAnchor.show(ctx({ code: "QUOTA_EXCEEDED", sessionId: "s1" }), deps, store)
    applyErrorCleared({ type: "error_cleared", correlationIds: ["x"] }, deps)
    assert.ok(harness.slot.firstElementChild?.classList.contains("tier-a-anchor"))
    assert.equal(harness.composer.hasAttribute("disabled"), true)
    assert.equal(store.isGated("s1"), true)
  })

  it("ignores non-error_cleared envelopes", () => {
    GlobalStatusBanner.show(ctx({ code: "NETWORK_OFFLINE" }), deps)
    applyErrorCleared({ type: "error_batch", contexts: [] }, deps)
    assert.ok(harness.slot.firstElementChild, "banner untouched by a non-clear envelope")
  })
})

// ---------- action buttons ----------

describe("action buttons", () => {
  let harness: ReturnType<typeof setupDom>
  let posted: Record<string, unknown>[]
  let deps: ErrorTierDeps

  beforeEach(() => {
    harness = setupDom()
    posted = []
    deps = makeDeps({
      slot: harness.slot,
      composer: harness.composer,
      send: harness.send,
      posted,
      renderInStreamCalls: [],
    })
  })

  it("non-dismiss actions are forwarded to the host with correlationId + code", () => {
    GlobalStatusBanner.show(
      ctx({
        code: "NETWORK_OFFLINE",
        correlationId: "cid-1",
        suggestedActions: [{ label: "Retry", action: "retry", primary: true }],
      }),
      deps,
    )
    const btn = harness.slot.querySelector("button") as HTMLButtonElement
    assert.ok(btn)
    btn.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }))
    assert.equal(posted.length, 1)
    assert.equal(posted[0]?.type, "error_action")
    assert.equal(posted[0]?.action, "retry")
    assert.equal(posted[0]?.correlationId, "cid-1")
    assert.equal(posted[0]?.code, "NETWORK_OFFLINE")
  })

  it("dismiss clears the Tier-B banner locally without messaging the host", () => {
    GlobalStatusBanner.show(
      ctx({ code: "NETWORK_OFFLINE", suggestedActions: [] }),
      deps,
    )
    const dismiss = Array.from(harness.slot.querySelectorAll("button")).find(
      b => b.textContent === "Dismiss",
    ) as HTMLButtonElement
    assert.ok(dismiss, "Tier-B banners are always dismissible")
    dismiss.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }))
    assert.equal(harness.slot.children.length, 0)
    assert.equal(posted.length, 0, "dismiss is local-only")
  })

  it("Tier-A anchor renders its primary recovery CTA first", () => {
    const store = new ErrorStateStore(memBackend())
    TierAAnchor.show(
      ctx({
        code: "QUOTA_EXCEEDED",
        sessionId: "s1",
        suggestedActions: [
          { label: "Dismiss", action: "dismiss" },
          { label: "Upgrade plan", action: "upgrade_plan", primary: true },
        ],
      }),
      deps,
      store,
    )
    const labels = Array.from(harness.slot.querySelectorAll("button")).map(b => b.textContent)
    assert.equal(labels[0], "Upgrade plan", "primary CTA leads")
  })
})
