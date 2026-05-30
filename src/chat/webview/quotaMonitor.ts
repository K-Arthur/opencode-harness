/**
 * Enhanced Quota Monitor Module
 * 
 * Provides proactive quota monitoring with progressive warnings,
 * suggested actions, and integration with the error handling system.
 */

import {
  QuotaState,
  QuotaWarning,
  ErrorContext,
  ErrorCategory,
  ErrorSeverity,
  ErrorAction,
  createErrorContext
} from './errorTypes';

/**
 * Quota monitor configuration
 */
export interface QuotaMonitorConfig {
  warningThresholds: number[]; // Percentage thresholds for warnings (e.g., [80, 50, 20, 10])
  criticalThreshold: number; // Threshold for critical warnings
  enableProactiveWarnings: boolean; // Enable proactive warnings before limits are reached
  enableCountdown: boolean; // Enable countdown to reset
  checkInterval: number; // Interval for quota checks in milliseconds
}

/**
 * Quota warning callback type
 */
export type QuotaWarningCallback = (warning: QuotaWarning) => void;

/**
 * Quota state with enhanced monitoring
 */
export interface EnhancedQuotaState extends QuotaState {
  warnings: QuotaWarning[];
  currentWarningLevel: number; // Current warning threshold level
  timeUntilReset: number; // Milliseconds until reset
  historicalUsage: {
    daily: number[];
    hourly: number[];
  };
}

/**
 * Enhanced quota monitor with proactive warnings and suggested actions
 */
export class QuotaMonitor {
  private config: QuotaMonitorConfig;
  private currentState: EnhancedQuotaState | null = null;
  private warningCallbacks: QuotaWarningCallback[] = [];
  private checkInterval?: number;
  private isMonitoring = false;

  constructor(config: Partial<QuotaMonitorConfig> = {}) {
    this.config = {
      warningThresholds: [80, 50, 20, 10],
      criticalThreshold: 5,
      enableProactiveWarnings: true,
      enableCountdown: true,
      checkInterval: 30000, // Check every 30 seconds
      ...config
    };
  }

  /**
   * Start monitoring quota status
   */
  startMonitoring(): void {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.checkQuotaStatus();

    // Set up periodic checks
    this.checkInterval = window.setInterval(() => {
      this.checkQuotaStatus();
    }, this.config.checkInterval);
  }

  /**
   * Stop monitoring quota status
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }

  /**
   * Check quota status and generate warnings
   */
  private checkQuotaStatus(): void {
    if (!this.currentState) return;

    const warnings = this.generateWarnings(this.currentState);
    const currentWarningLevel = this.getCurrentWarningLevel(this.currentState);

    // Notify if warnings changed
    const warningsChanged = this.warningsChanged(warnings);
    if (warningsChanged) {
      this.currentState.warnings = warnings;
      this.currentState.currentWarningLevel = currentWarningLevel;

      // Notify callbacks of new warnings
      for (const warning of warnings) {
        for (const callback of this.warningCallbacks) {
          try {
            callback(warning);
          } catch (error) {
            console.error('Error in quota warning callback:', error);
          }
        }
      }
    }
  }

  /**
   * Generate warnings based on current quota state
   */
  private generateWarnings(state: EnhancedQuotaState): QuotaWarning[] {
    const warnings: QuotaWarning[] = [];
    const tokenPercentage = this.calculateTokenPercentage(state);
    const requestPercentage = this.calculateRequestPercentage(state);

    const knownPercentages = [tokenPercentage, requestPercentage].filter(
      (v): v is number => v !== undefined
    );
    if (knownPercentages.length === 0) return warnings;

    // Use the more restrictive percentage
    const percentage = Math.min(...knownPercentages);

    // Check each warning threshold
    for (const threshold of this.config.warningThresholds) {
      if (percentage < threshold && percentage >= threshold - 10) {
        warnings.push(this.createWarning(threshold, percentage, state));
      }
    }

    // Critical warning
    if (percentage <= this.config.criticalThreshold) {
      warnings.push(this.createCriticalWarning(percentage, state));
    }

    return warnings;
  }

  /**
   * Calculate token usage percentage
   */
  private calculateTokenPercentage(state: QuotaState): number | undefined {
    if (!state.limitTokens || state.limitTokens <= 0) return undefined;
    return (state.remainingTokens / state.limitTokens) * 100;
  }

  /**
   * Calculate request usage percentage
   */
  private calculateRequestPercentage(state: QuotaState): number | undefined {
    if (!state.limitRequests || state.limitRequests <= 0 || state.remainingRequests === undefined) return undefined;
    return (state.remainingRequests / state.limitRequests) * 100;
  }

  /**
   * Create a warning for a specific threshold
   */
  private createWarning(threshold: number, currentPercentage: number, state: EnhancedQuotaState): QuotaWarning {
    const type = currentPercentage <= this.config.criticalThreshold ? 'critical' : 'warning';
    const message = this.getWarningMessage(threshold, currentPercentage);
    const suggestedActions = this.getSuggestedActions(threshold, currentPercentage, state);

    return {
      type,
      percentage: currentPercentage,
      message,
      suggestedActions,
      timeUntilReset: this.calculateTimeUntilReset(state)
    };
  }

  /**
   * Create a critical warning
   */
  private createCriticalWarning(currentPercentage: number, state: EnhancedQuotaState): QuotaWarning {
    return {
      type: 'critical',
      percentage: currentPercentage,
      message: `Critical: Only ${Math.round(currentPercentage)}% quota remaining. Action required.`,
      suggestedActions: [
        {
          label: 'Wait for Reset',
          action: 'wait_for_reset',
          primary: false
        },
        {
          label: 'Reduce Context',
          action: 'edit',
          primary: true
        },
        {
          label: 'Upgrade Plan',
          action: 'upgrade_plan'
        }
      ],
      timeUntilReset: this.calculateTimeUntilReset(state)
    };
  }

  /**
   * Get warning message based on threshold
   */
  private getWarningMessage(threshold: number, currentPercentage: number): string {
    if (threshold >= 80) {
      return `Warning: ${Math.round(currentPercentage)}% quota remaining. Consider monitoring usage.`;
    } else if (threshold >= 50) {
      return `Warning: ${Math.round(currentPercentage)}% quota remaining. Plan your usage accordingly.`;
    } else if (threshold >= 20) {
      return `Warning: ${Math.round(currentPercentage)}% quota remaining. Consider reducing context size.`;
    } else {
      return `Warning: ${Math.round(currentPercentage)}% quota remaining. Immediate action recommended.`;
    }
  }

  /**
   * Get suggested actions based on warning level
   */
  private getSuggestedActions(threshold: number, currentPercentage: number, state: EnhancedQuotaState): ErrorAction[] {
    const actions: ErrorAction[] = [];

    if (threshold >= 50) {
      // High quota - informational actions
      actions.push({
        label: 'View Usage Details',
        action: 'view_details'
      });
    } else if (threshold >= 20) {
      // Medium quota - reduction suggestions
      actions.push({
        label: 'Reduce Context',
        action: 'edit',
        primary: true
      });
      actions.push({
        label: 'View Usage Details',
        action: 'view_details'
      });
    } else {
      // Low quota - urgent actions
      actions.push({
        label: 'Wait for Reset',
        action: 'wait_for_reset',
        primary: false
      });
      actions.push({
        label: 'Reduce Context',
        action: 'edit',
        primary: true
      });
      actions.push({
        label: 'Upgrade Plan',
        action: 'upgrade_plan'
      });
    }

    return actions;
  }

  /**
   * Calculate time until quota reset
   */
  private calculateTimeUntilReset(state: QuotaState): number {
    if (!state.resetAt) return 0;
    if (isNaN(state.resetAt.getTime())) return 0; // Handle invalid dates
    return Math.max(0, state.resetAt.getTime() - Date.now());
  }

  /**
   * Get current warning level
   */
  private getCurrentWarningLevel(state: EnhancedQuotaState): number {
    const tokenPercentage = this.calculateTokenPercentage(state);
    const requestPercentage = this.calculateRequestPercentage(state);
    const knownPercentages = [tokenPercentage, requestPercentage].filter(
      (v): v is number => v !== undefined
    );
    if (knownPercentages.length === 0) return 100;

    const percentage = Math.min(...knownPercentages);

    for (let i = 0; i < this.config.warningThresholds.length; i++) {
      const threshold = this.config.warningThresholds[i];
      if (threshold !== undefined && percentage < threshold && percentage >= threshold - 10) {
        return threshold;
      }
    }

    return 100; // No warning
  }

  /**
   * Check if warnings have changed
   */
  private warningsChanged(newWarnings: QuotaWarning[]): boolean {
    if (!this.currentState) return true;

    const oldWarnings = this.currentState.warnings;

    if (oldWarnings.length !== newWarnings.length) return true;

    // Compare warning types and percentages
    for (let i = 0; i < oldWarnings.length; i++) {
      const oldWarning = oldWarnings[i];
      const newWarning = newWarnings[i];
      if (!oldWarning || !newWarning) continue;
      if (oldWarning.type !== newWarning.type ||
          Math.abs(oldWarning.percentage - newWarning.percentage) > 1) {
        return true;
      }
    }

    return false;
  }

  /**
   * Update quota state from backend data
   */
  updateQuotaState(quotaData: {
    remainingTokens: number;
    limitTokens: number;
    remainingRequests: number;
    limitRequests: number;
    resetAt: string;
  }): void {
    const resetAt = new Date(quotaData.resetAt);

    this.currentState = {
      remainingTokens: quotaData.remainingTokens,
      limitTokens: quotaData.limitTokens,
      remainingRequests: quotaData.remainingRequests,
      limitRequests: quotaData.limitRequests,
      resetAt,
      warningThreshold: this.config.warningThresholds[0] || 80,
      warnings: [],
      currentWarningLevel: 100,
      timeUntilReset: this.calculateTimeUntilReset({ 
        ...quotaData, 
        resetAt,
        warningThreshold: this.config.warningThresholds[0] || 80
      }),
      historicalUsage: {
        daily: [],
        hourly: []
      }
    };

    // Check quota status immediately after update
    this.checkQuotaStatus();
  }

  /**
   * Get current quota state
   */
  getQuotaState(): EnhancedQuotaState | null {
    return this.currentState ? { ...this.currentState } : null;
  }

  /**
   * Get current warnings
   */
  getWarnings(): QuotaWarning[] {
    return this.currentState ? [...this.currentState.warnings] : [];
  }

  /**
   * Register callback for quota warnings
   */
  onQuotaWarning(callback: QuotaWarningCallback): () => void {
    this.warningCallbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.warningCallbacks.indexOf(callback);
      if (index > -1) {
        this.warningCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Create an error context for quota-related errors
   */
  createQuotaError(message: string, quotaData?: {
    remainingTokens: number;
    limitTokens: number;
    resetAt: string;
  }): ErrorContext {
    const errorContext = createErrorContext('RATE_LIMIT_EXCEEDED', {
      category: ErrorCategory.USAGE,
      message,
      userMessage: quotaData 
        ? `Rate limit exceeded. ${quotaData.remainingTokens}/${quotaData.limitTokens} tokens remaining. Resets at ${new Date(quotaData.resetAt).toLocaleTimeString()}.`
        : 'Rate limit exceeded. Please wait for reset or upgrade your plan.',
      retryable: false,
      suggestedActions: [
        {
          label: 'Wait for Reset',
          action: 'wait_for_reset',
          primary: false
        },
        {
          label: 'Upgrade Plan',
          action: 'upgrade_plan',
          primary: true
        },
        {
          label: 'View Usage',
          action: 'view_details'
        }
      ]
    });

    return errorContext;
  }

  /**
   * Format time until reset for display
   */
  formatTimeUntilReset(ms: number): string {
    if (ms <= 0) return 'Reset now';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Get quota bar color based on percentage
   */
  getQuotaBarColor(percentage: number): string {
    if (percentage <= this.config.criticalThreshold) {
      return '#ef4444'; // Red
    } else if (percentage <= 20) {
      return '#f97316'; // Orange
    } else if (percentage <= 50) {
      return '#eab308'; // Yellow
    } else {
      return '#22c55e'; // Green
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<QuotaMonitorConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart monitoring if interval changed
    if (config.checkInterval && this.isMonitoring) {
      this.stopMonitoring();
      this.startMonitoring();
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): QuotaMonitorConfig {
    return { ...this.config };
  }

  /**
   * Clear current state
   */
  clearState(): void {
    this.currentState = null;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.stopMonitoring();
    this.warningCallbacks = [];
    this.clearState();
  }
}

// Global singleton instance
let globalQuotaMonitor: QuotaMonitor | null = null;

/**
 * Get or create the global quota monitor instance
 */
export function getQuotaMonitor(config?: Partial<QuotaMonitorConfig>): QuotaMonitor {
  if (!globalQuotaMonitor) {
    globalQuotaMonitor = new QuotaMonitor(config);
  } else if (config) {
    globalQuotaMonitor.updateConfig(config);
  }
  return globalQuotaMonitor;
}

/**
 * Reset the global quota monitor (useful for testing)
 */
export function resetQuotaMonitor(): void {
  if (globalQuotaMonitor) {
    globalQuotaMonitor.destroy();
    globalQuotaMonitor = null;
  }
}
