import { test, expect, type Page } from '@playwright/test'

declare global {
  interface Window {
    __vscodeMessages: Record<string, unknown>[]
    __vscodeState: unknown
    acquireVsCodeApi: () => {
      postMessage(message: Record<string, unknown>): void
      getState(): unknown
      setState(state: unknown): void
    }
  }
}

async function installVsCodeApi(page: Page) {
  await page.addInitScript(() => {
    window.__vscodeMessages = []
    window.__vscodeState = undefined
    window.acquireVsCodeApi = () => ({
      postMessage(message: Record<string, unknown>) {
        window.__vscodeMessages.push(JSON.parse(JSON.stringify(message)))
      },
      getState() {
        return window.__vscodeState
      },
      setState(state: unknown) {
        window.__vscodeState = JSON.parse(JSON.stringify(state))
      },
    })
  })
}

async function postedMessages(page: Page) {
  return page.evaluate(() => window.__vscodeMessages)
}

async function dispatchHostMessage(page: Page, message: Record<string, unknown>) {
  await page.evaluate((msg) => {
    window.dispatchEvent(new MessageEvent('message', { data: msg }))
  }, message)
}

test.describe('Webview host contract', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
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
    await page.locator('#prompt-input').fill('hello')
    await page.locator('#send-btn').click()

    const send = (await postedMessages(page)).find((m) => m.type === 'send_prompt')
    expect(send?.sessionId).toEqual(expect.any(String))
    const sessionId = send!.sessionId as string

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
    await expect(page.locator('#send-btn')).toBeDisabled()
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
            type: 'diff_block',
            id: 'diff-1',
            filePath: 'src/example.ts',
            diffText: '+hello',
          }],
        }],
      }],
      activeSessionId: 'session-1',
      globalModel: '',
    })

    await page.locator('.diff-btn-accept').click()
    await expect.poll(async () => postedMessages(page)).toContainEqual(
      expect.objectContaining({ type: 'accept_diff', blockId: 'diff-1' })
    )
  })
})
