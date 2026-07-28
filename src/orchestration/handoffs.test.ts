import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HandoffStore,
  validateClassificationOutput,
  validateExplorationOutput,
  validatePlanOutput,
  validateImplementationOutput,
  validateReviewOutput,
  validateSynthesisOutput,
  validateVisualAnalysisOutput,
  validateVerificationOutput,
  validateStageOutput,
} from "./handoffs";

describe("HandoffStore", () => {
  it("stores and retrieves handoffs", () => {
    const store = new HandoffStore();
    store.set("explore", {
      stage: "explore",
      output: {
        relevantFiles: ["src/main.ts"],
        relevantSymbols: ["Main"],
        architectureSummary: "Simple app",
        suspectedChangePoints: ["src/main.ts"],
        testsDiscovered: [],
        constraints: [],
        openQuestions: [],
        confidence: 0.8,
      },
    });
    const hf = store.get("explore");
    assert.ok(hf);
    assert.equal(hf.stage, "explore");
    if (hf.stage === "explore") {
      assert.equal(hf.output.relevantFiles.length, 1);
    }
  });

  it("has returns false for missing", () => {
    const store = new HandoffStore();
    assert.ok(!store.has("nonexistent"));
  });

  it("invalidateDownstream removes dependent handoffs", () => {
    const store = new HandoffStore();
    store.set("explore", { stage: "explore", output: { relevantFiles: [], relevantSymbols: [], architectureSummary: "", suspectedChangePoints: [], testsDiscovered: [], constraints: [], openQuestions: [], confidence: 0 } });
    store.set("plan", { stage: "plan", output: { goals: [], proposedChanges: [], filesAffected: [], risks: [], testingStrategy: "", rollbackStrategy: "", estimatedDifficulty: 0, unresolvedDecisions: [], implementationOrdering: [] } });
    store.set("implement", { stage: "implement", output: { filesChanged: [], filesCreated: [], filesDeleted: [], summary: "", commandsExecuted: [], testsRun: [], failuresEncountered: [], remainingConcerns: [], reviewRecommended: false } });

    const invalidated = store.invalidateDownstream("plan");
    assert.ok(invalidated.includes("implement"));
    assert.ok(store.has("explore"));
    assert.ok(store.has("plan"));
    assert.ok(!store.has("implement"));
  });

  it("getOutput returns typed output", () => {
    const store = new HandoffStore();
    store.set("classify", { stage: "classify", output: { taskType: "implement", complexity: 0.5, hasImages: false, intent: "write", canBypassPipeline: false } });
    const output = store.getOutput<{ taskType: string }>("classify");
    assert.ok(output);
    assert.equal(output.taskType, "implement");
  });

  it("clear removes all", () => {
    const store = new HandoffStore();
    store.set("a", { stage: "classify", output: { taskType: "implement", complexity: 0.5, hasImages: false, intent: "write", canBypassPipeline: false } });
    store.set("b", { stage: "explore", output: { relevantFiles: [], relevantSymbols: [], architectureSummary: "", suspectedChangePoints: [], testsDiscovered: [], constraints: [], openQuestions: [], confidence: 0 } });
    store.clear();
    assert.equal(store.getAll().length, 0);
  });
});

describe("validateClassificationOutput", () => {
  it("parses valid JSON", () => {
    const result = validateClassificationOutput(`{"taskType": "debug", "complexity": 0.8, "hasImages": false, "intent": "write", "canBypassPipeline": false}`);
    assert.ok(result.valid);
    if (result.valid) {
      assert.equal(result.handoff.stage, "classify");
      assert.equal(result.handoff.output.taskType, "debug");
    }
  });

  it("parses JSON in code block", () => {
    const result = validateClassificationOutput("Some text\n```json\n{\"taskType\": \"implement\", \"complexity\": 0.3}\n```");
    assert.ok(result.valid);
  });

  it("falls back with defaults on missing fields", () => {
    const result = validateClassificationOutput(`{"taskType": "implement"}`);
    assert.ok(result.valid);
    if (result.valid) {
      assert.equal(result.handoff.output.complexity, 0.5);
      assert.equal(result.handoff.output.canBypassPipeline, false);
    }
  });

  it("returns invalid for unparseable text", () => {
    const result = validateClassificationOutput("This is not JSON at all");
    assert.ok(!result.valid);
  });
});

describe("validateExplorationOutput", () => {
  it("parses valid exploration output", () => {
    const json = JSON.stringify({
      relevantFiles: ["src/main.ts", "src/utils.ts"],
      relevantSymbols: ["parseConfig", "validateInput"],
      architectureSummary: "The application uses a layered architecture",
      suspectedChangePoints: ["src/main.ts"],
      confidence: 0.85,
    });
    const result = validateExplorationOutput(json);
    assert.ok(result.valid);
    if (result.valid) {
      assert.equal(result.handoff.output.relevantFiles.length, 2);
      assert.equal(result.handoff.output.confidence, 0.85);
    }
  });
});

describe("validatePlanOutput", () => {
  it("parses plan with proposed changes", () => {
    const json = JSON.stringify({
      goals: ["Add dark mode toggle"],
      proposedChanges: [{ file: "src/theme.ts", action: "modify", summary: "Add dark mode variables", risk: "low" }],
      filesAffected: ["src/theme.ts"],
      testingStrategy: "Verify dark mode CSS variables",
      estimatedDifficulty: 0.3,
    });
    const result = validatePlanOutput(json);
    assert.ok(result.valid);
    if (result.valid) {
      assert.equal(result.handoff.output.goals.length, 1);
      assert.equal(result.handoff.output.proposedChanges.length, 1);
      assert.equal(result.handoff.output.proposedChanges[0]!.file, "src/theme.ts");
    }
  });

  it("handles empty proposed changes gracefully", () => {
    const result = validatePlanOutput(`{"goals": []}`);
    assert.ok(result.valid);
  });
});

describe("validateImplementationOutput", () => {
  it("parses implementation results", () => {
    const json = JSON.stringify({
      filesChanged: ["src/main.ts"],
      summary: "Added dark mode support",
      reviewRecommended: true,
    });
    const result = validateImplementationOutput(json);
    assert.ok(result.valid);
    if (result.valid) {
      assert.ok(result.handoff.output.reviewRecommended);
    }
  });
});

describe("validateReviewOutput", () => {
  it("parses review findings array", () => {
    const json = JSON.stringify([
      { severity: "blocking", category: "security", file: "src/auth.ts", evidence: "Missing CSRF token", blocksCompletion: true, confidence: 0.9, recommendedFix: "Add CSRF" },
    ]);
    const result = validateReviewOutput(json);
    assert.ok(result.valid);
    if (result.valid) {
      assert.equal(result.handoff.output.blockingCount, 1);
    }
  });

  it("parses empty findings gracefully", () => {
    const result = validateReviewOutput(`{}`);
    assert.ok(result.valid);
    if (result.valid) {
      assert.equal(result.handoff.output.blockingCount, 0);
    }
  });
});

describe("validateSynthesisOutput", () => {
  it("uses raw text as response", () => {
    const result = validateSynthesisOutput("This is the final response");
    assert.ok(result.valid);
    if (result.valid) {
      assert.equal(result.handoff.output.response, "This is the final response");
    }
  });
});

describe("validateVisualAnalysisOutput", () => {
  it("parses visual findings", () => {
    const json = JSON.stringify({
      findings: [{ component: "Button", issue: "Low contrast", severity: "major" }],
      summary: "Found contrast issues",
      confidence: 0.75,
      componentsIdentified: ["Button"],
    });
    const result = validateVisualAnalysisOutput(json);
    assert.ok(result.valid);
    if (result.valid) {
      assert.equal(result.handoff.output.findings.length, 1);
    }
  });
});

describe("validateVerificationOutput", () => {
  it("parses test results", () => {
    const json = JSON.stringify({
      checksPerformed: ["Unit tests", "Integration tests"],
      testsPassed: 15,
      testsFailed: 1,
      totalTests: 16,
      completionStatus: "failed",
    });
    const result = validateVerificationOutput(json);
    assert.ok(result.valid);
    if (result.valid) {
      assert.equal(result.handoff.output.testsPassed, 15);
    }
  });
});

describe("validateStageOutput", () => {
  it("routes to correct validator by stage id", () => {
    const result = validateStageOutput("classify", `{"taskType": "implement", "complexity": 0.5}`);
    assert.ok(result.valid);
    if (result.valid) assert.equal(result.handoff.stage, "classify");
  });

  it("falls through for unknown stages", () => {
    const result = validateStageOutput("brainstorm", "some text");
    assert.ok(result.valid);
  });
});
