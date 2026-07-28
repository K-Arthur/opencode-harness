// ─── Provider Concurrency and Rate-Limit Controller ────────────────────
//
// Provides per-provider (or per-account) concurrency limiting, token-bucket
// rate limiting, and retry-after feedback. Acquires "permits" before stage
// dispatch; permits are released on success, failure, or cancellation.

export interface ProviderIdentity {
  providerId: string;
  accountId?: string;
}

export interface ProviderLimiterConfig {
  /** Maximum concurrent requests per provider */
  maxConcurrent: number;
  /** Maximum requests per minute */
  requestsPerMinute: number;
  /** Maximum tokens per minute (input + output) */
  tokensPerMinute: number;
  /** Model-specific sub-limits (keyed by model ID) */
  modelLimits?: Record<string, { maxConcurrent: number }>;
  /** Cooldown in ms after rate-limit response */
  cooldownMs: number;
}

export interface PermitRequest {
  provider: ProviderIdentity;
  modelId: string;
  estimatedTokens?: number;
  priority: number;
  workflowId: string;
  stageId: string;
}

export interface ProviderPermit {
  id: string;
  provider: ProviderIdentity;
  modelId: string;
  acquiredAt: number;
  released: boolean;
}

interface ProviderState {
  activeCount: number;
  requestTimestamps: number[];
  tokenUsage: number[];
  tokenWindowStart: number;
  cooldownUntil: number;
  retryAfterUntil: number;
  config: ProviderLimiterConfig;
  queue: Array<{
    request: PermitRequest;
    resolve: (permit: ProviderPermit) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
}

const DEFAULT_CONFIG: ProviderLimiterConfig = {
  maxConcurrent: 2,
  requestsPerMinute: 30,
  tokensPerMinute: 200_000,
  cooldownMs: 5000,
};

export class ProviderLimiter {
  private providers = new Map<string, ProviderState>();
  private globalActive = 0;
  private globalMaxConcurrent = 10;
  private permitCounter = 0;


  constructor(configs?: Record<string, Partial<ProviderLimiterConfig>>) {
    if (configs) {
      for (const [providerId, cfg] of Object.entries(configs)) {
        this.setConfig(providerId, cfg);
      }
    }
  }

  /**
   * Update configuration for a provider.
   */
  setConfig(providerId: string, config: Partial<ProviderLimiterConfig>, accountId?: string): void {
    const key = this.providerKey({ providerId, accountId });
    const existing = this.providers.get(key);
    this.providers.set(key, {
      activeCount: existing?.activeCount ?? 0,
      requestTimestamps: existing?.requestTimestamps ?? [],
      tokenUsage: existing?.tokenUsage ?? [],
      tokenWindowStart: existing?.tokenWindowStart ?? Date.now(),
      cooldownUntil: existing?.cooldownUntil ?? 0,
      retryAfterUntil: existing?.retryAfterUntil ?? 0,
      config: { ...DEFAULT_CONFIG, ...config },
      queue: existing?.queue ?? [],
    });
  }

  /**
   * Acquire a provider permit before dispatching a stage.
   * Resolves when capacity is available or rejects on cancellation/timeout.
   */
  async acquirePermit(request: PermitRequest, timeoutMs = 60000): Promise<ProviderPermit> {
    const key = this.providerKey(request.provider);

    let state = this.providers.get(key);
    if (!state) {
      state = {
        activeCount: 0,
        requestTimestamps: [],
        tokenUsage: [],
        tokenWindowStart: Date.now(),
        cooldownUntil: 0,
        retryAfterUntil: 0,
        config: { ...DEFAULT_CONFIG },
        queue: [],
      };
      this.providers.set(key, state);
    }

    // Check cooldown
    if (state.cooldownUntil > Date.now() || state.retryAfterUntil > Date.now()) {
      const waitMs = Math.max(state.cooldownUntil, state.retryAfterUntil) - Date.now();
      if (waitMs > timeoutMs) {
        throw new Error(`Provider ${key} in cooldown for ${waitMs}ms`);
      }

      // Wait for cooldown
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(waitMs, 5000)));
    }

    // Check capacity
    if (this.canAcquire(state, request)) {
      return this.acquireImmediate(state, request, key);
    }

    // Queue the request
    return new Promise<ProviderPermit>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.dequeue(key, request);
        reject(new Error(`Permit timeout for ${key}/${request.modelId}`));
      }, timeoutMs);

      state!.queue.push({ request, resolve, reject, timer });
    });
  }

  /**
   * Release a permit after stage completion/failure/cancellation.
   */
  releasePermit(permit: ProviderPermit): void {
    if (permit.released) return;
    permit.released = true;

    const key = this.providerKey(permit.provider);
    const state = this.providers.get(key);
    if (state) {
      state.activeCount = Math.max(0, state.activeCount - 1);
      this.globalActive = Math.max(0, this.globalActive - 1);
    }

    // Dispatch next queued request
    this.dispatchNext(key);
  }

  /**
   * Report a rate-limit response from the provider.
   * This feeds back into scheduling to avoid tight retry loops.
   */
  reportRateLimit(
    provider: ProviderIdentity,
    retryAfterMs?: number,
    remainingRequests?: number,
    remainingTokens?: number,
  ): void {
    const key = this.providerKey(provider);
    const state = this.providers.get(key);
    if (!state) return;

    if (retryAfterMs && retryAfterMs > 0) {
      state.retryAfterUntil = Date.now() + retryAfterMs;
    }

    // If remaining is 0, cool down based on retry-after
    if (remainingRequests === 0 || remainingTokens === 0) {
      state.cooldownUntil = Date.now() + (retryAfterMs ?? 30000);
    }
  }

  /**
   * Report token usage for a completed request.
   */
  reportTokenUsage(provider: ProviderIdentity, tokens: number): void {
    const key = this.providerKey(provider);
    const state = this.providers.get(key);
    if (!state) return;

    state.tokenUsage.push(tokens);

    // Slide window
    const windowStart = Date.now() - 60000;
    state.tokenUsage = state.tokenUsage.filter((_, i) => {
      return state.requestTimestamps[i] ? state.requestTimestamps[i]! > windowStart : false;
    });
  }

  /**
   * Get current provider statistics for diagnostics.
   */
  getProviderStats(provider: ProviderIdentity): {
    activeCount: number;
    queueLength: number;
    cooldownRemaining: number;
    retryAfterRemaining: number;
  } {
    const key = this.providerKey(provider);
    const state = this.providers.get(key);
    if (!state) {
      return { activeCount: 0, queueLength: 0, cooldownRemaining: 0, retryAfterRemaining: 0 };
    }

    return {
      activeCount: state.activeCount,
      queueLength: state.queue.length,
      cooldownRemaining: Math.max(0, state.cooldownUntil - Date.now()),
      retryAfterRemaining: Math.max(0, state.retryAfterUntil - Date.now()),
    };
  }

  /**
   * Cancel all queued requests for a provider/workflow.
   */
  cancelQueued(provider: ProviderIdentity, workflowId?: string): void {
    const key = this.providerKey(provider);
    const state = this.providers.get(key);
    if (!state) return;

    state.queue = state.queue.filter((entry) => {
      if (workflowId && entry.request.workflowId !== workflowId) return true;
      clearTimeout(entry.timer);
      entry.reject(new Error("Cancelled"));
      return false;
    });
  }

  /**
   * Cancel all queued requests globally.
   */
  cancelAll(): void {
    for (const [key, state] of this.providers) {
      for (const entry of state.queue) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Cancelled"));
      }
      state.queue = [];
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private providerKey(identity: ProviderIdentity): string {
    return identity.accountId ? `${identity.providerId}/${identity.accountId}` : identity.providerId;
  }

  private canAcquire(state: ProviderState, request: PermitRequest): boolean {
    if (this.globalActive >= this.globalMaxConcurrent) return false;
    if (state.activeCount >= state.config.maxConcurrent) return false;

    // Check model-specific limit
    const modelLimit = state.config.modelLimits?.[request.modelId];
    if (modelLimit && state.activeCount >= modelLimit.maxConcurrent) return false;

    // Check RPM
    const oneMinuteAgo = Date.now() - 60000;
    const recentRequests = state.requestTimestamps.filter((t) => t > oneMinuteAgo).length;
    if (recentRequests >= state.config.requestsPerMinute) return false;

    // Check TPM
    const recentTokens = state.tokenUsage.reduce((sum, t) => sum + t, 0);
    if (recentTokens >= state.config.tokensPerMinute) return false;

    return true;
  }

  private acquireImmediate(state: ProviderState, request: PermitRequest, key: string): ProviderPermit {
    state.activeCount++;
    this.globalActive++;
    state.requestTimestamps.push(Date.now());

    const permit: ProviderPermit = {
      id: `permit-${++this.permitCounter}`,
      provider: request.provider,
      modelId: request.modelId,
      acquiredAt: Date.now(),
      released: false,
    };

    return permit;
  }

  private dequeue(key: string, request: PermitRequest): void {
    const state = this.providers.get(key);
    if (!state) return;

    state.queue = state.queue.filter((e) => e.request !== request);
  }

  private dispatchNext(key: string): void {
    const state = this.providers.get(key);
    if (!state || state.queue.length === 0) return;

    const next = state.queue.find((e) => this.canAcquire(state, e.request));
    if (!next) return;

    // Remove from queue
    state.queue = state.queue.filter((e) => e !== next);
    clearTimeout(next.timer);

    const permit = this.acquireImmediate(state, next.request, key);
    next.resolve(permit);
  }

  getGlobalActive(): number {
    return this.globalActive;
  }

  getGlobalMax(): number {
    return this.globalMaxConcurrent;
  }

  setGlobalMax(max: number): void {
    this.globalMaxConcurrent = Math.max(1, max);
  }

  resetProvider(providerId: string, accountId?: string): void {
    const key = this.providerKey({ providerId, accountId });
    const state = this.providers.get(key);
    if (state) {
      for (const entry of state.queue) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Provider reset"));
      }
      this.providers.delete(key);
    }
  }

  resetAll(): void {
    for (const [, state] of this.providers) {
      for (const entry of state.queue) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Provider reset"));
      }
    }
    this.providers.clear();
    this.globalActive = 0;
  }
}

// ─── Shared Singleton ──────────────────────────────────────────────────────

let globalProviderLimiter: ProviderLimiter | null = null;

export function getGlobalProviderLimiter(): ProviderLimiter {
  if (!globalProviderLimiter) {
    globalProviderLimiter = new ProviderLimiter();
  }
  return globalProviderLimiter;
}

export function setGlobalProviderLimiter(limiter: ProviderLimiter): void {
  globalProviderLimiter = limiter;
}

// ─── Stage Identity Extraction ─────────────────────────────────────────────

export function extractProviderFromModel(modelId: string): ProviderIdentity {
  const parts = modelId.split("/");
  return {
    providerId: parts[0] ?? "unknown",
    accountId: undefined,
  };
}
