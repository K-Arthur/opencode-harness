/**
 * Methodology Enhancement Module
 *
 * Proactive AI development methodology selection and application
 * for the OpenCode Harness VS Code extension.
 *
 * Builds ON TOP of existing skills infrastructure:
 * - TaskClassifier (src/skills/) — task intent classification (renamed to SkillsTaskClassifier)
 * - SkillTriggerEngine (src/skills/) — skill triggering rules
 * - ConfidenceScorer (src/skills/) — multi-signal confidence scoring
 * - TaskDecomposer (src/skills/) — dependency-aware decomposition
 * - TDDOrchestrator (src/skills/) — Red-Green-Refactor-Coverage cycles
 * - ModelManager (src/model/) — model management
 * - PromptManager (src/prompts/) — custom prompt resolution
 * - ContextEngine (src/context/) — context gathering
 *
 * New methodology-specific components:
 * - TaskClassifier (local) — granular task classification for methodology selection
 * - MethodologyCatalog — methodology rule matching and prompt templates
 * - CascadeRouter — cascade model routing with quality evaluation
 * - MethodologyOrchestrator — central pipeline coordinator
 */

// Re-export existing skills infrastructure (renamed to avoid naming conflicts)
export { TaskClassifier as SkillsTaskClassifier } from '../skills/TaskClassifier.js';
export { SkillTriggerEngine } from '../skills/SkillTriggerEngine.js';
export { ConfidenceScorer } from '../skills/ConfidenceScorer.js';
export { TaskDecomposer } from '../skills/TaskDecomposer.js';
export { TDDOrchestrator } from '../skills/TDDOrchestrator.js';
export { ModelManager } from '../model/ModelManager.js';
export { PromptManager } from '../prompts/PromptManager.js';
export { ContextEngine } from '../context/ContextEngine.js';

// New methodology-specific components
export { TaskClassifier } from './TaskClassifier.js';
export { MethodologyCatalog, METHODOLOGY_RULES, PROMPT_TEMPLATES } from './MethodologyCatalog.js';
export { CascadeRouter, QualityEvaluator } from './CascadeRouter.js';
export { QualityEvaluator as StandaloneQualityEvaluator } from './QualityEvaluator.js';
export { MethodologyOrchestrator, type AdvisoryOrchestrationResult } from './MethodologyOrchestrator.js';
export { PromptEngine } from './PromptEngine.js';
export { SchemaValidator } from './SchemaValidator.js';
export type { SchemaDefinition, SchemaField, ValidationError, ValidatorConfig } from './SchemaValidator.js';
export { SkillManager } from './SkillManager.js';
export type { SkillDefinition, SkillMatch, ComposedInstructions } from './SkillManager.js';
export { AgentsMdGenerator } from './AgentsMdGenerator.js';
export type { TechStack, ProjectStructure, AgentsMdResult } from './AgentsMdGenerator.js';
export { MethodologyAdvisor, METHODOLOGY_ADDENDUM_PREFIX } from './MethodologyAdvisor.js';
export type { MethodologyAdvice, AdviseOptions } from './MethodologyAdvisor.js';
export { SpecService, InMemorySpecStore } from './SpecService.js';
export type { Spec, SpecElements, SpecStatus, SpecStore, TaskBreakdownItem, VerificationCriterion } from './SpecService.js';
export { ModelProfileRegistry } from './ModelProfileRegistry.js';
export type { ModelProfileEntry } from './ModelProfileRegistry.js';
export { OutcomeTracker } from './OutcomeTracker.js';
export type { OutcomeSignal, OutcomeEvent, MethodologyOutcomeStats } from './OutcomeTracker.js';
export { QualityGateRunner } from './QualityGate.js';
export type { GateCheckResult, GateReport } from './QualityGate.js';
export { PlanValidator } from './PlanValidator.js';
export type { ExecutionPlanNode, ExecutionPlanEdge, ExecutionPlan, CheckResult, ValidationResult } from './PlanValidator.js';
export type * from './types.js';
