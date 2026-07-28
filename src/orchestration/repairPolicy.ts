import type { PersistedRepairState } from "./workflowSnapshot";

// ─── Repair Types ──────────────────────────────────────────────────────────

export interface RepairPolicy {
  enabled: boolean;
  maxPasses: number;
  maximumEstimatedCost?: number;
  maximumTokens?: number;
  requireUserApprovalAfter: number;
  stopOnRepeatedFindings: boolean;
  stopOnNoProgress: boolean;
}

export const DEFAULT_REPAIR_POLICY: RepairPolicy = {
  enabled: true,
  maxPasses: 3,
  requireUserApprovalAfter: 2,
  stopOnRepeatedFindings: true,
  stopOnNoProgress: true,
};

export interface RepairFinding {
  id: string;
  category: string;
  file: string;
  symbol?: string;
  description: string;
  evidence: string;
  normalizedDescription: string;
}

export interface RepairProgress {
  pass: number;
  findingsBefore: number;
  findingsAfter: number;
  filesChanged: string[];
  resolvedFindingIds: string[];
  newFindingIds: string[];
  sameAsPrevious: boolean;
  noProgress: boolean;
  budgetExhausted: boolean;
  maxPassesReached: boolean;
}

// ─── Finding Identity ──────────────────────────────────────────────────────

export function computeFindingId(finding: {
  category: string;
  file: string;
  symbol?: string;
  normalizedDescription: string;
}): string {
  const parts = [finding.category, finding.file, finding.symbol ?? "", finding.normalizedDescription];
  const input = parts.join("|").toLowerCase().replace(/\s+/g, " ");
  // Simple hash
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `finding-${Math.abs(hash).toString(36)}`;
}

export function normalizeFindingDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/`[^`]+`/g, "IDENTIFIER")
    .replace(/\d+/g, "N")
    .replace(/[""'']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

// ─── Repair State Machine ──────────────────────────────────────────────────

export class RepairStateMachine {
  private state: PersistedRepairState;
  private policy: RepairPolicy;
  private previousFindingIds = new Set<string>();
  private previousFindingCount = 0;

  constructor(policy?: Partial<RepairPolicy>, initialState?: Partial<PersistedRepairState>) {
    this.policy = { ...DEFAULT_REPAIR_POLICY, ...policy };
    this.state = {
      repairPasses: 0,
      maxRepairPasses: this.policy.maxPasses,
      blockedFindingIds: [],
      noProgressCount: 0,
      stoppedEarly: false,
      ...initialState,
    };
  }

  /**
   * Evaluate whether a repair pass should be attempted.
   */
  shouldRepair(findings: RepairFinding[], changedFiles: string[]): RepairProgress {
    const pass = this.state.repairPasses + 1;

    // Check max passes
    const maxPassesReached = pass > this.policy.maxPasses;
    if (maxPassesReached) {
      this.state.stoppedEarly = true;
      return {
        pass,
        findingsBefore: findings.length,
        findingsAfter: findings.length,
        filesChanged: changedFiles,
        resolvedFindingIds: [],
        newFindingIds: [],
        sameAsPrevious: false,
        noProgress: true,
        budgetExhausted: false,
        maxPassesReached: true,
      };
    }

    if (!this.policy.enabled) {
      return {
        pass,
        findingsBefore: findings.length,
        findingsAfter: findings.length,
        filesChanged: changedFiles,
        resolvedFindingIds: [],
        newFindingIds: [],
        sameAsPrevious: false,
        noProgress: false,
        budgetExhausted: false,
        maxPassesReached: false,
      };
    }

    // No findings — no repair needed
    if (findings.length === 0) {
      return {
        pass,
        findingsBefore: 0,
        findingsAfter: 0,
        filesChanged: changedFiles,
        resolvedFindingIds: [],
        newFindingIds: [],
        sameAsPrevious: false,
        noProgress: true,
        budgetExhausted: false,
        maxPassesReached: false,
      };
    }

    // Detect repeated findings
    const currentFindingIds = new Set(findings.map((f) => f.id));
    const sameAsPrevious = this.policy.stopOnRepeatedFindings &&
      this.previousFindingIds.size > 0 &&
      setsEqual(currentFindingIds, this.previousFindingIds);

    if (sameAsPrevious) {
      this.state.noProgressCount++;
      this.state.stoppedEarly = true;
      return {
        pass,
        findingsBefore: findings.length,
        findingsAfter: findings.length,
        filesChanged: changedFiles,
        resolvedFindingIds: [],
        newFindingIds: [],
        sameAsPrevious: true,
        noProgress: true,
        budgetExhausted: false,
        maxPassesReached: false,
      };
    }

    // Detect no progress (findings didn't decrease, files didn't change)
    const noProgress = this.policy.stopOnNoProgress &&
      this.previousFindingCount > 0 &&
      findings.length >= this.previousFindingCount &&
      changedFiles.length === 0;

    if (noProgress) {
      this.state.noProgressCount++;
      if (this.state.noProgressCount >= 2) {
        this.state.stoppedEarly = true;
        return {
          pass,
          findingsBefore: findings.length,
          findingsAfter: findings.length,
          filesChanged: changedFiles,
          resolvedFindingIds: [],
          newFindingIds: [],
          sameAsPrevious: false,
          noProgress: true,
          budgetExhausted: false,
          maxPassesReached: false,
        };
      }
    }

    // Resolve finding IDs
    const resolvedFindingIds: string[] = [];
    if (this.previousFindingIds.size > 0) {
      for (const id of this.previousFindingIds) {
        if (!currentFindingIds.has(id)) {
          resolvedFindingIds.push(id);
        }
      }
    }

    const newFindingIds: string[] = [];
    for (const id of currentFindingIds) {
      if (!this.previousFindingIds.has(id)) {
        newFindingIds.push(id);
      }
    }

    return {
      pass,
      findingsBefore: this.previousFindingCount,
      findingsAfter: findings.length,
      filesChanged: changedFiles,
      resolvedFindingIds,
      newFindingIds,
      sameAsPrevious: false,
      noProgress: false,
      budgetExhausted: false,
      maxPassesReached: false,
    };
  }

  /**
   * Record that a repair pass was executed.
   */
  recordPass(progress: RepairProgress): void {
    this.state.repairPasses = progress.pass;
    if (progress.resolvedFindingIds.length > 0) {
      this.state.blockedFindingIds = this.state.blockedFindingIds.filter(
        (id) => !progress.resolvedFindingIds.includes(id),
      );
    }
  }

  /**
   * Record the set of finding IDs after a repair. These are used for
   * repeated-finding detection on the next pass.
   */
  recordFindings(findings: RepairFinding[]): void {
    this.previousFindingIds = new Set(findings.map((f) => f.id));
    this.previousFindingCount = findings.length;
  }

  /**
   * Check if user approval is needed before the next repair pass.
   */
  needsUserApproval(): boolean {
    return this.policy.requireUserApprovalAfter > 0 &&
      this.state.repairPasses >= this.policy.requireUserApprovalAfter;
  }

  /**
   * Get current state for persistence.
   */
  getState(): PersistedRepairState {
    return { ...this.state };
  }

  /**
   * Reset the repair loop.
   */
  reset(): void {
    this.state.repairPasses = 0;
    this.state.noProgressCount = 0;
    this.state.stoppedEarly = false;
    this.previousFindingIds.clear();
    this.previousFindingCount = 0;
  }

  /**
   * Check if the repair loop is active (has done at least one pass).
   */
  isActive(): boolean {
    return this.state.repairPasses > 0;
  }

  /**
   * Check if the repair loop has been stopped early.
   */
  isStoppedEarly(): boolean {
    return this.state.stoppedEarly;
  }

  /**
   * Get the current pass number.
   */
  getCurrentPass(): number {
    return this.state.repairPasses;
  }

  /**
   * Get max passes.
   */
  getMaxPasses(): number {
    return this.state.maxRepairPasses;
  }

  /**
   * Get remaining budget (passes).
   */
  getRemainingPasses(): number {
    return this.state.maxRepairPasses - this.state.repairPasses;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}
