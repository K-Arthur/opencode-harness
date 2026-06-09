/**
 * Error UI Components Module
 * 
 * Provides progressive disclosure error display components with
 * accessibility features and specialized displays for different error types.
 */

import {
  ErrorContext,
  ErrorCategory,
  ErrorSeverity,
  ErrorAction,
  NetworkErrorContext,
  UsageErrorContext,
  GenerationErrorContext,
  AuthErrorContext,
  ModelErrorContext,
  ContextErrorContext
} from './errorTypes';
import { escapeHtml } from "./htmlUtils"

/**
 * Sink for error-action button clicks. Wired once by the webview entrypoint
 * (main.ts) to dispatch to the host (open_url / retry_stream / connect_provider)
 * or to local UI (model picker). Without it the buttons are inert, so we keep a
 * single injected handler instead of the old per-button console.log.
 */
export type ErrorActionHandler = (action: ErrorAction) => void
let _actionHandler: ErrorActionHandler | null = null
export function setErrorActionHandler(handler: ErrorActionHandler | null): void {
  _actionHandler = handler
}

/**
 * Error display configuration
 */
export interface ErrorDisplayConfig {
  enableProgressiveDisclosure: boolean;
  enableAnimations: boolean;
  showTechnicalDetails: boolean;
  autoCollapseDelay: number; // Auto-collapse after this many milliseconds (0 = never)
  maxTechnicalDetailsLength: number; // Maximum length of technical details to show
}

/**
 * Error display theme
 */
export interface ErrorDisplayTheme {
  colors: {
    low: string;
    medium: string;
    high: string;
    critical: string;
  };
  borderRadius: string;
  padding: string;
  fontSize: string;
}

/**
 * Default error display theme
 */
const DEFAULT_THEME: ErrorDisplayTheme = {
  colors: {
    low: '#3b82f6',      // Blue
    medium: '#f59e0b',    // Amber
    high: '#ef4444',      // Red
    critical: '#dc2626'   // Dark red
  },
  borderRadius: '8px',
  padding: '16px',
  fontSize: '14px'
};

/**
 * Error display component
 */
export class ErrorDisplay {
  private config: ErrorDisplayConfig;
  private theme: ErrorDisplayTheme;
  private expandedErrors = new Set<string>(); // Track expanded error IDs

  constructor(config: Partial<ErrorDisplayConfig> = {}, theme?: Partial<ErrorDisplayTheme>) {
    this.config = {
      enableProgressiveDisclosure: true,
      enableAnimations: true,
      showTechnicalDetails: false,
      autoCollapseDelay: 0,
      maxTechnicalDetailsLength: 500,
      ...config
    };

    this.theme = {
      ...DEFAULT_THEME,
      ...theme
    };
  }

  /**
   * Render an error context as an HTML element
   */
  render(error: ErrorContext): HTMLElement {
    const errorId = error.correlationId || error.code;
    const isExpanded = this.expandedErrors.has(errorId);

    const container = document.createElement('div');
    container.className = `error-display error-${error.severity}`;
    container.setAttribute('role', 'alert');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('data-error-id', errorId);

    // Apply severity-based styling
    const severityColor = this.getSeverityColor(error.severity);
    container.style.borderLeft = `4px solid ${severityColor}`;
    container.style.borderRadius = this.theme.borderRadius;
    container.style.padding = this.theme.padding;
    container.style.marginBottom = '12px';
    container.style.backgroundColor = 'var(--vscode-editor-background)';
    container.style.color = 'var(--vscode-editor-foreground)';

    // Error header
    const header = this.renderHeader(error, isExpanded);
    container.appendChild(header);

    // Error message (always visible)
    const message = this.renderMessage(error);
    container.appendChild(message);

    // Technical details (progressive disclosure)
    if (this.config.enableProgressiveDisclosure && error.technicalDetails) {
      const details = this.renderTechnicalDetails(error, isExpanded);
      container.appendChild(details);
    }

    // Action buttons
    const actions = this.renderActions(error);
    container.appendChild(actions);

    // Expand/collapse button for progressive disclosure
    if (this.config.enableProgressiveDisclosure) {
      const toggle = this.renderToggleButton(error, isExpanded);
      container.appendChild(toggle);
    }

    // Animation support
    if (this.config.enableAnimations) {
      container.style.transition = 'all 0.3s ease';
    }

    return container;
  }

  /**
   * Render basic error view (collapsed)
   */
  renderBasic(error: ErrorContext): HTMLElement {
    const container = document.createElement('div');
    container.className = 'error-display-basic';
    container.setAttribute('role', 'alert');
    container.setAttribute('aria-live', 'polite');

    const severityColor = this.getSeverityColor(error.severity);
    container.style.borderLeft = `3px solid ${severityColor}`;
    container.style.padding = '8px 12px';
    container.style.marginBottom = '8px';
    container.style.borderRadius = '4px';
    container.style.backgroundColor = 'var(--vscode-editor-background)';
    container.style.color = 'var(--vscode-editor-foreground)';

    const icon = this.getSeverityIcon(error.severity);
    const message = document.createElement('span');
    message.textContent = `${icon} ${error.userMessage}`;
    message.style.fontSize = this.theme.fontSize;

    container.appendChild(message);
    return container;
  }

  /**
   * Render detailed error view (expanded)
   */
  renderDetailed(error: ErrorContext): HTMLElement {
    const container = this.render(error);
    container.classList.add('error-display-detailed');
    
    // Force expand technical details
    const errorId = error.correlationId || error.code;
    this.expandedErrors.add(errorId);
    
    return container;
  }

  /**
   * Render error header
   */
  private renderHeader(error: ErrorContext, isExpanded: boolean): HTMLElement {
    const header = document.createElement('div');
    header.className = 'error-header';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.marginBottom = '8px';

    const icon = document.createElement('span');
    icon.textContent = this.getSeverityIcon(error.severity);
    icon.style.marginRight = '8px';
    icon.style.fontSize = '18px';

    const code = document.createElement('code');
    code.textContent = error.code;
    code.style.fontSize = '12px';
    code.style.padding = '2px 6px';
    code.style.borderRadius = '4px';
    code.style.backgroundColor = 'var(--vscode-textCodeBlock-background)';
    code.style.color = 'var(--vscode-textCodeBlock-foreground)';
    code.style.fontFamily = 'monospace';

    const category = document.createElement('span');
    category.textContent = this.getCategoryLabel(error.category);
    category.style.fontSize = '12px';
    category.style.color = 'var(--vscode-descriptionForeground)';
    category.style.marginLeft = '8px';

    header.appendChild(icon);
    header.appendChild(code);
    header.appendChild(category);

    return header;
  }

  /**
   * Render error message
   */
  private renderMessage(error: ErrorContext): HTMLElement {
    const message = document.createElement('div');
    message.className = 'error-message';
    message.textContent = error.userMessage;
    message.style.fontSize = this.theme.fontSize;
    message.style.lineHeight = '1.5';
    message.style.marginBottom = '12px';

    return message;
  }

  /**
   * Render technical details (expandable)
   */
  private renderTechnicalDetails(error: ErrorContext, isExpanded: boolean): HTMLElement {
    const details = document.createElement('div');
    details.className = 'error-technical-details';
    details.style.marginTop = '12px';
    details.style.paddingTop = '12px';
    details.style.borderTop = '1px solid var(--vscode-panel-border)';
    details.style.display = isExpanded ? 'block' : 'none';

    if (this.config.enableAnimations) {
      details.style.transition = 'display 0.3s ease';
    }

    const label = document.createElement('strong');
    label.textContent = 'Technical Details:';
    label.style.display = 'block';
    label.style.marginBottom = '4px';
    label.style.fontSize = '12px';
    label.style.color = 'var(--vscode-descriptionForeground)';

    const content = document.createElement('pre');
    content.style.fontSize = '12px';
    content.style.fontFamily = 'monospace';
    content.style.whiteSpace = 'pre-wrap';
    content.style.wordBreak = 'break-word';
    content.style.color = 'var(--vscode-descriptionForeground)';

    // Truncate technical details if too long
    let detailsText = error.technicalDetails || '';
    if (detailsText.length > this.config.maxTechnicalDetailsLength) {
      detailsText = detailsText.substring(0, this.config.maxTechnicalDetailsLength) + '...';
    }
    content.textContent = detailsText;

    details.appendChild(label);
    details.appendChild(content);

    return details;
  }

  /**
   * Render action buttons
   */
  private renderActions(error: ErrorContext): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'error-actions';
    actions.style.display = 'flex';
    actions.style.flexWrap = 'wrap';
    actions.style.gap = '8px';
    actions.style.marginTop = '12px';

    for (const action of error.suggestedActions) {
      const button = this.renderActionButton(action);
      actions.appendChild(button);
    }

    return actions;
  }

  /**
   * Render a single action button
   */
  private renderActionButton(action: ErrorAction): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = action.label;
    button.className = `error-action-button ${action.primary ? 'primary' : 'secondary'}`;
    
    // Button styling
    button.style.padding = '6px 12px';
    button.style.borderRadius = '4px';
    button.style.border = '1px solid var(--vscode-button-border)';
    button.style.backgroundColor = action.primary 
      ? 'var(--vscode-button-background)' 
      : 'transparent';
    button.style.color = 'var(--vscode-button-foreground)';
    button.style.cursor = action.disabled ? 'not-allowed' : 'pointer';
    button.style.fontSize = '13px';
    button.style.fontFamily = 'inherit';

    if (action.disabled) {
      button.style.opacity = '0.5';
      button.disabled = true;
    } else {
      button.addEventListener('click', () => {
        this.handleAction(action);
      });
    }

    // Keyboard accessibility
    button.setAttribute('tabindex', '0');
    button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!action.disabled) {
          this.handleAction(action);
        }
      }
    });

    return button;
  }

  /**
   * Render expand/collapse toggle button
   */
  private renderToggleButton(error: ErrorContext, isExpanded: boolean): HTMLElement {
    const toggle = document.createElement('button');
    toggle.className = 'error-toggle-button';
    toggle.textContent = isExpanded ? 'Show Less' : 'Show Details';
    toggle.style.marginTop = '8px';
    toggle.style.padding = '4px 8px';
    toggle.style.border = 'none';
    toggle.style.backgroundColor = 'transparent';
    toggle.style.color = 'var(--vscode-textLink-foreground)';
    toggle.style.cursor = 'pointer';
    toggle.style.fontSize = '12px';
    toggle.style.fontStyle = 'italic';

    toggle.addEventListener('click', () => {
      const errorId = error.correlationId || error.code;
      if (isExpanded) {
        this.expandedErrors.delete(errorId);
      } else {
        this.expandedErrors.add(errorId);
      }
      
      // Re-render the error
      const newElement = this.render(error);
      const oldElement = document.querySelector(`[data-error-id="${errorId}"]`);
      if (oldElement && oldElement.parentNode) {
        oldElement.parentNode.replaceChild(newElement, oldElement);
      }
    });

    return toggle;
  }

  /**
   * Handle action button click
   */
  private handleAction(action: ErrorAction): void {
    if (_actionHandler) {
      _actionHandler(action);
      return;
    }
    // No handler wired (e.g. unit/browser test context) — stay silent rather
    // than pretending to act.
    console.warn('Error action ignored — no handler registered:', action.action);
  }

  /**
   * Get severity color
   */
  private getSeverityColor(severity: ErrorSeverity): string {
    return this.theme.colors[severity];
  }

  /**
   * Get severity icon
   */
  private getSeverityIcon(severity: ErrorSeverity): string {
    switch (severity) {
      case ErrorSeverity.LOW:
        return 'ℹ️';
      case ErrorSeverity.MEDIUM:
        return '⚠️';
      case ErrorSeverity.HIGH:
        return '❌';
      case ErrorSeverity.CRITICAL:
        return '🚨';
      default:
        return '⚠️';
    }
  }

  /**
   * Get category label
   */
  private getCategoryLabel(category: ErrorCategory): string {
    switch (category) {
      case ErrorCategory.NETWORK:
        return 'Network';
      case ErrorCategory.USAGE:
        return 'Usage';
      case ErrorCategory.GENERATION:
        return 'Generation';
      case ErrorCategory.AUTH:
        return 'Authentication';
      case ErrorCategory.MODEL:
        return 'Model';
      case ErrorCategory.CONTEXT:
        return 'Context';
      case ErrorCategory.SYSTEM:
        return 'System';
      default:
        return 'Unknown';
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ErrorDisplayConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Update theme
   */
  updateTheme(theme: Partial<ErrorDisplayTheme>): void {
    this.theme = { ...this.theme, ...theme };
  }

  /**
   * Get current configuration
   */
  getConfig(): ErrorDisplayConfig {
    return { ...this.config };
  }

  /**
   * Get current theme
   */
  getTheme(): ErrorDisplayTheme {
    return { ...this.theme };
  }

  /**
   * Clear expanded errors
   */
  clearExpandedErrors(): void {
    this.expandedErrors.clear();
  }
}

/**
 * Network error display (specialized for network errors)
 */
export class NetworkErrorDisplay extends ErrorDisplay {
  constructor(config?: Partial<ErrorDisplayConfig>) {
    super(config);
  }

  render(error: NetworkErrorContext): HTMLElement {
    const container = super.render(error);
    
    // Add network-specific information
    if (error.networkStatus) {
      const networkInfo = document.createElement('div');
      networkInfo.className = 'network-info';
      networkInfo.style.marginTop = '8px';
      networkInfo.style.padding = '8px';
      networkInfo.style.backgroundColor = 'var(--vscode-textBlockQuote-background)';
      networkInfo.style.borderRadius = '4px';
      networkInfo.style.fontSize = '12px';

      const statusText = error.networkStatus === 'offline' 
        ? '🔴 Offline' 
        : error.networkStatus === 'slow' 
          ? '🟡 Slow Connection' 
          : error.networkStatus === 'timeout' 
            ? '🟠 Connection Timeout' 
            : '🟢 Connected';

      networkInfo.textContent = `Network Status: ${statusText}`;
      container.appendChild(networkInfo);
    }

    return container;
  }
}

/**
 * Quota error display (specialized for usage/quota errors)
 */
export class QuotaErrorDisplay extends ErrorDisplay {
  constructor(config?: Partial<ErrorDisplayConfig>) {
    super(config);
  }

  render(error: UsageErrorContext): HTMLElement {
    const container = super.render(error);
    
    // Add quota-specific information
    if (error.quotaState) {
      const quotaInfo = document.createElement('div');
      quotaInfo.className = 'quota-info';
      quotaInfo.style.marginTop = '8px';
      quotaInfo.style.padding = '8px';
      quotaInfo.style.backgroundColor = 'var(--vscode-textBlockQuote-background)';
      quotaInfo.style.borderRadius = '4px';
      quotaInfo.style.fontSize = '12px';

      const percentage = ((error.quotaState.remainingTokens / error.quotaState.limitTokens) * 100).toFixed(1);
      quotaInfo.textContent = `Quota: ${error.quotaState.remainingTokens.toLocaleString()} / ${error.quotaState.limitTokens.toLocaleString()} tokens (${percentage}%)`;
      
      container.appendChild(quotaInfo);

      // Add reset time if available
      if (error.quotaState.resetAt) {
        const resetInfo = document.createElement('div');
        resetInfo.style.marginTop = '4px';
        resetInfo.style.fontSize = '11px';
        resetInfo.style.color = 'var(--vscode-descriptionForeground)';
        resetInfo.textContent = `Resets at: ${error.quotaState.resetAt.toLocaleTimeString()}`;
        quotaInfo.appendChild(resetInfo);
      }
    }

    return container;
  }
}

/**
 * Generation error display (specialized for generation errors)
 */
export class GenerationErrorDisplay extends ErrorDisplay {
  constructor(config?: Partial<ErrorDisplayConfig>) {
    super(config);
  }

  render(error: GenerationErrorContext): HTMLElement {
    const container = super.render(error);
    
    // Add generation-specific information
    if (error.partialResponse && error.partialResponse.length > 0) {
      const partialInfo = document.createElement('div');
      partialInfo.className = 'partial-response-info';
      partialInfo.style.marginTop = '8px';
      partialInfo.style.padding = '8px';
      partialInfo.style.backgroundColor = 'var(--vscode-textBlockQuote-background)';
      partialInfo.style.borderRadius = '4px';
      partialInfo.style.fontSize = '12px';

      const preview = error.partialResponse.length > 100 
        ? error.partialResponse.substring(0, 100) + '...' 
        : error.partialResponse;
      
      partialInfo.innerHTML = `<strong>Partial Response Saved:</strong><br><code>${escapeHtml(preview)}</code>`;
      container.appendChild(partialInfo);
    }

    if (error.contextLimitReached) {
      const contextInfo = document.createElement('div');
      contextInfo.className = 'context-limit-info';
      contextInfo.style.marginTop = '8px';
      contextInfo.style.padding = '8px';
      contextInfo.style.backgroundColor = 'var(--vscode-textBlockQuote-background)';
      contextInfo.style.borderRadius = '4px';
      contextInfo.style.fontSize = '12px';

      contextInfo.textContent = `Context limit: ${error.currentContextSize} / ${error.maxContextSize} tokens`;
      container.appendChild(contextInfo);
    }

    return container;
  }

}

/**
 * Get error display instance based on error category
 */
export function getErrorDisplayForCategory(
  category: ErrorCategory,
  config?: Partial<ErrorDisplayConfig>
): ErrorDisplay {
  switch (category) {
    case ErrorCategory.NETWORK:
      return new NetworkErrorDisplay(config);
    case ErrorCategory.USAGE:
      return new QuotaErrorDisplay(config);
    case ErrorCategory.GENERATION:
      return new GenerationErrorDisplay(config);
    default:
      return new ErrorDisplay(config);
  }
}

// Global singleton instance
let globalErrorDisplay: ErrorDisplay | null = null;

/**
 * Get or create the global error display instance
 */
export function getErrorDisplay(config?: Partial<ErrorDisplayConfig>): ErrorDisplay {
  if (!globalErrorDisplay) {
    globalErrorDisplay = new ErrorDisplay(config);
  } else if (config) {
    globalErrorDisplay.updateConfig(config);
  }
  return globalErrorDisplay;
}

/**
 * Reset the global error display (useful for testing)
 */
export function resetErrorDisplay(): void {
  globalErrorDisplay = null;
}
