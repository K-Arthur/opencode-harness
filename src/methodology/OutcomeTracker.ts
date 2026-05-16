/**
 * Outcome Tracker — tracks implicit feedback signals from user behavior
 * to improve methodology selection over time.
 *
 * Signals tracked:
 * - re-send: user re-sent the same prompt (suggests poor result)
 * - rollback: user rolled back changes (suggests poor quality)
 * - model_switch: user manually switched model (wrong tier recommendation)
 * - approval: user explicitly approved (via positive signal)
 * - ignore: user moved on without interacting (neutral)
 *
 * Data is stored in VS Code globalState as a lightweight event log.
 */

import type { MethodologyId, TaskType, ModelTier } from './types.js';

export type OutcomeSignal = 're-send' | 'rollback' | 'model-switch' | 'approval' | 'ignore';

export interface OutcomeEvent {
  methodology: MethodologyId;
  taskType: TaskType;
  recommendedTier: ModelTier;
  signal: OutcomeSignal;
  timestamp: number;
  signature: string;
}

export interface MethodologyOutcomeStats {
  methodology: MethodologyId;
  taskType: TaskType;
  totalEvents: number;
  approvalRate: number;
  rollbackRate: number;
  reSendRate: number;
  modelSwitchRate: number;
}

const STORAGE_KEY = 'opencode-methodology-outcomes';
const MAX_EVENTS = 500;
const PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export class OutcomeTracker {
  private events: OutcomeEvent[] = [];
  private saveFn: ((events: OutcomeEvent[]) => void) | null = null;

  constructor(savedEvents?: OutcomeEvent[]) {
    if (savedEvents) {
      this.events = savedEvents;
    }
  }

  /**
   * Set the persistence function. Called after each mutation.
   * For VS Code: pass globalState.update.bind(globalState, STORAGE_KEY)
   */
  setPersistenceFn(fn: (events: OutcomeEvent[]) => void): void {
    this.saveFn = fn;
  }

  record(event: OutcomeEvent): void {
    this.events.push(event);
    this.prune();
    this.persist();
  }

  getStats(methodology: MethodologyId, taskType: TaskType): MethodologyOutcomeStats {
    const relevant = this.events.filter(e => e.methodology === methodology && e.taskType === taskType);
    const total = relevant.length;
    if (total === 0) {
      return { methodology, taskType, totalEvents: 0, approvalRate: 0.5, rollbackRate: 0, reSendRate: 0, modelSwitchRate: 0 };
    }
    const count = (s: OutcomeSignal) => relevant.filter(e => e.signal === s).length;
    return {
      methodology,
      taskType,
      totalEvents: total,
      approvalRate: count('approval') / total,
      rollbackRate: count('rollback') / total,
      reSendRate: count('re-send') / total,
      modelSwitchRate: count('model-switch') / total,
    };
  }

  /**
   * Get an adjustment factor for methodology confidence based on outcomes.
   * Returns -0.2 to +0.1 adjustment.
   */
  getConfidenceAdjustment(methodology: MethodologyId, taskType: TaskType): number {
    const stats = this.getStats(methodology, taskType);
    if (stats.totalEvents < 3) return 0;

    const negativeRate = stats.rollbackRate + stats.reSendRate + stats.modelSwitchRate;
    if (negativeRate > 0.6) return -0.2;
    if (negativeRate > 0.4) return -0.15;
    if (negativeRate > 0.2) return -0.1;
    if (stats.approvalRate > 0.7) return 0.1;
    return 0;
  }

  getAllEvents(): OutcomeEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
    this.persist();
  }

  private prune(): void {
    const cutoff = Date.now() - PRUNE_AGE_MS;
    this.events = this.events.filter(e => e.timestamp > cutoff);
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }
  }

  private persist(): void {
    if (this.saveFn) {
      this.saveFn(this.events);
    }
  }
}
