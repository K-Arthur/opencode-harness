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
 * Theme-driven severity glyphs (inherit `currentColor`, so the card's
 * --card-accent tints them). Replaces the old emoji icons (ℹ️⚠️❌🚨), which
 * ignored the theme and rendered inconsistently across platforms.
 */
const ICON_INFO = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM7.25 7h1.5v4.5h-1.5V7zM8 4.25A.9.9 0 118 6a.9.9 0 010-1.75z"/></svg>`;
const ICON_WARNING = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 1.5l6.5 11.5H1.5L8 1.5zm-.75 4v3.5h1.5V5.5h-1.5zm0 4.5V11h1.5V10h-1.5z"/></svg>`;
const ICON_ERROR = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zm2.5 8.44L9.44 11 8 9.56 6.56 11 5.5 9.94 6.94 8.5 5.5 7.06 6.56 6 8 7.44 9.44 6l1.06 1.06L9.06 8.5l1.44 1.44z"/></svg>`;
const ICON_CRITICAL = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M5.2 1.5h5.6L14.5 5.2v5.6L10.8 14.5H5.2L1.5 10.8V5.2L5.2 1.5zm2.05 3.5v4h1.5V5h-1.5zm0 5v1.5h1.5V10h-1.5z"/></svg>`;

function severitySvg(severity: ErrorSeverity): string {
  switch (severity) {
    case ErrorSeverity.LOW: return ICON_INFO;
    case ErrorSeverity.MEDIUM: return ICON_WARNING;
    case ErrorSeverity.CRITICAL: return ICON_CRITICAL;
    case ErrorSeverity.HIGH:
    default: return ICON_ERROR;
  }
}

function severityModifier(severity: ErrorSeverity): string {
  switch (severity) {
    case ErrorSeverity.LOW: return 'info';
    case ErrorSeverity.MEDIUM: return 'warning';
    case ErrorSeverity.CRITICAL: return 'critical';
    case ErrorSeverity.HIGH:
    default: return 'error';
  }
}

/** Copy `text` to the clipboard, flashing the button label as feedback. */
function copyToClipboard(text: string, btn: HTMLButtonElement): void {
  const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator;
  const flash = () => {
    const prev = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = prev || 'Copy'; }, 1200);
  };
  try {
    if (nav?.clipboard?.writeText) {
      nav.clipboard.writeText(text).then(flash).catch(() => { /* clipboard denied */ });
    }
  } catch { /* no clipboard in this context */ }
}

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

    // Compact, theme-driven card. Severity (left border + icon colour) and all
    // spacing come from cards.css (`.oc-card`) — no inline styling, no
    // gradients/shadows, so it stays small and matches the rest of the UI.
    const container = document.createElement('div');
    container.className = `oc-card oc-card--${severityModifier(error.severity)} error-display`;
    container.setAttribute('role', 'alert');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('data-error-id', errorId);

    container.appendChild(this.renderHeader(error));
    container.appendChild(this.renderMessage(error));

    // Technical details (raw JSON / stack) collapsed by default.
    if (this.config.enableProgressiveDisclosure && error.technicalDetails) {
      container.appendChild(this.renderTechnicalDetails(error, isExpanded));
    }

    // Action buttons + the Details toggle share one compact row.
    const actions = this.renderActions(error, isExpanded);
    if (actions) container.appendChild(actions);

    return container;
  }

  /**
   * Render basic error view (collapsed)
   */
  renderBasic(error: ErrorContext): HTMLElement {
    const container = document.createElement('div');
    container.className = `oc-card oc-card--${severityModifier(error.severity)} oc-card--basic error-display-basic`;
    container.setAttribute('role', 'alert');
    container.setAttribute('aria-live', 'polite');

    const header = document.createElement('div');
    header.className = 'oc-card__header';

    const icon = document.createElement('span');
    icon.className = 'oc-card__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = severitySvg(error.severity);

    const message = document.createElement('span');
    message.className = 'oc-card__message';
    message.textContent = error.userMessage;

    header.append(icon, message);
    container.appendChild(header);
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
  private renderHeader(error: ErrorContext): HTMLElement {
    const header = document.createElement('div');
    header.className = 'oc-card__header';

    const icon = document.createElement('span');
    icon.className = 'oc-card__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = severitySvg(error.severity);

    const title = document.createElement('span');
    title.className = 'oc-card__title';
    title.textContent = this.getCategoryLabel(error.category);

    const code = document.createElement('code');
    code.className = 'oc-card__code';
    code.textContent = error.code;

    const spacer = document.createElement('span');
    spacer.className = 'oc-card__spacer';

    header.append(icon, title, code, spacer);
    return header;
  }

  /**
   * Render error message (the always-visible, human-readable first line)
   */
  private renderMessage(error: ErrorContext): HTMLElement {
    const message = document.createElement('div');
    message.className = 'oc-card__message';
    message.textContent = error.userMessage;
    return message;
  }

  /**
   * Render technical details (raw JSON / stack), collapsed by default with a
   * Copy action. Visibility is toggled by {@link renderToggleButton} via the
   * `hidden` attribute.
   */
  private renderTechnicalDetails(error: ErrorContext, isExpanded: boolean): HTMLElement {
    const details = document.createElement('div');
    details.className = 'oc-card__details';
    if (!isExpanded) details.setAttribute('hidden', '');

    let detailsText = error.technicalDetails || '';
    if (detailsText.length > this.config.maxTechnicalDetailsLength) {
      detailsText = detailsText.substring(0, this.config.maxTechnicalDetailsLength) + '…';
    }

    const head = document.createElement('div');
    head.className = 'oc-card__details-head';

    const label = document.createElement('span');
    label.className = 'oc-card__details-label';
    label.textContent = 'Technical details';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'oc-card__btn oc-card__btn--ghost';
    copyBtn.textContent = 'Copy';
    copyBtn.setAttribute('aria-label', 'Copy technical details');
    copyBtn.addEventListener('click', () => copyToClipboard(detailsText, copyBtn));

    head.append(label, copyBtn);

    const content = document.createElement('pre');
    content.className = 'oc-card__details-pre';
    content.textContent = detailsText;

    details.append(head, content);
    return details;
  }

  /**
   * Render action buttons
   */
  private renderActions(error: ErrorContext, isExpanded: boolean): HTMLElement | null {
    const hasActions = !!error.suggestedActions && error.suggestedActions.length > 0;
    const hasDetails = this.config.enableProgressiveDisclosure && !!error.technicalDetails;
    if (!hasActions && !hasDetails) return null;

    const actions = document.createElement('div');
    actions.className = 'oc-card__actions';

    if (hasActions) {
      for (const action of error.suggestedActions) {
        actions.appendChild(this.renderActionButton(action));
      }
    }
    // The Details toggle lives in the same compact row as the actions.
    if (hasDetails) {
      actions.appendChild(this.renderToggleButton(error, isExpanded));
    }

    return actions;
  }

  /**
   * Render a single action button (native <button> — keyboard-activates for
   * free, so no manual keydown wiring needed)
   */
  private renderActionButton(action: ErrorAction): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.className = `oc-card__btn${action.primary ? ' oc-card__btn--primary' : ''}`;
    button.setAttribute('aria-label', action.label);

    if (action.disabled) {
      button.disabled = true;
    } else {
      button.addEventListener('click', () => this.handleAction(action));
    }
    return button;
  }

  /**
   * Render the Details disclosure toggle. Toggles the technical-details panel's
   * `hidden` attribute in place (keeping focus and avoiding a full re-render).
   */
  private renderToggleButton(error: ErrorContext, isExpanded: boolean): HTMLElement {
    const errorId = error.correlationId || error.code;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'oc-card__btn oc-card__btn--ghost';
    toggle.textContent = isExpanded ? 'Hide details' : 'Details';
    toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    toggle.setAttribute('aria-label', 'Toggle technical details');

    toggle.addEventListener('click', () => {
      const card = toggle.closest('.oc-card');
      const details = card?.querySelector('.oc-card__details') as HTMLElement | null;
      if (!details) return;
      const willShow = details.hasAttribute('hidden');
      if (willShow) {
        details.removeAttribute('hidden');
        this.expandedErrors.add(errorId);
      } else {
        details.setAttribute('hidden', '');
        this.expandedErrors.delete(errorId);
      }
      toggle.textContent = willShow ? 'Hide details' : 'Details';
      toggle.setAttribute('aria-expanded', willShow ? 'true' : 'false');
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
        ? 'Offline' 
        : error.networkStatus === 'slow' 
          ? 'Slow connection' 
          : error.networkStatus === 'timeout' 
            ? 'Connection timed out' 
            : 'Connected';

      networkInfo.textContent = `Network: ${statusText}`;
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
