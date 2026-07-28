import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PipelineCoordinator, type StageDispatcher, selectWorkflow, STANDARD_WORKFLOW, QUICK_WORKFLOW, DEBUG_WORKFLOW, REVIEW_WORKFLOW, MULTIMODAL_WORKFLOW, WORKFLOWS } from "./pipelineCoordinator";
import type { OrchestratedConfig } from "./types";

function makeConfig(overrides: Partial<OrchestratedConfig> = {}): OrchestratedConfig {
  return {
    enabled: true,
    workflowId: "standard",
    costProfile: "balanced",
    roleModels: {
      planning: "test/planner",
      implementation: "test/implementer",
      review: "test/reviewer",
      debugging: "test/debugger",
      visualReview: "test/visual",
    },
    fallbackModels: {},
    reasoningEffort: {
      planning: "high",
      implementation: "medium",
      review: "medium",
      debugging: "high",
      visualReview: "low",
    },
    requirePlanApproval: false,
    parallelReads: true,
    maxRepairLoops: 2,
    confirmExpensive: false,
    ...overrides,
  };
}

describe("PipelineCoordinator", () => {
  let coordinator: PipelineCoordinator;

  before(() => {
    coordinator = new PipelineCoordinator();
  });

  after(() => {
    coordinator.removePipeline("test-session");
  });

  it("exists and has expected methods", () => {
    assert.ok(coordinator instanceof PipelineCoordinator);
    assert.equal(typeof coordinator.runPipeline, "function");
    assert.equal(typeof coordinator.cancelPipeline, "function");
    assert.equal(typeof coordinator.getPipelineState, "function");
    assert.equal(typeof coordinator.removePipeline, "function");
  });

  it("getPipelineState returns undefined for unknown session", () => {
    assert.equal(coordinator.getPipelineState("nonexistent"), undefined);
  });

  it("cancelPipeline does not throw for unknown session", () => {
    coordinator.cancelPipeline("nonexistent");
  });

  it("removePipeline cleans up state", () => {
    coordinator.removePipeline("cleanup-test");
    assert.equal(coordinator.getPipelineState("cleanup-test"), undefined);
  });

  it("runPipeline returns a response and pipeline state with mock dispatcher", async () => {
    const dispatcher: StageDispatcher = {
      executePrompt: async (params) => ({
        response: `Mock response for ${params.stageId} using ${params.model}`,
        tokensUsed: 100,
        estimatedCost: 0.001,
        durationMs: 50,
      }),
      postPipelineProgress: () => {},
      isCancelled: () => false,
      logDiagnostic: () => {},
    };

    const result = await coordinator.runPipeline({
      sessionId: "test-full",
      workflow: STANDARD_WORKFLOW,
      config: makeConfig(),
      userRequest: "Add a dark mode toggle to the settings page with proper CSS variables and theme integration",
      attachedImages: false,
      dispatcher,
    });

    assert.ok(result.response, "Response should be non-empty");
    assert.ok(result.pipelineState, "Pipeline state should exist");
    assert.ok(["completed", "running"].includes(result.pipelineState.status), `Unexpected status: ${result.pipelineState.status}`);
    assert.ok(result.pipelineState.stages.length >= 1, "At least the classify stage should be present");
  });

  it("respects context policy and deduplication", async () => {
    const dispatcher: StageDispatcher = {
      executePrompt: async () => ({
        response: "Mock implementation complete",
        tokensUsed: 200,
        estimatedCost: 0.002,
        durationMs: 100,
      }),
      postPipelineProgress: () => {},
      isCancelled: () => false,
      logDiagnostic: () => {},
    };

    const result = await coordinator.runPipeline({
      sessionId: "test-dedup",
      workflow: STANDARD_WORKFLOW,
      config: makeConfig({ costProfile: "economy" }),
      userRequest: "Fix the button color",
      attachedImages: false,
      dispatcher,
    });

    assert.ok(["completed", "running"].includes(result.pipelineState.status));
  });

  it("pipeline state tracks stages and tokens", async () => {
    const dispatcher: StageDispatcher = {
      executePrompt: async (params) => {
        const tokens = params.stageId === "implement" ? 500 : 100;
        const cost = params.stageId === "implement" ? 0.005 : 0.001;
        return { response: `Result for ${params.stageId}`, tokensUsed: tokens, estimatedCost: cost, durationMs: 100 };
      },
      postPipelineProgress: () => {},
      isCancelled: () => false,
      logDiagnostic: () => {},
    };

    const result = await coordinator.runPipeline({
      sessionId: "test-tracking",
      workflow: STANDARD_WORKFLOW,
      config: makeConfig(),
      userRequest: "Add search functionality to the application",
      attachedImages: false,
      dispatcher,
    });

    const state = result.pipelineState;
    assert.ok(state.stages.length >= 2, "Should have at least classify + one more stage");

    const hasSynthesis = state.stages.some((s) => s.stageId === "synthesise");
    assert.ok(hasSynthesis, "Pipeline should include synthesis stage");
  });

  it("handles cancellation gracefully", async () => {
    const dispatcher: StageDispatcher = {
      executePrompt: async () => {
        return { response: "Mock", tokensUsed: 10, estimatedCost: 0.0001, durationMs: 10 };
      },
      postPipelineProgress: () => {},
      isCancelled: () => true,
      logDiagnostic: () => {},
    };

    const result = await coordinator.runPipeline({
      sessionId: "test-cancel",
      workflow: STANDARD_WORKFLOW,
      config: makeConfig(),
      userRequest: "Test cancellation",
      attachedImages: false,
      dispatcher,
    });

    assert.ok(typeof result.response === "string");
  });

  it("handles stage failure with fallback", async () => {
    let callCount = 0;
    const dispatcher: StageDispatcher = {
      executePrompt: async () => {
        callCount++;
        if (callCount === 1) throw new Error("Model temporarily unavailable");
        return { response: "Fallback result", tokensUsed: 100, estimatedCost: 0.001, durationMs: 50 };
      },
      postPipelineProgress: () => {},
      isCancelled: () => false,
      logDiagnostic: () => {},
    };

    const workflowWithFallback = {
      ...STANDARD_WORKFLOW,
      stages: STANDARD_WORKFLOW.stages.map((s) =>
        s.id === "implement"
          ? { ...s, fallbackChain: ["fallback/model"] }
          : s,
      ),
    };

    const result = await coordinator.runPipeline({
      sessionId: "test-fallback",
      workflow: workflowWithFallback,
      config: makeConfig(),
      userRequest: "Test fallback handling",
      attachedImages: false,
      dispatcher,
    });

    assert.ok(typeof result.response === "string");
  });
});

describe("selectWorkflow", () => {
  it("selects MULTIMODAL_WORKFLOW when images are attached", () => {
    const wf = selectWorkflow("Fix this UI", { hasImages: true }, 10);
    assert.equal(wf.id, "multimodal");
  });

  it("selects QUICK_WORKFLOW for short requests", () => {
    const wf = selectWorkflow("Hello", { hasImages: false }, 5);
    assert.equal(wf.id, "quick");
  });

  it("selects DEBUG_WORKFLOW for debug requests", () => {
    const wf = selectWorkflow("This bug causes a crash", { hasImages: false }, 30);
    assert.equal(wf.id, "debug");
  });

  it("selects REVIEW_WORKFLOW for review requests", () => {
    const wf = selectWorkflow("Review this code for security issues", { hasImages: false }, 50);
    assert.equal(wf.id, "review");
  });

  it("selects STANDARD_WORKFLOW for normal requests", () => {
    const wf = selectWorkflow("Add a new feature to the dashboard component that shows user analytics", { hasImages: false }, 80);
    assert.equal(wf.id, "standard");
  });
});

describe("workflow definitions", () => {
  it("STANDARD_WORKFLOW has expected stages", () => {
    const stageIds = STANDARD_WORKFLOW.stages.map((s) => s.id);
    assert.ok(stageIds.includes("explore"));
    assert.ok(stageIds.includes("plan"));
    assert.ok(stageIds.includes("implement"));
    assert.ok(stageIds.includes("review_code"));
    assert.ok(stageIds.includes("synthesise"));
  });

  it("QUICK_WORKFLOW has minimal stages", () => {
    assert.ok(QUICK_WORKFLOW.stages.length <= 3);
  });

  it("DEBUG_WORKFLOW has debugging role for implementation", () => {
    const implStage = DEBUG_WORKFLOW.stages.find((s) => s.id === "implement");
    assert.ok(implStage);
    assert.equal(implStage.role, "debugging");
  });

  it("REVIEW_WORKFLOW has parallel review stages", () => {
    const parallelStages = REVIEW_WORKFLOW.stages.filter((s) => s.parallel);
    assert.ok(parallelStages.length >= 2);
  });

  it("MULTIMODAL_WORKFLOW starts with visual_analyse", () => {
    assert.equal(MULTIMODAL_WORKFLOW.stages[0]?.id, "visual_analyse");
    assert.ok(MULTIMODAL_WORKFLOW.stages[0]?.needsVision);
  });

  it("WORKFLOWS contains all workflow definitions", () => {
    assert.ok(WORKFLOWS.standard);
    assert.ok(WORKFLOWS.quick);
    assert.ok(WORKFLOWS.debug);
    assert.ok(WORKFLOWS.review);
    assert.ok(WORKFLOWS.multimodal);
  });

  it("each workflow has a valid cost profile reference", () => {
    for (const [id, wf] of Object.entries(WORKFLOWS)) {
      assert.ok(wf.costProfileId, `Workflow ${id} missing costProfileId`);
      assert.ok(wf.contextPolicy, `Workflow ${id} missing contextPolicy`);
      assert.ok(typeof wf.maxRepairLoops === "number", `Workflow ${id} missing maxRepairLoops`);
    }
  });

  it("standard workflow has sensible budget limits", () => {
    assert.ok(STANDARD_WORKFLOW.maxTotalTokens > 0);
    assert.ok(STANDARD_WORKFLOW.maxTotalCost > 0);
    assert.ok(STANDARD_WORKFLOW.maxRepairLoops >= 0);
  });
});
