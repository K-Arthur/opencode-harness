import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  shouldHonorActiveSessionChange,
  resolveInitStateTarget,
  shouldForceFocusOnSend,
  shouldHonorResumeSessionSwitch,
} from "./sessionFocus"

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
        currentIsStreaming: false,
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
        currentIsStreaming: false,
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
        currentIsStreaming: true,
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
        currentIsStreaming: false,
      }),
      false,
    )
  })

  it("REFUSES to auto-switch even for a non-streaming host switch (auto-switch disabled)", () => {
    assert.equal(
      shouldHonorActiveSessionChange({
        welcomeVisible: false,
        currentActiveId: "reading",
        currentActiveValid: true,
        targetId: "other",
        targetIsStreaming: false,
        currentIsStreaming: false,
      }),
      false,
    )
  })

  it("REFUSES to switch away from a streaming tab to ANY other tab", () => {
    assert.equal(
      shouldHonorActiveSessionChange({
        welcomeVisible: false,
        currentActiveId: "streaming-task",
        currentActiveValid: true,
        targetId: "other-reading",
        targetIsStreaming: false,
        currentIsStreaming: true,
      }),
      false,
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

  it("REFRESH does NOT follow host active id when prior tab was closed — avoids host-driven auto-switch", () => {
    assert.equal(
      resolveInitStateTarget({
        isFirstInit: false,
        welcomeVisibleBefore: false,
        priorActiveId: "closed",
        hostActiveId: "b",
        isKnownSession: knownSet(["a", "b"]),
        firstSessionId: "a",
      }),
      "a",
    )
  })
})

describe("shouldForceFocusOnSend", () => {
  it("does NOT switch when the user is already viewing the target session", () => {
    assert.equal(
      shouldForceFocusOnSend({
        welcomeVisible: false,
        currentActiveId: "s1",
        currentActiveValid: true,
        targetId: "s1",
      }),
      false,
    )
  })

  it("does NOT switch even when the welcome view is showing (auto-switch disabled)", () => {
    assert.equal(
      shouldForceFocusOnSend({
        welcomeVisible: true,
        currentActiveId: null,
        currentActiveValid: false,
        targetId: "s1",
      }),
      false,
    )
  })

  it("does NOT switch even when the current tab no longer exists (auto-switch disabled)", () => {
    assert.equal(
      shouldForceFocusOnSend({
        welcomeVisible: false,
        currentActiveId: "ghost",
        currentActiveValid: false,
        targetId: "s1",
      }),
      false,
    )
  })

  it("REFUSES to yank focus from a different valid tab during send (the auto-switch bug)", () => {
    assert.equal(
      shouldForceFocusOnSend({
        welcomeVisible: false,
        currentActiveId: "user-is-reading",
        currentActiveValid: true,
        targetId: "background-session",
      }),
      false,
    )
  })
})

describe("shouldHonorResumeSessionSwitch", () => {
  it("honours when the user explicitly initiated the resume (history click)", () => {
    assert.equal(
      shouldHonorResumeSessionSwitch({
        welcomeVisible: false,
        currentActiveId: "other",
        currentActiveValid: true,
        targetId: "resumed",
        userInitiated: true,
      }),
      true,
    )
  })

  it("REFUSES to yank focus for a background/automatic resume while the user views another tab", () => {
    assert.equal(
      shouldHonorResumeSessionSwitch({
        welcomeVisible: false,
        currentActiveId: "reading",
        currentActiveValid: true,
        targetId: "background-resume",
        userInitiated: false,
      }),
      false,
    )
  })

  it("honours a background resume when the user is on the welcome screen", () => {
    assert.equal(
      shouldHonorResumeSessionSwitch({
        welcomeVisible: true,
        currentActiveId: null,
        currentActiveValid: false,
        targetId: "auto-resume",
        userInitiated: false,
      }),
      true,
    )
  })

  it("is a no-op (honoured) when already viewing the resumed session", () => {
    assert.equal(
      shouldHonorResumeSessionSwitch({
        welcomeVisible: false,
        currentActiveId: "resumed",
        currentActiveValid: true,
        targetId: "resumed",
        userInitiated: false,
      }),
      true,
    )
  })
})
