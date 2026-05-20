import { test, expect } from "@playwright/test"

test.describe("Context Usage Visual Regression", () => {
  test("context usage bar with tokens", async ({ page }) => {
    await page.goto("/")
    
    await page.evaluate(() => {
      const vscode = (window as any).acquireVsCodeApi()
      vscode.setState({
        sessions: [{ 
          id: "test-1", 
          name: "Test", 
          model: "claude-3-opus-20240229", 
          messages: [],
          tokenUsage: { total: 50000 }
        }]
      })
    })
    
    await expect(page).toHaveScreenshot("context-usage-with-tokens.png")
  })

  test("context usage bar hidden when zero tokens", async ({ page }) => {
    await page.goto("/")
    
    await page.evaluate(() => {
      const vscode = (window as any).acquireVsCodeApi()
      vscode.setState({
        sessions: [{ 
          id: "test-1", 
          name: "Test", 
          model: "claude-3-opus-20240229", 
          messages: [],
          tokenUsage: { total: 0 }
        }]
      })
    })
    
    await expect(page).toHaveScreenshot("context-usage-hidden.png")
  })
})

test.describe("Changed Files Visual Regression", () => {
  test("changed files list with multiple files", async ({ page }) => {
    await page.goto("/")
    
    await page.evaluate(() => {
      const vscode = (window as any).acquireVsCodeApi()
      vscode.setState({
        sessions: [{ 
          id: "test-1", 
          name: "Test", 
          model: "claude-3-opus-20240229", 
          messages: [],
          changedFiles: ["src/index.ts", "src/utils.ts", "src/components/Button.tsx"]
        }]
      })
    })
    
    await expect(page).toHaveScreenshot("changed-files-list.png")
  })

  test("changed files empty state", async ({ page }) => {
    await page.goto("/")
    
    await page.evaluate(() => {
      const vscode = (window as any).acquireVsCodeApi()
      vscode.setState({
        sessions: [{ 
          id: "test-1", 
          name: "Test", 
          model: "claude-3-opus-20240229", 
          messages: [],
          changedFiles: []
        }]
      })
    })
    
    await expect(page).toHaveScreenshot("changed-files-empty.png")
  })
})
