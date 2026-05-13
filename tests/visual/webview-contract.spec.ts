import { test, expect, type Page } from '@playwright/test'
import {
  installVsCodeApi,
  postedMessages,
  dispatchHostMessage,
  expectNoWebviewErrors,
  captureErrors,
  expectNoBrowserErrors,
} from './webviewTestHarness'

test.describe('Webview host contract', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('announces readiness so the host can push initial state', async ({ page }) => {
    await expect.poll(async () => postedMessages(page)).toContainEqual(
      expect.objectContaining({ type: 'webview_ready' })
    )
  })

  test('header and input actions post host messages', async ({ page }) => {
    await page.locator('#settings-btn').click()
    await page.locator('#mcp-btn').click()
    await page.locator('#attach-btn').click()

    const types = (await postedMessages(page)).map((m) => m.type)
    expect(types).toContain('open_settings')
    expect(types).toContain('open_mcp_settings')
    expect(types).toContain('attach_files')
  })

  test('host can insert attached file mentions into the prompt', async ({ page }) => {
    await page.locator('#prompt-input').fill('review')
    await dispatchHostMessage(page, {
      type: 'insert_text',
      text: '@file:src/chat/ChatProvider.ts ',
    })

    await expect(page.locator('#prompt-input')).toHaveValue('review @file:src/chat/ChatProvider.ts ')
    await expect(page.locator('#send-btn')).toBeEnabled()
  })

  test('model picker requests models when opened and posts selected model', async ({ page }) => {
    await page.locator('#model-selector-btn').click()
    await expect.poll(async () => (await postedMessages(page)).map((m) => m.type)).toContain('get_models')

    await dispatchHostMessage(page, {
      type: 'model_list',
      items: [
        { id: 'gpt-5-nano', provider: 'opencode', displayName: 'gpt-5-nano' },
        { id: 'big-pickle', provider: 'opencode', displayName: 'big-pickle' },
      ],
    })

    await page.locator('.model-option', { hasText: 'big-pickle' }).click()
    await expect(page.locator('#model-label')).toHaveText('big-pickle')

    const messages = await postedMessages(page)
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'set_model',
      model: 'opencode/big-pickle',
    }))
  })

  test('system tool messages do not mark an active stream as finished', async ({ page }) => {
    await dispatchHostMessage(page, {
      type: 'init_state',
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        model: '',
        mode: 'build',
        isStreaming: false,
        messages: [],
      }],
      activeSessionId: 'session-1',
      globalModel: '',
    })

    const sessionId = 'session-1'

    await dispatchHostMessage(page, {
      type: 'stream_start',
      sessionId,
      messageId: 'assistant-1',
    })
    await dispatchHostMessage(page, {
      type: 'message',
      message: {
        role: 'system',
        sessionId,
        blocks: [{ type: 'tool_call', toolName: 'read', state: 'running' }],
      },
    })

    await page.locator('#prompt-input').fill('second prompt while first is running')
    await expect(page.locator('#send-btn')).toHaveAttribute('aria-label', 'Stop generation')
    await expect(page.locator('#send-btn')).toHaveClass(/stopping/)
  })

  test('diff accept and reject actions are wired back to the host', async ({ page }) => {
    await dispatchHostMessage(page, {
      type: 'init_state',
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        model: '',
        mode: 'normal',
        isStreaming: false,
        messages: [{
          id: 'assistant-1',
          role: 'assistant',
          sessionId: 'session-1',
          blocks: [{
            type: 'diff',
            diffId: 'diff-1',
            path: 'src/example.ts',
            diffText: '+hello',
            state: 'pending',
            hunks: [],
            linesAdded: 1,
            linesRemoved: 0,
          }],
        }],
      }],
      activeSessionId: 'session-1',
      globalModel: '',
    })

    await page.locator('.diff-btn--accept').click()
    await expect.poll(async () => postedMessages(page)).toContainEqual(
      expect.objectContaining({ type: 'diff:accept', diffId: 'diff-1' })
    )
  })
})
