import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  inferAgentRole,
  normalizeAgentRole,
  resolveRoutedModel,
  resolveCapabilityAwareModel,
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

  it("normalizes visualReview aliases", () => {
    assert.equal(normalizeAgentRole("visual-review"), "visualReview")
    assert.equal(normalizeAgentRole("ui-review"), "visualReview")
    assert.equal(normalizeAgentRole("design-review"), "visualReview")
    assert.equal(normalizeAgentRole("design"), "planning")
  })

  it("infers role from explicit role, then mode, then prompt text", () => {
    assert.equal(inferAgentRole({ explicitRole: "review", mode: "build", promptText: "implement this" }), "review")
    assert.equal(inferAgentRole({ mode: "plan", promptText: "write files" }), "planning")
    assert.equal(inferAgentRole({ mode: "auto", promptText: "tests are failing with a stack trace" }), "debugging")
    assert.equal(inferAgentRole({ promptText: "review this diff for security issues" }), "review")
    assert.equal(inferAgentRole({ promptText: "add a toolbar button" }), "implementation")
  })

  it("infers visualReview role from prompt text", () => {
    assert.equal(inferAgentRole({ promptText: "check the visual appearance of this button" }), "visualReview")
    assert.equal(inferAgentRole({ promptText: "do a design review of this component" }), "visualReview")
    assert.equal(inferAgentRole({ promptText: "review this screenshot for layout issues" }), "visualReview")
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

describe("capability-aware model routing", () => {
  const capableProfile = {
    reasoning: 0.8,
    coding: 0.8,
    knowledge: 0.7,
    instructionFollowing: 0.8,
    toolUse: 0.7,
    vision: 0.5,
    contextUtilization: 0.7,
    autonomy: 0.7,
    throughput: 0.7,
    visualJudgment: 0.6,
    confidenceSources: {} as Record<string, 'verified' | 'declared' | 'inferred' | 'fallback'>,
  }

  const weakProfile = {
    ...capableProfile,
    reasoning: 0.3,
    autonomy: 0.2,
    coding: 0.3,
    toolUse: 0.3,
    visualJudgment: 0.1,
    confidenceSources: {} as Record<string, 'verified' | 'declared' | 'inferred' | 'fallback'>,
  }

  const baseInput = {
    role: "planning" as AgentRole,
    mode: "build",
    sessionModel: "anthropic/session",
    currentModel: "anthropic/global",
  }

  it("returns model with capability check when gating is enabled", () => {
    const result = resolveCapabilityAwareModel({
      ...baseInput,
      capabilities: capableProfile,
      enableCapabilityGating: true,
    })
    assert.equal(result.model, "anthropic/session")
    assert.equal(result.capabilityGated, true)
    assert.equal(result.capabilityCheck.capable, true)
  })

  it("returns capability failure when gating is enabled and model is below threshold", () => {
    const result = resolveCapabilityAwareModel({
      ...baseInput,
      capabilities: weakProfile,
      enableCapabilityGating: true,
    })
    assert.equal(result.model, "anthropic/session")
    assert.equal(result.capabilityCheck.capable, false)
    assert.ok(result.capabilityCheck.reason)
    assert.ok(result.capabilityCheck.reason!.includes('below threshold'))
  })

  it("does not gate when enableCapabilityGating is false", () => {
    const result = resolveCapabilityAwareModel({
      ...baseInput,
      capabilities: weakProfile,
      enableCapabilityGating: false,
    })
    assert.equal(result.model, "anthropic/session")
    assert.equal(result.capabilityCheck.capable, true)
  })

  it("provides autonomy scaffolding for capable model", () => {
    const result = resolveCapabilityAwareModel({
      ...baseInput,
      capabilities: capableProfile,
      enableCapabilityGating: false,
    })
    assert.ok(result.autonomyGuidance)
    assert.ok(result.promptPrefix.length > 0)
    // A high-autonomy model gets S-tier guidance (longer leash)
    assert.equal(result.autonomyGuidance!.delegationStrategy, 'direct')
  })

  it("provides tighter scaffolding for weak model", () => {
    const result = resolveCapabilityAwareModel({
      ...baseInput,
      capabilities: weakProfile,
      enableCapabilityGating: false,
    })
    assert.ok(result.autonomyGuidance)
    // A low-autonomy model gets tighter guidance
    assert.ok(result.autonomyGuidance!.checkpointEveryNSteps <= 3)
  })

  it("honors visualReview role in capability-aware routing", () => {
    const result = resolveCapabilityAwareModel({
      ...baseInput,
      role: "visualReview",
      capabilities: capableProfile,
      enableCapabilityGating: true,
    })
    assert.equal(result.model, "anthropic/session")
    assert.equal(result.capabilityCheck.capable, true)
  })

  it("flags weak visual judgment for visualReview role", () => {
    const result = resolveCapabilityAwareModel({
      ...baseInput,
      role: "visualReview",
      capabilities: weakProfile,
      enableCapabilityGating: true,
    })
    assert.equal(result.capabilityCheck.capable, false)
    assert.ok(result.capabilityCheck.reason)
  })
})
