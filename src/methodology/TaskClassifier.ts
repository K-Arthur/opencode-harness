/**
 * Task Classifier — analyzes user requests and extracts signals for
 * methodology selection.
 *
 * Uses rule-based heuristics to classify task type, estimate complexity,
 * detect modality requirements, and identify constraints.
 */

import {
  TaskClassification,
  TaskType,
  TaskComplexity,
  TaskModality,
  TaskConstraints,
} from './types.js';

// ─── Signal Detection ───────────────────────────────────────────────────────

const AMBIGUITY_MARKERS = [
  'maybe',
  'not sure',
  'depends on',
  'i think',
  'probably',
  'might need',
  'could be',
  'something like',
  'kind of',
  'sort of',
];

const TASK_TYPE_PRIORITY: Record<TaskType, number> = {
  'ui-from-image': 10,
  'quick-fix': 9,
  'debug': 8,
  'refactor': 7,
  'architect': 6,
  'review': 5,
  'test': 4,
  'document': 3,
  'explain': 2,
  'generate': 1,
};

const TASK_TYPE_PATTERNS: Record<TaskType, RegExp[]> = {
  'quick-fix': [
    /fix\s+(this\s+)?(bug|error|issue|typo)/i,
    /quick\s+fix/i,
    /simple\s+fix/i,
    /patch\s+this/i,
  ],
  generate: [
    /create\s+(a|an|the)/i,
    /build\s+(a|an|the)/i,
    /implement\s+(a|an|the)/i,
    /write\s+(a|an|the|function|component|class|test)/i,
    /add\s+(a|an|the|feature|endpoint|route)/i,
    /generate\s+(a|an|the|code|test)/i,
    /new\s+(feature|component|page|endpoint|api)/i,
  ],
  explain: [
    /explain\s+(this|how|what|why)/i,
    /what\s+does\s+this\s+do/i,
    /how\s+does\s+(this|it|the)/i,
    /walk\s+me\s+through/i,
    /describe\s+(how|what|the)/i,
  ],
  refactor: [
    /refactor\s+(this|the|code)/i,
    /clean\s+up\s+(this|the|code)/i,
    /restructure\s+(this|the)/i,
    /improve\s+(this|the)\s+(code|design|architecture)/i,
    /simplify\s+(this|the)/i,
    /rename\s+(this|the|variable|function)/i,
    /extract\s+(method|function|component|class)/i,
  ],
  debug: [
    /debug\s+(this|the|code|error)/i,
    /why\s+is\s+(this|it|the|code)\s+(\w+\s+)?(not\s+working|failing|broken|crashing)/i,
    /what'?s?\s+wrong\s+with/i,
    /fix\s+(this\s+)?(error|crash|exception|bug)/i,
    /trace\s+(the\s+)?(error|issue|problem)/i,
    /stack\s+trace/i,
  ],
  review: [
    /review\s+(this|the|code|pr|pull\s+request)/i,
    /code\s+review/i,
    /check\s+(this|the|code|for\s+issues)/i,
    /audit\s+(this|the|code|security)/i,
    /look\s+over\s+(this|the)/i,
    /any\s+issues\s+with/i,
    /is\s+this\s+(good|correct|safe)/i,
  ],
  architect: [
    /design\s+(a|an|the|architecture|system|api)/i,
    /architecture\s+(for|of|design)/i,
    /system\s+design/i,
    /plan\s+(the\s+)?(architecture|structure|layout)/i,
    /how\s+should\s+i\s+(structure|organize|architect)/i,
    /tech\s+stack/i,
  ],
  document: [
    /document\s+(this|the|code|api)/i,
    /write\s+(docs|documentation|readme|comments)/i,
    /add\s+(docs|documentation|comments|jsdoc)/i,
    /create\s+(documentation|a\s+readme|api\s+docs)/i,
    /explain\s+in\s+the\s+docs/i,
  ],
  test: [
    /write\s+(a\s+)?test(s)?\s+(for|to)/i,
    /test\s+(this|the|code|function)/i,
    /add\s+(tests?|coverage)/i,
    /generate\s+tests?/i,
    /unit\s+test(s)?/i,
    /integration\s+test(s)?/i,
    /e2e\s+test(s)?/i,
  ],
  'ui-from-image': [
    /from\s+(this\s+)?(screenshot|image|design|mockup)/i,
    /implement\s+(this\s+)?(screenshot|design|ui)/i,
    /recreate\s+(this\s+)?(screenshot|design|ui)/i,
    /look\s+at\s+(this\s+)?(screenshot|image)/i,
    /build\s+(this\s+)?(ui|page|component)\s+from/i,
  ],
};

const CODE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.go', '.rs', '.java',
  '.cpp', '.c', '.h', '.css', '.scss', '.html', '.json', '.yaml', '.yml',
];

// ─── Task Classifier ────────────────────────────────────────────────────────

export class TaskClassifier {
  /**
   * Classify a user request into a structured TaskClassification.
   */
  classify(
    query: string,
    options: {
      hasImageAttachment?: boolean;
      selectedCode?: string;
      openFiles?: string[];
    } = {}
  ): TaskClassification {
    const signals = this.extractSignals(query, options);
    const type = this.detectTaskType(query, signals);
    const complexity = this.estimateComplexity(query, signals, type);
    const modalities = this.detectModalities(query, signals, options);
    const constraints = this.detectConstraints(query, signals);

    return { type, complexity, modalities, constraints, signals };
  }

  // ─── Signal Extraction ──────────────────────────────────────────────────

  private extractSignals(
    query: string,
    options: { hasImageAttachment?: boolean; selectedCode?: string; openFiles?: string[] }
  ): TaskClassification['signals'] {
    const hasCodeSnippet = this.hasCodeSnippet(query);
    const hasFilePath = this.hasFilePath(query);
    const hasAmbiguityMarkers = AMBIGUITY_MARKERS.some((marker) =>
      query.toLowerCase().includes(marker)
    );

    // Count sub-questions (question marks; semicolons only outside code blocks)
    const codeBlockFree = query.replace(/```[\s\S]*?```/g, '');
    const subQuestionCount = (query.match(/\?/g) || []).length +
      (codeBlockFree.split(';').length - 1);

    return {
      queryLength: query.length,
      hasCodeSnippet,
      hasFilePath,
      hasAmbiguityMarkers,
      hasImageAttachment: options.hasImageAttachment ?? false,
      subQuestionCount,
    };
  }

  private hasCodeSnippet(query: string): boolean {
    // Detect code block markers or inline code patterns
    if (query.includes('```') || query.includes('`')) return true;
    // Detect common code patterns (function calls, variable assignments)
    if (/\b(function|const|let|var|class|import|export|def|fn)\s+\w+/.test(query)) {
      return true;
    }
    return false;
  }

  private hasFilePath(query: string): boolean {
    // Detect file paths (relative or absolute)
    if (/(^|[\/\\])[\w-]+\.[\w]+$/.test(query)) return true;
    // Detect file extensions
    if (CODE_EXTENSIONS.some((ext) => query.includes(ext))) return true;
    return false;
  }

  // ─── Task Type Detection ────────────────────────────────────────────────

  private detectTaskType(query: string, signals: TaskClassification['signals']): TaskType {
    const lowerQuery = query.toLowerCase();

    // Image attachment strongly suggests ui-from-image
    if (signals.hasImageAttachment) {
      if (/implement|build|create|recreate|make/.test(lowerQuery)) {
        return 'ui-from-image';
      }
      if (/analyze|what|describe|explain/.test(lowerQuery)) {
        return 'explain';
      }
    }

    // Score each task type by pattern matches
    let bestType: TaskType = 'generate'; // default
    let bestScore = 0;

    for (const [type, patterns] of Object.entries(TASK_TYPE_PATTERNS)) {
      let score = 0;
      for (const pattern of patterns) {
        if (pattern.test(query)) {
          score += 1;
        }
      }
      if (score > bestScore || (score === bestScore && TASK_TYPE_PRIORITY[type as TaskType] > TASK_TYPE_PRIORITY[bestType])) {
        bestScore = score;
        bestType = type as TaskType;
      }
    }

    // If no patterns matched, use heuristics
    if (bestScore === 0) {
      bestType = this.heuristicType(query, signals);
    }

    return bestType;
  }

  private heuristicType(
    query: string,
    signals: TaskClassification['signals']
  ): TaskType {
    const lowerQuery = query.toLowerCase();

    // Short queries with code snippets are likely quick-fixes
    if (signals.queryLength < 100 && signals.hasCodeSnippet) {
      return 'quick-fix';
    }

    // Queries with "how" or "what" are likely explain
    if (/^(how|what|why|when|where)\b/.test(lowerQuery)) {
      return 'explain';
    }

    // Queries mentioning files are likely generate or refactor
    if (signals.hasFilePath) {
      return 'generate';
    }

    // Default to generate for anything else
    return 'generate';
  }

  // ─── Complexity Estimation ──────────────────────────────────────────────

  private estimateComplexity(
    query: string,
    signals: TaskClassification['signals'],
    type: TaskType
  ): TaskComplexity {
    const lowerQuery = query.toLowerCase();

    // Depth: sequential reasoning steps
    let depth = 0.2; // base
    if (signals.subQuestionCount > 2) depth += 0.3;
    if (/then|after|before|once|when\s+.*\s+then/i.test(lowerQuery)) depth += 0.2;
    if (type === 'architect' || type === 'debug') depth += 0.3;
    if (type === 'quick-fix') depth = Math.min(depth, 0.3);
    depth = Math.min(depth, 1.0);

    // Width: number of domains/skills
    let width = 0.2; // base
    const domainKeywords = [
      'database', 'api', 'frontend', 'backend', 'auth', 'security',
      'performance', 'testing', 'deployment', 'ui', 'css', 'state',
    ];
    const matchedDomains = domainKeywords.filter((kw) =>
      lowerQuery.includes(kw)
    ).length;
    width += matchedDomains * 0.15;
    if (type === 'architect') width += 0.3;
    width = Math.min(width, 1.0);

    // Ambiguity: how unclear the requirements are
    let ambiguity = 0.1; // base
    if (signals.hasAmbiguityMarkers) ambiguity += 0.3;
    if (/etc|and\s+so\s+on|and\s+other|whatever/i.test(lowerQuery)) ambiguity += 0.2;
    if (signals.queryLength < 50) ambiguity += 0.2; // short queries are often vague
    ambiguity = Math.min(ambiguity, 1.0);

    // File scope: estimated number of files affected
    let fileScope = 0.1; // base
    if (signals.hasFilePath) fileScope += 0.2;
    if (/all\s+files|every|throughout|entire\s+project/i.test(lowerQuery)) fileScope += 0.5;
    if (/this\s+file|this\s+function|here/i.test(lowerQuery)) fileScope = Math.min(fileScope, 0.3);
    if (type === 'architect') fileScope += 0.4;
    fileScope = Math.min(fileScope, 1.0);

    return {
      depth: Math.round(depth * 100) / 100,
      width: Math.round(width * 100) / 100,
      ambiguity: Math.round(ambiguity * 100) / 100,
      fileScope: Math.round(fileScope * 100) / 100,
    };
  }

  // ─── Modality Detection ─────────────────────────────────────────────────

  private detectModalities(
    query: string,
    signals: TaskClassification['signals'],
    options: { hasImageAttachment?: boolean }
  ): TaskModality {
    const lowerQuery = query.toLowerCase();

    return {
      needsVision:
        signals.hasImageAttachment ||
        /screenshot|image|photo|visual|ui\s+from|look\s+at\s+this/i.test(lowerQuery),
      needsDiagram:
        /diagram|architecture\s+diagram|flowchart|erd|uml|schema/i.test(lowerQuery),
      needsCodeExec:
        /run|execute|test|verify|check\s+if\s+it\s+works/i.test(lowerQuery),
    };
  }

  // ─── Constraint Detection ───────────────────────────────────────────────

  private detectConstraints(
    query: string,
    signals: TaskClassification['signals']
  ): TaskConstraints {
    const lowerQuery = query.toLowerCase();

    return {
      speedPreferred:
        /quick|fast|urgent|asap|simple|just\s+do|don'?t\s+overthink/i.test(lowerQuery),
      qualityPreferred:
        /thorough|comprehensive|production.?ready|bullet.?proof|robust|careful/i.test(lowerQuery),
      budgetLimit: this.extractBudgetLimit(query),
    };
  }

  private extractBudgetLimit(query: string): number | undefined {
    const match = query.match(/(?:budget|max\s+(?:cost|tokens?))[:\s]+\$?(\d+)/i);
    return match?.[1] ? parseInt(match[1], 10) : undefined;
  }
}
