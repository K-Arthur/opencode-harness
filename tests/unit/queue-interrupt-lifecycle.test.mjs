import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.join(__dirname, "..", "..", "src")

function read(relPath) {
  return readFileSync(path.join(srcRoot, relPath), "utf8")
}

// ─── Source reads ────────────────────────────────────────────────────
const webviewEventRouterSource = read("chat/WebviewEventRouter.ts")
const streamOrchestratorSource = read("chat/webview/streamOrchestrator.ts")
const streamCoordinatorSource = read("chat/handlers/StreamCoordinator.ts")
const hostQueueSource = read("chat/HostPromptQueue.ts")
const queueRendererSource = read("chat/webview/queueRenderer.ts")
const queueSource = read("chat/webview/queue.ts")

// ═══════════════════════════════════════════════════════════════════════
// ISSUE 1: Queue Remnant / Ghosting — drainQueue must post state sync
// ═══════════════════════════════════════════════════════════════════════

describe("Issue 1: Queue Ghosting — drainQueue must emit queue_state after dequeue", () => {
  it("drainQueue calls postQueueState after dequeueing an item", () => {
    // The drainQueue method MUST call postQueueState() after dequeuing so
    // the webview's local render cache is immediately updated and the
    // "sending" chip does not linger as a ghost.
    const drainBody = extractMethodBody(webviewEventRouterSource, "drainQueue")
    assert.ok(drainBody, "drainQueue method must exist in WebviewEventRouter")

    // After dequeue, there must be a postQueueState call to sync the webview.
    const dequeueIdx = drainBody.indexOf("dequeue(")
    assert.ok(dequeueIdx >= 0, "drainQueue must call hostQueue.dequeue()")

    const postQueueStateAfterDequeue = drainBody.indexOf("postQueueState(", dequeueIdx)
    assert.ok(
      postQueueStateAfterDequeue > dequeueIdx,
      "drainQueue MUST call postQueueState() after dequeue to prevent ghost chips"
    )
  })

  it("drainQueuedPrompt calls postQueueState after confirmCompleted", () => {
    const body = extractMethodBody(webviewEventRouterSource, "drainQueuedPrompt")
    assert.ok(body, "drainQueuedPrompt method must exist")

    const confirmIdx = body.indexOf("confirmCompleted(")
    assert.ok(confirmIdx >= 0, "drainQueuedPrompt must call confirmCompleted")

    const postQueueStateAfter = body.indexOf("postQueueState(", confirmIdx)
    assert.ok(
      postQueueStateAfter > confirmIdx,
      "drainQueuedPrompt MUST call postQueueState() after confirmCompleted"
    )
  })

  it("drainQueuedPrompt calls postQueueState on failure path too", () => {
    const body = extractMethodBody(webviewEventRouterSource, "drainQueuedPrompt")
    assert.ok(body, "drainQueuedPrompt method must exist")

    const catchIdx = body.indexOf("catch (err)")
    assert.ok(catchIdx >= 0, "drainQueuedPrompt must have a catch block")

    const markFailedIdx = body.indexOf("markFailed(", catchIdx)
    assert.ok(markFailedIdx >= 0, "catch block must call markFailed on error")

    const postQueueStateInCatch = body.indexOf("postQueueState(", markFailedIdx)
    assert.ok(
      postQueueStateInCatch > markFailedIdx,
      "drainQueuedPrompt MUST call postQueueState() after markFailed to sync webview"
    )
  })

  it("queue_state handler syncs from host and renders or removes the container", () => {
    // The queue_state handler must call syncFromHost on the PromptQueue
    // and either render or remove the container based on queued count.
    assert.ok(
      streamOrchestratorSource.includes("syncFromHost") || streamOrchestratorSource.includes("queue_state"),
      "queue_state handler must exist"
    )
  })

  it("PromptQueue.syncFromHost replaces local items with host-provided data", () => {
    assert.ok(
      queueSource.includes("syncFromHost"),
      "PromptQueue must expose syncFromHost for host-authoritative state"
    )
    const syncBody = extractFunctionBody(queueSource, "syncFromHost")
    assert.ok(
      syncBody.includes("items.length = 0") || syncBody.includes("items.splice(0"),
      "syncFromHost must clear local items before applying host data"
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════
// ISSUE 2: Silent Interrupt Log — stream_end reason="aborted" must
//          emit a timeline system message
// ═══════════════════════════════════════════════════════════════════════

describe("Issue 2: Interrupt Log — showStreamEndReasonMessage must handle 'aborted'", () => {
  it("showStreamEndReasonMessage handles reason='aborted'", () => {
    const body = extractFunctionBody(streamOrchestratorSource, "showStreamEndReasonMessage")
    assert.ok(body, "showStreamEndReasonMessage must exist in streamOrchestrator.ts")

    // Must have a branch for "aborted" reason
    const hasAbortedBranch =
      body.includes('"aborted"') ||
      body.includes("'aborted'") ||
      body.includes("reason === \"aborted\"") ||
      body.includes("reason === 'aborted'") ||
      /reason\s*===?\s*["']aborted["']/.test(body)
    assert.ok(
      hasAbortedBranch,
      "showStreamEndReasonMessage MUST handle reason='aborted' to log interruptions in the timeline"
    )
  })

  it("aborted branch calls showSystemMessage with interruption text", () => {
    const body = extractFunctionBody(streamOrchestratorSource, "showStreamEndReasonMessage")
    assert.ok(body, "showStreamEndReasonMessage must exist")

    // Find the "aborted" branch and verify it calls showSystemMessage
    const abortedIdx = body.indexOf('"aborted"')
    if (abortedIdx >= 0) {
      // Look for showSystemMessage call within ~500 chars of the aborted branch
      const window = body.slice(abortedIdx, abortedIdx + 500)
      assert.ok(
        window.includes("showSystemMessage"),
        "The 'aborted' branch MUST call showSystemMessage to append a timeline marker"
      )
    }
  })

  it("StreamCoordinator.abort posts stream_end with reason='aborted'", () => {
    const abortBody = extractMethodBody(streamCoordinatorSource, "abort")
    assert.ok(abortBody, "abort method must exist in StreamCoordinator")

    // The abort method must post stream_end with reason "aborted"
    const hasStreamEnd = abortBody.includes("stream_end")
    const hasAborted = abortBody.includes('"aborted"') || abortBody.includes("'aborted'")
    assert.ok(hasStreamEnd, "abort() must post a stream_end message")
    assert.ok(hasAborted, "abort() must use reason='aborted' in stream_end")
  })

  it("abort does NOT record the interruption as a system message directly — it relies on stream_end", () => {
    // The abort path should NOT try to append a system message itself.
    // The timeline marker is the responsibility of showStreamEndReasonMessage.
    // abort() should only post stream_end.
    const abortBody = extractMethodBody(streamCoordinatorSource, "abort")
    assert.ok(abortBody, "abort method must exist")

    // abort should NOT call sessionStore.appendMessage with role="system"
    const hasSystemAppend =
      abortBody.includes("role:") && abortBody.includes("system") && abortBody.includes("appendMessage")
    assert.ok(
      !hasSystemAppend,
      "abort() must NOT directly append a system message — timeline marker is handled by stream_end → showStreamEndReasonMessage"
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════
// ISSUE 3: Concurrency — reorder must be resilient to drain races
// ═══════════════════════════════════════════════════════════════════════

describe("Issue 3: Concurrency — queue reorder resilience during drain", () => {
  it("HostPromptQueue.reorder validates indices against current array bounds", () => {
    const body = extractMethodBody(hostQueueSource, "reorder")
    assert.ok(body, "reorder method must exist in HostPromptQueue")

    // Must check bounds before splicing
    assert.ok(
      body.includes("fromIdx") && body.includes("toIdx"),
      "reorder must accept fromIdx and toIdx parameters"
    )
    assert.ok(
      body.includes("< 0") || body.includes(">= queue.length") || body.includes("range"),
      "reorder MUST validate index bounds to prevent corruption during concurrent drain"
    )
  })

  it("HostPromptQueue.reorder validates indices before splice", () => {
    const body = extractMethodBody(hostQueueSource, "reorder")
    assert.ok(body, "reorder must exist")

    // Reorder must validate fromIdx and toIdx are within bounds
    const hasBoundsCheck =
      (body.includes("< 0") || body.includes(">= queue.length") || body.includes(">= queue.length"))
    assert.ok(
      hasBoundsCheck,
      "reorder MUST validate index bounds to prevent corruption during concurrent drain"
    )
  })

  it("queueRenderer posts reorder_queue to host and re-renders from host state", () => {
    // After reorder, the renderer must post to host and then re-render.
    // The host responds with queue_state which syncs the webview.
    assert.ok(
      queueRendererSource.includes("reorder_queue"),
      "queueRenderer must send reorder_queue message to host"
    )
    assert.ok(
      queueRendererSource.includes("renderQueue"),
      "queueRenderer must call renderQueue after reorder"
    )
  })

  it("HostPromptQueue.markStuckSendingAsQueued recovers interrupted drain items", () => {
    const body = extractMethodBody(hostQueueSource, "markStuckSendingAsQueued")
    assert.ok(body, "markStuckSendingAsQueued must exist")

    assert.ok(
      body.includes('"sending"') || body.includes("'sending'"),
      "markStuckSendingAsQueued must find items in 'sending' state"
    )
    assert.ok(
      body.includes('"queued"') || body.includes("'queued'"),
      "markStuckSendingAsQueued must reset them to 'queued'"
    )
  })

  it("drainQueue calls markStuckSendingAsQueued before dequeue", () => {
    const drainBody = extractMethodBody(webviewEventRouterSource, "drainQueue")
    assert.ok(drainBody, "drainQueue must exist")

    const markIdx = drainBody.indexOf("markStuckSendingAsQueued")
    const dequeueIdx = drainBody.indexOf("dequeue(")
    assert.ok(markIdx >= 0, "drainQueue must call markStuckSendingAsQueued")
    assert.ok(
      markIdx < dequeueIdx,
      "markStuckSendingAsQueued MUST run BEFORE dequeue to recover stale items first"
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════════════════════

describe("Edge cases: Queue drain and interrupt lifecycle", () => {
  it("drainQueue skips drain when aborted and drainAfterAbort is false", () => {
    const drainBody = extractMethodBody(webviewEventRouterSource, "drainQueue")
    assert.ok(drainBody, "drainQueue must exist")

    // Must check reason === "aborted" and drainAfterAbort flag
    const hasAbortedCheck = drainBody.includes("aborted")
    const hasDrainAfterAbort = drainBody.includes("drainAfterAbort")
    assert.ok(
      hasAbortedCheck && hasDrainAfterAbort,
      "drainQueue must check reason='aborted' and drainAfterAbort flag"
    )
  })

  it("drainQueue still posts queue_state even when skipping drain after abort", () => {
    const drainBody = extractMethodBody(webviewEventRouterSource, "drainQueue")
    assert.ok(drainBody, "drainQueue must exist")

    // When aborted + !drainAfterAbort, must still post queue_state so UI reflects
    // remaining queued items.
    const abortCheckIdx = drainBody.indexOf("aborted")
    if (abortCheckIdx >= 0) {
      const window = drainBody.slice(abortCheckIdx, abortCheckIdx + 300)
      assert.ok(
        window.includes("postQueueState"),
        "drainQueue must call postQueueState even when skipping drain after abort"
      )
    }
  })

  it("StreamCoordinator.finalizeStream drains queue after stream completion", () => {
    const body = extractMethodBody(streamCoordinatorSource, "finalizeStream")
    assert.ok(body, "finalizeStream must exist")

    // finalizeStream must trigger queue drain via onQueueDrain callback
    assert.ok(
      body.includes("onQueueDrain"),
      "finalizeStream MUST call onQueueDrain to drain the host queue after completion"
    )
  })

  it("StreamCoordinator.abort drains queue after abort with reason='aborted'", () => {
    const body = extractMethodBody(streamCoordinatorSource, "abort")
    assert.ok(body, "abort must exist")

    // abort must trigger queue drain via onQueueDrain callback
    assert.ok(
      body.includes("onQueueDrain"),
      "abort MUST call onQueueDrain to drain (or skip) the host queue after abort"
    )
  })

  it("HostPromptQueue.confirmCompleted removes the item from the array", () => {
    const body = extractMethodBody(hostQueueSource, "confirmCompleted")
    assert.ok(body, "confirmCompleted must exist")

    assert.ok(
      body.includes("splice"),
      "confirmCompleted MUST remove the item from the array via splice"
    )
  })

  it("queueRenderer removes the DOM container when queue is empty", () => {
    const body = extractMethodBody(queueRendererSource, "renderQueue")
    assert.ok(body, "renderQueue must exist")

    // When queue is empty, the container must be removed from DOM
    assert.ok(
      body.includes("container.remove()") || body.includes(".remove()"),
      "renderQueue must remove the container DOM element when queue is empty"
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function extractMethodBody(source, methodName) {
  // Find the method/function definition (not a call site) and extract the body.
  // We need to find the opening brace of the method BODY, not any braces in
  // parameter type definitions (e.g. "item: { id: string }").
  const patterns = [
    new RegExp(`(?:private|public|protected)\\s+(?:async\\s+)?${methodName}\\s*\\(`, "g"),
    new RegExp(`function\\s+${methodName}\\s*\\(`, "g"),
    new RegExp(`(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*:\\s*\\S+[\\s\\S]*?\\{`, "g"),
  ]

  let bestIdx = -1
  let bestBraceIdx = -1
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(source)) !== null) {
      // For the third pattern (with return type), the \{ at the end is the body brace
      if (pattern === patterns[2]) {
        bestIdx = match.index
        bestBraceIdx = match.index + match[0].length - 1
        break
      }
      // For the first two patterns, we need to find the body brace by skipping
      // nested type braces in parameters. Walk forward counting braces.
      const startSearch = match.index + match[0].length
      let depth = 0
      let found = false
      for (let i = match.index; i < startSearch + 500; i++) {
        if (source[i] === "{") {
          if (depth === 0) {
            // This might be a type parameter brace, not the body brace
            // Check if we're still inside parameters by looking for closing paren
            const before = source.slice(match.index, i)
            const openParens = (before.match(/\(/g) || []).length
            const closeParens = (before.match(/\)/g) || []).length
            if (closeParens >= openParens) {
              // We've passed the parameter list - this is the body brace
              bestIdx = match.index
              bestBraceIdx = i
              found = true
              break
            }
          }
          depth++
        }
        if (source[i] === "}") depth--
      }
      if (found) break
    }
    if (bestIdx >= 0) break
  }

  if (bestIdx >= 0 && bestBraceIdx >= 0) {
    let depth = 0
    let started = false
    for (let i = bestBraceIdx; i < source.length; i++) {
      if (source[i] === "{") { depth++; started = true }
      if (source[i] === "}") { depth--; if (started && depth === 0) return source.slice(bestBraceIdx, i + 1) }
    }
    return source.slice(bestBraceIdx, bestBraceIdx + 5000)
  }

  return null
}

function extractFunctionBody(source, funcName) {
  return extractMethodBody(source, funcName)
}
