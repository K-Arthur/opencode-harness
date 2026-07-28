import type { StageDefinition, WorkflowDefinition, PipelineStageId } from "./types";
import type { StageState } from "./stateMachine";

// ─── Graph Types ───────────────────────────────────────────────────────────

export interface DependencyNode {
  stageId: string;
  dependsOn: string[];
  optionalDeps: string[];
  parallel: boolean;
  readOnly: boolean;
  writeAllowed: boolean;
  category: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: "required" | "optional";
}

export interface ValidationError {
  code: "CYCLE" | "MISSING_DEP" | "SELF_DEP" | "DUPLICATE_ID" | "INVALID_PARALLEL" | "WRITE_CONFLICT";
  message: string;
  nodes?: string[];
}

export interface ScheduleBatch {
  batchIndex: number;
  stageIds: string[];
  parallel: boolean;
  allReadOnly: boolean;
  allWriteSafe: boolean;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: DependencyEdge[];
  topologicalLayers: ScheduleBatch[];
  validationErrors: ValidationError[];
  valid: boolean;
}

// ─── Graph Builder ─────────────────────────────────────────────────────────

export function buildDependencyGraph(workflow: WorkflowDefinition): DependencyGraph {
  const nodes = new Map<string, DependencyNode>();
  const edges: DependencyEdge[] = [];
  const errors: ValidationError[] = [];

  // Build nodes
  const seenIds = new Set<string>();

  for (const stage of workflow.stages) {
    if (seenIds.has(stage.id)) {
      errors.push({ code: "DUPLICATE_ID", message: `Duplicate stage ID: ${stage.id}`, nodes: [stage.id] });
    }
    seenIds.add(stage.id);

    if (stage.dependsOn?.includes(stage.id)) {
      errors.push({ code: "SELF_DEP", message: `Stage ${stage.id} depends on itself`, nodes: [stage.id] });
    }

    nodes.set(stage.id, {
      stageId: stage.id,
      dependsOn: stage.dependsOn ?? [],
      optionalDeps: [],
      parallel: stage.parallel ?? false,
      readOnly: stage.readOnly ?? false,
      writeAllowed: stage.writeAllowed ?? false,
      category: stage.role,
    });
  }

  // Build edges
  const allStageIds = new Set(workflow.stages.map((s) => s.id));

  for (const stage of workflow.stages) {
    for (const dep of stage.dependsOn ?? []) {
      if (!allStageIds.has(dep)) {
        errors.push({
          code: "MISSING_DEP",
          message: `Stage "${stage.id}" depends on "${dep}" which does not exist in the workflow`,
          nodes: [stage.id, dep],
        });
        continue;
      }
      edges.push({ from: dep, to: stage.id, type: "required" });
    }
  }

  // Check for write conflicts among parallel stages
  const parallelGroups = groupParallelStages(nodes, workflow.stages);
  for (const group of parallelGroups) {
    const writeStages = group.filter((id) => {
      const n = nodes.get(id);
      return n?.writeAllowed;
    });
    if (writeStages.length > 1) {
      errors.push({
        code: "WRITE_CONFLICT",
        message: `Parallel write-capable stages: ${writeStages.join(", ")}. Write stages must be serialized.`,
        nodes: writeStages,
      });
    }
  }

  // Check for cycles
  const cycleErrors = detectCycles(nodes, edges);
  errors.push(...cycleErrors);

  // Compute topological layers
  const topologicalLayers = errors.length === 0 || errors.every((e) => e.code === "WRITE_CONFLICT")
    ? computeLayers(nodes, edges)
    : [];

  return {
    nodes,
    edges,
    topologicalLayers,
    validationErrors: errors,
    valid: errors.length === 0 || errors.every((e) => e.code === "WRITE_CONFLICT"),
  };
}

// ─── Cycle Detection ───────────────────────────────────────────────────────

function detectCycles(nodes: Map<string, DependencyNode>, edges: DependencyEdge[]): ValidationError[] {
  const adjacency = new Map<string, string[]>();
  for (const [id] of nodes) {
    adjacency.set(id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const [id] of nodes) color.set(id, WHITE);

  const inCycle = new Set<string>();

  function dfs(node: string): boolean {
    color.set(node, GRAY);
    for (const neighbor of adjacency.get(node) ?? []) {
      const nc = color.get(neighbor) ?? WHITE;
      if (nc === GRAY) {
        inCycle.add(node);
        inCycle.add(neighbor);
        return true;
      }
      if (nc === WHITE && dfs(neighbor)) {
        inCycle.add(node);
        return true;
      }
    }
    color.set(node, BLACK);
    return false;
  }

  for (const [id] of nodes) {
    if (color.get(id) === WHITE) dfs(id);
  }

  if (inCycle.size > 0) {
    return [{
      code: "CYCLE",
      message: `Dependency cycle detected involving stages: ${Array.from(inCycle).join(", ")}`,
      nodes: Array.from(inCycle),
    }];
  }

  return [];
}

// ─── Group Parallel Stages ─────────────────────────────────────────────────

function groupParallelStages(nodes: Map<string, DependencyNode>, stages: StageDefinition[]): string[][] {
  const groups: string[][] = [];
  const processed = new Set<string>();

  for (const stage of stages) {
    if (processed.has(stage.id)) continue;
    const node = nodes.get(stage.id);
    if (!node || !node.parallel) {
      processed.add(stage.id);
      continue;
    }

    // Find all stages in this parallel group (same dependency set)
    const group = [stage.id];
    const depSet = new Set(node.dependsOn);
    for (const other of stages) {
      if (other.id === stage.id || processed.has(other.id)) continue;
      const otherNode = nodes.get(other.id);
      if (!otherNode?.parallel) continue;
      const otherDepSet = new Set(otherNode.dependsOn);
      if (setsEqual(depSet, otherDepSet)) {
        group.push(other.id);
        processed.add(other.id);
      }
    }

    groups.push(group);
    processed.add(stage.id);
  }

  return groups;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

// ─── Layer Computation ─────────────────────────────────────────────────────

function computeLayers(nodes: Map<string, DependencyNode>, edges: DependencyEdge[]): ScheduleBatch[] {
  // Kahn's algorithm with layer grouping
  const inDegree = new Map<string, number>();
  for (const [id] of nodes) inDegree.set(id, 0);
  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  // Build adjacency for downstream tracking
  const downstream = new Map<string, string[]>();
  for (const [id] of nodes) downstream.set(id, []);
  for (const edge of edges) {
    downstream.get(edge.from)?.push(edge.to);
  }

  const layers: ScheduleBatch[] = [];
  let batchIndex = 0;

  // Find nodes with no dependencies
  let ready = new Set<string>();
  for (const [id, deg] of inDegree) {
    if (deg === 0) ready.add(id);
  }

  while (ready.size > 0) {
    const batch = Array.from(ready).sort();
    const allReadOnly = batch.every((id) => nodes.get(id)?.readOnly);
    const allWriteSafe = batch.every((id) => {
      const n = nodes.get(id);
      return n?.readOnly || !n?.writeAllowed;
    });

    // Within a batch, parallel = all declared parallel OR cost profile says so
    const anyParallel = batch.some((id) => nodes.get(id)?.parallel);

    layers.push({
      batchIndex,
      stageIds: batch,
      parallel: anyParallel && allWriteSafe,
      allReadOnly,
      allWriteSafe,
    });

    // Reduce in-degree for downstream stages
    const nextReady = new Set<string>();
    for (const id of batch) {
      for (const downstreamId of downstream.get(id) ?? []) {
        const newDeg = (inDegree.get(downstreamId) ?? 1) - 1;
        inDegree.set(downstreamId, newDeg);
        if (newDeg === 0) {
          nextReady.add(downstreamId);
        }
      }
    }

    ready = nextReady;
    batchIndex++;
  }

  return layers;
}

// ─── Readiness Check ───────────────────────────────────────────────────────

export function getReadyStages(
  layers: ScheduleBatch[],
  stageStates: Map<string, StageState>,
  skipRequested: Set<string>,
  currentLayerIndex: number,
): ScheduleBatch | null {
  for (let i = currentLayerIndex; i < layers.length; i++) {
    const batch = layers[i]!;
    const allReady = batch.stageIds.every((id) => {
      if (skipRequested.has(id)) return true;
      const state = stageStates.get(id);
      return state === "pending" || state === "ready" || state === "blocked";
    });
    if (allReady) return batch;
  }
  return null;
}

export function hasUnresolvedDependencies(
  stageId: string,
  nodes: Map<string, DependencyNode>,
  stageStates: Map<string, StageState>,
): boolean {
  const node = nodes.get(stageId);
  if (!node) return true;

  for (const dep of node.dependsOn) {
    const depState = stageStates.get(dep);
    if (!depState || depState === "pending" || depState === "blocked" || depState === "ready") {
      return true;
    }
  }

  return false;
}

export function invalidateDownstreamStages(
  stageId: string,
  nodes: Map<string, DependencyNode>,
  edges: DependencyEdge[],
  stageStates: Map<string, StageState>,
): string[] {
  const invalidated: string[] = [];

  // Find all stages that depend on this one
  const traverse = (currentId: string) => {
    for (const edge of edges) {
      if (edge.from === currentId) {
        const target = edge.to;
        if (!invalidated.includes(target)) {
          invalidated.push(target);
          traverse(target);
        }
      }
    }
  };

  traverse(stageId);

  // Mark them
  for (const id of invalidated) {
    stageStates.set(id, "pending");
  }

  return invalidated;
}

export function resolveDependencyIds(workflow: WorkflowDefinition): string[] {
  const graph = buildDependencyGraph(workflow);
  const result: string[] = [];

  for (const layer of graph.topologicalLayers) {
    for (const id of layer.stageIds) {
      if (!result.includes(id)) result.push(id);
    }
  }

  // Add any stages not in the graph
  for (const stage of workflow.stages) {
    if (!result.includes(stage.id)) result.push(stage.id);
  }

  return result;
}
