export interface ExecutionPlanNode {
  id: string;
  type: string;
  params?: Record<string, unknown>;
  tool?: string;
  dependencies?: string[];
  budget?: number;
  idempotencyKey?: string;
}

export interface ExecutionPlanEdge {
  from: string;
  to: string;
  outputKey?: string;
}

export interface ExecutionPlan {
  nodes: ExecutionPlanNode[];
  edges: ExecutionPlanEdge[];
  totalBudget?: number;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  error: string | null;
}

export interface ValidationResult {
  valid: boolean;
  checks: CheckResult[];
}

export class PlanValidator {
  private async checkNodesExist(plan: ExecutionPlan): Promise<void> {
    if (plan.nodes.length === 0) {
      throw new Error('Plan must contain at least one node');
    }
  }

  private async checkEdgesTypeCompatible(plan: ExecutionPlan): Promise<void> {
    const nodeIds = new Set(plan.nodes.map((n) => n.id));
    for (const edge of plan.edges) {
      if (!nodeIds.has(edge.from)) {
        throw new Error(`Edge references non-existent source node "${edge.from}"`);
      }
      if (!nodeIds.has(edge.to)) {
        throw new Error(`Edge references non-existent target node "${edge.to}"`);
      }
    }
  }

  private async checkDagAcyclic(plan: ExecutionPlan): Promise<void> {
    const adj = new Map<string, Set<string>>();
    for (const node of plan.nodes) {
      adj.set(node.id, new Set());
    }
    for (const edge of plan.edges) {
      adj.get(edge.from)?.add(edge.to);
    }

    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    for (const node of plan.nodes) {
      color.set(node.id, WHITE);
    }

    const dfs = (id: string): boolean => {
      color.set(id, GRAY);
      const neighbors = adj.get(id);
      if (neighbors) {
        for (const neighbor of Array.from(neighbors)) {
          const c = color.get(neighbor);
          if (c === GRAY) return true;
          if (c === WHITE && dfs(neighbor)) return true;
        }
      }
      color.set(id, BLACK);
      return false;
    };

    for (const node of plan.nodes) {
      if (color.get(node.id) === WHITE) {
        if (dfs(node.id)) {
          throw new Error('Plan contains cyclic dependencies');
        }
      }
    }
  }

  private async checkParamsPresent(plan: ExecutionPlan): Promise<void> {
    for (const node of plan.nodes) {
      if (node.tool !== undefined && node.params === undefined) {
        throw new Error(`Node "${node.id}" has tool "${node.tool}" but no params`);
      }
    }
  }

  private async checkBudgetSatisfied(plan: ExecutionPlan): Promise<void> {
    if (plan.totalBudget === undefined) return;
    const sum = plan.nodes.reduce((acc, n) => acc + (n.budget ?? 0), 0);
    if (sum > plan.totalBudget) {
      throw new Error(
        `Node budgets total ${sum} exceeds plan totalBudget of ${plan.totalBudget}`,
      );
    }
  }

  private async checkSafetyCompliant(plan: ExecutionPlan): Promise<void> {
    const mutating = new Set(['write', 'delete']);
    for (const node of plan.nodes) {
      if (mutating.has(node.type) && node.idempotencyKey === undefined) {
        throw new Error(
          `Node "${node.id}" has type "${node.type}" but no idempotencyKey`,
        );
      }
    }
  }

  private async checkIdempotencyKeys(plan: ExecutionPlan): Promise<void> {
    const seen = new Set<string>();
    for (const node of plan.nodes) {
      if (node.idempotencyKey !== undefined) {
        if (seen.has(node.idempotencyKey)) {
          throw new Error(
            `Duplicate idempotencyKey "${node.idempotencyKey}"`,
          );
        }
        seen.add(node.idempotencyKey);
      }
    }
  }

  async validate(plan: ExecutionPlan): Promise<ValidationResult> {
    const checks: [string, (p: ExecutionPlan) => Promise<void>][] = [
      ['nodes_exist', (p) => this.checkNodesExist(p)],
      ['edges_type_compatible', (p) => this.checkEdgesTypeCompatible(p)],
      ['dag_acyclic', (p) => this.checkDagAcyclic(p)],
      ['params_present', (p) => this.checkParamsPresent(p)],
      ['budget_satisfied', (p) => this.checkBudgetSatisfied(p)],
      ['safety_compliant', (p) => this.checkSafetyCompliant(p)],
      ['idempotency_keys', (p) => this.checkIdempotencyKeys(p)],
    ];

    const results = await Promise.all(
      checks.map(async ([name, fn]): Promise<CheckResult> => {
        try {
          await fn(plan);
          return { name, passed: true, error: null };
        } catch (error: unknown) {
          return { name, passed: false, error: String(error) };
        }
      }),
    );

    return {
      valid: results.every((r) => r.passed),
      checks: results,
    };
  }
}
