/**
 * TDDProgressTracker — Tracks TDD orchestration progress across sessions
 * and emits subagent activity updates to the webview.
 *
 * Integrates with WebviewEventRouter to provide real-time TDD phase
 * indicators, test counts, and domain badges in the subagent panel.
 */

import { TDDOrchestrator } from '../skills/TDDOrchestrator';
import { SubagentActivity, DecomposedTask } from '../skills/types';

interface TDDSessionState {
  orchestrator: TDDOrchestrator;
  task: DecomposedTask;
  startedAt: number;
  lastUpdated: number;
}

class TDDProgressTracker {
  private sessions = new Map<string, TDDSessionState>();
  private postMessage: (msg: Record<string, unknown>) => void;

  constructor(options: { postMessage: (msg: Record<string, unknown>) => void }) {
    this.postMessage = options.postMessage;
  }

  /**
   * Start tracking TDD progress for a session.
   */
  async startSession(
    sessionId: string,
    task: DecomposedTask,
  ): Promise<void> {
    const orchestrator = new TDDOrchestrator();
    await orchestrator.start(task);

    this.sessions.set(sessionId, {
      orchestrator,
      task,
      startedAt: Date.now(),
      lastUpdated: Date.now(),
    });

    this.emitActivities(sessionId);
  }

  /**
   * Execute a TDD cycle and emit updated activities.
   */
  async executeCycle(
    sessionId: string,
    dispatchSubagent: (prompt: string, task: DecomposedTask) => Promise<{
      agentId: string;
      status: 'completed' | 'failed';
      output: string;
      filesModified: string[];
    }>,
    runTests: (testFiles: string[], options?: { coverage?: boolean }) => Promise<{
      passed: boolean;
      output: string;
      testCount: number;
      passCount: number;
      failCount: number;
      coveragePercent?: number;
    }>,
  ): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`No TDD session found for ${sessionId}`);
    }

    await state.orchestrator.executeCycle(dispatchSubagent, runTests);
    state.lastUpdated = Date.now();

    this.emitActivities(sessionId);
  }

  /**
   * Get current activities for a session.
   */
  getActivities(sessionId: string): SubagentActivity[] {
    const state = this.sessions.get(sessionId);
    if (!state) return [];

    const activity = state.orchestrator.getActivity();
    return activity ? [activity] : [];
  }

  /**
   * Get final metrics after TDD completes.
   */
  getMetrics(sessionId: string) {
    const state = this.sessions.get(sessionId);
    if (!state) return null;
    return state.orchestrator.getMetrics();
  }

  /**
   * Complete and clean up a TDD session.
   */
  completeSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    // Emit final activities before cleanup
    this.emitActivities(sessionId);

    this.sessions.delete(sessionId);
  }

  /**
   * Cancel and clean up a TDD session.
   */
  cancelSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.orchestrator.reset();
    this.sessions.delete(sessionId);
  }

  /**
   * Check if a session is being tracked.
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get all active session IDs.
   */
  getActiveSessions(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Emit subagent activities to the webview.
   */
  private emitActivities(sessionId: string): void {
    const activities = this.getActivities(sessionId);
    this.postMessage({
      type: 'subagent_activities',
      activities,
      sessionId,
    });
  }
}

export { TDDProgressTracker };
export type { TDDSessionState };
