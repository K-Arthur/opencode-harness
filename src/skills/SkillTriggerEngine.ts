/**
 * SkillTriggerEngine — Matches user messages against trigger rules to
 * suggest relevant skills. Enhanced with SADD/TDD trigger rules (Phase 1).
 */

import type { TriggerRule, TriggerMatch } from './types';

class SkillTriggerEngine {
  private rules: Map<string, TriggerRule> = new Map();
  private compiledRules: Array<{ rule: TriggerRule; regex: RegExp }> = [];

  constructor() {
    this.initializeDefaultRules();
  }

  /**
   * Initialize default trigger rules — includes SADD/TDD rules.
   */
  private initializeDefaultRules(): void {
    const defaultRules: TriggerRule[] = [
      // --- SADD triggers (Phase 1) ---
      {
        id: 'sadd-complex-feature',
        name: 'SADD for Complex Feature Implementation',
        pattern: '\\b(implement|build|create)\\s+.*(feature|system|module|service|platform|dashboard)s?\\b',
        skillIds: ['subagent-driven-development'],
        priority: 12,
        enabled: true,
        category: 'sadd'
      },
      {
        id: 'sadd-fullstack',
        name: 'SADD for Full-Stack Tasks',
        pattern: '\\b(frontend|backend|full.?stack|api.*component|component.*api|end.?to.?end)\\b',
        skillIds: ['subagent-driven-development'],
        priority: 11,
        enabled: true,
        category: 'sadd'
      },
      {
        id: 'sadd-multi-file',
        name: 'SADD for Multi-File Changes',
        pattern: '\\b(multiple|several|many)\\s+(files?|components?|endpoints?|services?)\\b',
        skillIds: ['subagent-driven-development'],
        priority: 10,
        enabled: true,
        category: 'sadd'
      },
      {
        id: 'sadd-spec-driven',
        name: 'SADD for Spec-Driven Development',
        // Matches: spec-driven, spec driven, spec-first, spec-based, and
        // phrases like "according to the specification" (with optional article)
        pattern: '\\b(spec.?driven|spec.?first|spec.?based|according\\s+to(?:\\s+(?:the|a|an))?\\s+(?:spec|specification))\\b',
        skillIds: ['subagent-driven-development', 'test-driven-development'],
        priority: 13,
        enabled: true,
        category: 'sadd'
      },

      // --- TDD triggers (Phase 1) ---
      {
        id: 'tdd-new-function',
        name: 'TDD for New Function/Method',
        // Matches: write/implement/add/... { a | an | the }? { adjective }? (function | method | class | component)
        // The optional adjective slot lets "write a new function" match.
        pattern: '\\b(write|implement|add|create|build)\\s+(?:(?:a|an|the)\\s+)?(?:\\w+\\s+)?(function|method|class|component)\\b',
        skillIds: ['test-driven-development'],
        priority: 11,
        enabled: true,
        category: 'tdd'
      },
      {
        id: 'tdd-new-api',
        name: 'TDD for New API/Endpoint',
        pattern: '\\b(create|build|implement|add)\\s+((a|an|the)\\s+)?(api|endpoint|route|handler|controller)s?\\b',
        skillIds: ['test-driven-development'],
        priority: 11,
        enabled: true,
        category: 'tdd'
      },
      {
        id: 'tdd-spec-verification',
        name: 'TDD for Spec Verification',
        // Matches: verify/validate/check { the | a | an }? { spec | specification | requirements }
        pattern: '\\b(verify|validate|check)\\s+(?:the\\s+|a\\s+|an\\s+)?(spec|specification|requirements)\\b',
        skillIds: ['test-driven-development'],
        priority: 12,
        enabled: true,
        category: 'tdd'
      },
      {
        id: 'tdd-implementation',
        name: 'TDD for General Implementation',
        pattern: '\\b(implement|build|create|develop)\\s+.*(system|feature|service|module|platform|application|solution)\\b',
        skillIds: ['test-driven-development'],
        priority: 8,
        enabled: true,
        category: 'tdd'
      },
      {
        id: 'tdd-bugfix',
        name: 'TDD for Bug Fix (Regression Test)',
        pattern: '\\b(fix|patch|resolve)\\s+((a|an|the)\\s+)?(bug|error|issue|crash|exception|failure)\\b',
        skillIds: ['test-driven-development'],
        priority: 10,
        enabled: true,
        category: 'tdd'
      },
      {
        id: 'tdd-refactor',
        name: 'TDD for Refactoring (Safety Net)',
        pattern: '\\b(refactor|restructure|reorganize|clean\\s+up)\\b',
        skillIds: ['test-driven-development'],
        priority: 9,
        enabled: true,
        category: 'tdd'
      },

      // --- Existing rules ---
      {
        id: 'react-component',
        name: 'React Component Creation',
        pattern: '\\b(create|build|implement|write|add)\\s+(a\\s+)?(react\\s+)?component',
        skillIds: ['react-component-builder'],
        priority: 8,
        enabled: true,
        category: 'keyword'
      },
      {
        id: 'python-testing',
        name: 'Python Testing',
        pattern: '\\b(write|create|add|implement)\\s+(python\\s+)?(unit\\s+)?test',
        skillIds: ['python-test-generator'],
        priority: 8,
        enabled: true,
        category: 'keyword'
      },
      {
        id: 'code-review',
        name: 'Code Review',
        pattern: '\\b(review|audit|check|analyze)\\s+(the\\s+)?code',
        skillIds: ['code-reviewer'],
        priority: 8,
        enabled: true,
        category: 'keyword'
      },
      {
        id: 'api-documentation',
        name: 'API Documentation',
        pattern: '\\b(document|add\\s+doc|create\\s+docs?|write\\s+docs?)\\s+(the\\s+)?(api|endpoint)',
        skillIds: ['api-documenter'],
        priority: 9,
        enabled: true,
        category: 'keyword'
      },
      {
        id: 'database-migration',
        name: 'Database Migration',
        pattern: '\\b(create|add|write)\\s+(a\\s+)?(database\\s+)?(migration|schema)',
        skillIds: ['db-migration-generator'],
        priority: 9,
        enabled: true,
        category: 'keyword'
      },
      {
        id: 'frontend-task',
        name: 'Frontend Task',
        pattern: '\\b(react|vue|angular|component|ui|interface)\\b',
        skillIds: ['frontend-helper'],
        priority: 5,
        enabled: true,
        category: 'domain'
      },
      {
        id: 'backend-task',
        name: 'Backend Task',
        pattern: '\\b(api|endpoint|server|backend|service|controller)\\b',
        skillIds: ['backend-helper'],
        priority: 5,
        enabled: true,
        category: 'domain'
      },
      {
        id: 'database-task',
        name: 'Database Task',
        pattern: '\\b(database|db|sql|query|schema|migration)\\b',
        skillIds: ['database-helper'],
        priority: 5,
        enabled: true,
        category: 'domain'
      },
      {
        id: 'simple-task',
        name: 'Simple Task',
        pattern: '\\b(quick|simple|basic|minor|small)\\b',
        skillIds: ['quick-helper'],
        priority: 3,
        enabled: true,
        category: 'complexity'
      },
      {
        id: 'complex-task',
        name: 'Complex Task',
        pattern: '\\b(complex|comprehensive|extensive|entire|complete)\\b',
        skillIds: ['complex-helper'],
        priority: 7,
        enabled: true,
        category: 'complexity'
      }
    ];

    for (const rule of defaultRules) {
      this.addRule(rule);
    }
  }

  /**
   * Add a trigger rule
   */
  addRule(rule: TriggerRule): void {
    this.rules.set(rule.id, rule);
    this.recompileRules();
  }

  /**
   * Remove a trigger rule
   */
  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
    this.recompileRules();
  }

  /**
   * Update a trigger rule
   */
  updateRule(rule: TriggerRule): void {
    this.rules.set(rule.id, rule);
    this.recompileRules();
  }

  /**
   * Enable or disable a rule
   */
  setRuleEnabled(ruleId: string, enabled: boolean): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = enabled;
      this.recompileRules();
    }
  }

  /**
   * Recompile rules for efficient matching
   */
  private recompileRules(): void {
    this.compiledRules = [];

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      try {
        const regex = new RegExp(rule.pattern, 'gi');
        this.compiledRules.push({ rule, regex });
      } catch (error) {
        console.warn(`Invalid regex pattern for rule ${rule.id}: ${rule.pattern}`);
      }
    }

    // Sort by priority (higher priority first)
    this.compiledRules.sort((a, b) => b.rule.priority - a.rule.priority);
  }

  /**
   * Match message against rules and return triggered skills
   */
  matchMessage(message: string): TriggerMatch[] {
    const matches: TriggerMatch[] = [];
    for (const { rule, regex } of this.compiledRules) {
      regex.lastIndex = 0; // reset stateful lastIndex from 'g' flag
      const match = regex.exec(message);
      if (match) {
        const confidence = this.calculateConfidence(match);
        matches.push({ rule, match: match[0], confidence });
      }
    }

    return matches;
  }

  /**
   * Returns a map of skillId → max confidence across all matched rules.
   */
  getSkillBoostMap(message: string): Map<string, number> {
    const boost = new Map<string, number>();
    for (const m of this.matchMessage(message)) {
      for (const skillId of m.rule.skillIds) {
        boost.set(skillId, Math.max(boost.get(skillId) ?? 0, m.confidence));
      }
    }
    return boost;
  }

  /**
   * Get skill IDs triggered by a message
   */
  getTriggeredSkills(message: string): string[] {
    return Array.from(this.getSkillBoostMap(message).keys());
  }

  /**
   * Calculate confidence score for a match
   */
  private calculateConfidence(match: RegExpExecArray): number {
    // Base confidence
    let confidence = 0.7;

    // Increase confidence for longer matches
    if (match[0].length > 10) {
      confidence += 0.1;
    }

    // Increase confidence for exact word matches
    if (match[0].trim() === match[0]) {
      confidence += 0.1;
    }

    // Decrease confidence if match is very short
    if (match[0].length < 3) {
      confidence -= 0.2;
    }

    return Math.min(Math.max(confidence, 0), 1);
  }

  /**
   * Get all rules
   */
  getRules(): TriggerRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get rules by category
   */
  getRulesByCategory(category: TriggerRule['category']): TriggerRule[] {
    return Array.from(this.rules.values()).filter(rule => rule.category === category);
  }

  /**
   * Get SADD-specific rules
   */
  getSaddRules(): TriggerRule[] {
    return this.getRulesByCategory('sadd');
  }

  /**
   * Get TDD-specific rules
   */
  getTddRules(): TriggerRule[] {
    return this.getRulesByCategory('tdd');
  }

  /**
   * Clear all rules
   */
  clearRules(): void {
    this.rules.clear();
    this.compiledRules = [];
  }

  /**
   * Reset to default rules
   */
  resetToDefaults(): void {
    this.clearRules();
    this.initializeDefaultRules();
  }

  /**
   * Export rules as JSON
   */
  exportRules(): string {
    return JSON.stringify(Array.from(this.rules.values()), null, 2);
  }

  /**
   * Import rules from JSON
   */
  importRules(rulesJson: string): void {
    try {
      const rules = JSON.parse(rulesJson) as TriggerRule[];
      this.clearRules();
      for (const rule of rules) {
        this.addRule(rule);
      }
    } catch (error) {
      throw new Error('Invalid rules JSON format');
    }
  }
}

export { SkillTriggerEngine };
export type { TriggerRule, TriggerMatch };
