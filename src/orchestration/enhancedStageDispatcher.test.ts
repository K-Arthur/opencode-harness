import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createEnhancedStageDispatcher } from "./enhancedStageDispatcher";
import type { SessionManager } from "../session/SessionManager";
import type { StreamCallbacks } from "../chat/handlers/StreamCoordinatorTypes";
import type { WorkflowSnapshot } from "./stateMachine";

function makeFakeSessionManager(responseText = "stage result") {
  const calls: Array<{ sessionId: string; parts: unknown; options: unknown }> = [];
  const fake: Pick<SessionManager, "sendPrompt"> = {
    async sendPrompt(sessionId, parts, options) {
      calls.push({ sessionId, parts, options });
      return {
        info: { role: "assistant", id: "msg-1", time: { created: Date.now() } } as unknown as import("@opencode-ai/sdk/v2").Message,
        parts: [{ id: "p1", type: "text", text: responseText } as unknown as import("@opencode-ai/sdk/v2").Part],
      };
    },
  };
  return { fake: fake as unknown as SessionManager, calls };
}

describe("enhancedStageDispatcher", () => {
  it("executePrompt sends model override and agent, and returns response text", async () => {
    const { fake, calls } = makeFakeSessionManager("done");
    const posted: unknown[] = [];
    const callbacks: StreamCallbacks = {
      postMessage: (m: Record<string, unknown>) => posted.push(m),
      postRequestError: () => { /* noop */ },
    } as unknown as StreamCallbacks;
    const dispatcher = createEnhancedStageDispatcher({
      sessionManager: fake,
      callbacks,
      cliSessionId: "cli-1",
      tabId: "tab-1",
      abortController: new AbortController(),
    });

    const result = await dispatcher.executePrompt({
      sessionId: "cli-1",
      model: "anthropic/claude-sonnet-4-6",
      role: "planning",
      agent: "planner",
      systemPrompt: "sys",
      userPrompt: "user",
      stageId: "explore",
      stageRole: "planning",
    });

    assert.equal(result.response, "done");
    assert.equal(calls.length, 1);
    const opts = calls[0]!.options as { model?: { providerID: string; modelID: string }; agent?: string };
    assert.equal(opts.model?.providerID, "anthropic");
    assert.equal(opts.model?.modelID, "claude-sonnet-4-6");
    assert.equal(opts.agent, "planner");
  });

  it("postPipelineProgress emits a pipeline_progress message", () => {
    const { fake } = makeFakeSessionManager();
    const posted: unknown[] = [];
    const callbacks: StreamCallbacks = {
      postMessage: (m: Record<string, unknown>) => posted.push(m),
      postRequestError: () => { /* noop */ },
    } as unknown as StreamCallbacks;
    const dispatcher = createEnhancedStageDispatcher({
      sessionManager: fake,
      callbacks,
      cliSessionId: "cli-1",
      tabId: "tab-1",
      abortController: new AbortController(),
    });

    const snapshot: WorkflowSnapshot = {
      runId: "run-1",
      workflowId: "standard",
      workflowVersion: 1,
      state: "running",
      stages: [{
        stageId: "explore",
        state: "running",
        role: "planning",
        model: "fast/model",
        retryCount: 0,
        attemptHistory: [],
      }],
      currentStageId: "explore",
      startedAt: Date.now(),
      totalTokensUsed: 10,
      totalEstimatedCost: 0.0001,
      retryCount: 0,
      repairLoopCount: 0,
      costProfileId: "balanced",
      revision: 3,
    };
    dispatcher.postPipelineProgress(snapshot);

    assert.equal(posted.length, 1);
    const msg = posted[0] as { type: string; state?: { revision?: number; runId?: string; workflowState?: string } };
    assert.equal(msg.type, "pipeline_progress");
    assert.equal(msg.state?.revision, 3);
    assert.equal(msg.state?.runId, "run-1");
    assert.equal(msg.state?.workflowState, "running");
  });
});
