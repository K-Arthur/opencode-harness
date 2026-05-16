/**
 * Prompt Engine — renders methodology-specific prompts with context
 * optimization, token budget management, and variable substitution.
 *
 * Supports all prompt strategies from the MethodologyCatalog:
 * direct, hierarchical-cot, plan-then-execute, iterative-refinement,
 * multi-agent-debate, cross-modal, schema-first, few-shot-strong,
 * conversational-decompose.
 */

import {
  PromptStrategy,
  PromptTemplate,
  ContextItem,
  OptimizedContext,
  TaskClassification,
  MethodologySelection,
} from './types.js';
import { PROMPT_TEMPLATES } from './MethodologyCatalog.js';

// ─── Token Estimation ───────────────────────────────────────────────────────

/**
 * Estimate token count for text.
 * Uses a conservative 4 characters-per-token ratio (works for most languages).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Prompt Engine ──────────────────────────────────────────────────────────

export interface PromptRenderOptions {
  /** The user's task/query */
  task: string;
  /** Task classification for context-aware rendering */
  classification?: TaskClassification;
  /** Methodology selection for strategy-aware rendering */
  methodology?: MethodologySelection;
  /** JSON schema for schema-first strategy */
  schema?: Record<string, unknown>;
  /** Few-shot examples for few-shot-strong strategy */
  examples?: Array<{ input: string; output: string }>;
  /** Image description for cross-modal strategy */
  imageDescription?: string;
  /** Context items to include */
  context?: ContextItem[];
  /** Maximum tokens for the rendered prompt */
  maxTokens?: number;
  /** Temperature override */
  temperature?: number;
}

export interface RenderedPrompt {
  systemPrompt: string;
  userPrompt: string;
  totalTokens: number;
  temperature: number;
  maxTokens: number;
}

export class PromptEngine {
  /**
   * Render a complete prompt for a given strategy and options.
   */
  render(
    strategy: PromptStrategy,
    options: PromptRenderOptions
  ): RenderedPrompt {
    const template = this.getTemplate(strategy);
    const systemPrompt = this.renderSystemPrompt(template, options);
    const userPrompt = this.renderUserPrompt(template, options);
    const context = this.optimizeContext(options.context ?? [], options.maxTokens ?? 8000);

    const fullSystemPrompt = this.injectContext(systemPrompt, context, 'beginning');
    const totalTokens = estimateTokens(fullSystemPrompt) + estimateTokens(userPrompt);

    return {
      systemPrompt: fullSystemPrompt,
      userPrompt,
      totalTokens,
      temperature: options.temperature ?? template.temperature ?? this.defaultTemperature(strategy),
      maxTokens: options.maxTokens ?? template.maxTokens ?? 4096,
    };
  }

  /**
   * Get the base template for a strategy.
   */
  private getTemplate(strategy: PromptStrategy): PromptTemplate {
    const base = PROMPT_TEMPLATES[strategy];
    if (!base) {
      return {
        systemPrompt: PROMPT_TEMPLATES['hierarchical-cot'].systemPrompt,
        userPromptTemplate: PROMPT_TEMPLATES['hierarchical-cot'].userPromptTemplate,
        maxTokens: 4096,
        temperature: this.defaultTemperature('hierarchical-cot'),
      };
    }
    return {
      systemPrompt: base.systemPrompt,
      userPromptTemplate: base.userPromptTemplate,
      maxTokens: base.maxTokens ?? 4096,
      temperature: base.temperature ?? this.defaultTemperature(strategy),
    };
  }

  /**
   * Default temperature per strategy.
   * Lower for structured outputs, higher for creative tasks.
   */
  private defaultTemperature(strategy: PromptStrategy): number {
    switch (strategy) {
      case 'schema-first':
        return 0.1; // Very low for structured JSON
      case 'direct':
        return 0.3; // Low for simple tasks
      case 'hierarchical-cot':
        return 0.5; // Medium for reasoning
      case 'plan-then-execute':
        return 0.5;
      case 'iterative-refinement':
        return 0.4; // Slightly lower for critical analysis
      case 'few-shot-strong':
        return 0.3; // Low to follow examples closely
      case 'conversational-decompose':
        return 0.6; // Higher for interactive decomposition
      case 'multi-agent-debate':
        return 0.7; // Higher for creative tradeoff analysis
      case 'cross-modal':
        return 0.4; // Medium for visual analysis
      default:
        return 0.5;
    }
  }

  /**
   * Render the system prompt with variable substitution.
   */
  private renderSystemPrompt(
    template: PromptTemplate,
    options: PromptRenderOptions
  ): string {
    let prompt = template.systemPrompt;

    // Substitute examples for few-shot-strong
    if (options.examples && prompt.includes('{{examples}}')) {
      const examplesText = options.examples
        .map((ex, i) => `Example ${i + 1}:\nInput: ${ex.input}\nOutput: ${ex.output}`)
        .join('\n\n');
      prompt = prompt.replace('{{examples}}', examplesText);
    }

    return prompt;
  }

  /**
   * Render the user prompt with variable substitution.
   */
  private renderUserPrompt(
    template: PromptTemplate,
    options: PromptRenderOptions
  ): string {
    let prompt = template.userPromptTemplate;

    // Substitute task
    prompt = prompt.replace('{{task}}', options.task);

    // Substitute schema for schema-first
    if (options.schema && prompt.includes('{{schema}}')) {
      prompt = prompt.replace('{{schema}}', JSON.stringify(options.schema, null, 2));
    }

    // Substitute image description for cross-modal
    if (options.imageDescription && prompt.includes('{{image_description}}')) {
      prompt = prompt.replace('{{image_description}}', options.imageDescription);
    }

    return prompt;
  }

  /**
   * Optimize context to fit within token budget.
   * Uses relevance-based ranking and truncation.
   */
  optimizeContext(
    items: ContextItem[],
    budget: number
  ): OptimizedContext {
    if (items.length === 0) {
      return { items: [], totalTokens: 0, edgePlacement: 'both' };
    }

    // Sort by relevance score (highest first)
    const sorted = [...items].sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Greedily pack items until budget is exhausted
    // Reserve 20% of budget for edge placement (critical context at beginning/end)
    const contextBudget = budget * 0.8;
    const selected: ContextItem[] = [];
    let totalTokens = 0;

    for (const item of sorted) {
      const itemTokens = item.tokenCount || estimateTokens(item.content);
      if (totalTokens + itemTokens <= contextBudget) {
        selected.push(item);
        totalTokens += itemTokens;
      }
    }

    // Determine edge placement based on content types
    const hasUserContext = selected.some((i) => i.type === 'user');
    const hasFileContext = selected.some((i) => i.type === 'file');

    let edgePlacement: 'beginning' | 'end' | 'both' = 'end';
    if (hasUserContext && hasFileContext) {
      edgePlacement = 'both'; // User context at beginning, files at end
    } else if (hasUserContext) {
      edgePlacement = 'beginning';
    }

    return { items: selected, totalTokens, edgePlacement };
  }

  /**
   * Inject optimized context into the system prompt.
   */
  private injectContext(
    systemPrompt: string,
    context: OptimizedContext,
    placement: 'beginning' | 'end' | 'both'
  ): string {
    if (context.items.length === 0) return systemPrompt;

    const contextText = this.formatContext(context.items);

    switch (placement) {
      case 'beginning':
        return `## Context\n\n${contextText}\n\n---\n\n${systemPrompt}`;
      case 'end':
        return `${systemPrompt}\n\n---\n\n## Context\n\n${contextText}`;
      case 'both': {
        // Split context: user/relevance at beginning, files at end
        const userItems = context.items.filter((i) => i.type === 'user' || i.relevanceScore > 0.8);
        const fileItems = context.items.filter((i) => i.type === 'file' && i.relevanceScore <= 0.8);

        let result = systemPrompt;
        if (userItems.length > 0) {
          result = `## Context\n\n${this.formatContext(userItems)}\n\n---\n\n${result}`;
        }
        if (fileItems.length > 0) {
          result = `${result}\n\n---\n\n## Reference Files\n\n${this.formatContext(fileItems)}`;
        }
        return result;
      }
    }
  }

  /**
   * Format context items into readable text.
   */
  private formatContext(items: ContextItem[]): string {
    return items
      .map((item) => {
        const header = `[${item.type}] ${item.source}`;
        return `### ${header}\n\n${item.content}`;
      })
      .join('\n\n');
  }

  /**
   * Estimate tokens for a rendered prompt.
   */
  estimatePromptTokens(prompt: RenderedPrompt): number {
    return prompt.totalTokens;
  }

  /**
   * Check if a prompt fits within the token budget.
   */
  fitsBudget(prompt: RenderedPrompt, budget: number): boolean {
    return prompt.totalTokens <= budget;
  }

  /**
   * Truncate a prompt to fit within token budget.
   * Truncates context items first, then user prompt if needed.
   */
  truncateToBudget(prompt: RenderedPrompt, budget: number): RenderedPrompt {
    if (prompt.totalTokens <= budget) return prompt;

    // Truncate user prompt first (preserve system instructions)
    const maxUserChars = Math.max(
      100,
      (budget - estimateTokens(prompt.systemPrompt)) * 4
    );

    const truncatedUser = prompt.userPrompt.slice(0, maxUserChars) + '\n\n[... truncated for token budget]';

    return {
      ...prompt,
      userPrompt: truncatedUser,
      totalTokens: estimateTokens(prompt.systemPrompt) + estimateTokens(truncatedUser),
    };
  }
}
