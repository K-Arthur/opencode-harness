/**
 * Methodology Catalog — defines the selection rules that map task
 * classifications to development methodologies.
 *
 * Rules are ordered by specificity (most specific first). The first matching
 * rule wins. If no rule matches, a default methodology is returned.
 */

import {
  MethodologyId,
  MethodologyRule,
  MethodologySelection,
  PromptStrategy,
  TaskClassification,
  ModelTier,
  ExecutionPattern,
} from './types.js';
import type { OutcomeTracker } from './OutcomeTracker.js';
import type { Spec } from './SpecService.js';

// ─── Rule Definitions ───────────────────────────────────────────────────────

export const METHODOLOGY_RULES: MethodologyRule[] = [
  // ── Quick fixes (lowest complexity, single file) ──────────────────────
  {
    when: {
      taskTypes: ['quick-fix'],
      maxComplexity: 0.3,
      maxFileScope: 0.3,
    },
    methodology: 'quick-flow',
    recommendedTier: 'B',
    promptStrategy: 'direct',
    executionPattern: 'sequential',
  },

  // ── UI from image (requires vision) ───────────────────────────────────
  {
    when: {
      taskTypes: ['ui-from-image'],
      needsVision: true,
    },
    methodology: 'multimodal-pipeline',
    recommendedTier: 'S',
    promptStrategy: 'cross-modal',
    executionPattern: 'sequential',
  },

  // ── Architecture design (high complexity) ─────────────────────────────
  {
    when: {
      taskTypes: ['architect'],
      minComplexity: 0.6,
    },
    methodology: 'supervisor-workers',
    recommendedTier: 'S',
    promptStrategy: 'plan-then-execute',
    executionPattern: 'parallel',
  },

  // ── Code review (cascade through tiers) ───────────────────────────────
  {
    when: {
      taskTypes: ['review'],
    },
    methodology: 'cascade-review',
    recommendedTier: 'A',
    promptStrategy: 'iterative-refinement',
    executionPattern: 'sequential',
  },

  // ── Debugging (research → hypothesis → fix) ───────────────────────────
  {
    when: {
      taskTypes: ['debug'],
      minComplexity: 0.4,
    },
    methodology: 'research-hypothesis',
    recommendedTier: 'A',
    promptStrategy: 'plan-then-execute',
    executionPattern: 'hybrid',
  },

  // ── Greenfield complex generation (bmad-full) ─────────────────────────
  {
    when: {
      taskTypes: ['generate'],
      minComplexity: 0.7,
      minFileScope: 0.6,
    },
    methodology: 'bmad-full',
    recommendedTier: 'S',
    promptStrategy: 'plan-then-execute',
    executionPattern: 'parallel',
  },

  // ── Complex feature generation (multi-file, high complexity) ──────────
  {
    when: {
      taskTypes: ['generate'],
      minComplexity: 0.5,
      minFileScope: 0.4,
    },
    methodology: 'bmad-lite',
    recommendedTier: 'S',
    promptStrategy: 'plan-then-execute',
    executionPattern: 'hybrid',
  },

  // ── Refactoring with existing spec (spec-anchored) ────────────────────
  {
    when: {
      taskTypes: ['refactor'],
      minComplexity: 0.4,
      maxComplexity: 0.7,
    },
    methodology: 'spec-anchored',
    recommendedTier: 'A',
    promptStrategy: 'hierarchical-cot',
    executionPattern: 'sequential',
  },

  // ── Complex but contained generation (high complexity, low file scope) ─
  {
    when: {
      taskTypes: ['generate'],
      minComplexity: 0.6,
      maxFileScope: 0.4,
    },
    methodology: 'bmad-lite',
    recommendedTier: 'S',
    promptStrategy: 'plan-then-execute',
    executionPattern: 'hybrid',
  },

  // ── Simple generation (low complexity, single file) ───────────────────
  {
    when: {
      taskTypes: ['generate'],
      maxComplexity: 0.3,
      maxFileScope: 0.3,
    },
    methodology: 'direct-execution',
    recommendedTier: 'B',
    promptStrategy: 'direct',
    executionPattern: 'sequential',
  },

  // ── Medium complexity generation (spec-first) ─────────────────────────
  {
    when: {
      taskTypes: ['generate'],
      minComplexity: 0.3,
      maxComplexity: 0.6,
    },
    methodology: 'spec-first',
    recommendedTier: 'A',
    promptStrategy: 'hierarchical-cot',
    executionPattern: 'sequential',
  },

  // ── Refactoring (medium complexity) ───────────────────────────────────
  {
    when: {
      taskTypes: ['refactor'],
      minComplexity: 0.3,
    },
    methodology: 'spec-first',
    recommendedTier: 'A',
    promptStrategy: 'hierarchical-cot',
    executionPattern: 'sequential',
  },

  // ── Test generation ───────────────────────────────────────────────────
  {
    when: {
      taskTypes: ['test'],
    },
    methodology: 'spec-first',
    recommendedTier: 'B',
    promptStrategy: 'schema-first',
    executionPattern: 'sequential',
  },

  // ── Documentation ─────────────────────────────────────────────────────
  {
    when: {
      taskTypes: ['document'],
    },
    methodology: 'direct-execution',
    recommendedTier: 'B',
    promptStrategy: 'direct',
    executionPattern: 'sequential',
  },

  // ── Explanation ───────────────────────────────────────────────────────
  {
    when: {
      taskTypes: ['explain'],
    },
    methodology: 'direct-execution',
    recommendedTier: 'B',
    promptStrategy: 'direct',
    executionPattern: 'sequential',
  },

  // ── Default fallback ──────────────────────────────────────────────────
  {
    when: {},
    methodology: 'spec-first',
    recommendedTier: 'A',
    promptStrategy: 'hierarchical-cot',
    executionPattern: 'sequential',
  },
];

// ─── Prompt Strategy Templates ──────────────────────────────────────────────

export const PROMPT_TEMPLATES: Record<PromptStrategy, {
  systemPrompt: string;
  userPromptTemplate: string;
  maxTokens?: number;
  temperature?: number;
}> = {
  direct: {
    systemPrompt: 'You are a coding assistant. Respond directly and concisely.',
    userPromptTemplate: '{{task}}',
  },

  'hierarchical-cot': {
    systemPrompt:
      'You are a development assistant. For complex tasks, follow this structure:\n\n' +
      'PLAN: List the steps needed to complete the task.\n' +
      'STEP 1: [Execute first step]\n' +
      'STEP 2: [Execute second step]\n' +
      '...\n' +
      'ANSWER: [Final result]\n\n' +
      'Be specific and concrete. Do not skip steps.',
    userPromptTemplate: '{{task}}',
  },

  'plan-then-execute': {
    systemPrompt:
      'You are a development assistant. First, create a detailed plan. ' +
      'Then, execute the plan step by step.\n\n' +
      'PHASE 1 — PLAN:\n' +
      '- List all steps\n' +
      '- Identify dependencies\n' +
      '- Note potential risks\n\n' +
      'PHASE 2 — EXECUTE:\n' +
      '- Follow the plan exactly\n' +
      '- Report any deviations',
    userPromptTemplate: '{{task}}',
  },

  'iterative-refinement': {
    systemPrompt:
      'You are a code reviewer. Analyze the code thoroughly.\n\n' +
      'PASS 1 — OBVIOUS ISSUES: Check for syntax errors, missing imports, typos.\n' +
      'PASS 2 — LOGIC ISSUES: Check for bugs, edge cases, error handling.\n' +
      'PASS 3 — QUALITY ISSUES: Check for naming, complexity, duplication, patterns.\n' +
      'PASS 4 — SECURITY: Check for vulnerabilities, injection, auth issues.\n\n' +
      'Report findings per pass.',
    userPromptTemplate: '{{task}}',
  },

  'multi-agent-debate': {
    systemPrompt:
      'You are an architecture advisor. Consider multiple perspectives:\n\n' +
      'PERSPECTIVE 1 — SIMPLICITY: What is the simplest solution?\n' +
      'PERSPECTIVE 2 — SCALABILITY: What scales best?\n' +
      'PERSPECTIVE 3 — MAINTAINABILITY: What is easiest to maintain?\n' +
      'PERSPECTIVE 4 — PERFORMANCE: What is fastest?\n\n' +
      'Weigh tradeoffs and recommend the best approach.',
    userPromptTemplate: '{{task}}',
  },

  'cross-modal': {
    systemPrompt:
      'You are a UI development assistant. Analyze the visual input and generate code.\n\n' +
      'STEP 1 — ANALYZE: Describe the layout, components, colors, typography.\n' +
      'STEP 2 — EXTRACT: Identify design tokens (spacing, colors, fonts).\n' +
      'STEP 3 — GENERATE: Write code that reproduces the visual design.\n' +
      'STEP 4 — VALIDATE: Check that the code matches the visual input.',
    userPromptTemplate: '{{task}}\n\n{{image_description}}',
  },

  'schema-first': {
    systemPrompt:
      'Return your response as JSON matching the provided schema exactly.\n' +
      'Do not include any text outside the JSON object.\n' +
      'Do not add fields not in the schema.\n' +
      'Do not omit required fields.',
    userPromptTemplate: '{{task}}\n\nSchema:\n{{schema}}',
  },

  'few-shot-strong': {
    systemPrompt:
      'You are a development assistant. Follow the pattern shown in the examples.\n\n' +
      'EXAMPLES:\n{{examples}}\n\n' +
      'Now complete the task following the same pattern.',
    userPromptTemplate: '{{task}}',
  },

  'conversational-decompose': {
    systemPrompt:
      'You are a development assistant. Break complex tasks into smaller sub-tasks.\n' +
      'Address each sub-task one at a time.\n' +
      'After completing each sub-task, confirm before moving to the next.',
    userPromptTemplate: '{{task}}',
  },
};

// ─── Constants ───────────────────────────────────────────────────────────────

const CONFIDENCE_BOUNDARY_THRESHOLD = 0.1;
const BASE_CONFIDENCE = 0.8;
const AMBIGUITY_PENALTY_FACTOR = 0.2;
const MIN_CONFIDENCE = 0.3;
const MAX_CONFIDENCE = 1.0;

// ─── Methodology Catalog ────────────────────────────────────────────────────

export class MethodologyCatalog {
  private rules: MethodologyRule[];
  private outcomeTracker: OutcomeTracker | null = null;

  constructor(rules: MethodologyRule[] = METHODOLOGY_RULES) {
    this.rules = rules;
  }

  setOutcomeTracker(tracker: OutcomeTracker): void {
    this.outcomeTracker = tracker;
  }

  /**
   * Select the best methodology for a given task classification.
   * Returns the most specific matching rule.
   * Applies adaptive confidence adjustment based on historical outcomes.
   */
  select(classification: TaskClassification): MethodologySelection {
    const rule = this.rules
      .filter((candidate) => this.matchesRule(candidate, classification))
      .sort((a, b) => this.ruleSpecificity(b) - this.ruleSpecificity(a))[0];

    if (rule) {
      let confidence = this.calculateConfidence(rule, classification);

      if (this.outcomeTracker) {
        confidence += this.outcomeTracker.getConfidenceAdjustment(rule.methodology, classification.type);
        confidence = Math.max(0.1, Math.min(1.0, confidence));
      }

      return {
        methodology: rule.methodology,
        promptStrategy: rule.promptStrategy,
        executionPattern: rule.executionPattern,
        recommendedTier: rule.recommendedTier,
        confidence,
        matchedRule: rule,
      };
    }

    return {
      methodology: 'spec-first',
      promptStrategy: 'hierarchical-cot',
      executionPattern: 'sequential',
      recommendedTier: 'A',
      confidence: 0.5,
      matchedRule: null,
    };
  }


  /**
   * Check if a rule matches a task classification.
   */
  private matchesRule(
    rule: MethodologyRule,
    classification: TaskClassification
  ): boolean {
    const { when } = rule;
    const { type, complexity, modalities } = classification;

    if (when.taskTypes && when.taskTypes.length > 0) {
      if (!when.taskTypes.includes(type)) return false;
    }

    if (when.minComplexity !== undefined) {
      const overall = this.calculateOverallComplexity(classification);
      if (overall < when.minComplexity) return false;
    }

    if (when.maxComplexity !== undefined) {
      const overall = this.calculateOverallComplexity(classification);
      if (overall > when.maxComplexity) return false;
    }

    if (when.needsVision !== undefined) {
      if (modalities.needsVision !== when.needsVision) return false;
    }

    if (when.minFileScope !== undefined) {
      if (complexity.fileScope < when.minFileScope) return false;
    }

    if (when.maxFileScope !== undefined) {
      if (complexity.fileScope > when.maxFileScope) return false;
    }

    return true;
  }

  /**
   * Calculate overall complexity as a weighted average.
   */
  private calculateOverallComplexity(classification: TaskClassification): number {
    const { depth, width, ambiguity, fileScope } = classification.complexity;
    // Weight: depth is most important for methodology selection
    return depth * 0.4 + width * 0.25 + ambiguity * 0.15 + fileScope * 0.2;
  }

  /**
   * Calculate confidence in the methodology selection.
   * Higher confidence when the task clearly matches the rule conditions.
   */
  private calculateConfidence(
    rule: MethodologyRule,
    classification: TaskClassification
  ): number {
    const overall = this.calculateOverallComplexity(classification);
    let confidence = BASE_CONFIDENCE;

    // Reduce confidence if task is near a boundary
    if (rule.when.minComplexity !== undefined) {
      const distance = overall - rule.when.minComplexity;
      if (distance < CONFIDENCE_BOUNDARY_THRESHOLD) confidence -= CONFIDENCE_BOUNDARY_THRESHOLD;
    }
    if (rule.when.maxComplexity !== undefined) {
      const distance = rule.when.maxComplexity - overall;
      if (distance < CONFIDENCE_BOUNDARY_THRESHOLD) confidence -= CONFIDENCE_BOUNDARY_THRESHOLD;
    }

    // Reduce confidence for ambiguous tasks
    confidence -= classification.complexity.ambiguity * AMBIGUITY_PENALTY_FACTOR;

    return Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, confidence));
  }

  /**
   * Get the prompt template for a strategy.
   */
  getPromptTemplate(strategy: PromptStrategy): {
    systemPrompt: string;
    userPromptTemplate: string;
  } {
    return PROMPT_TEMPLATES[strategy] || PROMPT_TEMPLATES['hierarchical-cot'];
  }

  /**
   * Add or update a rule at runtime.
   * Only removes an existing rule that shares the exact same `when` conditions,
   * preventing destruction of sibling rules with the same methodology.
   */
  setRule(rule: MethodologyRule): void {
    const whenKey = JSON.stringify(rule.when);
    this.rules = this.rules.filter((r) => JSON.stringify(r.when) !== whenKey);
    this.rules.push(rule);
    this.rules.sort((a, b) => {
      const aSpecificity = this.ruleSpecificity(a);
      const bSpecificity = this.ruleSpecificity(b);
      return bSpecificity - aSpecificity;
    });
  }

  private ruleSpecificity(rule: MethodologyRule): number {
    let score = 0;
    if (rule.when.taskTypes && rule.when.taskTypes.length > 0) score += 2;
    if (rule.when.taskTypes && rule.when.taskTypes.length > 1) score += 1;
    if (rule.when.needsVision !== undefined) score += 1;

    const hasMinC = rule.when.minComplexity !== undefined;
    const hasMaxC = rule.when.maxComplexity !== undefined;
    if (hasMinC && hasMaxC) {
      const range = rule.when.maxComplexity! - rule.when.minComplexity!;
      score += 2 + Math.max(0, 1 - range);
    } else if (hasMinC || hasMaxC) {
      score += 1.5;
    }

    const hasMinFS = rule.when.minFileScope !== undefined;
    const hasMaxFS = rule.when.maxFileScope !== undefined;
    if (hasMinFS && hasMaxFS) {
      const range = rule.when.maxFileScope! - rule.when.minFileScope!;
      score += 2 + Math.max(0, 1 - range);
    } else if (hasMinFS || hasMaxFS) {
      score += 1.5;
    }

    return score;
  }
}
