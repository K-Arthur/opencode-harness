import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QualityEvaluator } from './QualityEvaluator.js';
import type { TaskClassification } from './types.js';

function makeClassification(overrides: Partial<TaskClassification> = {}): TaskClassification {
  return {
    type: 'generate',
    complexity: { depth: 0.5, width: 0.3, ambiguity: 0.2, fileScope: 0.4 },
    modalities: { needsVision: false, needsDiagram: false, needsCodeExec: false },
    constraints: { speedPreferred: false, qualityPreferred: false },
    signals: { queryLength: 100, hasCodeSnippet: false, hasFilePath: false, hasAmbiguityMarkers: false, hasImageAttachment: false, subQuestionCount: 1 },
    ...overrides,
  };
}

describe('QualityEvaluator', () => {
  const evaluator = new QualityEvaluator();

  it('scores a complete code response highly for generate tasks', () => {
    const task = makeClassification({ type: 'generate' });
    const response = 'Here is the implementation:\n```typescript\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n```';
    const metrics = evaluator.evaluate(response, task);
    const score = evaluator.overallScore(metrics);
    assert.ok(score > 0.4, `Expected score > 0.4, got ${score}`);
  });

  it('penalizes vague language', () => {
    const task = makeClassification({ type: 'explain' });
    const vagueResponse = 'Maybe you could perhaps possibly try something or other somehow it depends';
    const metrics = evaluator.evaluate(vagueResponse, task);
    assert.ok(metrics.specificity < 0.5, `Expected low specificity, got ${metrics.specificity}`);
  });

  it('detects code blocks for generate tasks', () => {
    const task = makeClassification({ type: 'generate' });
    const response = '```python\ndef hello():\n    print("hello")\n```';
    const metrics = evaluator.evaluate(response, task);
    assert.ok(metrics.codeMetrics, 'Expected codeMetrics for generate task');
    assert.equal(metrics.codeMetrics!.compiles, true);
  });

  it('does not require code metrics for explain tasks', () => {
    const task = makeClassification({ type: 'explain' });
    const response = 'This function adds two numbers together by using the + operator.';
    const metrics = evaluator.evaluate(response, task);
    assert.equal(metrics.codeMetrics, undefined);
  });

  it('checks JSON schema compliance for JSON responses', () => {
    const task = makeClassification({ type: 'test' });
    const validJson = '{"name": "test", "passed": true}';
    const invalidJson = '{"name": "test", "passed": }';
    const validMetrics = evaluator.evaluate(validJson, task);
    const invalidMetrics = evaluator.evaluate(invalidJson, task);
    assert.equal(validMetrics.schemaCompliance, true);
    assert.equal(invalidMetrics.schemaCompliance, false);
  });

  it('detects contradictions reducing consistency', () => {
    const task = makeClassification({ type: 'review' });
    const contradictory = 'You should always use tabs. You should never use tabs.';
    const metrics = evaluator.evaluate(contradictory, task);
    assert.ok(metrics.consistencyScore < 1.0, `Expected reduced consistency, got ${metrics.consistencyScore}`);
  });

  it('returns completeness proportional to task complexity', () => {
    const simpleTask = makeClassification({ type: 'quick-fix', complexity: { depth: 0.1, width: 0.1, ambiguity: 0.1, fileScope: 0.1 } });
    const complexTask = makeClassification({ type: 'architect', complexity: { depth: 0.9, width: 0.8, ambiguity: 0.3, fileScope: 0.9 } });
    const shortResponse = 'Fixed the typo.';
    const simpleMetrics = evaluator.evaluate(shortResponse, simpleTask);
    const complexMetrics = evaluator.evaluate(shortResponse, complexTask);
    assert.ok(simpleMetrics.completeness >= complexMetrics.completeness, 'Simple task should be more complete with same response');
  });
});
