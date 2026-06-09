import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { shouldHonorActiveSessionChange, resolveInitStateTarget } from "./sessionFocus"

const knownSet = (ids: string[]) => (id: string | null | undefined): boolean =>
  typeof id === "string" && ids.includes(id)

describe("shouldHonorActiveSessionChange", () => {
  it("honours the change when the welcome view is showing", () => {
    assert.equal(
      shouldHonorActiveSessionChange({
        welcomeVisible: true,
        currentActiveId: null,
        currentActiveValid: false,
        targetId: "s1",
        targetIsStreaming: true,
      }),
      true,
    )
  })

  it("honours the change when the current tab no longer exists", () => {
    assert.equal(
      shouldHonorActiveSessionChange({
        welcomeVisible: false,
        currentActiveId: "ghost",
        currentActiveValid: false,
        targetId: "s1",
        targetIsStreaming: false,
      }),
      true,
    )
  })

  it("is a no-op (honoured) when already on the target", () => {
    assert.equal(
      shouldHonorActiveSessionChange({
        welcomeVisible: false,
        currentActiveId: "s1",
        currentActiveValid: true,
        targetId: "s1",
        targetIsStreaming: true,
      }),
      true,
    )
  })

  it("REFUSES to steal focus to a streaming session while the user views another tab", () => {
    assert.equal(
      shouldHonorActiveSessionChange({
        welcomeVisible: false,
        currentActiveId: "reading",
        currentActiveValid: true,
        targetId: "task",
        targetIsStreaming: true,
      }),
      false,
    )
  })

  it("follows a non-streaming host switch (e.g. command-palette open) from another tab", () => {
    assert.equal(
      shouldHonorActiveSessionChange({
        welcomeVisible: false,
        currentActiveId: "reading",
        currentActiveValid: true,
        targetId: "other",
        targetIsStreaming: false,
      }),
      true,
    )
  })
})

describe("resolveInitStateTarget", () => {
  it("cold start honours the host's restored active session", () => {
    assert.equal(
      resolveInitStateTarget({
        isFirstInit: true,
        welcomeVisibleBefore: true,
        priorActiveId: null,
        hostActiveId: "restored",
        isKnownSession: knownSet(["restored", "a", "b"]),
        firstSessionId: "a",
      }),
      "restored",
    )
  })

  it("cold start falls back to first session when host active is unknown", () => {
    assert.equal(
      resolveInitStateTarget({
        isFirstInit: true,
        welcomeVisibleBefore: true,
        priorActiveId: null,
        hostActiveId: "gone",
        isKnownSession: knownSet(["a", "b"]),
        firstSessionId: "a",
      }),
      "a",
    )
  })

  it("REFRESH preserves the user's current tab over the host's active id", () => {
    assert.equal(
      resolveInitStateTarget({
        isFirstInit: false,
        welcomeVisibleBefore: false,
        priorActiveId: "reading",
        hostActiveId: "task", // host thinks the streaming session is active
        isKnownSession: knownSet(["reading", "task"]),
        firstSessionId: "task",
      }),
      "reading",
    )
  })

  it("REFRESH keeps the welcome screen when the user was on it", () => {
    assert.equal(
      resolveInitStateTarget({
        isFirstInit: false,
        welcomeVisibleBefore: true,
        priorActiveId: null,
        hostActiveId: "task",
        isKnownSession: knownSet(["task"]),
        firstSessionId: "task",
      }),
      null,
    )
  })

  it("REFRESH falls back to host active when the prior tab was closed and welcome was not shown", () => {
    assert.equal(
      resolveInitStateTarget({
        isFirstInit: false,
        welcomeVisibleBefore: false,
        priorActiveId: "closed",
        hostActiveId: "b",
        isKnownSession: knownSet(["a", "b"]),
        firstSessionId: "a",
      }),
      "b",
    )
  })
})
