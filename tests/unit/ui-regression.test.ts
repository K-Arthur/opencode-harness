import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createState } from '../../src/chat/webview/state'

// Mock vscode API
const mockVscode = {
  postMessage: () => {},
  getState: () => undefined,
  setState: (s: any) => { mockVscode.savedState = s },
  savedState: undefined as any
}

describe('UI Regression: Model Dropdown on Welcome Screen', () => {
  beforeEach(() => {
    mockVscode.savedState = undefined
  })

  it('should update global model even when no active session exists', () => {
    const stateManager = createState(mockVscode as any)
    
    // Initial state: no active session
    assert.strictEqual(stateManager.getActiveSession(), undefined)
    assert.strictEqual(stateManager.getState().globalModel, "")

    // User selects a model on the welcome screen
    stateManager.setGlobalModel("anthropic/claude-3-opus")
    stateManager.flush()
    
    // Global model should be updated
    assert.strictEqual(stateManager.getState().globalModel, "anthropic/claude-3-opus")
    // State should be persisted
    assert.strictEqual(mockVscode.savedState.globalModel, "anthropic/claude-3-opus")
  })

  it('should mark recent and favorite models for frontend sorting', () => {
    const stateManager = createState(mockVscode as any)

    stateManager.setGlobalModel("google/gemini-2.5-pro")
    const isFavorite = stateManager.toggleModelFavorite("anthropic/claude-sonnet-4")
    const models = stateManager.applyModelState([
      { provider: "google", id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
      { provider: "anthropic", id: "claude-sonnet-4", displayName: "Claude Sonnet 4" },
    ])

    assert.equal(isFavorite, true)
    assert.equal(models.find((m) => m.provider === "google")?.recentRank, 0)
    assert.equal(models.find((m) => m.provider === "anthropic")?.favorite, true)
  })
})
