import { AuditEntry, MethodologyId, ClassifiedError, ErrorClass } from './types.js';

interface AuditFilter {
  status?: AuditEntry['status'];
  methodology?: MethodologyId;
  model?: string;
  minQuality?: number;
  startTime?: Date;
  endTime?: Date;
}

interface AuditStats {
  totalTraces: number;
  successRate: number;
  avgQuality: number;
  avgCost: number;
  avgDuration: number;
  totalCost: number;
  totalTokens: number;
  errorsByClass: Record<ErrorClass, number>;
}

const ERROR_CLASSES: ErrorClass[] = [
  'routing',
  'model',
  'validation',
  'execution',
  'quality',
  'protocol',
  'context',
  'multimodal',
];

export class AuditTrail {
  private entries: AuditEntry[] = [];
  private traceCounter = 0;

  startTrace(
    intent: string,
    methodology: MethodologyId,
    model: string,
    planHash: string,
  ): string {
    const traceId = `trace-${++this.traceCounter}-${Date.now()}`;
    this.entries.push({
      traceId,
      timestamp: new Date(),
      intent,
      methodology,
      model,
      planHash,
      status: 'success',
      quality: 0,
      cost: 0,
      tokens: 0,
      duration: 0,
      escalations: 0,
    });
    return traceId;
  }

  endTrace(
    traceId: string,
    status: AuditEntry['status'],
    quality: number,
    cost: number,
    tokens: number,
    duration: number,
    error?: ClassifiedError,
  ): void {
    const entry = this.entries.find((e) => e.traceId === traceId);
    if (!entry) return;
    entry.status = status;
    entry.quality = quality;
    entry.cost = cost;
    entry.tokens = tokens;
    entry.duration = duration;
    entry.error = error;
  }

  getEntries(filter?: AuditFilter): AuditEntry[] {
    if (!filter) return [...this.entries];
    return this.entries.filter((entry) => {
      if (filter.status !== undefined && entry.status !== filter.status)
        return false;
      if (filter.methodology !== undefined && entry.methodology !== filter.methodology)
        return false;
      if (filter.model !== undefined && entry.model !== filter.model)
        return false;
      if (filter.minQuality !== undefined && entry.quality < filter.minQuality)
        return false;
      if (filter.startTime !== undefined && entry.timestamp < filter.startTime)
        return false;
      if (filter.endTime !== undefined && entry.timestamp > filter.endTime)
        return false;
      return true;
    });
  }

  getEntry(traceId: string): AuditEntry | undefined {
    return this.entries.find((e) => e.traceId === traceId);
  }

  clear(): void {
    this.entries = [];
  }

  getStats(): AuditStats {
    const total = this.entries.length;
    if (total === 0) {
      return {
        totalTraces: 0,
        successRate: 0,
        avgQuality: 0,
        avgCost: 0,
        avgDuration: 0,
        totalCost: 0,
        totalTokens: 0,
        errorsByClass: Object.fromEntries(ERROR_CLASSES.map((c) => [c, 0])) as Record<ErrorClass, number>,
      };
    }

    const successes = this.entries.filter((e) => e.status === 'success').length;
    const totalQuality = this.entries.reduce((sum, e) => sum + e.quality, 0);
    const totalCost = this.entries.reduce((sum, e) => sum + e.cost, 0);
    const totalTokens = this.entries.reduce((sum, e) => sum + e.tokens, 0);
    const totalDuration = this.entries.reduce((sum, e) => sum + e.duration, 0);

    const errorsByClass = Object.fromEntries(ERROR_CLASSES.map((c) => [c, 0])) as Record<ErrorClass, number>;
    for (const entry of this.entries) {
      if (entry.error) {
        errorsByClass[entry.error.class]++;
      }
    }

    return {
      totalTraces: total,
      successRate: successes / total,
      avgQuality: totalQuality / total,
      avgCost: totalCost / total,
      avgDuration: totalDuration / total,
      totalCost,
      totalTokens,
      errorsByClass,
    };
  }

  classifyError(error: unknown): ClassifiedError {
    if (
      typeof error === 'object' &&
      error !== null &&
      'class' in error &&
      'message' in error
    ) {
      const candidate = error as { class: unknown; message: unknown };
      if (
        typeof candidate.class === 'string' &&
        ERROR_CLASSES.includes(candidate.class as ErrorClass)
      ) {
        return error as ClassifiedError;
      }
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof (error as { message: unknown }).message === 'string'
    ) {
      const msg = (error as { message: string }).message;
      if (/timeout|timed out/i.test(msg)) {
        return {
          class: 'model',
          message: msg,
          recoverable: true,
          recoveryAction: 'retry',
          userMessage: 'Request timed out, will retry',
        };
      }
      if (/validation|schema|invalid/i.test(msg)) {
        return {
          class: 'validation',
          message: msg,
          recoverable: false,
          userMessage: 'Validation failed',
        };
      }
      if (/not found|missing/i.test(msg)) {
        return {
          class: 'routing',
          message: msg,
          recoverable: true,
          recoveryAction: 'fallback',
          userMessage: 'Resource not found',
        };
      }
    }

    return {
      class: 'execution',
      message: String(error),
      recoverable: false,
      userMessage: 'An unexpected error occurred',
    };
  }
}

export type { AuditFilter, AuditStats };
