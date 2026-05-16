/**
 * Network Monitor Module
 * 
 * Monitors network connectivity, connection quality, and provides
 * offline support with request queuing and automatic retry.
 */

import {
  NetworkStatus,
  PendingRequest,
  ErrorContext,
  ErrorCategory,
  createErrorContext
} from './errorTypes';

/**
 * Network monitor configuration
 */
export interface NetworkMonitorConfig {
  checkInterval?: number; // Interval for network checks in milliseconds
  offlineThreshold?: number; // Latency threshold to consider connection poor
  enableQueue?: boolean; // Enable offline request queuing
  maxQueueSize?: number; // Maximum number of requests to queue
  retryOnReconnect?: boolean; // Automatically retry queued requests on reconnection
}

/**
 * Network change callback type
 */
export type NetworkChangeCallback = (status: NetworkStatus) => void;

/**
 * Network monitor for connectivity and offline support
 */
export class NetworkMonitor {
  private config: NetworkMonitorConfig;
  private currentStatus: NetworkStatus;
  private requestQueue: PendingRequest[] = [];
  private networkChangeCallbacks: NetworkChangeCallback[] = [];
  private checkInterval?: number;
  private isMonitoring = false;
  private _boundHandleOnline: () => void = () => {};
  private _boundHandleOffline: () => void = () => {};

  constructor(config: NetworkMonitorConfig = {}) {
    this.config = {
      checkInterval: 30000, // Check every 30 seconds
      offlineThreshold: 5000, // 5 seconds latency threshold
      enableQueue: true,
      maxQueueSize: 50,
      retryOnReconnect: true,
      ...config
    };

    this.currentStatus = {
      online: navigator.onLine,
      connectionQuality: 'fast',
      latency: undefined,
      lastChecked: Date.now()
    };

    // Listen for browser online/offline events
    if (typeof window !== 'undefined') {
      this._boundHandleOnline = this.handleOnline.bind(this)
      this._boundHandleOffline = this.handleOffline.bind(this)
      window.addEventListener('online', this._boundHandleOnline);
      window.addEventListener('offline', this._boundHandleOffline);
    }
  }

  /**
   * Start monitoring network status
   */
  startMonitoring(): void {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.checkNetworkStatus();

    // Set up periodic checks
    this.checkInterval = window.setInterval(() => {
      this.checkNetworkStatus();
    }, this.config.checkInterval);
  }

  /**
   * Stop monitoring network status
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
   * Check current network status
   */
  private async checkNetworkStatus(): Promise<void> {
    const isOnline = navigator.onLine;
    let connectionQuality: 'fast' | 'slow' | 'poor' = 'fast';
    let latency: number | undefined;

    if (isOnline) {
      // Measure latency by fetching a small resource
      try {
        const startTime = Date.now();
        await this.fetchWithTimeout('/favicon.ico', 2000);
        latency = Date.now() - startTime;

        // Determine connection quality based on latency
        if (latency > this.config.offlineThreshold!) {
          connectionQuality = 'poor';
        } else if (latency > 1000) {
          connectionQuality = 'slow';
        }
      } catch (error) {
        // Fetch failed, likely poor or no connection
        connectionQuality = 'poor';
        latency = undefined;
      }
    }

    const newStatus: NetworkStatus = {
      online: isOnline,
      connectionQuality,
      latency,
      lastChecked: Date.now()
    };

    // Notify if status changed
    if (this.statusChanged(this.currentStatus, newStatus)) {
      this.currentStatus = newStatus;
      this.notifyNetworkChange(newStatus);

      // Auto-retry queued requests when coming back online
      if (isOnline && this.config.retryOnReconnect) {
        this.processQueue();
      }
    } else {
      this.currentStatus = newStatus;
    }
  }

  /**
   * Fetch with timeout for network checking
   */
  private async fetchWithTimeout(url: string, timeout: number): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-cache'
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if network status changed
   */
  private statusChanged(oldStatus: NetworkStatus, newStatus: NetworkStatus): boolean {
    return (
      oldStatus.online !== newStatus.online ||
      oldStatus.connectionQuality !== newStatus.connectionQuality ||
      Math.abs((oldStatus.latency || 0) - (newStatus.latency || 0)) > 1000
    );
  }

  /**
   * Handle browser online event
   */
  private handleOnline(): void {
    this.checkNetworkStatus();
  }

  /**
   * Handle browser offline event
   */
  private handleOffline(): void {
    this.currentStatus = {
      online: false,
      connectionQuality: 'poor',
      latency: undefined,
      lastChecked: Date.now()
    };
    this.notifyNetworkChange(this.currentStatus);
  }

  /**
   * Get current network status
   */
  getNetworkStatus(): NetworkStatus {
    return { ...this.currentStatus };
  }

  /**
   * Check if currently online
   */
  isOnline(): boolean {
    return this.currentStatus.online;
  }

  /**
   * Get connection quality
   */
  getConnectionQuality(): 'fast' | 'slow' | 'poor' {
    return this.currentStatus.connectionQuality;
  }

  /**
   * Register callback for network changes
   */
  onNetworkChange(callback: NetworkChangeCallback): () => void {
    this.networkChangeCallbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.networkChangeCallbacks.indexOf(callback);
      if (index > -1) {
        this.networkChangeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Notify all registered callbacks of network change
   */
  private notifyNetworkChange(status: NetworkStatus): void {
    for (const callback of this.networkChangeCallbacks) {
      try {
        callback(status);
      } catch (error) {
        console.error('Error in network change callback:', error);
      }
    }
  }

  /**
   * Queue a request for later retry when offline
   */
  queueRequest(request: unknown, options: {
    priority?: 'high' | 'medium' | 'low';
    maxRetries?: number;
  } = {}): string {
    if (!this.config.enableQueue) {
      throw new Error('Request queuing is disabled');
    }

    const queueSize = this.requestQueue.length;
    if (queueSize >= this.config.maxQueueSize!) {
      // Remove oldest low-priority request if queue is full
      const lowPriorityIndex = this.requestQueue.findIndex(
        r => r.priority === 'low'
      );
      if (lowPriorityIndex > -1) {
        this.requestQueue.splice(lowPriorityIndex, 1);
      } else {
        throw new Error('Request queue is full');
      }
    }

    const pendingRequest: PendingRequest = {
      id: this.generateRequestId(),
      timestamp: Date.now(),
      request,
      retryCount: 0,
      maxRetries: options.maxRetries || 3,
      priority: options.priority || 'medium'
    };

    // Insert based on priority (high priority first)
    if (pendingRequest.priority === 'high') {
      this.requestQueue.unshift(pendingRequest);
    } else {
      this.requestQueue.push(pendingRequest);
    }

    return pendingRequest.id;
  }

  /**
   * Process queued requests
   */
  async processQueue(): Promise<void> {
    if (!this.currentStatus.online || this.requestQueue.length === 0) {
      return;
    }

    // Process requests in priority order
    const requestsToProcess = [...this.requestQueue].sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    for (const pendingRequest of requestsToProcess) {
      try {
        // This would integrate with the actual request execution logic
        // For now, we'll just mark it as processed
        await this.executeQueuedRequest(pendingRequest);
        
        // Remove successfully processed request
        const index = this.requestQueue.findIndex(r => r.id === pendingRequest.id);
        if (index > -1) {
          this.requestQueue.splice(index, 1);
        }
      } catch (error) {
        // Increment retry count
        pendingRequest.retryCount++;

        // Remove if max retries exceeded
        if (pendingRequest.retryCount >= pendingRequest.maxRetries) {
          const index = this.requestQueue.findIndex(r => r.id === pendingRequest.id);
          if (index > -1) {
            this.requestQueue.splice(index, 1);
          }
          
          // Notify of failed request
          console.error(`Request ${pendingRequest.id} failed after ${pendingRequest.maxRetries} retries`);
        }
      }
    }
  }

  /**
   * Execute a queued request (placeholder for actual implementation)
   */
  private async executeQueuedRequest(pendingRequest: PendingRequest): Promise<void> {
    // This would integrate with the actual request execution logic
    // For now, this is a placeholder
    console.log(`Executing queued request: ${pendingRequest.id}`);
    
    // Simulate request execution
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Get queued requests
   */
  getQueue(): PendingRequest[] {
    return [...this.requestQueue];
  }

  /**
   * Clear the request queue
   */
  clearQueue(): void {
    this.requestQueue = [];
  }

  /**
   * Remove a specific request from the queue
   */
  removeFromQueue(requestId: string): boolean {
    const index = this.requestQueue.findIndex(r => r.id === requestId);
    if (index > -1) {
      this.requestQueue.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create an error context for network-related errors
   */
  createNetworkError(message: string, isOffline?: boolean): ErrorContext {
    return createErrorContext('NETWORK_OFFLINE', {
      category: ErrorCategory.NETWORK,
      message,
      userMessage: isOffline 
        ? 'You appear to be offline. Please check your internet connection.'
        : 'Network connection issue. Please check your connection and try again.',
      retryable: true,
      suggestedActions: [
        {
          label: 'Retry',
          action: 'retry',
          primary: true
        },
        {
          label: 'Check Connection',
          action: 'view_details'
        }
      ]
    });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<NetworkMonitorConfig>): void {
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
  getConfig(): NetworkMonitorConfig {
    return { ...this.config };
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.stopMonitoring();
    this.networkChangeCallbacks = [];
    this.clearQueue();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this._boundHandleOnline);
      window.removeEventListener('offline', this._boundHandleOffline);
    }
  }
}

// Global singleton instance
let globalNetworkMonitor: NetworkMonitor | null = null;

/**
 * Get or create the global network monitor instance
 */
export function getNetworkMonitor(config?: NetworkMonitorConfig): NetworkMonitor {
  if (!globalNetworkMonitor) {
    globalNetworkMonitor = new NetworkMonitor(config);
  } else if (config) {
    globalNetworkMonitor.updateConfig(config);
  }
  return globalNetworkMonitor;
}

/**
 * Reset the global network monitor (useful for testing)
 */
export function resetNetworkMonitor(): void {
  if (globalNetworkMonitor) {
    globalNetworkMonitor.destroy();
    globalNetworkMonitor = null;
  }
}
