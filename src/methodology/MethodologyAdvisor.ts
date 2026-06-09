/**
 * MethodologyAdvisor — the synchronous facade the prompt pipeline uses
 * to choose a development methodology and shape the prompt the user is
 * about to send.
 *
 * Why a separate class:
 * - MethodologyOrchestrator requires a model executor + model profiles and
 *   runs the full cascade pipeline. That is the right tool when we own
 *   the model calls; here we are sending a prompt through the opencode
 *   server and only need the *advice* (classification + methodology + a
 *   prompt addendum to inject).
 * - The advisor is pure, synchronous, cheap, and easy to unit test.
 *
 * Edge cases handled:
 * - Empty / whitespace-only / very short input → skip with `null`
 * - Slash commands and steer prompts (start with "/") → skip
 * - Disabled via config → skip
 * - User explicitly opted out via per-tab flag → skip
 * - Truncates very long input before classification (10k char ceiling)
 * - Idempotent: same input + config → same advice
 */

import { TaskClassifier } from './TaskClassifier.js';
import { MethodologyCatalog } from './MethodologyCatalog.js';
import type {
  TaskClassification,
  MethodologySelection,
  PromptStrategy,
  MethodologyId,
} from './types.js';

/**
 * A function that given the user's prompt returns the set of enabled skill
 * names the system thinks are relevant. Returning `[]` means "none" — the
 * advisor will simply omit the suggestion line. The advisor never throws if
 * this hook throws — failures are swallowed (best-effort).
 */
export type SkillHinter = (text: string) => string[];

const MIN_INPUT_LENGTH = 12;            // skip trivial prompts ("hi", "thanks")
const MAX_CLASSIFY_LENGTH = 10_000;     // ceiling on classifier input
const ADDENDUM_PREFIX = '[methodology]'; // grep marker for logs / debugging

export interface AdviseOptions {
  hasImageAttachment?: boolean;
  selectedCode?: string;
  openFiles?: string[];
  /** When false the advisor returns null without classifying. Default true. */
  enabled?: boolean;
}

export interface MethodologyAdvice {
  classification: TaskClassification;
  selection: MethodologySelection;
  /** A short, model-readable string to PREPEND as a separate text part. */
  promptAddendum: string;
  /** A short, human-readable string the webview shows next to the message. */
  label: string;
  /** Stable cache key derivable from input + selection (for telemetry/dedup). */
  signature: string;
}

const METHODOLOGY_LABELS: Record<MethodologyId, string> = {
  'direct-execution': 'Direct',
  'spec-first': 'Spec-first',
  'spec-anchored': 'Spec-anchored',
  'bmad-lite': 'BMAD-lite',
  'bmad-full': 'BMAD',
  'supervisor-workers': 'Supervisor + workers',
  'cascade-review': 'Cascade review',
  'multimodal-pipeline': 'Multimodal pipeline',
  'quick-flow': 'Quick flow',
  'research-hypothesis': 'Research → hypothesis',
};

const STRATEGY_HINTS: Record<PromptStrategy, string> = {
  direct: 'Answer directly and concisely.',
  'hierarchical-cot':
    'Reason step by step. Write a brief PLAN first, then execute each STEP, then a final ANSWER. Be concrete.',
  'plan-then-execute':
    'Two phases. PHASE 1 — PLAN: enumerate steps, dependencies, risks. PHASE 2 — EXECUTE: follow the plan, flag deviations.',
  'iterative-refinement':
    'Four passes: (1) obvious issues, (2) logic/edge cases, (3) quality/naming/complexity, (4) security. Report findings per pass.',
  'multi-agent-debate':
    'Consider tradeoffs from four perspectives: simplicity, scalability, maintainability, performance. Recommend the best balance.',
  'cross-modal':
    'Analyze the visual input first (layout, components, design tokens), then generate code that reproduces it, then self-validate.',
  'schema-first':
    'Respond as JSON matching the schema exactly. No prose outside the JSON. No extra fields. All required fields present.',
  'few-shot-strong': 'Follow the pattern shown in the examples.',
  'conversational-decompose':
    'Break the task into sub-tasks. Confirm each sub-task is correct before moving on.',
};

export class MethodologyAdvisor {
  private classifier: TaskClassifier;
  private catalog: MethodologyCatalog;
  private enabled: boolean;
  private skillHinter?: SkillHinter;

  constructor(opts: { classifier?: TaskClassifier; catalog?: MethodologyCatalog; enabled?: boolean; skillHinter?: SkillHinter } = {}) {
    this.classifier = opts.classifier ?? new TaskClassifier();
    this.catalog = opts.catalog ?? new MethodologyCatalog();
    this.enabled = opts.enabled ?? true;
    this.skillHinter = opts.skillHinter;
  }

  setSkillHinter(hinter: SkillHinter | undefined): void {
    this.skillHinter = hinter;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Produce methodology advice for an outgoing user prompt.
   * Returns `null` when the advisor declines to act (so callers can no-op).
   */
  advise(rawText: string, options: AdviseOptions = {}): MethodologyAdvice | null {
    const enabled = options.enabled ?? this.enabled;
    if (!enabled) return null;

    const text = (rawText ?? '').trim();
    if (!text) return null;
    // Skip slash commands and steer prompts — they have their own routing.
    if (text.startsWith('/')) return null;

    // For very short prompts without an image, methodology selection is noise.
    if (text.length < MIN_INPUT_LENGTH && !options.hasImageAttachment) return null;

    const classifyInput = text.length > MAX_CLASSIFY_LENGTH
      ? text.slice(0, MAX_CLASSIFY_LENGTH)
      : text;

    const classification = this.classifier.classify(classifyInput, {
      hasImageAttachment: options.hasImageAttachment ?? false,
      selectedCode: options.selectedCode,
      openFiles: options.openFiles,
    });
    const selection = this.catalog.select(classification);

    const triggeredSkills = this.collectTriggeredSkills(classifyInput);
    const promptAddendum = this.renderAddendum(selection, triggeredSkills);
    const label = this.renderLabel(selection);
    const signature = this.makeSignature(classifyInput, selection);

    return { classification, selection, promptAddendum, label, signature };
  }

  private collectTriggeredSkills(text: string): string[] {
    if (!this.skillHinter) return [];
    try {
      const skills = this.skillHinter(text);
      if (!Array.isArray(skills)) return [];
      // Deduplicate while preserving order; cap at 4 so the addendum stays short.
      const seen = new Set<string>();
      const out: string[] = [];
      for (const s of skills) {
        if (typeof s !== 'string') continue;
        const trimmed = s.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        out.push(trimmed);
        if (out.length >= 4) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  private renderAddendum(selection: MethodologySelection, triggeredSkills: string[]): string {
    const hint = STRATEGY_HINTS[selection.promptStrategy] ?? STRATEGY_HINTS['hierarchical-cot'];
    const methodology = METHODOLOGY_LABELS[selection.methodology] ?? selection.methodology;
    const skillLine = triggeredSkills.length > 0
      ? `\nRelevant skills: ${triggeredSkills.join(', ')}.`
      : '';
    // Single self-contained block; opencode passes this as a text part so we
    // don't want to overwhelm the user's actual prompt.
    return `${ADDENDUM_PREFIX} ${methodology} · ${selection.promptStrategy}\n${hint}${skillLine}`;
  }

  private renderLabel(selection: MethodologySelection): string {
    return METHODOLOGY_LABELS[selection.methodology] ?? selection.methodology;
  }

  private makeSignature(text: string, selection: MethodologySelection): string {
    // Cheap stable digest — not crypto, just for dedup/telemetry keys.
    let h = 0;
    for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    return `${selection.methodology}:${selection.promptStrategy}:${(h >>> 0).toString(36)}`;
  }
}

export const METHODOLOGY_ADDENDUM_PREFIX = ADDENDUM_PREFIX;
