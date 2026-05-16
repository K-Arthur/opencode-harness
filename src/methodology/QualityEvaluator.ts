/**
 * Quality Evaluator — heuristic-based response quality assessment.
 *
 * Evaluates model responses without making additional LLM calls. Uses
 * structural signals, task-type-specific rubrics, and pattern detection
 * to produce a 0.0–1.0 quality score.
 *
 * Signals evaluated:
 * - Schema compliance (valid JSON when expected)
 * - Completeness (response length relative to task complexity)
 * - Specificity (absence of vague/hedging language)
 * - Consistency (no self-contradictions)
 * - Code presence (code blocks for generate/refactor tasks)
 * - Actionability (concrete steps/recommendations for review/debug)
 */

import type { TaskClassification, TaskType, QualityMetrics, CodeQualityMetrics } from './types.js';

export class QualityEvaluator {
  evaluate(response: string, task: TaskClassification): QualityMetrics {
    return {
      schemaCompliance: this.checkSchemaCompliance(response),
      completeness: this.checkCompleteness(response, task),
      specificity: this.checkSpecificity(response),
      consistencyScore: this.checkConsistency(response),
      codeMetrics: this.checkCodeQuality(response, task),
    };
  }

  overallScore(metrics: QualityMetrics): number {
    const w = { schemaCompliance: 0.2, completeness: 0.2, specificity: 0.2, consistencyScore: 0.15, codeMetrics: 0.25 };
    let codeScore = 0.5;
    if (metrics.codeMetrics) {
      const m = metrics.codeMetrics;
      codeScore = [m.compiles, m.importsValid, m.noDuplication, m.complexityOk].filter(Boolean).length / 4;
    }
    return (
      (metrics.schemaCompliance ? 1 : 0) * w.schemaCompliance +
      metrics.completeness * w.completeness +
      metrics.specificity * w.specificity +
      metrics.consistencyScore * w.consistencyScore +
      codeScore * w.codeMetrics
    );
  }

  private checkSchemaCompliance(response: string): boolean {
    const t = response.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try { JSON.parse(t); return true; } catch { return false; }
    }
    return true;
  }

  private checkCompleteness(response: string, task: TaskClassification): number {
    const expected = this.estimateExpectedLength(task);
    if (response.length >= expected) return 1.0;
    return response.length / expected;
  }

  private estimateExpectedLength(task: TaskClassification): number {
    const base = 200;
    const cm = (task.complexity.depth + task.complexity.width) / 2;
    const table: Record<TaskType, number> = {
      'quick-fix': base * 2,
      'explain': base * 5,
      'generate': base * 10 * (1 + cm),
      'review': base * 8,
      'architect': base * 15 * (1 + cm),
      'debug': base * 6 * (1 + cm),
      'refactor': base * 8 * (1 + cm),
      'test': base * 6,
      'document': base * 4,
      'ui-from-image': base * 12,
    };
    return table[task.type] ?? base * 5;
  }

  private checkSpecificity(response: string): number {
    const vague = [/\b(maybe|perhaps|possibly|might|could try)\b/gi];
    let count = 0;
    for (const p of vague) { const m = response.match(p); if (m) count += m.length; }
    const words = response.split(/\s+/).length;
    if (words === 0) return 0;
    return Math.max(0, 1 - (count / words) * 10);
  }

  private checkConsistency(response: string): number {
    const lower = response.toLowerCase();
    const pairs = [['should', 'should not'], ['must', 'must not'], ['always', 'never'], ['is required', 'is optional']];
    let contradictions = 0;
    for (const [a, b] of pairs) { if (a && b && lower.includes(a) && lower.includes(b)) contradictions++; }
    return Math.max(0, 1 - contradictions * 0.25);
  }

  private checkCodeQuality(response: string, task: TaskClassification): CodeQualityMetrics | undefined {
    const needsCode: TaskType[] = ['generate', 'refactor', 'test', 'quick-fix', 'debug'];
    if (!needsCode.includes(task.type)) return undefined;

    const hasCodeBlock = /```[\s\S]*?```/.test(response);
    const hasImports = /^(import |from |require\(|#include )/m.test(response);
    const hasDuplicateBlocks = this.hasDuplicateCodeBlocks(response);

    return {
      compiles: hasCodeBlock,
      testsPass: task.type === 'test' ? /describe|it\(|test\(|assert|expect/.test(response) : hasCodeBlock,
      complexityOk: true,
      noDuplication: !hasDuplicateBlocks,
      importsValid: hasCodeBlock && !hasImports ? true : hasImports,
    };
  }

  private hasDuplicateCodeBlocks(response: string): boolean {
    const blocks = response.match(/```[\s\S]*?```/g);
    if (!blocks || blocks.length < 2) return false;
    const normalized = blocks.map(b => b.replace(/\s+/g, ' ').trim());
    for (let i = 0; i < normalized.length; i++) {
      for (let j = i + 1; j < normalized.length; j++) {
        if (normalized[i] === normalized[j]) return true;
      }
    }
    return false;
  }
}
