import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  inferAgentRole,
  normalizeAgentRole,
  resolveRoutedModel,
  type AgentRole,
} from "./modelRouting"

describe("modelRouting", () => {
  it("normalizes role aliases", () => {
    assert.equal(normalizeAgentRole("plan"), "planning")
    assert.equal(normalizeAgentRole("code-review"), "review")
    assert.equal(normalizeAgentRole("debug"), "debugging")
    assert.equal(normalizeAgentRole("build"), "implementation")
    assert.equal(normalizeAgentRole("unknown"), undefined)
  })

  it("infers role from explicit role, then mode, then prompt text", () => {
    assert.equal(inferAgentRole({ explicitRole: "review", mode: "build", promptText: "implement this" }), "review")
    assert.equal(inferAgentRole({ mode: "plan", promptText: "write files" }), "planning")
    assert.equal(inferAgentRole({ mode: "auto", promptText: "tests are failing with a stack trace" }), "debugging")
    assert.equal(inferAgentRole({ promptText: "review this diff for security issues" }), "review")
    assert.equal(inferAgentRole({ promptText: "add a toolbar button" }), "implementation")
  })

  it("uses role overrides before mode overrides and session defaults", () => {
    const role: AgentRole = "review"
    assert.equal(resolveRoutedModel({
      role,
      mode: "build",
      sessionModel: "anthropic/session",
      currentModel: "anthropic/global",
      workspaceRoleModels: { review: "anthropic/reviewer" },
      settingsRoleModels: { review: "openai/settings-reviewer" },
      workspaceModeModels: { build: "anthropic/build" },
      settingsModeModels: { build: "openai/build" },
    }), "anthropic/reviewer")
  })

  it("falls through settings role, workspace mode, settings mode, session, then global", () => {
    assert.equal(resolveRoutedModel({
      role: "debugging",
      mode: "build",
      sessionModel: "anthropic/session",
      currentModel: "anthropic/global",
      settingsRoleModels: { debugging: "openai/debug" },
      workspaceModeModels: { build: "anthropic/build" },
    }), "openai/debug")

    assert.equal(resolveRoutedModel({
      role: "implementation",
      mode: "build",
      sessionModel: "anthropic/session",
      currentModel: "anthropic/global",
      workspaceModeModels: { build: "anthropic/build" },
    }), "anthropic/build")

    assert.equal(resolveRoutedModel({
      role: "implementation",
      mode: "build",
      sessionModel: "anthropic/session",
      currentModel: "anthropic/global",
      settingsModeModels: { build: "openai/build" },
    }), "openai/build")

    assert.equal(resolveRoutedModel({
      role: "implementation",
      mode: "build",
      sessionModel: "anthropic/session",
      currentModel: "anthropic/global",
    }), "anthropic/session")

    assert.equal(resolveRoutedModel({
      role: "implementation",
      mode: "build",
      currentModel: "anthropic/global",
    }), "anthropic/global")
  })

  it("ignores role overrides (but still honors mode overrides) when roleRoutingEnabled is false", () => {
    assert.equal(resolveRoutedModel({
      role: "review",
      mode: "build",
      sessionModel: "anthropic/session",
      currentModel: "anthropic/global",
      workspaceRoleModels: { review: "anthropic/reviewer" },
      settingsRoleModels: { review: "openai/settings-reviewer" },
      workspaceModeModels: { build: "anthropic/build" },
      roleRoutingEnabled: false,
    }), "anthropic/build")

    assert.equal(resolveRoutedModel({
      role: "review",
      mode: "build",
      sessionModel: "anthropic/session",
      currentModel: "anthropic/global",
      workspaceRoleModels: { review: "anthropic/reviewer" },
      roleRoutingEnabled: false,
    }), "anthropic/session")
  })

  it("skips keyword-based prompt sniffing when enableTextInference is false, but still honors an explicit role or mode", () => {
    assert.equal(inferAgentRole({ promptText: "tests are failing with a stack trace", enableTextInference: false }), "implementation")
    assert.equal(inferAgentRole({ mode: "plan", promptText: "tests are failing", enableTextInference: false }), "planning")
    assert.equal(inferAgentRole({ explicitRole: "debugging", promptText: "add a toolbar button", enableTextInference: false }), "debugging")
  })
})
