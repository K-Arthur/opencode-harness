/**
 * SpecService — manages specifications for spec-driven development.
 *
 * Specs are six-element structures (outcomes, scope, constraints, decisions,
 * task breakdown, verification criteria) that anchor the methodology
 * pipeline when a task is large enough to warrant spec-first execution.
 *
 * Storage is pluggable via the `SpecStore` interface so the service works
 * in both extension (vscode.Memento) and headless test contexts.
 */

import { ValidationResult } from './types.js';

// ─── Spec data model ───────────────────────────────────────────────────────

export interface TaskBreakdownItem {
  id: string;
  title: string;
  dependsOn: string[];
}

export interface VerificationCriterion {
  id: string;
  description: string;
  type: 'unit-test' | 'integration-test' | 'manual' | 'metric';
}

export interface SpecElements {
  outcomes: string[];
  scope: { inScope: string[]; outOfScope: string[] };
  constraints: string[];
  decisions: Record<string, string>;
  taskBreakdown: TaskBreakdownItem[];
  verificationCriteria: VerificationCriterion[];
}

export type SpecStatus = 'draft' | 'approved' | 'deprecated';

export interface Spec {
  id: string;
  projectId: string;
  version: string;
  elements: SpecElements;
  status: SpecStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpecStore {
  get(id: string): Spec | undefined;
  set(id: string, spec: Spec): void;
  delete(id: string): void;
  list(): Spec[];
}

/** In-memory default store. Suitable for tests and for non-persistent runs. */
export class InMemorySpecStore implements SpecStore {
  private specs = new Map<string, Spec>();

  get(id: string): Spec | undefined {
    return this.specs.get(id);
  }
  set(id: string, spec: Spec): void {
    this.specs.set(id, spec);
  }
  delete(id: string): void {
    this.specs.delete(id);
  }
  list(): Spec[] {
    return Array.from(this.specs.values());
  }
}

// ─── Validation ────────────────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateElements(elements: SpecElements): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(elements.outcomes) || elements.outcomes.length === 0) {
    return { ok: false, error: 'spec.elements.outcomes must contain at least one outcome' };
  }
  if (!elements.outcomes.every(isNonEmptyString)) {
    return { ok: false, error: 'spec.elements.outcomes entries must be non-empty strings' };
  }
  if (!elements.scope || !Array.isArray(elements.scope.inScope) || !Array.isArray(elements.scope.outOfScope)) {
    return { ok: false, error: 'spec.elements.scope must have inScope and outOfScope arrays' };
  }
  if (!Array.isArray(elements.constraints)) {
    return { ok: false, error: 'spec.elements.constraints must be an array' };
  }
  if (!elements.decisions || typeof elements.decisions !== 'object') {
    return { ok: false, error: 'spec.elements.decisions must be an object' };
  }
  if (!Array.isArray(elements.taskBreakdown)) {
    return { ok: false, error: 'spec.elements.taskBreakdown must be an array' };
  }
  for (const t of elements.taskBreakdown) {
    if (!isNonEmptyString(t.id) || !isNonEmptyString(t.title) || !Array.isArray(t.dependsOn)) {
      return { ok: false, error: `spec.elements.taskBreakdown items must have id, title, dependsOn (item id=${t.id ?? '?'})` };
    }
  }
  // Detect a depends-on cycle / unknown reference
  const ids = new Set(elements.taskBreakdown.map((t) => t.id));
  for (const t of elements.taskBreakdown) {
    for (const dep of t.dependsOn) {
      if (!ids.has(dep)) {
        return { ok: false, error: `task ${t.id} depends on unknown task ${dep}` };
      }
    }
  }
  if (!Array.isArray(elements.verificationCriteria)) {
    return { ok: false, error: 'spec.elements.verificationCriteria must be an array' };
  }
  return { ok: true };
}

// ─── SpecService ───────────────────────────────────────────────────────────

export interface CreateSpecInput {
  projectId: string;
  elements: SpecElements;
  status?: SpecStatus;
}

export class SpecService {
  private store: SpecStore;
  private history = new Map<string, Spec[]>(); // specId → versions (newest last)

  constructor(store: SpecStore = new InMemorySpecStore()) {
    this.store = store;
  }

  createSpec(input: CreateSpecInput): Spec {
    if (!isNonEmptyString(input.projectId)) {
      throw new Error('createSpec: projectId is required');
    }
    const check = validateElements(input.elements);
    if (!check.ok) throw new Error(`createSpec: ${check.error}`);

    const now = new Date();
    const spec: Spec = {
      id: this.generateId(input.projectId),
      projectId: input.projectId,
      version: '1.0.0',
      elements: structuredClone(input.elements),
      status: input.status ?? 'draft',
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(spec.id, spec);
    this.history.set(spec.id, [structuredClone(spec)]);
    return spec;
  }

  getSpec(specId: string): Spec | undefined {
    return this.store.get(specId);
  }

  updateSpec(specId: string, updates: Partial<SpecElements>): Spec {
    const current = this.store.get(specId);
    if (!current) throw new Error(`updateSpec: spec ${specId} not found`);

    const merged: SpecElements = {
      ...current.elements,
      ...updates,
      scope: updates.scope ?? current.elements.scope,
      decisions: { ...current.elements.decisions, ...(updates.decisions ?? {}) },
    };
    const check = validateElements(merged);
    if (!check.ok) throw new Error(`updateSpec: ${check.error}`);

    const next: Spec = {
      ...current,
      elements: merged,
      version: this.bumpVersion(current.version),
      updatedAt: new Date(),
    };
    this.store.set(specId, next);
    const hist = this.history.get(specId) ?? [];
    hist.push(structuredClone(next));
    this.history.set(specId, hist);
    return next;
  }

  deleteSpec(specId: string): void {
    this.store.delete(specId);
    this.history.delete(specId);
  }

  validateSpec(spec: Spec): ValidationResult<Spec> {
    const check = validateElements(spec.elements);
    if (!check.ok) return { success: false, error: check.error, attempts: 1 };
    return { success: true, data: spec, attempts: 1 };
  }

  getVersionHistory(specId: string): Spec[] {
    return (this.history.get(specId) ?? []).map((s) => structuredClone(s));
  }

  list(): Spec[] {
    return this.store.list();
  }

  private generateId(projectId: string): string {
    const slug = projectId.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    return `spec-${slug}-${Date.now().toString(36)}`;
  }

  private bumpVersion(version: string): string {
    const parts = version.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return '1.0.0';
    const [major = 0, minor = 0, patch = 0] = parts;
    return `${major}.${minor}.${patch + 1}`;
  }
}
