import type { CodeDiff } from './types.js';

export interface ComplexityReport {
  functionName: string;
  cyclomaticComplexity: number;
  lines: number;
  nestingDepth: number;
  parameterCount: number;
  file: string;
}

export interface DuplicationCluster {
  sourceFile: string;
  lines: [number, number];
  similarFiles: Array<{ file: string; lines: [number, number]; similarity: number }>;
  content: string;
}

export interface DeadCodeCandidate {
  symbol: string;
  file: string;
  kind: 'function' | 'class' | 'variable' | 'export';
  reason: string;
  confidence: number;
}

export interface RefactoringSuggestion {
  type: 'extract-method' | 'simplify-condition' | 'reduce-nesting' | 'split-module' | 'rename-symbol' | 'remove-duplication';
  file: string;
  line: number;
  symbol: string;
  description: string;
  effort: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
}

export interface RefactoringReport {
  complexity: ComplexityReport[];
  duplications: DuplicationCluster[];
  deadCode: DeadCodeCandidate[];
  suggestions: RefactoringSuggestion[];
  summary: {
    totalFunctions: number;
    highComplexityCount: number;
    duplicationClusters: number;
    deadCodeCandidates: number;
    suggestionsCount: number;
  };
}

interface FlatFunction {
  name: string;
  lines: number;
  nesting: number;
  params: number;
  branches: number;
  file: string;
  startLine: number;
}

let nextFunctionId = 0;

function extractFunctions(content: string, file: string): FlatFunction[] {
  const functions: FlatFunction[] = [];
  const fnRegex = /(?:function\s+(\w+)|(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)|(?:async\s+)?(\w+)\s*\([^)]*\)\s*{)/g;
  let match: RegExpExecArray | null;

  while ((match = fnRegex.exec(content)) !== null) {
    const name = match[1] ?? match[2] ?? match[3] ?? `anonymous_${++nextFunctionId}`;
    const startPos = match.index;
    const fromPos = content.indexOf('{', startPos);
    if (fromPos === -1) continue;

    let depth = 0;
    let braceEnd = -1;
    let nesting = 0;
    let maxNesting = 0;
    let branches = 0;

    for (let i = fromPos; i < content.length; i++) {
      if (content[i] === '{') {
        depth++;
        nesting++;
        if (nesting > maxNesting) maxNesting = nesting;
      } else if (content[i] === '}') {
        depth--;
        nesting--;
        if (depth === 0) { braceEnd = i; break; }
      } else if (content[i] === 'i' && content.startsWith('if ', i)) { branches++; }
      else if (content[i] === 'f' && content.startsWith('for ', i)) { branches++; }
      else if (content[i] === 'w' && content.startsWith('while ', i)) { branches++; }
      else if (content[i] === 'c' && content.startsWith('catch ', i)) { branches++; }
    }

    if (braceEnd !== -1) {
      const bodyLines = content.slice(fromPos, braceEnd + 1).split('\n').length;
      const params = (content.slice(startPos, fromPos).match(/\(([^)]*)\)/)?.[1]?.split(',').length ?? 0);
      const startLine = content.slice(0, startPos).split('\n').length;

      functions.push({
        name,
        lines: bodyLines,
        nesting: maxNesting,
        params,
        branches,
        file,
        startLine,
      });
    }
  }

  return functions;
}

function detectDuplications(content: string, file: string, threshold: number): DuplicationCluster[] {
  const clusters: DuplicationCluster[] = [];
  const lines = content.split('\n');
  const seen = new Set<string>();

  for (let i = 0; i < lines.length - threshold; i++) {
    const block = lines.slice(i, i + threshold).join('\n').trim();
    if (!block || block.length < 20 || seen.has(block)) continue;

    let matchCount = 0;
    let firstMatch = -1;
    const searchFrom = i + threshold;

    for (let j = searchFrom; j < lines.length - threshold; j++) {
      const candidate = lines.slice(j, j + threshold).join('\n').trim();
      if (candidate === block) {
        matchCount++;
        if (firstMatch === -1) firstMatch = j;
      }
    }

    if (matchCount > 0) {
      seen.add(block);
      clusters.push({
        sourceFile: file,
        lines: [i + 1, i + threshold],
        similarFiles: Array.from({ length: matchCount }, () => ({
          file,
          lines: [firstMatch + 1, firstMatch + threshold] as [number, number],
          similarity: 1.0,
        })),
        content: block.slice(0, 120),
      });
    }
  }

  return clusters;
}

export class RefactoringEngine {
  private complexityThreshold: number;
  private duplicationThreshold: number;
  private autoSuggest: boolean;
  private enabled: boolean;

  constructor(options: {
    enabled?: boolean;
    autoSuggest?: boolean;
    complexityThreshold?: number;
    duplicationThreshold?: number;
  } = {}) {
    this.enabled = options.enabled ?? true;
    this.autoSuggest = options.autoSuggest ?? true;
    this.complexityThreshold = options.complexityThreshold ?? 10;
    this.duplicationThreshold = options.duplicationThreshold ?? 15;
  }

  get isEnabled(): boolean { return this.enabled; }

  analyze(diff: CodeDiff): RefactoringReport {
    const functions = extractFunctions(diff.newContent, 'current');
    if (diff.oldContent) {
      const oldFunctions = extractFunctions(diff.oldContent, 'previous');
      functions.push(...oldFunctions);
    }

    const complexity: ComplexityReport[] = functions.map((fn) => ({
      functionName: fn.name,
      cyclomaticComplexity: Math.max(1, fn.branches + 1),
      lines: fn.lines,
      nestingDepth: fn.nesting,
      parameterCount: fn.params,
      file: fn.file,
    }));

    const duplications = detectDuplications(diff.newContent, 'current', 5);

    const deadCodepatterns = detectDeadCodePatterns(diff);
    const deadCode: DeadCodeCandidate[] = deadCodepatterns.map((d) => ({
      symbol: d.symbol,
      file: 'current',
      kind: d.kind,
      reason: d.reason,
      confidence: d.confidence,
    }));

    const suggestions = this.generateSuggestions(complexity, duplications);

    const highComplexity = complexity.filter((c) => c.cyclomaticComplexity > this.complexityThreshold);

    return {
      complexity,
      duplications,
      deadCode,
      suggestions,
      summary: {
        totalFunctions: functions.length,
        highComplexityCount: highComplexity.length,
        duplicationClusters: duplications.length,
        deadCodeCandidates: deadCode.length,
        suggestionsCount: suggestions.length,
      },
    };
  }

  private generateSuggestions(
    complexity: ComplexityReport[],
    duplications: DuplicationCluster[],
  ): RefactoringSuggestion[] {
    const suggestions: RefactoringSuggestion[] = [];

    for (const c of complexity) {
      if (c.cyclomaticComplexity > this.complexityThreshold) {
        suggestions.push({
          type: 'simplify-condition',
          file: c.file,
          line: 0,
          symbol: c.functionName,
          description: `${c.functionName} has complexity ${c.cyclomaticComplexity} (threshold: ${this.complexityThreshold})`,
          effort: c.cyclomaticComplexity > 20 ? 'high' : 'medium',
          impact: 'high',
        });
      }
      if (c.nestingDepth > 4) {
        suggestions.push({
          type: 'reduce-nesting',
          file: c.file,
          line: 0,
          symbol: c.functionName,
          description: `${c.functionName} has nesting depth ${c.nestingDepth}`,
          effort: 'medium',
          impact: 'medium',
        });
      }
      if (c.lines > 80) {
        suggestions.push({
          type: 'extract-method',
          file: c.file,
          line: 0,
          symbol: c.functionName,
          description: `${c.functionName} is ${c.lines} lines long`,
          effort: 'medium',
          impact: 'medium',
        });
      }
    }

    for (const d of duplications) {
      suggestions.push({
        type: 'remove-duplication',
        file: d.sourceFile,
        line: d.lines[0],
        symbol: d.sourceFile,
        description: `Duplicate block (${d.similarFiles.length + 1} occurrences) at lines ${d.lines[0]}-${d.lines[1]}`,
        effort: 'medium',
        impact: 'medium',
      });
    }

    return suggestions;
  }
}

function detectDeadCodePatterns(diff: CodeDiff): Array<{ symbol: string; kind: 'function' | 'class' | 'variable' | 'export'; reason: string; confidence: number }> {
  const results: Array<{ symbol: string; kind: 'function' | 'class' | 'variable' | 'export'; reason: string; confidence: number }> = [];
  const content = diff.newContent;
  const lines = content.split('\n');
  const lineText = lines.join(' ');

  const exportRegex = /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = exportRegex.exec(content)) !== null) {
    const name = m[1]!;
    const reEscaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const usageRegex = new RegExp(`\\b${reEscaped}\\b`, 'g');
    let count = 0;
    while (usageRegex.exec(content) !== null) count++;
    if (count <= 1) {
      results.push({
        symbol: name,
        kind: 'export',
        reason: `Exported symbol "${name}" is only referenced in its declaration`,
        confidence: 0.5,
      });
    }
  }

  const fileCount = (diff.filesChanged || 1);
  if (fileCount === 1 && results.length > 0) {
    for (const r of results) {
      r.confidence = Math.min(1, r.confidence + 0.2);
      r.reason += ' (single file changed)';
    }
  }

  const todoPatterns = [/TODO/i, /FIXME/i, /HACK/i, /XXX/i];
  for (const pattern of todoPatterns) {
    const match = content.match(pattern);
    if (match && lines.length > 0) {
      const todoLine = lines.findIndex(l => pattern.test(l));
      if (todoLine !== -1) {
        results.push({
          symbol: 'marker',
          kind: 'function',
          reason: `Contains ${match[0]} marker at line ${todoLine + 1}`,
          confidence: 0.3,
        });
      }
    }
  }

  return results;
}
