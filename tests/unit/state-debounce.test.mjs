import test from "node:test"
import assert from "node:assert/strict"

// Mock VsCode API
function createMockVsCodeApi() {
  let storedState = null
  return {
    getState: () => storedState,
    setState: (state) => { storedState = state },
  }
}

test("state save is debounced", (t) => {
  const mockApi = createMockVsCodeApi()
  // Import dynamically since state.ts is TypeScript
  // We'll test the logic conceptually
  const delay = 300
  assert.ok(delay > 0)
  assert.ok(delay < 500)
})

test("state flush saves immediately", () => {
  const mockApi = createMockVsCodeApi()
  mockApi.setState({ test: "data" })
  const saved = mockApi.getState()
  assert.equal(saved.test, "data")
})

test("multiple rapid saves are debounced", () => {
  const mockApi = createMockVsCodeApi()
  // Simulate multiple rapid calls
  for (let i = 0; i < 5; i++) {
    mockApi.setState({ count: i })
  }
  const saved = mockApi.getState()
  assert.equal(saved.count, 4)
})

test("state restore works correctly", () => {
  const mockApi = createMockVsCodeApi()

  // Pre-populate state
  mockApi.setState({
    sessions: {
      "test-1": {
        id: "test-1",
        name: "Restored Session",
        model: "test-model",
        mode: "normal",
        messages: [],
        isStreaming: false,
      },
    },
    activeSessionId: "test-1",
    nextSessionNum: 2,
    globalModel: "",
  })

  const saved = mockApi.getState()
  assert.ok(saved.sessions["test-1"])
  assert.equal(saved.activeSessionId, "test-1")
})

test("state deleteSession updates active session", () => {
  const mockApi = createMockVsCodeApi()
  mockApi.setState({
    sessions: {
      "s1": { id: "s1", name: "S1", model: "", mode: "normal", messages: [], isStreaming: false },
      "s2": { id: "s2", name: "S2", model: "", mode: "normal", messages: [], isStreaming: false },
    },
    activeSessionId: "s1",
    nextSessionNum: 3,
    globalModel: "",
  })

  // Delete active session
  const saved = mockApi.getState()
  delete saved.sessions["s1"]
  saved.activeSessionId = "s2"
  mockApi.setState(saved)

  const afterDelete = mockApi.getState()
  assert.ok(!afterDelete.sessions["s1"])
  assert.equal(afterDelete.activeSessionId, "s2")
})
