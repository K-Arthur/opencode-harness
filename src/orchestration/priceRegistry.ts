// ─── Provider Price Registry ─────────────────────────────────────────────
//
// Versioned registry of provider/model pricing metadata. Supports user
// overrides, unknown pricing, and currency tracking.

export interface ModelPriceEntry {
  modelId: string;
  providerId: string;
  inputTokenPrice: number;
  outputTokenPrice: number;
  cachedInputPrice?: number;
  reasoningTokenPrice?: number;
  perRequestCharge?: number;
  currency: string;
  effectiveDate: number;
  source: "official" | "derived" | "user_override" | "unknown";
  notes?: string;
}

export interface ProviderPriceInfo {
  providerId: string;
  name: string;
  models: Map<string, ModelPriceEntry>;
  defaultCurrency: string;
}

export interface BudgetReservation {
  stageId: string;
  reservedTokens: number;
  reservedCost: number;
  acquired: boolean;
}

const UNKNOWN_PRICE: ModelPriceEntry = {
  modelId: "",
  providerId: "",
  inputTokenPrice: 0,
  outputTokenPrice: 0,
  currency: "USD",
  effectiveDate: 0,
  source: "unknown",
  notes: "Price unknown — limits enforced on token count only",
};

export class PriceRegistry {
  private providers = new Map<string, ProviderPriceInfo>();
  private userOverrides = new Map<string, Partial<ModelPriceEntry>>();

  /**
   * Register provider pricing information.
   */
  registerProvider(info: ProviderPriceInfo): void {
    this.providers.set(info.providerId, info);
  }

  /**
   * Register a model price entry.
   */
  registerModelPrice(entry: ModelPriceEntry): void {
    let provider = this.providers.get(entry.providerId);
    if (!provider) {
      provider = {
        providerId: entry.providerId,
        name: entry.providerId,
        models: new Map(),
        defaultCurrency: "USD",
      };
      this.providers.set(entry.providerId, provider);
    }
    provider.models.set(entry.modelId, entry);
  }

  /**
   * Set a user override for a model's pricing.
   */
  setUserOverride(modelId: string, overrides: Partial<ModelPriceEntry>): void {
    const existing = this.userOverrides.get(modelId) ?? {};
    this.userOverrides.set(modelId, { ...existing, ...overrides, source: "user_override" });
  }

  /**
   * Get the price for a model.
   */
  getPrice(modelId: string): ModelPriceEntry {
    // Check user override first
    const override = this.userOverrides.get(modelId);
    if (override) {
      const base = this.findEntry(modelId);
      return { ...base, ...override };
    }

    return this.findEntry(modelId);
  }

  /**
   * Estimate the cost for a given token count.
   * Returns null if price is unknown.
   */
  estimateCost(modelId: string, inputTokens: number, outputTokens: number): number | null {
    const price = this.getPrice(modelId);
    if (price.source === "unknown" && price.inputTokenPrice === 0 && price.outputTokenPrice === 0) {
      return null;
    }

    const inputCost = (inputTokens / 1000) * price.inputTokenPrice;
    const outputCost = (outputTokens / 1000) * price.outputTokenPrice;
    const perRequest = price.perRequestCharge ?? 0;

    return inputCost + outputCost + perRequest;
  }

  /**
   * Check if pricing is known for a model.
   */
  isPriceKnown(modelId: string): boolean {
    const price = this.getPrice(modelId);
    return price.source !== "unknown" || price.inputTokenPrice > 0 || price.outputTokenPrice > 0;
  }

  /**
   * Calculate token budget at a given cost limit for a model.
   */
  tokensForCost(modelId: string, maxCost: number): { inputTokens: number; outputTokens: number } | null {
    const price = this.getPrice(modelId);
    if (price.inputTokenPrice === 0 && price.outputTokenPrice === 0) return null;

    // Assume 3:1 input:output ratio for estimation
    const estimatedOutputRatio = 0.25;
    const inputCostPerToken = price.inputTokenPrice / 1000;
    const outputCostPerToken = price.outputTokenPrice / 1000;

    // Solve: inputTokens * inputCost + outputTokens * outputCost = maxCost
    // outputTokens = inputTokens * estimatedOutputRatio
    const inputTokenCost = inputCostPerToken + outputCostPerToken * estimatedOutputRatio;
    const maxInputTokens = Math.floor(maxCost / inputTokenCost);
    const maxOutputTokens = Math.floor(maxInputTokens * estimatedOutputRatio);

    return { inputTokens: maxInputTokens, outputTokens: maxOutputTokens };
  }

  /**
   * Get the cheapest model that matches a capability filter.
   */
  getCheapestModel(inputPriceCap: number, filter?: (entry: ModelPriceEntry) => boolean): string | null {
    let cheapest: { modelId: string; price: number } | null = null;

    for (const [, provider] of this.providers) {
      for (const [, entry] of provider.models) {
        if (entry.inputTokenPrice > inputPriceCap) continue;
        if (filter && !filter(entry)) continue;

        if (!cheapest || entry.inputTokenPrice < cheapest.price) {
          cheapest = { modelId: entry.modelId, price: entry.inputTokenPrice };
        }
      }
    }

    return cheapest?.modelId ?? null;
  }

  /**
   * Get all known model IDs.
   */
  getAllKnownModels(): string[] {
    const models: string[] = [];
    for (const [, provider] of this.providers) {
      for (const [, entry] of provider.models) {
        models.push(entry.modelId);
      }
    }
    return models;
  }

  /**
   * Reserve budget for a stage. This does not deduct — it is a pre-check.
   */
  reserveBudget(
    modelId: string,
    estimatedInputTokens: number,
    estimatedOutputTokens: number,
    remainingTokenBudget: number,
    remainingCostBudget: number,
  ): BudgetReservation {
    const estimatedCost = this.estimateCost(modelId, estimatedInputTokens, estimatedOutputTokens) ?? 0;
    const reservedTokens = estimatedInputTokens + estimatedOutputTokens;

    return {
      stageId: "",
      reservedTokens,
      reservedCost: estimatedCost,
      acquired: reservedTokens <= remainingTokenBudget && estimatedCost <= remainingCostBudget,
    };
  }

  /**
   * Find a price entry for a model ID.
   */
  private findEntry(modelId: string): ModelPriceEntry {
    for (const [, provider] of this.providers) {
      const entry = provider.models.get(modelId);
      if (entry) return entry;
    }
    return { ...UNKNOWN_PRICE, modelId };
  }

  // ─── Diagnostics ─────────────────────────────────────────────────────

  getKnownProviderCount(): number {
    return this.providers.size;
  }

  getKnownModelCount(): number {
    let count = 0;
    for (const [, provider] of this.providers) {
      count += provider.models.size;
    }
    return count;
  }

  reset(): void {
    this.providers.clear();
    this.userOverrides.clear();
  }
}

// ─── Shared Singleton ──────────────────────────────────────────────────────

let globalPriceRegistry: PriceRegistry | null = null;

export function getGlobalPriceRegistry(): PriceRegistry {
  if (!globalPriceRegistry) {
    globalPriceRegistry = new PriceRegistry();
  }
  return globalPriceRegistry;
}

export function setGlobalPriceRegistry(registry: PriceRegistry): void {
  globalPriceRegistry = registry;
}
