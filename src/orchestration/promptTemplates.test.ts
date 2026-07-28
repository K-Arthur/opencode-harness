import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_TEMPLATES,
  getTemplateForRole,
  renderTemplate,
  stageToRole,
} from "./promptTemplates";

describe("prompt templates", () => {
  it("defines templates for all known roles", () => {
    const roles = ["explore", "plan", "implementation", "review", "visualReview", "debugging", "review_security", "synthesise"];
    for (const role of roles) {
      const template = ROLE_TEMPLATES[role];
      assert.ok(template, `Missing template for role: ${role}`);
      assert.ok(template.systemPrompt.length > 50, `Template for ${role} is too short`);
      assert.ok(template.version, `Template for ${role} missing version`);
      assert.ok(template.expectedOutput, `Template for ${role} missing expected output`);
      assert.ok(template.constraints.length > 0, `Template for ${role} has no constraints`);
      assert.ok(template.handoffFormat, `Template for ${role} missing handoff format`);
    }
  });

  it("getTemplateForRole returns correct template", () => {
    const t = getTemplateForRole("implementation");
    assert.ok(t);
    assert.equal(t.role, "implementation");
    assert.ok(t.systemPrompt.includes("implement"));
  });

  it("renderTemplate substitutes variables", () => {
    const template = ROLE_TEMPLATES.implementation!;
    const rendered = renderTemplate(template, {
      userRequest: "Add a login form",
      planSummary: "Create LoginForm component",
    });
    assert.ok(rendered.includes("Create LoginForm component"), "Should include planSummary");
    assert.ok(rendered.includes("implement"), "Should include role instructions");
  });

  it("renderTemplate substitutes userRequest in templates that contain it", () => {
    const template = ROLE_TEMPLATES.explore!;
    const rendered = renderTemplate(template, {
      userRequest: "Find the authentication code",
    });
    assert.ok(rendered.includes("Find the authentication code"), "Should include userRequest");
  });

  it("stageToRole maps all pipeline stages to roles", () => {
    const stages = [
      "explore", "retrieve_context", "plan", "plan_review", "implement",
      "test_execute", "review_code", "review_security", "review_accessibility",
      "review_performance", "fix", "visual_analyse", "synthesise",
      "compact_context", "research", "brainstorm", "document",
    ];
    for (const stage of stages) {
      const role = stageToRole(stage);
      assert.ok(role, `No role mapping for stage: ${stage}`);
      assert.ok(typeof role === "string");
    }
  });

  it("stageToRole maps review_security separately from review", () => {
    assert.equal(stageToRole("review_security"), "review_security");
    assert.equal(stageToRole("review_code"), "review");
  });

  it("explore template prohibits file modifications", () => {
    const template = ROLE_TEMPLATES.explore!;
    assert.ok(template.constraints.some((c) => c.toLowerCase().includes("modification") || c.toLowerCase().includes("modify")));
  });

  it("implementer template mentions writing tests", () => {
    const template = ROLE_TEMPLATES.implementation!;
    assert.ok(template.systemPrompt.includes("Write tests") || template.systemPrompt.includes("tests"));
  });

  it("synthesizer template mentions checklist", () => {
    const template = ROLE_TEMPLATES.synthesise!;
    assert.ok(template.systemPrompt.includes("checklist") || template.systemPrompt.includes("summary"));
  });
});
