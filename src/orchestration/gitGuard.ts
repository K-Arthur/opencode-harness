import type { PersistedGitState } from "./workflowSnapshot";

// ─── Git Environment Types ─────────────────────────────────────────────────

export type GitGuardPolicy = "warn" | "pause_if_target_dirty" | "require_approval" | "require_clean" | "disabled" | "readonly";

export interface GitGuardConfig {
  policy: GitGuardPolicy;
  allowedForReadOnly: boolean;
  skipUntracked: boolean;
  maxDirtyFileWarnings: number;
}

export const DEFAULT_GUARD_CONFIG: GitGuardConfig = {
  policy: "pause_if_target_dirty",
  allowedForReadOnly: true,
  skipUntracked: true,
  maxDirtyFileWarnings: 10,
};

export interface GitStatusResult {
  branch: string;
  headSha: string;
  isDirty: boolean;
  modifiedFiles: string[];
  stagedFiles: string[];
  untrackedFiles: string[];
  conflictedFiles: string[];
  hasConflicts: boolean;
  hasUnresolvedMerge: boolean;
  isDetachedHead: boolean;
  hasSubmoduleChanges: boolean;
  recordedAt: number;
}

export interface GitGuardResult {
  ok: boolean;
  policyApplied: GitGuardPolicy;
  status: GitStatusResult;
  risks: GitGuardRisk[];
  action: GitGuardAction;
  message: string;
}

export interface GitGuardRisk {
  severity: "info" | "warning" | "blocking";
  category: "dirty_target" | "merge_conflict" | "detached_head" | "branch_changed" | "general_dirty" | "submodule" | "index_locked";
  file?: string;
  message: string;
}

export type GitGuardAction =
  | "proceed"
  | "pause_for_approval"
  | "block"
  | "skip_write_stages"
  | "warn_only";

// ─── Git Guard ─────────────────────────────────────────────────────────────

export class GitGuard {
  private config: GitGuardConfig;
  private gitRunner: GitRunner;

  constructor(config?: Partial<GitGuardConfig>, gitRunner?: GitRunner) {
    this.config = { ...DEFAULT_GUARD_CONFIG, ...config };
    this.gitRunner = gitRunner ?? new DefaultGitRunner();
  }

  /**
   * Set the guard policy.
   */
  setPolicy(policy: GitGuardPolicy): void {
    this.config.policy = policy;
  }

  /**
   * Check the repository state before a workflow stage.
   */
  async checkBeforeStage(
    repoPath: string | undefined,
    stageId: string,
    writeAllowed: boolean,
    targetFiles: string[],
    initialBaseline?: PersistedGitState,
  ): Promise<GitGuardResult> {
    // If no repo path, workspace is not a Git repo — skip guard
    if (!repoPath) {
      return {
        ok: true,
        policyApplied: "disabled",
        status: this.makeEmptyStatus(),
        risks: [],
        action: "proceed",
        message: "Not a Git repository",
      };
    }

    // Read-only policy or read-only stage
    if (this.config.policy === "disabled" || this.config.policy === "readonly") {
      return {
        ok: true,
        policyApplied: this.config.policy,
        status: this.makeEmptyStatus(),
        risks: [],
        action: "proceed",
        message: this.config.policy === "disabled" ? "Git guard disabled" : "Git guard in read-only mode",
      };
    }

    // Get the Git status
    let status: GitStatusResult;
    try {
      status = await this.gitRunner.getStatus(repoPath);
    } catch (err) {
      return {
        ok: true,
        policyApplied: "warn",
        status: this.makeEmptyStatus(),
        risks: [{
          severity: "info",
          category: "general_dirty",
          message: `Could not determine Git status: ${err instanceof Error ? err.message : String(err)}`,
        }],
        action: "proceed",
        message: "Git status unavailable — proceeding with caution",
      };
    }

    const risks: GitGuardRisk[] = [];

    // Check for high-risk states
    if (status.hasConflicts || status.hasUnresolvedMerge) {
      risks.push({
        severity: "blocking",
        category: "merge_conflict",
        message: `Unresolved merge conflict${status.conflictedFiles.length > 0 ? ` in ${status.conflictedFiles.join(", ")}` : ""}`,
      });
    }

    // Check if read-only stage is safe
    if (!writeAllowed && this.config.allowedForReadOnly) {
      return {
        ok: true,
        policyApplied: this.config.policy,
        status,
        risks: risks.filter((r) => r.category !== "general_dirty"),
        action: "proceed",
        message: "Read-only stage is safe to proceed",
      };
    }

    // Check target files against dirty state
    const normalizedTargets = targetFiles.map((f) => this.normalizeGitPath(f));
    const allDirtyFiles = [...status.modifiedFiles, ...status.stagedFiles];
    const dirtyTargets = allDirtyFiles.filter((f) =>
      normalizedTargets.some((t) => f.includes(t) || t.includes(f)),
    );

    if (dirtyTargets.length > 0) {
      for (const file of dirtyTargets.slice(0, this.config.maxDirtyFileWarnings)) {
        risks.push({
          severity: "warning",
          category: "dirty_target",
          file,
          message: `Target file "${file}" has uncommitted changes`,
        });
      }
    }

    // Check if working tree is generally dirty
    if (status.isDirty && this.config.policy !== "require_clean") {
      const nonTargetDirty = allDirtyFiles.filter((f) => !dirtyTargets.includes(f));
      if (nonTargetDirty.length > 0) {
        risks.push({
          severity: "info",
          category: "general_dirty",
          message: `${nonTargetDirty.length} file(s) have uncommitted changes outside target files`,
        });
      }
    }

    // Determine action based on policy
    return this.resolveAction(status, risks, writeAllowed);
  }

  /**
   * Get the full initial Git state for baseline recording.
   */
  async captureInitialState(repoPath: string | undefined): Promise<PersistedGitState | null> {
    if (!repoPath) return null;

    try {
      const status = await this.gitRunner.getStatus(repoPath);
      return {
        branch: status.branch,
        headSha: status.headSha,
        isDirty: status.isDirty,
        dirtyFiles: [...status.modifiedFiles, ...status.stagedFiles],
        hasConflicts: status.hasConflicts,
        hasUnresolvedMerge: status.hasUnresolvedMerge,
        recordedAt: Date.now(),
        baselineMark: `git-${Date.now()}`,
      };
    } catch {
      return null;
    }
  }

  /**
   * Re-check whether the Git state has changed since the baseline.
   * For example, the branch may have changed or new conflicts may have appeared.
   */
  async recheckState(
    repoPath: string | undefined,
    baseline: PersistedGitState,
  ): Promise<{ changed: boolean; newRisks: GitGuardRisk[] }> {
    if (!repoPath) return { changed: false, newRisks: [] };

    try {
      const status = await this.gitRunner.getStatus(repoPath);
      const newRisks: GitGuardRisk[] = [];

      if (status.branch !== baseline.branch) {
        newRisks.push({
          severity: "warning",
          category: "branch_changed",
          message: `Branch changed from "${baseline.branch}" to "${status.branch}"`,
        });
      }

      if (status.hasConflicts && !baseline.hasConflicts) {
        newRisks.push({
          severity: "blocking",
          category: "merge_conflict",
          message: "New merge conflicts detected",
        });
      }

      return {
        changed: newRisks.length > 0,
        newRisks,
      };
    } catch {
      return { changed: false, newRisks: [] };
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private resolveAction(
    status: GitStatusResult,
    risks: GitGuardRisk[],
    _writeAllowed: boolean,
  ): GitGuardResult {
    const blockingRisks = risks.filter((r) => r.severity === "blocking");
    const warningRisks = risks.filter((r) => r.severity === "warning");

    if (blockingRisks.length > 0) {
      return {
        ok: false,
        policyApplied: this.config.policy,
        status,
        risks,
        action: "block",
        message: `Blocking Git issues: ${blockingRisks.map((r) => r.message).join("; ")}`,
      };
    }

    switch (this.config.policy) {
      case "require_clean":
        if (status.isDirty) {
          return {
            ok: false,
            policyApplied: "require_clean",
            status,
            risks,
            action: "block",
            message: "Working tree must be clean",
          };
        }
        return {
          ok: true,
          policyApplied: "require_clean",
          status,
          risks,
          action: "proceed",
          message: "Working tree is clean",
        };

      case "require_approval":
        if (warningRisks.length > 0 || status.isDirty) {
          return {
            ok: false,
            policyApplied: "require_approval",
            status,
            risks,
            action: "pause_for_approval",
            message: "Dirty working tree requires approval",
          };
        }
        return {
          ok: true,
          policyApplied: "require_approval",
          status,
          risks,
          action: "proceed",
          message: "Working tree is clean",
        };

      case "pause_if_target_dirty":
        if (warningRisks.length > 0) {
          return {
            ok: false,
            policyApplied: "pause_if_target_dirty",
            status,
            risks,
            action: "pause_for_approval",
            message: `Target file(s) have uncommitted changes: ${warningRisks.map((r) => r.file).filter(Boolean).join(", ")}`,
          };
        }
        return {
          ok: true,
          policyApplied: "pause_if_target_dirty",
          status,
          risks: risks.filter((r) => r.severity !== "warning"),
          action: "proceed",
          message: "Target files are clean",
        };

      case "warn":
      default:
        return {
          ok: true,
          policyApplied: "warn",
          status,
          risks,
          action: "proceed",
          message: risks.length > 0
            ? `${risks.length} Git risk(s) identified — proceeding with warnings`
            : "No Git risks identified",
        };
    }
  }

  private normalizeGitPath(filePath: string): string {
    return filePath.replace(/\\/g, "/").toLowerCase();
  }

  private makeEmptyStatus(): GitStatusResult {
    return {
      branch: "unknown",
      headSha: "",
      isDirty: false,
      modifiedFiles: [],
      stagedFiles: [],
      untrackedFiles: [],
      conflictedFiles: [],
      hasConflicts: false,
      hasUnresolvedMerge: false,
      isDetachedHead: false,
      hasSubmoduleChanges: false,
      recordedAt: Date.now(),
    };
  }
}

// ─── Git Runner Interface ──────────────────────────────────────────────────

export interface GitRunner {
  getStatus(repoPath: string): Promise<GitStatusResult>;
}

export class DefaultGitRunner implements GitRunner {
  async getStatus(repoPath: string): Promise<GitStatusResult> {
    // Note: In a real VS Code extension, this would use
    // `vscode.extensions.getExtension("vscode.git")?.exports.getAPI(1)`
    // or shell out to `git status --porcelain=v2`.
    // For testability, this is abstracted through the interface.

    const { execSync } = await import("child_process");

    const branch = this.execGit(repoPath, "rev-parse --abbrev-ref HEAD").trim();
    const headSha = this.execGit(repoPath, "rev-parse HEAD").trim();
    const isDetachedHead = branch === "HEAD";

    // Use --porcelain=v2 for machine-readable output
    const porcelain = this.execGit(repoPath, "status --porcelain=v2");

    const modifiedFiles: string[] = [];
    const stagedFiles: string[] = [];
    const untrackedFiles: string[] = [];
    const conflictedFiles: string[] = [];

    for (const line of porcelain.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("1 ") || trimmed.startsWith("2 ")) {
        // Tracked file entry
        const parts = trimmed.split(" ");
        const xy = parts[1] ?? "";
        const path = parts[parts.length - 1] ?? "";

        if (xy.includes("U") || xy.includes("DD") || xy.includes("AA") || xy.includes("AU") || xy.includes("UA") || xy.includes("DU") || xy.includes("UD")) {
          conflictedFiles.push(path);
        } else if (xy[0] !== "." && xy[0] !== " ") {
          stagedFiles.push(path);
        }
        if (xy[1] !== "." && xy[1] !== " ") {
          modifiedFiles.push(path);
        }
      } else if (trimmed.startsWith("? ")) {
        untrackedFiles.push(trimmed.slice(2));
      } else if (trimmed.startsWith("u ")) {
        conflictedFiles.push(trimmed.slice(2));
      }
    }

    // Check for merge/rebase/cherry-pick/bisect in progress
    let hasUnresolvedMerge = false;
    try {
      const mergeHead = this.execGit(repoPath, "rev-parse MERGE_HEAD 2>/dev/null || true");
      hasUnresolvedMerge = mergeHead.trim().length > 0;
    } catch {
      hasUnresolvedMerge = false;
    }

    // Check submodules
    let hasSubmoduleChanges = false;
    try {
      const submodules = this.execGit(repoPath, "submodule status 2>/dev/null || true");
      hasSubmoduleChanges = submodules.trim().length > 0 && submodules.includes("+");
    } catch {
      hasSubmoduleChanges = false;
    }

    return {
      branch,
      headSha,
      isDirty: modifiedFiles.length > 0 || stagedFiles.length > 0 || conflictedFiles.length > 0,
      modifiedFiles,
      stagedFiles,
      untrackedFiles,
      conflictedFiles,
      hasConflicts: conflictedFiles.length > 0,
      hasUnresolvedMerge,
      isDetachedHead,
      hasSubmoduleChanges,
      recordedAt: Date.now(),
    };
  }

  private execGit(repoPath: string, args: string): string {
    const { execSync } = require("child_process");
    try {
      return execSync(`git ${args}`, { cwd: repoPath, encoding: "utf8", timeout: 10000 });
    } catch {
      return "";
    }
  }
}
