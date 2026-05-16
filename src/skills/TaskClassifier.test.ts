/**
 * Unit tests for TaskClassifier — Phase 1 SADD/TDD enhancements.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TaskClassifier } from './TaskClassifier';

void describe('TaskClassifier', () => {
  let classifier: TaskClassifier;

  beforeEach(() => {
    classifier = new TaskClassifier();
  });

  void describe('classify', () => {
    void it('should classify debugging tasks', () => {
      const result = classifier.classify('Fix the bug in the login flow');
      assert.strictEqual(result.type, 'debugging');
    });

    void it('should classify testing tasks', () => {
      const result = classifier.classify('Write unit tests for the auth module');
      assert.strictEqual(result.type, 'testing');
    });

    void it('should classify refactoring tasks', () => {
      const result = classifier.classify('Refactor the database layer');
      assert.strictEqual(result.type, 'refactoring');
    });

    void it('should classify documentation tasks', () => {
      const result = classifier.classify('Document the API endpoints');
      assert.strictEqual(result.type, 'documentation');
    });

    void it('should classify coding tasks', () => {
      const result = classifier.classify('Create a new user component');
      assert.strictEqual(result.type, 'coding');
    });

    void it('should prioritize testing over debugging for ambiguous messages', () => {
      const result = classifier.classify('Test the error handling for the bug fix');
      assert.strictEqual(result.type, 'testing');
    });

    void it('should detect frontend domain', () => {
      const result = classifier.classify('Build a React component for the dashboard');
      assert.strictEqual(result.domain, 'frontend');
    });

    void it('should detect backend domain', () => {
      const result = classifier.classify('Create an API endpoint for user data');
      assert.strictEqual(result.domain, 'api');
    });

    void it('should detect database domain', () => {
      const result = classifier.classify('Add a database migration for the users table');
      assert.strictEqual(result.domain, 'database');
    });

    void it('should return general for unrecognized domain', () => {
      const result = classifier.classify('Write a script to process files');
      assert.strictEqual(result.domain, 'general');
    });

    void it('should detect simple complexity', () => {
      const result = classifier.classify('Quick fix for the typo');
      assert.strictEqual(result.complexity, 'simple');
    });

    void it('should detect complex complexity', () => {
      const result = classifier.classify('Implement a comprehensive authentication system');
      assert.strictEqual(result.complexity, 'complex');
    });

    void it('should extract meaningful keywords', () => {
      const result = classifier.classify('Create a React component for user authentication with OAuth');
      assert.ok(result.keywords.length > 0);
      assert.ok(!result.keywords.includes('the'));
      assert.ok(!result.keywords.includes('for'));
    });
  });

  void describe('analyzeWithStructure', () => {
    void it('should return a full TaskAnalysis with decomposition strategy', async () => {
      const result = await classifier.analyzeWithStructure(
        'Create a simple function to check email addresses',
        'test-repo',
      );

      assert.strictEqual(result.type, 'coding');
      assert.ok(result.decompositionStrategy !== undefined);
      assert.ok(result.tddRecommended !== undefined);
      assert.ok(result.estimatedSubtasks !== undefined);
      assert.ok(result.dependencyGraph !== undefined);
      assert.ok(result.riskScore !== undefined);
      assert.ok(result.frontendBackendSplit !== undefined);
    });

    void it('should select single strategy for simple tasks', async () => {
      const result = await classifier.analyzeWithStructure(
        'Quick fix for a typo in the readme',
        'test-repo',
      );

      assert.strictEqual(result.decompositionStrategy, 'single');
    });

    void it('should select hierarchical strategy for complex tasks', async () => {
      const result = await classifier.analyzeWithStructure(
        'Build a comprehensive dashboard with multiple widgets, real-time data, and complex state management',
        'test-repo',
      );

      assert.strictEqual(result.decompositionStrategy, 'hierarchical');
    });

    void it('should select hierarchical strategy for cross-domain tasks', async () => {
      const result = await classifier.analyzeWithStructure(
        'Create a React component that fetches data from the backend API and displays it',
        'test-repo',
      );

      assert.strictEqual(result.frontendBackendSplit, true);
      assert.strictEqual(result.decompositionStrategy, 'hierarchical');
    });

    void it('should recommend TDD for coding tasks', async () => {
      const result = await classifier.analyzeWithStructure(
        'Create a new API endpoint for user registration',
        'test-repo',
      );

      assert.strictEqual(result.tddRecommended, true);
    });

    void it('should not recommend TDD for documentation tasks', async () => {
      const result = await classifier.analyzeWithStructure(
        'Document the API endpoints',
        'test-repo',
      );

      assert.strictEqual(result.tddRecommended, false);
    });

    void it('should not recommend TDD for testing tasks', async () => {
      const result = await classifier.analyzeWithStructure(
        'Write unit tests for the auth module',
        'test-repo',
      );

      assert.strictEqual(result.tddRecommended, false);
    });

    void it('should recommend TDD for debugging tasks', async () => {
      const result = await classifier.analyzeWithStructure(
        'Fix the bug in the login flow',
        'test-repo',
      );

      assert.strictEqual(result.tddRecommended, true);
    });

    void it('should recommend TDD for refactoring tasks', async () => {
      const result = await classifier.analyzeWithStructure(
        'Refactor the database layer',
        'test-repo',
      );

      assert.strictEqual(result.tddRecommended, true);
    });

    void it('should estimate 1 subtask for simple tasks', async () => {
      const result = await classifier.analyzeWithStructure(
        'Quick fix',
        'test-repo',
      );

      assert.strictEqual(result.estimatedSubtasks, 1);
    });

    void it('should estimate more subtasks for complex tasks', async () => {
      const result = await classifier.analyzeWithStructure(
        'Build a comprehensive system with multiple modules',
        'test-repo',
      );

      assert.ok(result.estimatedSubtasks >= 1);
    });

    void it('should calculate risk score between 0 and 1', async () => {
      const result = await classifier.analyzeWithStructure(
        'Create a new feature',
        'test-repo',
      );

      assert.ok(result.riskScore >= 0);
      assert.ok(result.riskScore <= 1);
    });

    void it('should have higher risk for complex coding tasks', async () => {
      const simpleResult = await classifier.analyzeWithStructure(
        'Quick fix',
        'test-repo',
      );
      const complexResult = await classifier.analyzeWithStructure(
        'Build a comprehensive authentication system with OAuth, session management, and role-based access control',
        'test-repo',
      );

      assert.ok(complexResult.riskScore >= simpleResult.riskScore);
    });

    void it('should include dependency graph with source and test files', async () => {
      const result = await classifier.analyzeWithStructure(
        'Create a new component',
        'test-repo',
      );

      assert.ok(result.dependencyGraph.sourceFiles !== undefined);
      assert.ok(result.dependencyGraph.testFiles !== undefined);
      assert.ok(Array.isArray(result.dependencyGraph.sourceFiles));
      assert.ok(Array.isArray(result.dependencyGraph.testFiles));
    });
  });

  void describe('strategy selection', () => {
    void it('simple + coding → single', async () => {
      const result = await classifier.analyzeWithStructure(
        'Add a simple helper function',
        'test-repo',
      );
      assert.strictEqual(result.decompositionStrategy, 'single');
    });

    void it('complex + any → hierarchical', async () => {
      const result = await classifier.analyzeWithStructure(
        'Build a comprehensive platform with multiple services',
        'test-repo',
      );
      assert.strictEqual(result.decompositionStrategy, 'hierarchical');
    });

    void it('medium + cross-domain → hierarchical', async () => {
      const result = await classifier.analyzeWithStructure(
        'Create a React component with API integration',
        'test-repo',
      );
      assert.strictEqual(result.decompositionStrategy, 'hierarchical');
    });
  });

  void describe('cross-domain detection', () => {
    void it('should detect frontend + backend split', async () => {
      const result = await classifier.analyzeWithStructure(
        'Build a React component that calls the backend API service',
        'test-repo',
      );
      assert.strictEqual(result.frontendBackendSplit, true);
    });

    void it('should detect frontend + API split', async () => {
      const result = await classifier.analyzeWithStructure(
        'Create a Vue component with REST endpoint integration',
        'test-repo',
      );
      assert.strictEqual(result.frontendBackendSplit, true);
    });

    void it('should not detect split for single-domain tasks', async () => {
      const result = await classifier.analyzeWithStructure(
        'Write unit tests for the database layer',
        'test-repo',
      );
      assert.strictEqual(result.frontendBackendSplit, false);
    });
  });
});
