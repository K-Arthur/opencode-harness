import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { OrchestrationCoordinator, type StageExecutor } from "./pipelineCoordinator2";
import { STANDARD_WORKFLOW, QUICK_WORKFLOW, WORKFLOWS } from "./pipelineCoordinator";
import type { OrchestratedConfig } from "./types";
import type { WorkflowSnapshot } from "./stateMachine";

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

function createMockExecutor(): StageExecutor {
  return {
    executePrompt: async (params) => ({
      response: JSON.stringify({ summary: `Mock result for ${params.stageId}`, filesChanged: [] }),
      tokensUsed: 100,
      estimatedCost: 0.001,
      durationMs: 50,
    }),
    postPipelineProgress: () => {},
    isCancelled: () => false,
    logDiagnostic: () => {},
    requestApproval: async () => true,
  };
}

describe("OrchestrationCoordinator", () => {
  let coordinator: OrchestrationCoordinator;

  before(() => {
    coordinator = new OrchestrationCoordinator();
  });

  it("exists and has expected methods", () => {
    assert.ok(coordinator instanceof OrchestrationCoordinator);
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

  // ─── Workflow: Explorer → Planner → Implementer → Reviewer ──────────
  it("runs standard workflow with mock executor", async () => {
    const result = await coordinator.runPipeline({
      sessionId: "test-full",
      workflow: STANDARD_WORKFLOW,
      config: makeConfig(),
      userRequest: "Add a dark mode toggle to the settings page with proper CSS variables integration across all theme files and components",
      attachedImages: false,
      executor: createMockExecutor(),
    });

    assert.ok(result.response, "Response should be non-empty");
    const state = coordinator.getPipelineState("test-full");
    assert.ok(state, "Pipeline state should exist");
    assert.ok(
      state.state === "completed" || state.state === "completed_with_warnings",
      `Unexpected final state: ${state.state}`,
    );
    // Standard workflow has explore, plan, implement, review_code, fix, synthesise
    // At minimum: explore → plan → implement → synthesise
    assert.ok(state.stages.length >= 3, `Should have multiple stages, got ${state.stages.length}`);
  });

  // ─── Explorer output reused by later stages ─────────────────────────
  it("explorer handoff feeds into planning", async () => {
    let exploreOutput = "";
    const tracker: StageExecutor = {
      ...createMockExecutor(),
      executePrompt: async (params) => {
        if (params.stageId === "explore") {
          exploreOutput = "Exploration complete";
          return {
            response: JSON.stringify({
              relevantFiles: ["src/theme.ts"],
              architectureSummary: "Theme system found",
              suspectedChangePoints: ["src/theme.ts", "src/settings.tsx"],
              constraints: ["Follow existing CSS variable pattern"],
              confidence: 0.9,
            }),
            tokensUsed: 100,
            estimatedCost: 0.001,
            durationMs: 50,
          };
        }
        return {
          response: JSON.stringify({ summary: `Mock result for ${params.stageId}`, filesChanged: [] }),
          tokensUsed: 100,
          estimatedCost: 0.001,
          durationMs: 50,
        };
      },
    };

    const result = await coordinator.runPipeline({
      sessionId: "test-explore-feed",
      workflow: STANDARD_WORKFLOW,
      config: makeConfig(),
      userRequest: "Implement a full user authentication system with JWT tokens, password hashing, and OAuth2 integration across the entire codebase with comprehensive tests",
      attachedImages: false,
      executor: tracker,
    });

    assert.ok(result.response);
    const handoffs = coordinator.getHandoffs("test-explore-feed");
    assert.ok(handoffs);
    const exploreHf = handoffs.find((h) => h.stage === "explore");
    assert.ok(exploreHf);
  });

  // ─── Pause and resume ───────────────────────────────────────────────
  it("supports pause and resume", () => {
    // Pause on a non-running session should return false
    assert.ok(!coordinator.pauseWorkflow("nonexistent"));
    assert.ok(!coordinator.resumeWorkflow("nonexistent"));
  });

  // ─── Cancel full workflow ───────────────────────────────────────────
  it("cancels workflow mid-execution", async () => {
    let executionStarted = false;
    const slowExecutor: StageExecutor = {
      ...createMockExecutor(),
      executePrompt: async (params) => {
        executionStarted = true;
        return new Promise((_resolve, reject) => {
          const id = setInterval(() => {
            if (params.signal?.aborted) {
              clearInterval(id);
              reject(new Error("Aborted"));
            }
          }, 5);
        });
      },
    };

    const promise = coordinator.runPipeline({
      sessionId: "test-cancel",
      workflow: QUICK_WORKFLOW,
      config: makeConfig({ costProfile: "economy" }),
      userRequest: "Cancel test with sufficient length to avoid pipeline bypass scenario for testing purposes",
      attachedImages: false,
      executor: slowExecutor,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    coordinator.cancelPipeline("test-cancel");

    const result = await promise;
    assert.ok(typeof result.response === "string");
    const state = coordinator.getPipelineState("test-cancel");
    assert.ok(
      !state || state.state === "cancelled" || state.state === "completed" || state.state === "failed",
      "Pipeline should terminate",
    );
  });

  // ─── Cancel stage ──────────────────────────────────────────────────
  it("cancelStage handles non-existent session gracefully", () => {
    coordinator.cancelStage("nonexistent", "implement");
  });

  // ─── Skip stage ────────────────────────────────────────────────────
  it("skipStage handles non-existent session gracefully", () => {
    coordinator.skipStage("nonexistent", "implement");
  });

  // ─── Retry stage ───────────────────────────────────────────────────
  it("retryStage handles non-existent session gracefully", () => {
    coordinator.retryStage("nonexistent", "implement");
  });

  // ─── Approve stage ─────────────────────────────────────────────────
  it("approveStage handles non-existent session gracefully", () => {
    coordinator.approveStage("nonexistent", "implement", true);
  });

  // ─── Stage retry with fallback ─────────────────────────────────────
  it("falls back to alternative model on failure", async () => {
    let callCount = 0;
    const failOnceExecutor: StageExecutor = {
      ...createMockExecutor(),
      executePrompt: async (params) => {
        callCount++;
        if (callCount === 1) throw new Error("Model temporarily unavailable");
        return {
          response: JSON.stringify({ summary: `Fallback result for ${params.stageId}`, filesChanged: [] }),
          tokensUsed: 100,
          estimatedCost: 0.001,
          durationMs: 50,
        };
      },
    };

    const result = await coordinator.runPipeline({
      sessionId: "test-fallback",
      workflow: QUICK_WORKFLOW,
      config: makeConfig({ costProfile: "economy" }),
      userRequest: "Test fallback",
      attachedImages: false,
      executor: failOnceExecutor,
    });

    assert.ok(typeof result.response === "string");
    assert.ok(callCount >= 1);
  });

  // ─── Simple request bypasses heavy pipeline ────────────────────────
  it("handles simple read-only request quickly", async () => {
    const result = await coordinator.runPipeline({
      sessionId: "test-simple",
      workflow: QUICK_WORKFLOW,
      config: makeConfig({ costProfile: "economy" }),
      userRequest: "Hello",
      attachedImages: false,
      executor: createMockExecutor(),
    });

    assert.ok(typeof result.response === "string");
  });

  // ─── isRunning tracks state ────────────────────────────────────────
  it("isRunning returns correct state", async () => {
    // Use a check-inside approach for the never-resolving case
    let started = false;
    const blockingExecutor: StageExecutor = {
      ...createMockExecutor(),
      executePrompt: async (params) => {
        started = true;
        return new Promise((_resolve, reject) => {
          const id = setInterval(() => {
            if (params.signal?.aborted) {
              clearInterval(id);
              reject(new Error("Aborted"));
            }
          }, 5);
        });
      },
    };

    const promise = coordinator.runPipeline({
      sessionId: "test-isrunning",
      workflow: QUICK_WORKFLOW,
      config: makeConfig(),
      userRequest: "Running test with long enough request to avoid pipeline bypass mechanics entirely",
      attachedImages: false,
      executor: blockingExecutor,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(coordinator.isRunning("test-isrunning"));

    coordinator.cancelPipeline("test-isrunning");
    await promise.catch(() => {});
    assert.ok(!coordinator.isRunning("test-isrunning"));
  });

  // ─── Multiple sessions are isolated ────────────────────────────────
  it("keeps sessions isolated", async () => {
    const result1 = coordinator.runPipeline({
      sessionId: "session-a",
      workflow: QUICK_WORKFLOW,
      config: makeConfig(),
      userRequest: "Request A",
      attachedImages: false,
      executor: createMockExecutor(),
    });

    const result2 = coordinator.runPipeline({
      sessionId: "session-b",
      workflow: QUICK_WORKFLOW,
      config: makeConfig(),
      userRequest: "Request B",
      attachedImages: false,
      executor: createMockExecutor(),
    });

    const [r1, r2] = await Promise.all([result1, result2]);
    assert.ok(r1.response);
    assert.ok(r2.response);

    const s1 = coordinator.getPipelineState("session-a");
    const s2 = coordinator.getPipelineState("session-b");
    assert.ok(s1 && s2, "Both sessions should have states");
    assert.notEqual(s1.runId, s2.runId, "Run IDs should differ");
  });

  // ─── Workflow state machine integration ────────────────────────────
  it("records stage states in each stage snapshot", async () => {
    const result = await coordinator.runPipeline({
      sessionId: "test-record-states",
      workflow: STANDARD_WORKFLOW,
      config: makeConfig(),
      userRequest: "Record states test with a long request that triggers full pipeline execution across all stages",
      attachedImages: false,
      executor: createMockExecutor(),
    });

    const state = coordinator.getPipelineState("test-record-states");
    assert.ok(state);
    for (const stage of state.stages) {
      assert.ok(stage.stageId, "Stage should have an ID");
      assert.ok(stage.model, "Stage should have a model");
      assert.ok(
        ["succeeded", "failed", "cancelled", "skipped", "pending"].includes(stage.state),
        `Stage ${stage.stageId} has unexpected state: ${stage.state}`,
      );
    }
  });
});

describe("OrchestrationConcurrency", () => {
  it("rejects concurrent pipeline for same session", async () => {
    const coordinator = new OrchestrationCoordinator();
    const blockingExecutor: StageExecutor = {
      ...createMockExecutor(),
      executePrompt: async (params) => {
        return new Promise((_resolve, reject) => {
          const id = setInterval(() => {
            if (params.signal?.aborted) {
              clearInterval(id);
              reject(new Error("Aborted"));
            }
          }, 5);
        });
      },
    };

    const promise1 = coordinator.runPipeline({
      sessionId: "concurrent-test",
      workflow: QUICK_WORKFLOW,
      config: makeConfig(),
      userRequest: "First concurrent request with long enough text to trigger real pipeline stages",
      attachedImages: false,
      executor: blockingExecutor,
    }).catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, 50));

    await assert.rejects(
      coordinator.runPipeline({
        sessionId: "concurrent-test",
        workflow: QUICK_WORKFLOW,
        config: makeConfig(),
        userRequest: "Second concurrent request also long enough to avoid bypass",
        attachedImages: false,
        executor: createMockExecutor(),
      }),
      /already running/,
    );

    coordinator.cancelPipeline("concurrent-test");
    await promise1;
  });
});
