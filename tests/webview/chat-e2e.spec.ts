import { test, expect } from "@playwright/test"

test.describe("Chat Webview E2E", () => {
  test("model dropdown syncs selected state on model change", async ({ page }) => {
    await page.goto("/")
    
    // Mock VS Code API
    await page.evaluate(() => {
      (window as any).acquireVsCodeApi = () => ({
        postMessage: (msg: any) => {
          (window as any).__testMessages = (window as any).__testMessages || []
          ;(window as any).__testMessages.push(msg)
        },
        getState: () => ({
          sessions: [{ id: "test-1", name: "Test", model: "claude-3-opus-20240229", messages: [] }]
        }),
        setState: () => {}
      })
    })
    
    // Wait for page to load
    await page.waitForSelector(".model-selector-btn")
    
    // Click model dropdown
    await page.click(".model-selector-btn")
    
    // Select a different model
    await page.click('[role="option"]:has-text("claude-3-sonnet")')
    
    // Verify model was changed
    const messages = await page.evaluate(() => (window as any).__testMessages || [])
    const modelUpdateMsg = messages.find((m: any) => m.type === "model_update")
    expect(modelUpdateMsg).toBeDefined()
    expect(modelUpdateMsg.model).toContain("claude-3-sonnet")
  })

  test("context usage panel resets on tab switch", async ({ page }) => {
    await page.goto("/")
    
    await page.evaluate(() => {
      (window as any).acquireVsCodeApi = () => ({
        postMessage: (msg: any) => {
          (window as any).__testMessages = (window as any).__testMessages || []
          ;(window as any).__testMessages.push(msg)
        },
        getState: () => ({
          sessions: [
            { id: "test-1", name: "Test 1", model: "claude-3-opus-20240229", messages: [], tokenUsage: { total: 1000 } },
            { id: "test-2", name: "Test 2", model: "claude-3-opus-20240229", messages: [], tokenUsage: { total: 0 } }
          ],
          activeSessionId: "test-1"
        }),
        setState: () => {}
      })
    })
    
    // Switch to second tab
    await page.evaluate(() => {
      const vscode = (window as any).acquireVsCodeApi()
      vscode.postMessage({ type: "active_session_changed", sessionId: "test-2" })
    })
    
    // Verify context usage was reset
    const contextBar = page.locator("#context-usage-bar")
    await expect(contextBar).toHaveClass(/hidden/)
  })

  test("changed files display with icons and status", async ({ page }) => {
    await page.goto("/")
    
    await page.evaluate(() => {
      (window as any).acquireVsCodeApi = () => ({
        postMessage: (msg: any) => {
          (window as any).__testMessages = (window as any).__testMessages || []
          ;(window as any).__testMessages.push(msg)
        },
        getState: () => ({
          sessions: [{ id: "test-1", name: "Test", model: "claude-3-opus-20240229", messages: [], changedFiles: ["src/index.ts", "src/utils.ts"] }]
        }),
        setState: () => {}
      })
    })
    
    // Wait for changed files to render
    await page.waitForSelector(".changed-file-chip")
    
    // Verify icons are present
    const icons = await page.locator(".changed-file-icon").count()
    expect(icons).toBeGreaterThan(0)
    
    // Verify status indicators are present
    const status = await page.locator(".changed-file-status").count()
    expect(status).toBeGreaterThan(0)
  })

  test("streaming markdown handles partial code fences", async ({ page }) => {
    await page.goto("/")
    
    await page.evaluate(() => {
      (window as any).acquireVsCodeApi = () => ({
        postMessage: (msg: any) => {
          (window as any).__testMessages = (window as any).__testMessages || []
          ;(window as any).__testMessages.push(msg)
        },
        getState: () => ({
          sessions: [{ id: "test-1", name: "Test", model: "claude-3-opus-20240229", messages: [] }]
        }),
        setState: () => {}
      })
    })
    
    // Simulate streaming message with unclosed code fence
    await page.evaluate(() => {
      const vscode = (window as any).acquireVsCodeApi()
      vscode.postMessage({
        type: "stream_chunk",
        sessionId: "test-1",
        text: "```typescript\nconst x = 1",
        messageId: "msg-1"
      })
    })
    
    // Verify content is rendered (not treated as raw code block due to normalization)
    await page.waitForSelector(".message-content")
    const content = await page.locator(".message-content").textContent()
    expect(content).toContain("```typescript")
  })
})
