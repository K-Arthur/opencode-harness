import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WorkflowStateMachine,
  transitionWorkflow,
  transitionStage,
  isWorkflowTerminal,
  isWorkflowActive,
  isStageTerminal,
  isStageActive,
  classifyStateError,
  type WorkflowState,
  type StageState,
} from "./stateMachine";

describe("transitionWorkflow", () => {
  const VALID_TRANSITIONS: [WorkflowState, WorkflowState][] = [
    ["created", "classifying"],
    ["created", "running"],
    ["created", "cancelled"],
    ["classifying", "running"],
    ["classifying", "failed"],
    ["running", "waiting_for_approval"],
    ["running", "paused"],
    ["running", "completed"],
    ["running", "completed_with_warnings"],
    ["running", "failed"],
    ["running", "cancelling"],
    ["waiting_for_approval", "running"],
    ["waiting_for_approval", "cancelled"],
    ["paused", "running"],
    ["paused", "cancelled"],
    ["cancelling", "cancelled"],
    ["recovering", "running"],
    ["recovering", "failed"],
  ];

  for (const [from, to] of VALID_TRANSITIONS) {
    it(`allows ${from} → ${to}`, () => {
      assert.equal(transitionWorkflow(from, to), to);
    });
  }

  const INVALID_TRANSITIONS: [WorkflowState, WorkflowState][] = [
    ["completed", "running"],
    ["cancelled", "running"],
    ["failed", "running"],
    ["created", "completed"],
    ["running", "created"],
    ["waiting_for_approval", "completed"],
  ];

  for (const [from, to] of INVALID_TRANSITIONS) {
    it(`rejects ${from} → ${to}`, () => {
      assert.equal(transitionWorkflow(from, to), from);
    });
  }
});

describe("transitionStage", () => {
  it("allows pending → ready", () => {
    assert.equal(transitionStage("pending", "ready"), "ready");
  });

  it("allows running → succeeded", () => {
    assert.equal(transitionStage("running", "succeeded"), "succeeded");
  });

  it("allows running → failed → retrying → starting → running", () => {
    let s: StageState = "running";
    s = transitionStage(s, "failed");
    assert.equal(s, "failed");
    s = transitionStage(s, "retrying");
    assert.equal(s, "retrying");
    s = transitionStage(s, "starting");
    assert.equal(s, "starting");
    s = transitionStage(s, "running");
    assert.equal(s, "running");
  });

  it("rejects succeeded → running", () => {
    assert.equal(transitionStage("succeeded", "running"), "succeeded");
  });

  it("rejects failed → running (must go via retrying)", () => {
    assert.equal(transitionStage("failed", "running"), "failed");
  });

  it("rejects skipped → cancelled (skipped is terminal)", () => {
    assert.equal(transitionStage("skipped", "cancelled"), "skipped");
  });
});

describe("WorkflowStateMachine", () => {
  it("starts at created", () => {
    const m = new WorkflowStateMachine("run-1", "standard", 1, "balanced");
    assert.equal(m.getState(), "created");
  });

  it("transitions correctly", () => {
    const m = new WorkflowStateMachine("run-1", "standard");
    assert.ok(m.transition("classifying"));
    assert.equal(m.getState(), "classifying");
    assert.ok(m.transition("running"));
    assert.ok(m.transition("completed"));
    assert.equal(m.getState(), "completed");
    assert.ok(!m.transition("running"));
  });

  it("tracks stage states", () => {
    const m = new WorkflowStateMachine("run-1", "standard");
    assert.equal(m.getStageState("plan"), "pending");
    assert.ok(m.transitionStage("plan", "ready"));
    assert.equal(m.getStageState("plan"), "ready");
    assert.ok(m.transitionStage("plan", "starting", { role: "planning", model: "test/model" }));
    assert.ok(m.transitionStage("plan", "running"));
    assert.ok(m.transitionStage("plan", "succeeded", { tokensUsed: 100, estimatedCost: 0.001, durationMs: 500 }));
    const snap = m.getStageSnapshot("plan");
    assert.ok(snap);
    assert.equal(snap.state, "succeeded");
    assert.equal(snap.tokensUsed, 100);
  });

  it("returns undefined for unknown stage", () => {
    const m = new WorkflowStateMachine("run-1", "standard");
    assert.equal(m.getStageSnapshot("nonexistent"), undefined);
  });

  it("records attempt history", () => {
    const m = new WorkflowStateMachine("run-1", "standard");
    m.transitionStage("implement", "ready", { role: "implementation", model: "test/model" });
    m.transitionStage("implement", "starting");
    m.recordAttempt("implement", "test/model");
    const snap = m.getStageSnapshot("implement");
    assert.ok(snap);
    assert.ok(snap.attemptHistory.length >= 1);
  });

  it("bumps revision on workflow and stage transitions", () => {
    const m = new WorkflowStateMachine("run-1", "standard");
    const before = m.snapshot().revision;
    m.transition("classifying");
    m.transition("running");
    m.transitionStage("explore", "ready", { role: "planning", model: "fast/model" });
    m.transitionStage("explore", "succeeded");
    assert.ok(m.snapshot().revision > before);
  });

  it("snapshot captures full state", () => {
    const m = new WorkflowStateMachine("run-1", "standard", 1, "economy");
    m.transition("classifying");
    m.transition("running");
    m.transitionStage("explore", "ready", { role: "planning", model: "fast/model" });
    m.transitionStage("explore", "succeeded");
    const snap = m.snapshot({ currentStageId: "explore" });
    assert.equal(snap.runId, "run-1");
    assert.equal(snap.workflowId, "standard");
    assert.equal(snap.workflowVersion, 1);
    assert.equal(snap.costProfileId, "economy");
    assert.equal(snap.state, "running");
    assert.equal(snap.currentStageId, "explore");
    assert.ok(snap.stages.length >= 1);
    assert.equal(snap.stages[0]?.stageId, "explore");
  });

  it("getAllStages returns all stages", () => {
    const m = new WorkflowStateMachine("run-1", "standard");
    m.transitionStage("a", "ready");
    m.transitionStage("b", "ready");
    m.transitionStage("a", "succeeded");
    assert.equal(m.getAllStages().length, 2);
  });
});

describe("isWorkflowTerminal", () => {
  it("cancelled is terminal", () => assert.ok(isWorkflowTerminal("cancelled")));
  it("failed is terminal", () => assert.ok(isWorkflowTerminal("failed")));
  it("completed is terminal", () => assert.ok(isWorkflowTerminal("completed")));
  it("completed_with_warnings is terminal", () => assert.ok(isWorkflowTerminal("completed_with_warnings")));
  it("running is not terminal", () => assert.ok(!isWorkflowTerminal("running")));
});

describe("isWorkflowActive", () => {
  it("running is active", () => assert.ok(isWorkflowActive("running")));
  it("completed is not active", () => assert.ok(!isWorkflowActive("completed")));
});

describe("isStageTerminal", () => {
  it("succeeded is terminal", () => assert.ok(isStageTerminal("succeeded")));
  it("failed is terminal", () => assert.ok(isStageTerminal("failed")));
  it("cancelled is terminal", () => assert.ok(isStageTerminal("cancelled")));
  it("skipped is terminal", () => assert.ok(isStageTerminal("skipped")));
  it("running is not terminal", () => assert.ok(!isStageTerminal("running")));
});

describe("isStageActive", () => {
  it("running is active", () => assert.ok(isStageActive("running")));
  it("succeeded is not active", () => assert.ok(!isStageActive("succeeded")));
});

describe("classifyStateError", () => {
  it("timeout is transient", () => assert.equal(classifyStateError("request timed out"), "transient"));
  it("rate limit is transient", () => assert.equal(classifyStateError("429 Too Many Requests"), "transient"));
  it("network error is transient", () => assert.equal(classifyStateError("ECONNREFUSED"), "transient"));
  it("auth error is terminal", () => assert.equal(classifyStateError("authentication failed"), "terminal"));
  it("quota error is terminal", () => assert.equal(classifyStateError("quota exceeded"), "terminal"));
  it("context overflow is terminal", () => assert.equal(classifyStateError("context overflow"), "terminal"));
  it("stale error is stale", () => assert.equal(classifyStateError("request not found in transcript"), "stale"));
  it("unknown error falls through", () => assert.equal(classifyStateError("something unexpected"), "unknown"));
});
