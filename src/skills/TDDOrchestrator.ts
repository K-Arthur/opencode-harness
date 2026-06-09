/**
 * TDDOrchestrator — Manages Red-Green-Refactor-Coverage cycles
 * for test-driven development across frontend and backend domains.
 *
 * Phase 3: Connects to actual test runners (Vitest/Jest) and subagent dispatch
 * to orchestrate TDD workflows with progress tracking and feedback.
 *
 * Spec-Driven Enhancement: Supports spec-driven workflows where specifications
 * guide the TDD process, providing outcomes, scope, and verification criteria.
 */

import {
  TddPhase,
  TddOrchestrationState,
  TddMetrics,
  DecomposedTask,
  SubagentActivity,
} from './types';

// Spec-driven types
interface Spec {
  outcomes: string[];
  scope: { inScope: string[]; outOfScope: string[] };
  constraints: string[];
  verificationCriteria: Array<{ criteria: string; test?: string; automated?: boolean }>;
}

interface SpecAwareTask extends DecomposedTask {
  spec?: Spec;
}

interface TestRunnerResult {
  passed: boolean;
  output: string;
  testCount: number;
  passCount: number;
  failCount: number;
  coveragePercent?: number;
}

interface TestRunnerOptions {
  coverage?: boolean;
}

interface SubagentDispatchResult {
  agentId: string;
  status: 'completed' | 'failed';
  output: string;
  filesModified: string[];
}

type TddPhaseName = 'red' | 'green' | 'refactor' | 'coverage';

class TDDOrchestrator {
  private state: TddOrchestrationState | null = null;
  private metrics: TddMetrics | null = null;
  private maxIterations = 5;
  private minCoverage = 80;
  private currentSpec?: Spec;

  constructor(options?: { maxIterations?: number; minCoverage?: number }) {
    this.maxIterations = options?.maxIterations ?? this.maxIterations;
    this.minCoverage = options?.minCoverage ?? this.minCoverage;
  }

  /**
   * Set a spec to guide the TDD process.
   */
  setSpec(spec: Spec): void {
    this.currentSpec = spec;
  }

  /**
   * Get the current spec.
   */
  getSpec(): Spec | undefined {
    return this.currentSpec;
  }

  /**
   * Initialize TDD orchestration for a decomposed task.
   */
  async start(task: DecomposedTask): Promise<TddOrchestrationState> {
    this.state = {
      taskId: task.id,
      phases: this.initializePhases(task),
      currentPhase: 0,
      totalTests: 0,
      passingTests: 0,
      failingTests: 0,
      testFramework: task.tddScope.testFramework,
      domain: task.domain,
    };

    this.metrics = {
      taskId: task.id,
      domain: task.domain,
      testsGenerated: 0,
      testsPassedFirstRun: 0,
      redGreenRefactorCycles: 0,
      finalCoverage: 0,
      bugsFoundPostTdd: 0,
      success: false,
    };

    return this.state;
  }

  /**
   * Execute the full TDD cycle for the current phase.
   */
  async executeCycle(
    dispatchSubagent: (prompt: string, task: DecomposedTask) => Promise<SubagentDispatchResult>,
    runTests: (testFiles: string[], options?: TestRunnerOptions) => Promise<TestRunnerResult>,
  ): Promise<TddOrchestrationState> {
    if (!this.state) {
      throw new Error('TDD orchestration not started. Call start() first.');
    }

    const phase = this.state.phases[this.state.currentPhase];
    if (!phase) {
      return this.complete();
    }

    switch (phase.name) {
      case 'red':
        await this.executeRedPhase(phase, dispatchSubagent, runTests);
        break;
      case 'green':
        await this.executeGreenPhase(phase, dispatchSubagent, runTests);
        break;
      case 'refactor':
        await this.executeRefactorPhase(phase, dispatchSubagent, runTests);
        break;
      case 'coverage':
        await this.executeCoveragePhase(phase, runTests);
        break;
    }

    // Move to next phase if current is complete
    if (phase.status === 'completed') {
      this.state.currentPhase++;
    }

    return this.state;
  }

  /**
   * RED Phase: Write failing tests.
   * Spec-aware: Uses spec verification criteria to guide test generation.
   */
  private async executeRedPhase(
    phase: TddPhase,
    dispatchSubagent: (prompt: string, task: DecomposedTask) => Promise<SubagentDispatchResult>,
    runTests: (testFiles: string[], options?: TestRunnerOptions) => Promise<TestRunnerResult>,
  ): Promise<void> {
    const prompt = this.buildRedPrompt(phase);
    const result = await dispatchSubagent(prompt, this.getTaskFromState());

    if (result.status === 'failed') {
      phase.status = 'failed';
      return;
    }

    // Write test content to file
    phase.testContent = result.output;
    phase.iterations++;

    // Verify tests fail (RED condition)
    const testResult = await runTests([phase.testFile ?? '']);
    if (!testResult.passed) {
      phase.status = 'completed';
      this.state!.failingTests = testResult.failCount;
      this.state!.totalTests = testResult.testCount;
      this.metrics!.testsGenerated += testResult.testCount;
    } else {
      // Tests passed when they should fail — iterate
      if (phase.iterations < this.maxIterations) {
        phase.status = 'in-progress';
      } else {
        phase.status = 'failed';
      }
    }
  }

  /**
   * Build RED phase prompt with spec awareness.
   */
  private buildRedPrompt(phase: TddPhase): string {
    let prompt = `Write failing unit tests for the specified functionality.
Tests should cover:
- Happy path scenarios
- Edge cases and error conditions
- Boundary values

File: ${phase.testFile}
The tests MUST fail when run. Do not implement the functionality yet.`;

    if (this.currentSpec) {
      prompt += `\n\nSpec context:\n`;
      prompt += `Outcomes: ${this.currentSpec.outcomes.join(', ')}\n`;
      prompt += `In Scope: ${this.currentSpec.scope.inScope.join(', ')}\n`;
      prompt += `Constraints: ${this.currentSpec.constraints.join(', ')}\n`;
      
      const relevantCriteria = this.currentSpec.verificationCriteria.filter(c => c.test);
      if (relevantCriteria.length > 0) {
        prompt += `Verification Criteria: ${relevantCriteria.map(c => c.criteria).join(', ')}\n`;
      }
    }

    return prompt;
  }

  /**
   * GREEN Phase: Implement minimal code to make tests pass.
   */
  private async executeGreenPhase(
    phase: TddPhase,
    dispatchSubagent: (prompt: string, task: DecomposedTask) => Promise<SubagentDispatchResult>,
    runTests: (testFiles: string[], options?: TestRunnerOptions) => Promise<TestRunnerResult>,
  ): Promise<void> {
    const prompt = this.buildGreenPrompt(phase);
    const result = await dispatchSubagent(prompt, this.getTaskFromState());

    if (result.status === 'failed') {
      phase.status = 'failed';
      return;
    }

    // Write implementation content
    phase.implementationContent = result.output;
    phase.iterations++;

    // Verify tests pass (GREEN condition)
    const testResult = await runTests([phase.testFile ?? '']);
    if (testResult.passed) {
      phase.status = 'completed';
      this.state!.passingTests = testResult.passCount;
      this.state!.totalTests = testResult.testCount;
      this.metrics!.redGreenRefactorCycles++;

      if (phase.iterations === 1) {
        this.metrics!.testsPassedFirstRun++;
      }
    } else {
      // Tests still failing — iterate
      phase.testOutput = testResult.output;
      if (phase.iterations < this.maxIterations) {
        phase.status = 'in-progress';
      } else {
        phase.status = 'failed';
      }
    }
  }

  /**
   * REFACTOR Phase: Clean up code while keeping tests green.
   */
  private async executeRefactorPhase(
    phase: TddPhase,
    dispatchSubagent: (prompt: string, task: DecomposedTask) => Promise<SubagentDispatchResult>,
    runTests: (testFiles: string[], options?: TestRunnerOptions) => Promise<TestRunnerResult>,
  ): Promise<void> {
    const prompt = this.buildRefactorPrompt(phase);
    const result = await dispatchSubagent(prompt, this.getTaskFromState());

    if (result.status === 'failed') {
      phase.status = 'failed';
      return;
    }

    // Update implementation with refactored code
    phase.implementationContent = result.output;
    phase.iterations++;

    // Verify tests still pass after refactoring
    const testResult = await runTests([phase.testFile ?? '']);
    if (testResult.passed) {
      phase.status = 'completed';
      this.metrics!.redGreenRefactorCycles++;
    } else {
      // Refactoring broke tests — revert and mark failed
      phase.testOutput = testResult.output;
      phase.status = 'failed';
    }
  }

  /**
   * COVERAGE Phase: Measure and improve test coverage.
   */
  private async executeCoveragePhase(
    phase: TddPhase,
    runTests: (testFiles: string[], options?: TestRunnerOptions) => Promise<TestRunnerResult>,
  ): Promise<void> {
    const testResult = await runTests([phase.testFile ?? ''], { coverage: true });
    phase.iterations++;

    if (testResult.coveragePercent !== undefined) {
      this.state!.coveragePercent = testResult.coveragePercent;
      this.metrics!.finalCoverage = testResult.coveragePercent;

      if (testResult.coveragePercent >= this.minCoverage) {
        phase.status = 'completed';
      } else {
        // Coverage below threshold — need more tests
        phase.status = 'in-progress';
        // Loop back to RED phase for additional tests
        this.state!.currentPhase = 0;
        const redPhase = this.state!.phases.find(p => p.name === 'red');
        if (redPhase) {
          redPhase.status = 'pending';
        }
      }
    } else {
      // Coverage not available — mark complete anyway
      phase.status = 'completed';
    }
  }

  /**
   * Complete the TDD cycle and finalize metrics.
   */
  private complete(): TddOrchestrationState {
    if (!this.state || !this.metrics) {
      throw new Error('TDD orchestration not started.');
    }

    this.metrics.success = this.state.phases.every(p => p.status === 'completed');
    this.state.currentPhase = this.state.phases.length;

    return this.state;
  }

  /**
   * Get current TDD activity for UI display.
   */
  getActivity(): SubagentActivity | null {
    if (!this.state) return null;

    const phase = this.state.phases[this.state.currentPhase];
    if (!phase) return null;

    return {
      id: this.state.taskId,
      name: `TDD: ${phase.name.toUpperCase()}`,
      status: phase.status === 'completed' ? 'completed' : phase.status === 'failed' ? 'failed' : 'running',
      progress: this.calculateProgress(),
      tddPhase: phase.name,
      testsWritten: this.state.totalTests,
      testsPassing: this.state.passingTests,
      domain: this.state.domain,
    };
  }

  /**
   * Get final metrics after TDD cycle completes.
   */
  getMetrics(): TddMetrics | null {
    return this.metrics;
  }

  /**
   * Reset the orchestrator for a new task.
   */
  reset(): void {
    this.state = null;
    this.metrics = null;
  }

  // --- Private helpers ---

  private initializePhases(task: DecomposedTask): TddPhase[] {
    return [
      {
        name: 'red',
        status: 'pending',
        testFile: task.testFiles[0],
        iterations: 0,
      },
      {
        name: 'green',
        status: 'pending',
        implementationFile: task.files[0],
        iterations: 0,
      },
      {
        name: 'refactor',
        status: 'pending',
        implementationFile: task.files[0],
        iterations: 0,
      },
      {
        name: 'coverage',
        status: 'pending',
        iterations: 0,
      },
    ];
  }

  private calculateProgress(): number {
    if (!this.state) return 0;

    const completedPhases = this.state.phases.filter(
      p => p.status === 'completed',
    ).length;
    const totalPhases = this.state.phases.length;

    return Math.round((completedPhases / totalPhases) * 100);
  }

  private getTaskFromState(): DecomposedTask {
    // Reconstruct minimal task from state for subagent prompts
    return {
      id: this.state!.taskId,
      title: `TDD Task: ${this.state!.domain}`,
      description: `TDD orchestration for ${this.state!.domain} domain`,
      domain: this.state!.domain,
      dependencies: [],
      files: this.state!.phases.map(p => p.implementationFile).filter(Boolean) as string[],
      testFiles: this.state!.phases.map(p => p.testFile).filter(Boolean) as string[],
      estimatedComplexity: 'medium',
      tddScope: {
        testType: 'unit',
        testFramework: this.state!.testFramework,
        testPatterns: [],
        edgeCases: [],
      },
    };
  }

  private buildGreenPrompt(phase: TddPhase): string {
    return `Implement the MINIMAL code needed to make the failing tests pass.
Do NOT refactor or add extra features — just make tests green.

Test file: ${phase.testFile}
Implementation file: ${phase.implementationFile}
Test output (failures): ${phase.testOutput ?? 'N/A'}

Focus on the simplest implementation that satisfies all test assertions.`;
  }

  private buildRefactorPrompt(phase: TddPhase): string {
    return `Refactor the implementation to improve code quality while keeping all tests passing.
Focus on:
- Code readability and clarity
- Removing duplication
- Improving naming and structure
- Following best practices

Implementation file: ${phase.implementationFile}
Test file: ${phase.testFile}

IMPORTANT: All tests must still pass after refactoring.`;
  }
}

export { TDDOrchestrator };
export type { TestRunnerResult, SubagentDispatchResult };
