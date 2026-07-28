import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COST_PROFILES,
  DEFAULT_ORCHESTRATED_CONFIG,
  DEFAULT_PRESETS,
  PIPELINE_STAGE_LABELS,
  STAGE_CATEGORIES,
} from "./types";

describe("orchestration types", () => {
  it("defines pipeline stage labels for all known stages", () => {
    const stages: string[] = [
      "classify", "explore", "retrieve_context", "plan", "plan_review",
      "implement", "test_execute", "review_code", "review_security",
      "review_accessibility", "review_performance", "fix", "visual_analyse",
      "synthesise", "compact_context", "research", "brainstorm", "document",
    ];
    for (const s of stages) {
      assert.ok(s in PIPELINE_STAGE_LABELS, `Missing label for stage: ${s}`);
      assert.equal(typeof PIPELINE_STAGE_LABELS[s as keyof typeof PIPELINE_STAGE_LABELS], "string");
    }
  });

  it("defines stage categories for all known stages", () => {
    const stageIds = Object.keys(PIPELINE_STAGE_LABELS) as Array<keyof typeof STAGE_CATEGORIES>;
    for (const s of stageIds) {
      assert.ok(s in STAGE_CATEGORIES, `Missing category for stage: ${s}`);
    }
  });

  it("has valid cost profiles with correct structure", () => {
    const ids = ["economy", "balanced", "quality"];
    for (const id of ids) {
      const profile = COST_PROFILES[id];
      assert.ok(profile, `Missing cost profile: ${id}`);
      assert.equal(profile.id, id);
      assert.ok(profile.maxCostPerRequest >= 0);
      assert.ok(profile.maxStages >= 3);
    }
  });

  it("economy is cheapest, quality is most expensive", () => {
    const econ = COST_PROFILES["economy"]!;
    const bal = COST_PROFILES["balanced"]!;
    const qual = COST_PROFILES["quality"]!;
    assert.ok(econ.maxCostPerRequest < bal.maxCostPerRequest);
    assert.ok(bal.maxCostPerRequest < qual.maxCostPerRequest);
  });

  it("quality has most stages allowed", () => {
    const econ = COST_PROFILES["economy"]!;
    const bal = COST_PROFILES["balanced"]!;
    const qual = COST_PROFILES["quality"]!;
    assert.ok(qual.maxStages >= bal.maxStages);
    assert.ok(bal.maxStages >= econ.maxStages);
  });

  it("DEFAULT_ORCHESTRATED_CONFIG has all required fields", () => {
    const config = DEFAULT_ORCHESTRATED_CONFIG;
    assert.equal(config.enabled, true);
    assert.equal(config.workflowId, "standard");
    assert.equal(config.costProfile, "balanced");
    assert.ok(config.roleModels);
    assert.ok(config.fallbackModels);
    assert.ok(config.reasoningEffort);
    assert.ok(config.reasoningEffort.planning);
    assert.ok(config.reasoningEffort.implementation);
  });

  it("DEFAULT_PRESETS contains default, economy, thorough", () => {
    const ids = DEFAULT_PRESETS.map((p) => p.id);
    assert.ok(ids.includes("default"));
    assert.ok(ids.includes("economy"));
    assert.ok(ids.includes("thorough"));
  });

  it("economy preset sets confirmExpensive and uses economy cost profile", () => {
    const preset = DEFAULT_PRESETS.find((p) => p.id === "economy");
    assert.ok(preset);
    assert.equal(preset.config.costProfile, "economy");
    assert.equal(preset.config.confirmExpensive, true);
    assert.equal(preset.config.maxRepairLoops, 1);
  });

  it("thorough preset requires plan approval and uses quality cost profile", () => {
    const preset = DEFAULT_PRESETS.find((p) => p.id === "thorough");
    assert.ok(preset);
    assert.equal(preset.config.costProfile, "quality");
    assert.equal(preset.config.requirePlanApproval, true);
    assert.equal(preset.config.maxRepairLoops, 3);
  });

  it("validates reasoning effort values per role", () => {
    const config = DEFAULT_ORCHESTRATED_CONFIG;
    const validEfforts = ["low", "medium", "high", "auto"];
    for (const effort of Object.values(config.reasoningEffort)) {
      assert.ok(validEfforts.includes(effort), `Invalid reasoning effort: ${effort}`);
    }
  });
});
