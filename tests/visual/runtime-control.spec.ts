import { test, expect } from '@playwright/test'
import {
  dispatchHostMessage,
  expectNoWebviewErrors,
  installVsCodeApi,
  postedMessages,
} from './webviewTestHarness'

test.describe('OpenCode runtime control', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('shows the verified runtime and posts an idle switch request', async ({ page }) => {
    const selector = page.locator('#runtime-select')
    const badge = page.locator('#runtime-badge')

    await dispatchHostMessage(page, {
      type: 'runtime_status',
      connected: true,
      runtime: 'opencode2',
      apiSurface: 'opencode2',
      version: '2.0.0',
      preference: 'auto',
    })

    await expect(selector).toHaveValue('auto')
    await expect(badge).toHaveText('OpenCode 2 · verified')
    await expect(badge).toHaveAttribute('aria-label', 'OpenCode 2 v2.0.0 verified by the server handshake')
    await expect(selector).toHaveCSS('min-height', '26px')
    await expect(selector).toHaveCSS('border-left-width', '1px')

    await selector.selectOption('opencode')
    await expect(selector).toBeDisabled()
    await expect(badge).toHaveText('Switching…')
    await expect.poll(async () => postedMessages(page)).toContainEqual({
      type: 'set_runtime',
      runtime: 'opencode',
    })

    // Keep a real rendered artifact for local visual inspection without adding
    // a machine-specific screenshot baseline to the repository.
    await page.screenshot({ path: '/tmp/opencode-runtime-control.png' })
  })

  test('returns to a disconnected state when the host disconnects', async ({ page }) => {
    await dispatchHostMessage(page, {
      type: 'runtime_status',
      connected: true,
      runtime: 'opencode',
      preference: 'opencode',
    })
    await expect(page.locator('#runtime-badge')).toHaveText('OpenCode · verified')

    await dispatchHostMessage(page, {
      type: 'runtime_status',
      connected: false,
      runtime: 'unknown',
      preference: 'opencode',
    })
    await expect(page.locator('#runtime-badge')).toHaveText('Not connected')
  })
})
