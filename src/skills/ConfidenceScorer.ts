/**
 * ConfidenceScorer — Calculates multi-signal confidence scores for skill
 * recommendations. Enhanced with SADD/TDD signals (Phase 1/5).
 */

import type {
  ConfidenceSignals,
  ConfidenceResult,
  ProjectContext,
  ModelSkillInfo,
  ScorerState,
  TaskIntent,
  TriggerMatch,
} from './types';

// Export types for use by other modules
export type { ConfidenceSignals, ConfidenceResult };

class ConfidenceScorer {
  private signalWeights: Map<string, number> = new Map();
  private historicalUsage: Map<string, number> = new Map();
  private userPreferences: Map<string, number> = new Map();

  constructor() {
    this.initializeDefaultWeights();
  }

  /**
   * Initialize default signal weights — includes SADD/TDD signals.
   */
  private initializeDefaultWeights(): void {
    // Core signals
    this.signalWeights.set('semanticSimilarity', 0.22);
    this.signalWeights.set('taskMatch', 0.18);
    this.signalWeights.set('contextMatch', 0.14);
    this.signalWeights.set('triggerConfidence', 0.14);
    this.signalWeights.set('modelPerformance', 0.09);
    this.signalWeights.set('userPreference', 0.09);
    this.signalWeights.set('historicalUsage', 0.05);
    // SADD/TDD signals (Phase 1 — initialized low, refined in Phase 5)
    this.signalWeights.set('decompositionAccuracy', 0.03);
    this.signalWeights.set('testCoverage', 0.03);
    this.signalWeights.set('tddSuccessRate', 0.03);
  }

  /**
   * Calculate overall confidence score from multiple signals
   */
  calculateConfidence(
    signals: ConfidenceSignals
  ): ConfidenceResult {
    const weightedSum =
      signals.semanticSimilarity * this.signalWeights.get('semanticSimilarity')! +
      signals.taskMatch * this.signalWeights.get('taskMatch')! +
      signals.contextMatch * this.signalWeights.get('contextMatch')! +
      signals.triggerConfidence * this.signalWeights.get('triggerConfidence')! +
      signals.modelPerformance * this.signalWeights.get('modelPerformance')! +
      signals.userPreference * this.signalWeights.get('userPreference')! +
      signals.historicalUsage * this.signalWeights.get('historicalUsage')! +
      (signals.decompositionAccuracy ?? 0.5) * this.signalWeights.get('decompositionAccuracy')! +
      (signals.testCoverage ?? 0.5) * this.signalWeights.get('testCoverage')! +
      (signals.tddSuccessRate ?? 0.5) * this.signalWeights.get('tddSuccessRate')!;

    const confidence = Math.min(Math.max(weightedSum, 0), 1);
    const level = this.getConfidenceLevel(confidence);
    const reasoning = this.generateReasoning(signals, confidence);

    return {
      confidence,
      signals,
      level,
      reasoning
    };
  }

  /**
   * Calculate semantic similarity score
   */
  calculateSemanticSimilarity(
    similarityScore: number
  ): number {
    return Math.min(Math.max(similarityScore, 0), 1);
  }

  /**
   * Calculate task match score
   */
  calculateTaskMatch(
    taskIntent: TaskIntent,
    skillCategory: string
  ): number {
    const taskTypeToCategory: Record<string, string[]> = {
      'coding': ['coding', 'general'],
      'debugging': ['debugging', 'coding'],
      'testing': ['testing', 'coding'],
      'documentation': ['documentation', 'general'],
      'refactoring': ['refactoring', 'coding'],
      'other': ['general']
    };

    const matchingCategories = taskTypeToCategory[taskIntent.type] || ['general'];

    if (matchingCategories.includes(skillCategory)) {
      return 0.9;
    }

    const domainToCategory: Record<string, string[]> = {
      'frontend': ['frontend', 'ui'],
      'backend': ['backend', 'api'],
      'database': ['database', 'data'],
      'api': ['api', 'backend'],
      'testing': ['testing'],
      'general': ['general']
    };

    const matchingDomainCategories = domainToCategory[taskIntent.domain] || [];

    if (matchingDomainCategories.includes(skillCategory)) {
      return 0.7;
    }

    return 0.3;
  }

  /**
   * Calculate context match score
   */
  calculateContextMatch(
    projectContext: ProjectContext,
    skillCategory: string
  ): number {
    let score = 0.5;

    const projectTypeToCategory: Record<string, string[]> = {
      'frontend': ['frontend', 'ui', 'react', 'vue', 'angular'],
      'python': ['python', 'testing', 'documentation'],
      'javascript': ['javascript', 'typescript', 'frontend', 'backend'],
      'java': ['java', 'backend'],
      'go': ['go', 'backend'],
      'rust': ['rust', 'backend'],
      'general': ['general']
    };

    const matchingCategories = projectTypeToCategory[projectContext.projectType] || [];

    if (matchingCategories.includes(skillCategory)) {
      score += 0.3;
    }

    if (skillCategory === 'testing' && projectContext.hasTests) {
      score += 0.2;
    }

    if (skillCategory === 'documentation' && projectContext.hasDocumentation) {
      score += 0.2;
    }

    return Math.min(score, 1);
  }

  /**
   * Calculate trigger confidence score
   */
  calculateTriggerConfidence(
    triggerMatches: TriggerMatch[]
  ): number {
    if (triggerMatches.length === 0) {
      return 0;
    }

    const maxConfidence = Math.max(...triggerMatches.map(match => match.confidence));
    return maxConfidence;
  }

  /**
   * Calculate model performance score
   */
  calculateModelPerformance(
    modelSkillInfo?: ModelSkillInfo
  ): number {
    if (!modelSkillInfo) {
      return 0.5;
    }
    if (!modelSkillInfo.supported) {
      return 0;
    }
    return modelSkillInfo.performanceScore;
  }

  /**
   * Calculate user preference score
   */
  calculateUserPreference(skillId: string): number {
    return this.userPreferences.get(skillId) ?? 0.5;
  }

  /**
   * Calculate historical usage score
   */
  calculateHistoricalUsage(skillId: string): number {
    return this.historicalUsage.get(skillId) ?? 0;
  }

  /**
   * Get confidence level category
   */
  private getConfidenceLevel(confidence: number): ConfidenceResult['level'] {
    if (confidence < 0.2) return 'very-low';
    if (confidence < 0.4) return 'low';
    if (confidence < 0.6) return 'medium';
    if (confidence < 0.8) return 'high';
    return 'very-high';
  }

  /**
   * Generate reasoning for confidence score
   */
  private generateReasoning(signals: ConfidenceSignals, confidence: number): string {
    const reasons: string[] = [];

    if (signals.semanticSimilarity > 0.7) {
      reasons.push('high semantic similarity');
    }

    if (signals.taskMatch > 0.7) {
      reasons.push('strong task type match');
    }

    if (signals.contextMatch > 0.7) {
      reasons.push('good project context alignment');
    }

    if (signals.triggerConfidence > 0.7) {
      reasons.push('rule-based trigger matched');
    }

    if (signals.modelPerformance > 0.8) {
      reasons.push('excellent model performance');
    }

    if (signals.userPreference > 0.7) {
      reasons.push('user preference alignment');
    }

    if (signals.historicalUsage > 0.5) {
      reasons.push('frequently used skill');
    }

    if ((signals.decompositionAccuracy ?? 0) > 0.7) {
      reasons.push('high decomposition accuracy');
    }

    if ((signals.testCoverage ?? 0) > 0.7) {
      reasons.push('strong test coverage');
    }

    if (reasons.length === 0) {
      return `Confidence score of ${(confidence * 100).toFixed(0)}% based on combined signal analysis`;
    }

    return `Confidence score of ${(confidence * 100).toFixed(0)}% due to: ${reasons.join(', ')}`;
  }

  /**
   * Update user preference for a skill
   */
  updateUserPreference(skillId: string, preference: number): void {
    this.userPreferences.set(skillId, Math.min(Math.max(preference, 0), 1));
  }

  /**
   * Record skill usage for historical scoring
   */
  recordSkillUsage(skillId: string): void {
    const current = this.historicalUsage.get(skillId) ?? 0;
    this.historicalUsage.set(skillId, Math.min(current + 0.1, 1));
  }

  /**
   * Decay historical usage scores (call periodically)
   */
  decayHistoricalUsage(decayFactor: number = 0.9): void {
    for (const [skillId, usage] of this.historicalUsage.entries()) {
      this.historicalUsage.set(skillId, usage * decayFactor);
    }
  }

  /**
   * Set signal weight
   */
  setSignalWeight(signal: string, weight: number): void {
    this.signalWeights.set(signal, Math.min(Math.max(weight, 0), 1));
    this.normalizeWeights();
  }

  /**
   * Get signal weight
   */
  getSignalWeight(signal: string): number {
    return this.signalWeights.get(signal) ?? 0;
  }

  /**
   * Normalize signal weights to sum to 1
   */
  normalizeWeights(): void {
    const total = Array.from(this.signalWeights.values()).reduce((sum, weight) => sum + weight, 0);

    if (total === 0) {
      return;
    }

    for (const [signal, weight] of this.signalWeights.entries()) {
      this.signalWeights.set(signal, weight / total);
    }
  }

  /**
   * Apply refined weights from FeedbackLoop analysis
   */
  applyRefinedWeights(refinements: Map<string, number>): void {
    for (const [signal, weight] of refinements) {
      if (this.signalWeights.has(signal)) {
        this.signalWeights.set(signal, weight);
      }
    }
    this.normalizeWeights();
  }

  /**
   * Clear all data
   */
  clearAll(): void {
    this.historicalUsage.clear();
    this.userPreferences.clear();
  }

  /**
   * Export scorer state as a plain object
   */
  export(): ScorerState {
    return {
      signalWeights: Array.from(this.signalWeights.entries()),
      historicalUsage: Array.from(this.historicalUsage.entries()),
      userPreferences: Array.from(this.userPreferences.entries()),
    };
  }

  /**
   * Import scorer state from a plain object
   */
  import(state: ScorerState): void {
    this.clearAll();
    for (const [signal, weight] of state.signalWeights ?? []) {
      this.signalWeights.set(signal, weight);
    }
    for (const [skillId, usage] of state.historicalUsage ?? []) {
      this.historicalUsage.set(skillId, usage);
    }
    for (const [skillId, preference] of state.userPreferences ?? []) {
      this.userPreferences.set(skillId, preference);
    }
  }
}

export { ConfidenceScorer };
