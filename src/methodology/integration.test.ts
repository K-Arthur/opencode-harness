import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TaskClassifier } from './TaskClassifier.js';
import { MethodologyCatalog } from './MethodologyCatalog.js';
import { CascadeRouter, type ModelExecutor, type AdvisoryResult } from './CascadeRouter.js';
import { PromptEngine, type RenderedPrompt } from './PromptEngine.js';
import { QualityEvaluator } from './QualityEvaluator.js';
import { QualityGateRunner, createDefaultGates } from './QualityGate.js';
import { PlanValidator } from './PlanValidator.js';
import { AuditTrail } from './AuditTrail.js';
import { MethodologyOrchestrator } from './MethodologyOrchestrator.js';
import { DEFAULT_CONFIG, type ModelProfile, type TaskType, type ModelTier, type TaskClassification, type CodeDiff } from './types.js';

function mockModelProfile(tier: ModelTier, id: string): ModelProfile {
  return {
    id,
    provider: 'test',
    name: `Test ${tier}`,
    tier,
    capabilities: {
      reasoning: tier === 'S' ? 0.95 : tier === 'A' ? 0.85 : tier === 'B' ? 0.7 : 0.5,
      coding: tier === 'S' ? 0.9 : tier === 'A' ? 0.8 : tier === 'B' ? 0.65 : 0.45,
      knowledge: 0.8,
      instructionFollowing: 0.8,
      toolUse: 0.7,
      vision: 0.5,
      contextUtilization: 0.7,
    },
    performance: { contextWindow: 128000, ttft: 500, tokensPerSecond: 100, costPerInputToken: 0.001, costPerOutputToken: 0.005 },
    taskPerformance: {},
    lastUpdated: new Date(),
    source: 'benchmark' as const,
  };
}

const mockProfiles: ModelProfile[] = [
  mockModelProfile('S', 'test/model-s'),
  mockModelProfile('A', 'test/model-a'),
  mockModelProfile('B', 'test/model-b'),
  mockModelProfile('C', 'test/model-c'),
];

function makeExecutor(results: Array<{ model: string; response: string; tokens: number; cost: number }>): ModelExecutor {
  const map = new Map(results.map(r => [r.model, r]));
  return {
    execute: async (modelId: string) => {
      const r = map.get(modelId);
      if (!r) throw new Error(`No mock result for ${modelId}`);
      return { response: r.response, tokens: r.tokens, cost: r.cost };
    },
  };
}

describe('Methodology Integration — classification → selection → routing', () => {
  it('classifies a generate task, selects methodology, recommends a model', () => {
    const classifier = new TaskClassifier();
    const catalog = new MethodologyCatalog();
    const classification = classifier.classify('Write a React component that fetches data from an API and displays it in a table with sorting and pagination', {
      hasImageAttachment: false,
    });
    assert.equal(classification.type, 'generate');

    const selection = catalog.select(classification);
    assert.ok(selection.methodology.length > 0);
    assert.ok(selection.confidence > 0);

    const router = new CascadeRouter(
      { maxEscalations: 2, qualityThresholds: { generate: 0.7 }, maxTokensPerRequest: 50000, maxCostPerRequest: 5, fallbackChain: [] },
      makeExecutor([
        { model: 'test/model-s', response: '```tsx\nfunction Component() { return <div/>; }\n```', tokens: 100, cost: 0.01 },
      ]),
    );
    const advisory = router.recommendModel(
      classification, selection.methodology, selection, mockProfiles,
      { S: ['test/model-s'], A: ['test/model-a'], B: ['test/model-b'], C: ['test/model-c'] },
    );
    assert.ok(typeof advisory.recommendedTier === 'string', `Expected tier string, got ${advisory.recommendedTier}`);
    assert.ok(advisory.recommendedModel.length > 0);
  });

  it('classifies a debug task and recommends a model', () => {
    const classifier = new TaskClassifier();
    const catalog = new MethodologyCatalog();
    const classification = classifier.classify('Why is this code throwing a TypeError? I have the error message and stack trace.', { hasImageAttachment: false });
    assert.equal(classification.type, 'debug');

    const selection = catalog.select(classification);
    assert.ok(selection.confidence > 0);

    const router = new CascadeRouter(
      { maxEscalations: 1, qualityThresholds: { debug: 0.7 }, maxTokensPerRequest: 50000, maxCostPerRequest: 5, fallbackChain: [] },
      makeExecutor([
        { model: 'test/model-b', response: 'The TypeError occurs because...', tokens: 50, cost: 0.001 },
      ]),
    );
    const advisory = router.recommendModel(
      classification, selection.methodology, selection, mockProfiles,
      { S: ['test/model-s'], A: ['test/model-a'], B: ['test/model-b'], C: ['test/model-c'] },
    );
    assert.ok(advisory.recommendedTier.length > 0);
    assert.ok(advisory.recommendedModel.includes('model-'));
  });

  it('does not downgrade an S-tier methodology recommendation', () => {
    const classifier = new TaskClassifier();
    const task = classifier.classify('Build a full authentication system with JWT, OAuth, session management, database schema, and frontend screens');
    const router = new CascadeRouter(
      { maxEscalations: 2, qualityThresholds: { generate: 0.7 }, maxTokensPerRequest: 50000, maxCostPerRequest: 5, fallbackChain: [] },
    );
    const advisory = router.recommendModel(
      task,
      'bmad-lite',
      {
        methodology: 'bmad-lite',
        recommendedTier: 'S',
        promptStrategy: 'plan-then-execute',
        executionPattern: 'hybrid',
        confidence: 0.9,
        matchedRule: null,
      },
      mockProfiles,
      { S: ['test/model-s'], A: ['test/model-a'], B: ['test/model-b'], C: ['test/model-c'] },
    );

    assert.equal(advisory.recommendedTier, 'S');
    assert.equal(advisory.recommendedModel, 'test/model-s');
    assert.deepEqual(advisory.fallbackChain.map((entry) => entry.tier), ['S']);
  });

  it('recommends a C-tier model when start tier is C', () => {
    const router = new CascadeRouter(
      { maxEscalations: 2, qualityThresholds: { explain: 0.6 }, maxTokensPerRequest: 50000, maxCostPerRequest: 5, fallbackChain: [] },
    );
    const advisory = router.recommendModel(
      {
        type: 'explain',
        complexity: { depth: 0.2, width: 0.2, ambiguity: 0.1, fileScope: 0.1 },
        modalities: { needsVision: false, needsDiagram: false, needsCodeExec: false },
        constraints: { speedPreferred: false, qualityPreferred: false },
        signals: { queryLength: 20, hasCodeSnippet: false, hasFilePath: false, hasAmbiguityMarkers: false, hasImageAttachment: false, subQuestionCount: 1 },
      },
      'direct-execution',
      {
        methodology: 'direct-execution',
        recommendedTier: 'C',
        promptStrategy: 'direct',
        executionPattern: 'sequential',
        confidence: 0.6,
        matchedRule: null,
      },
      mockProfiles,
      { S: ['test/model-s'], A: ['test/model-a'], B: ['test/model-b'], C: ['test/model-c'] },
    );

    assert.notEqual(advisory.recommendedModel, '');
    assert.equal(advisory.recommendedTier, 'C');
    assert.ok(advisory.recommendedModel.includes('model-c'), `expected C-tier model, got ${advisory.recommendedModel}`);
  });

  it('returns empty recommendation when no models exist for tier', () => {
    const router = new CascadeRouter(
      { maxEscalations: 2, qualityThresholds: { explain: 0.6 }, maxTokensPerRequest: 50000, maxCostPerRequest: 5, fallbackChain: [] },
    );
    const advisory = router.recommendModel(
      {
        type: 'explain',
        complexity: { depth: 0.2, width: 0.2, ambiguity: 0.1, fileScope: 0.1 },
        modalities: { needsVision: false, needsDiagram: false, needsCodeExec: false },
        constraints: { speedPreferred: false, qualityPreferred: false },
        signals: { queryLength: 20, hasCodeSnippet: false, hasFilePath: false, hasAmbiguityMarkers: false, hasImageAttachment: false, subQuestionCount: 1 },
      },
      'direct-execution',
      {
        methodology: 'direct-execution',
        recommendedTier: 'S',
        promptStrategy: 'direct',
        executionPattern: 'sequential',
        confidence: 0.6,
        matchedRule: null,
      },
      [],
      { S: [], A: [], B: [], C: [] },
    );

    assert.equal(advisory.recommendedModel, '');
    assert.equal(advisory.recommendedTier, 'S');
    assert.equal(advisory.fallbackChain.length, 0);
  });

  it('updateConfig applies cascade changes to future recommendations', () => {
    const orchestrator = new MethodologyOrchestrator();
    orchestrator.updateConfig({
      cascade: { ...DEFAULT_CONFIG.cascade, maxEscalations: 0 },
    });

    const result = orchestrator.advise('Build a full authentication system with JWT, OAuth, session management, database schema, and frontend screens');

    assert.equal(result.advisory.fallbackChain.length, 1);
  });

  it('cascade escalates from B to A to S when quality is insufficient', async () => {
    const classifier = new TaskClassifier();
    const classification = classifier.classify('Build a full authentication system with JWT, OAuth, and session management', { hasImageAttachment: false });
    assert.equal(classification.type, 'generate');

    let callOrder = 0;
    const executor: ModelExecutor = {
      execute: async (modelId: string) => {
        callOrder++;
        if (modelId === 'test/model-b') return { response: 'Basic auth setup', tokens: 50, cost: 0.001 };
        if (modelId === 'test/model-a') return { response: 'Auth with JWT and middleware', tokens: 100, cost: 0.005 };
        if (modelId === 'test/model-s') return { response: 'Full auth with JWT, OAuth providers, session store, refresh tokens, middleware chain', tokens: 200, cost: 0.01 };
        throw new Error(`Unknown model: ${modelId}`);
      },
    };

    const auditor = new AuditTrail();
    let currentModel = 'test/model-b';
    let finalResult: { modelId: string; quality: number; escalations: number } | null = null;

    const qualityEval = new QualityEvaluator();
    const fallbackChain = ['test/model-a', 'test/model-s'];

    for (let esc = 0; esc <= 2; esc++) {
      const traceId = auditor.startTrace(`cascade-${esc}`, 'bmad-lite', currentModel, `plan-${esc}`);
      const result = await executor.execute(currentModel, '', '');
      const respQuality = qualityEval.overallScore(qualityEval.evaluate(result.response, classification));

      if (respQuality >= 0.8 || esc === 2) {
        auditor.endTrace(traceId, 'success', respQuality, result.cost, result.tokens, 1000);
        finalResult = { modelId: currentModel, quality: respQuality, escalations: esc };
        break;
      }

      auditor.endTrace(traceId, 'degraded', respQuality, result.cost, result.tokens, 500, {
        class: 'quality',
        message: `Quality ${respQuality} below threshold 0.8`,
        recoverable: true,
        recoveryAction: 'escalate',
        userMessage: `Escalating from ${currentModel}`,
      });

      currentModel = fallbackChain[esc] ?? currentModel;
    }

    assert.ok(finalResult, 'Should have reached a final result');
    assert.equal(finalResult!.modelId, 'test/model-s');
    assert.ok(finalResult!.quality >= 0.8 || finalResult!.escalations === 2);

    const entries = auditor.getEntries();
    assert.ok(entries.length >= 2);
  });

  it('prompt engine renders strategy and respects token budget', () => {
    const engine = new PromptEngine();
    const classification: TaskClassification = {
      type: 'generate',
      complexity: { depth: 0.7, width: 0.5, ambiguity: 0.3, fileScope: 0.4 },
      modalities: { needsVision: false, needsDiagram: false, needsCodeExec: false },
      constraints: { speedPreferred: false, qualityPreferred: true },
      signals: { queryLength: 80, hasCodeSnippet: false, hasFilePath: false, hasAmbiguityMarkers: false, hasImageAttachment: false, subQuestionCount: 1 },
    };

    const rendered = engine.render('hierarchical-cot', {
      task: 'Build a login form',
      classification,
      context: [],
      maxTokens: 4000,
      temperature: 0.3,
    });
    assert.ok(rendered.systemPrompt.length > 0);
    assert.ok(rendered.userPrompt.length > 0);
    assert.ok(rendered.totalTokens > 0);

    const longPrompt: RenderedPrompt = {
      systemPrompt: 'system instruction',
      userPrompt: 'A very long string '.repeat(10000),
      totalTokens: 100000,
      temperature: 0.3,
      maxTokens: 4000,
    };
    const truncated = engine.truncateToBudget(longPrompt, 50);
    assert.ok(truncated.userPrompt.length < longPrompt.userPrompt.length, 'truncated prompt should be shorter');
  });

  it('quality gates pass for clean diff and warn for large diff', async () => {
    const gates = createDefaultGates();
    const runner = new QualityGateRunner(gates);

    const cleanDiff: CodeDiff = { filesChanged: 1, linesAdded: 5, linesRemoved: 2, linesChanged: 7, newContent: 'const x = 1;\n', oldContent: '', imports: ['fs'] };
    const cleanReport = await runner.run(cleanDiff);
    assert.ok(cleanReport.passed);

    const largeDiff: CodeDiff = { filesChanged: 1, linesAdded: 500, linesRemoved: 0, linesChanged: 500, newContent: Array.from({ length: 500 }, (_, i) => `line${i} = ${i};\n`).join(''), oldContent: '', imports: [] };
    const largeReport = await runner.run(largeDiff);
    assert.equal(largeReport.blocked.length, 0, `expected no blocks, got: ${largeReport.blocked.join(', ')}`);
    assert.ok(largeReport.warnings.includes('diff-size'), 'diff-size should warn');
  });

  it('plan validator validates a correct plan', async () => {
    const validator = new PlanValidator();
    const result = await validator.validate({
      nodes: [
        { id: 'read-file', type: 'read', tool: 'read', params: { path: 'test.txt' } },
        { id: 'parse', type: 'transform', tool: 'parse', params: {}, dependencies: ['read-file'] },
        { id: 'write', type: 'write', tool: 'write', params: { path: 'out.txt' }, dependencies: ['parse'], idempotencyKey: 'write-1' },
      ],
      edges: [
        { from: 'read-file', to: 'parse' },
        { from: 'parse', to: 'write' },
      ],
      totalBudget: 100,
    });
    assert.ok(result.valid, `Expected valid plan, got errors: ${result.checks.filter(c => !c.passed).map(c => c.error).join(', ')}`);
  });

  it('plan validator rejects a plan with cycles', async () => {
    const validator = new PlanValidator();
    const result = await validator.validate({
      nodes: [
        { id: 'a', type: 'read', tool: 'read', params: {} },
        { id: 'b', type: 'transform', tool: 'parse', params: {}, dependencies: ['c'] },
        { id: 'c', type: 'transform', tool: 'parse', params: {}, dependencies: ['a', 'b'] },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'b' },
      ],
      totalBudget: 100,
    });
    assert.equal(result.valid, false);
    assert.ok(result.checks.some(c => !c.passed && c.name === 'dag_acyclic'));
  });
});
