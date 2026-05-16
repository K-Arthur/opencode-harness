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

// ─── Methodology Catalog ────────────────────────────────────────────────────

export class MethodologyCatalog {
  private rules: MethodologyRule[];

  constructor(rules: MethodologyRule[] = METHODOLOGY_RULES) {
    this.rules = rules;
  }

  /**
   * Select the best methodology for a given task classification.
   * Returns the first matching rule (rules are ordered by specificity).
   */
  select(classification: TaskClassification): MethodologySelection {
    for (const rule of this.rules) {
      if (this.matchesRule(rule, classification)) {
        const overallComplexity = this.calculateOverallComplexity(classification);
        return {
          methodology: rule.methodology,
          promptStrategy: rule.promptStrategy,
          executionPattern: rule.executionPattern,
          recommendedTier: rule.recommendedTier,
          confidence: this.calculateConfidence(rule, classification),
          matchedRule: rule,
        };
      }
    }

    // Fallback (should not reach here if default rule exists)
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
    let confidence = 0.8; // base confidence for a match

    // Reduce confidence if task is near a boundary
    if (rule.when.minComplexity !== undefined) {
      const distance = overall - rule.when.minComplexity;
      if (distance < 0.1) confidence -= 0.1;
    }
    if (rule.when.maxComplexity !== undefined) {
      const distance = rule.when.maxComplexity - overall;
      if (distance < 0.1) confidence -= 0.1;
    }

    // Reduce confidence for ambiguous tasks
    confidence -= classification.complexity.ambiguity * 0.2;

    return Math.max(0.3, Math.min(1.0, confidence));
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
   */
  setRule(rule: MethodologyRule): void {
    // Remove existing rule with same methodology
    this.rules = this.rules.filter((r) => r.methodology !== rule.methodology);
    // Insert in sorted position (by specificity)
    this.rules.push(rule);
    this.rules.sort((a, b) => {
      const aSpecificity = this.ruleSpecificity(a);
      const bSpecificity = this.ruleSpecificity(b);
      return bSpecificity - aSpecificity; // most specific first
    });
  }

  private ruleSpecificity(rule: MethodologyRule): number {
    let score = 0;
    if (rule.when.taskTypes && rule.when.taskTypes.length > 0) score += 2;
    if (rule.when.minComplexity !== undefined) score += 1;
    if (rule.when.maxComplexity !== undefined) score += 1;
    if (rule.when.needsVision !== undefined) score += 1;
    if (rule.when.minFileScope !== undefined) score += 1;
    return score;
  }
}
