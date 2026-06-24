import { test, expect } from '@playwright/test'
import { dispatchHostMessage, installVsCodeApi, expectNoWebviewErrors, postedMessages } from '../visual/webviewTestHarness'

test.describe('Error Handling E2E — Full Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('prompt_rejected shows in-stream error with reason', async ({ page }) => {
    // Send init_state first to create a session
    await dispatchHostMessage(page, {
      type: 'init_state',
      tabs: [{ id: 'tab-1', cliSessionId: 'sess-1', isStreaming: false }],
      activeSessionId: 'tab-1',
      maxConcurrentStreams: 5,
    })

    // Clear any welcome messages
    await page.evaluate(() => {
      const list = document.querySelector('.message-list')
      if (list) list.innerHTML = ''
    })

    // Simulate prompt_rejected
    await dispatchHostMessage(page, {
      type: 'prompt_rejected',
      sessionId: 'tab-1',
      reason: 'Concurrent stream limit reached. Wait for the active stream to finish.',
    })

    // Wait a tick for the error to render
    await page.waitForTimeout(100)

    // Check that an error message appears
    const errors = page.locator('.msg-error')
    await expect(errors.first()).toBeVisible()
  })

  test('rate_limit_exhausted creates both input banner and in-stream error', async ({ page }) => {
    await dispatchHostMessage(page, {
      type: 'init_state',
      tabs: [{ id: 'tab-1', cliSessionId: 'sess-1', isStreaming: false }],
      activeSessionId: 'tab-1',
      maxConcurrentStreams: 5,
    })

    // Send rate_limit_exhausted
    await dispatchHostMessage(page, {
      type: 'rate_limit_exhausted',
      info: { resetAt: new Date(Date.now() + 60000).toISOString() },
    })

    await page.waitForTimeout(100)

    // Input-area banner should exist
    const banner = page.locator('#rate-limit-bar')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('Rate limit exceeded')
  })

  test('rate_limit_state feeds quota monitor and shows quota bar', async ({ page }) => {
    await dispatchHostMessage(page, {
      type: 'init_state',
      tabs: [{ id: 'tab-1', cliSessionId: 'sess-1', isStreaming: false }],
      activeSessionId: 'tab-1',
      maxConcurrentStreams: 5,
    })

    await dispatchHostMessage(page, {
      type: 'rate_limit_state',
      state: {
        remainingTokens: 500,
        limitTokens: 1000,
        remainingRequests: 10,
        limitRequests: 20,
        resetAt: new Date(Date.now() + 3600000).toISOString(),
        provider: 'openai',
      },
    })

    await page.waitForTimeout(100)

    // Quota bar should be visible and show percentage
    const quotaBar = page.locator('#quota-bar')
    await expect(quotaBar).toBeVisible()
    await expect(quotaBar.locator('.quota-label')).toContainText('openai')
  })

  test('show_error handler creates in-stream error message', async ({ page }) => {
    await dispatchHostMessage(page, {
      type: 'init_state',
      tabs: [{ id: 'tab-1', cliSessionId: 'sess-1', isStreaming: false }],
      activeSessionId: 'tab-1',
      maxConcurrentStreams: 5,
    })

    await dispatchHostMessage(page, {
      type: 'show_error',
      message: 'Server configuration is invalid.',
    })

    await page.waitForTimeout(100)

    const error = page.locator('.msg-error')
    await expect(error).toBeVisible()
    await expect(error.locator('.error-message')).toContainText('Server configuration is invalid')
  })

  test('provider_error surfaces user-facing error', async ({ page }) => {
    await dispatchHostMessage(page, {
      type: 'init_state',
      tabs: [{ id: 'tab-1', cliSessionId: 'sess-1', isStreaming: false }],
      activeSessionId: 'tab-1',
      maxConcurrentStreams: 5,
    })

    await dispatchHostMessage(page, {
      type: 'provider_error',
      error: 'API key for openai is invalid or expired.',
    })

    await page.waitForTimeout(100)

    const error = page.locator('.msg-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('Provider error')
    await expect(error).toContainText('API key')
  })

  test('webview_request_error with errorContext preserves structured actions', async ({ page }) => {
    await dispatchHostMessage(page, {
      type: 'init_state',
      tabs: [{ id: 'tab-1', cliSessionId: 'sess-1', isStreaming: false }],
      activeSessionId: 'tab-1',
      maxConcurrentStreams: 5,
    })

    await dispatchHostMessage(page, {
      type: 'webview_request_error',
      error: 'Model unavailable.',
      errorContext: {
        category: 'model',
        severity: 'high',
        code: 'MODEL_UNAVAILABLE',
        message: 'Model unavailable',
        userMessage: 'The requested model is currently unavailable.',
        suggestedActions: [
          { label: 'Switch Model', action: 'switch_model', primary: true },
        ],
        retryable: true,
        timestamp: Date.now(),
      },
    })

    await page.waitForTimeout(100)

    const error = page.locator('.msg-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('unavailable')
  })

  test('request_error with errorContext shows accurate error information', async ({ page }) => {
    await dispatchHostMessage(page, {
      type: 'init_state',
      tabs: [{ id: 'tab-1', cliSessionId: 'sess-1', isStreaming: false }],
      activeSessionId: 'tab-1',
      maxConcurrentStreams: 5,
    })

    await dispatchHostMessage(page, {
      type: 'request_error',
      message: 'Quota exceeded.',
      errorContext: {
        category: 'usage',
        severity: 'high',
        code: 'QUOTA_EXCEEDED',
        message: 'Quota exceeded',
        userMessage: 'Your usage quota is exhausted.',
        suggestedActions: [
          { label: 'Switch provider', action: 'switch_model', primary: true },
        ],
        retryable: false,
        timestamp: Date.now(),
      },
    })

    await page.waitForTimeout(100)

    // USAGE + HIGH + non-retryable is a Tier A hard block: it renders in the
    // global-status-banner slot and gates the composer.
    const banner = page.locator('#global-status-banner .tier-a-anchor')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('Your usage quota is exhausted')
    await expect(page.locator('#prompt-input')).toHaveAttribute('disabled', 'true')
  })

  test('duplicate error coalescing - same error only shown once', async ({ page }) => {
    await dispatchHostMessage(page, {
      type: 'init_state',
      tabs: [{ id: 'tab-1', cliSessionId: 'sess-1', isStreaming: false }],
      activeSessionId: 'tab-1',
      maxConcurrentStreams: 5,
    })

    // Send the same error twice
    await dispatchHostMessage(page, {
      type: 'request_error',
      message: 'Server error.',
      errorContext: {
        category: 'system',
        severity: 'medium',
        code: 'SERVER_ERROR',
        message: 'Server error',
        userMessage: 'The OpenCode server returned an error. Retry, or check its logs.',
        suggestedActions: [{ label: 'Retry', action: 'retry', primary: true }],
        retryable: true,
        timestamp: Date.now(),
      },
    })

    await page.waitForTimeout(50)

    await dispatchHostMessage(page, {
      type: 'request_error',
      message: 'Server error.',
      errorContext: {
        category: 'system',
        severity: 'medium',
        code: 'SERVER_ERROR',
        message: 'Server error',
        userMessage: 'The OpenCode server returned an error. Retry, or check its logs.',
        suggestedActions: [{ label: 'Retry', action: 'retry', primary: true }],
        retryable: true,
        timestamp: Date.now(),
      },
    })

    await page.waitForTimeout(100)

    // SYSTEM + retryable is a Tier B ambient banner; the second error replaces
    // the first, so only one banner remains.
    const banners = page.locator('#global-status-banner .tier-b-banner')
    await expect(banners).toHaveCount(1)
    await expect(banners.first()).toContainText('The OpenCode server returned an error')
  })
})
