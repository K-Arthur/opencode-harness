/**
 * Tests for the Methodology Enhancement module.
 *
 * These tests verify the core classification, selection, and routing logic
 * without requiring actual model API calls.
 */

import { describe, it } from 'node:test';
import * as assert from 'assert';
import { TaskClassifier } from './TaskClassifier.js';
import { MethodologyCatalog, METHODOLOGY_RULES } from './MethodologyCatalog.js';
import { QualityEvaluator } from './CascadeRouter.js';
import { TaskClassification, MethodologyId } from './types.js';

// Alias for Node.js test runner compatibility
const suite = describe;
const test = it;

// ─── Task Classifier Tests ──────────────────────────────────────────────────

suite('TaskClassifier', () => {
  const classifier = new TaskClassifier();

  test('classifies quick-fix requests', () => {
    const result = classifier.classify('fix this bug in the login function');
    assert.strictEqual(result.type, 'quick-fix');
    assert.strictEqual(result.complexity.depth <= 0.3, true);
  });

  test('classifies generate requests', () => {
    const result = classifier.classify('create a new REST API endpoint for user registration');
    assert.strictEqual(result.type, 'generate');
  });

  test('classifies explain requests', () => {
    const result = classifier.classify('explain how the authentication middleware works');
    assert.strictEqual(result.type, 'explain');
  });

  test('classifies refactor requests', () => {
    const result = classifier.classify('refactor this component to use hooks instead of class');
    assert.strictEqual(result.type, 'refactor');
  });

  test('classifies debug requests', () => {
    const result = classifier.classify('why is this code crashing with a null reference error?');
    assert.strictEqual(result.type, 'debug');
  });

  test('classifies review requests', () => {
    const result = classifier.classify('review this PR for security issues');
    assert.strictEqual(result.type, 'review');
  });

  test('classifies architect requests', () => {
    const result = classifier.classify('design the architecture for a microservices payment system');
    assert.strictEqual(result.type, 'architect');
    assert.strictEqual(result.complexity.depth >= 0.5, true);
  });

  test('classifies test requests', () => {
    const result = classifier.classify('write unit tests for the calculateTotal function');
    assert.strictEqual(result.type, 'test');
  });

  test('classifies document requests', () => {
    const result = classifier.classify('add JSDoc comments to this module');
    assert.strictEqual(result.type, 'document');
  });

  test('detects image attachment modality', () => {
    const result = classifier.classify('implement this UI from the screenshot', {
      hasImageAttachment: true,
    });
    assert.strictEqual(result.type, 'ui-from-image');
    assert.strictEqual(result.modalities.needsVision, true);
  });

  test('detects ambiguity markers', () => {
    const result = classifier.classify('maybe add something like a login page or whatever');
    assert.strictEqual(result.signals.hasAmbiguityMarkers, true);
    assert.strictEqual(result.complexity.ambiguity >= 0.3, true);
  });

  test('detects code snippets', () => {
    const result = classifier.classify('fix this: `function foo() { return bar; }`');
    assert.strictEqual(result.signals.hasCodeSnippet, true);
  });

  test('detects file paths', () => {
    const result = classifier.classify('update src/components/Button.tsx to support loading state');
    assert.strictEqual(result.signals.hasFilePath, true);
  });

  test('estimates complexity for simple tasks', () => {
    const result = classifier.classify('fix typo in README');
    assert.strictEqual(result.complexity.depth <= 0.3, true);
    assert.strictEqual(result.complexity.fileScope <= 0.3, true);
  });

  test('estimates complexity for complex tasks', () => {
    const result = classifier.classify(
      'design a scalable architecture for a multi-tenant SaaS platform ' +
      'with real-time collaboration, then implement the core services'
    );
    assert.strictEqual(result.complexity.depth >= 0.5, true);
    assert.strictEqual(result.complexity.width >= 0.4, true);
  });

  test('detects speed preference', () => {
    const result = classifier.classify('quick fix for this bug, just do it');
    assert.strictEqual(result.constraints.speedPreferred, true);
  });

  test('detects quality preference', () => {
    const result = classifier.classify('thoroughly review this code for production readiness');
    assert.strictEqual(result.constraints.qualityPreferred, true);
  });
});

// ─── Methodology Catalog Tests ──────────────────────────────────────────────

suite('MethodologyCatalog', () => {
  const catalog = new MethodologyCatalog();

  function makeClassification(overrides: Partial<TaskClassification>): TaskClassification {
    return {
      type: 'generate',
      complexity: { depth: 0.5, width: 0.5, ambiguity: 0.2, fileScope: 0.5 },
      modalities: { needsVision: false, needsDiagram: false, needsCodeExec: false },
      constraints: { speedPreferred: false, qualityPreferred: false },
      signals: {
        queryLength: 50,
        hasCodeSnippet: false,
        hasFilePath: false,
        hasAmbiguityMarkers: false,
        hasImageAttachment: false,
        subQuestionCount: 0,
      },
      ...overrides,
    };
  }

  test('selects quick-flow for quick-fix tasks', () => {
    const result = catalog.select(
      makeClassification({ type: 'quick-fix', complexity: { depth: 0.2, width: 0.1, ambiguity: 0.1, fileScope: 0.1 } })
    );
    assert.strictEqual(result.methodology, 'quick-flow');
  });

  test('selects multimodal-pipeline for UI from image', () => {
    const result = catalog.select(
      makeClassification({
        type: 'ui-from-image',
        modalities: { needsVision: true, needsDiagram: false, needsCodeExec: false },
      })
    );
    assert.strictEqual(result.methodology, 'multimodal-pipeline');
  });

  test('selects supervisor-workers for architecture', () => {
    const result = catalog.select(
      makeClassification({
        type: 'architect',
        complexity: { depth: 0.8, width: 0.7, ambiguity: 0.3, fileScope: 0.8 },
      })
    );
    assert.strictEqual(result.methodology, 'supervisor-workers');
  });

  test('selects cascade-review for review tasks', () => {
    const result = catalog.select(makeClassification({ type: 'review' }));
    assert.strictEqual(result.methodology, 'cascade-review');
  });

  test('selects bmad-lite for complex generation', () => {
    const result = catalog.select(
      makeClassification({
        type: 'generate',
        complexity: { depth: 0.7, width: 0.6, ambiguity: 0.3, fileScope: 0.6 },
      })
    );
    assert.strictEqual(result.methodology, 'bmad-lite');
  });

  test('selects spec-first for medium complexity generation', () => {
    const result = catalog.select(
      makeClassification({
        type: 'generate',
        complexity: { depth: 0.4, width: 0.4, ambiguity: 0.2, fileScope: 0.4 },
      })
    );
    assert.strictEqual(result.methodology, 'spec-first');
  });

  test('selects direct-execution for documentation', () => {
    const result = catalog.select(makeClassification({ type: 'document' }));
    assert.strictEqual(result.methodology, 'direct-execution');
  });

  test('falls back to spec-first for unclassified tasks', () => {
    const result = catalog.select(
      makeClassification({ type: 'generate', complexity: { depth: 0.1, width: 0.1, ambiguity: 0.1, fileScope: 0.1 } })
    );
    // Very low complexity generate should fall through to default
    assert.strictEqual(result.methodology, 'spec-first');
  });

  test('provides prompt templates for all strategies', () => {
    const strategies = [
      'direct', 'hierarchical-cot', 'plan-then-execute', 'iterative-refinement',
      'multi-agent-debate', 'cross-modal', 'schema-first', 'few-shot-strong',
      'conversational-decompose',
    ] as const;

    for (const strategy of strategies) {
      const template = catalog.getPromptTemplate(strategy);
      assert.ok(template.systemPrompt.length > 0);
      assert.ok(template.userPromptTemplate.length > 0);
    }
  });

  test('calculates confidence based on rule match quality', () => {
    const result = catalog.select(
      makeClassification({
        type: 'architect',
        complexity: { depth: 0.9, width: 0.8, ambiguity: 0.1, fileScope: 0.9 },
      })
    );
    // High complexity architect task should have high confidence
    assert.strictEqual(result.confidence >= 0.6, true);
  });
});

// ─── Quality Evaluator Tests ────────────────────────────────────────────────

suite('QualityEvaluator', () => {
  const evaluator = new QualityEvaluator();

  test('validates JSON responses', () => {
    const metrics = evaluator.evaluate('{"key": "value"}', makeTestTask());
    assert.strictEqual(metrics.schemaCompliance, true);
  });

  test('rejects invalid JSON', () => {
    const metrics = evaluator.evaluate('{invalid json}', makeTestTask());
    assert.strictEqual(metrics.schemaCompliance, false);
  });

  test('accepts non-JSON responses as compliant', () => {
    const metrics = evaluator.evaluate('This is a text response', makeTestTask());
    assert.strictEqual(metrics.schemaCompliance, true);
  });

  test('scores completeness based on expected length', () => {
    const task = makeTestTask({ type: 'quick-fix' });
    const shortResponse = evaluator.evaluate('fix it', task);
    const longResponse = evaluator.evaluate('Here is the detailed fix: step 1, step 2, step 3...', task);

    assert.ok(longResponse.completeness >= shortResponse.completeness);
  });

  test('penalizes vague language', () => {
    const vagueResponse = 'maybe this could work, perhaps try something, it might be ok';
    const specificResponse = 'Change line 42 to use async/await instead of callbacks';

    const vague = evaluator.evaluate(vagueResponse, makeTestTask());
    const specific = evaluator.evaluate(specificResponse, makeTestTask());

    assert.ok(specific.specificity > vague.specificity);
  });

  test('detects contradictions', () => {
    const contradictory = 'You should always use X. You should never use X.';
    const consistent = 'You should always use X for this case.';

    const contrad = evaluator.evaluate(contradictory, makeTestTask());
    const consist = evaluator.evaluate(consistent, makeTestTask());

    assert.ok(consist.consistencyScore > contrad.consistencyScore);
  });

  test('calculates overall score', () => {
    const metrics = evaluator.evaluate('{"result": "success"}', makeTestTask());
    const score = evaluator.overallScore(metrics);
    assert.ok(score >= 0 && score <= 1);
  });
});

function makeTestTask(overrides: Partial<TaskClassification> = {}): TaskClassification {
  return {
    type: 'generate',
    complexity: { depth: 0.5, width: 0.5, ambiguity: 0.2, fileScope: 0.5 },
    modalities: { needsVision: false, needsDiagram: false, needsCodeExec: false },
    constraints: { speedPreferred: false, qualityPreferred: false },
    signals: {
      queryLength: 50,
      hasCodeSnippet: false,
      hasFilePath: false,
      hasAmbiguityMarkers: false,
      hasImageAttachment: false,
      subQuestionCount: 0,
    },
    ...overrides,
  };
}
