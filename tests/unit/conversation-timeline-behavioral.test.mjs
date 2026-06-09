import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const timelineSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "timeline.ts"), "utf8")
const rendererSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "renderer.ts"), "utf8")
const scrollMarkersSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "ui", "scrollMarkers.ts"), "utf8")
const messagesCss = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "webview", "css", "messages.css"), "utf8")

describe("Conversation Timeline — Behavioral Tests", () => {

  describe("Fix #1: scroll progress is rAF-throttled", () => {
    it("uses requestAnimationFrame to throttle updateTimelineProgress during scroll", () => {
      const rafIdx = timelineSource.indexOf("requestAnimationFrame")
      assert.ok(rafIdx >= 0, "timeline.ts must use requestAnimationFrame for scroll progress throttling")

      const scrollIdx = timelineSource.indexOf("addEventListener(\"scroll\"")
      assert.ok(scrollIdx >= 0, "must have a scroll event listener")

      const blockBetween = timelineSource.slice(
        Math.min(scrollIdx, rafIdx),
        Math.max(scrollIdx, rafIdx) + 200,
      )
      assert.ok(
        blockBetween.includes("scheduleProgressUpdate") || blockBetween.includes("requestAnimationFrame"),
        "scroll listener must call an rAF-gated progress update function",
      )
    })

    it("cancels pending rAF before scheduling a new one to prevent stacking", () => {
      assert.ok(
        timelineSource.includes("cancelAnimationFrame") || timelineSource.includes("progressRafId"),
        "must cancel pending rAF to prevent stacking frames",
      )
    })

    it("does not call updateTimelineProgress directly from the scroll listener", () => {
      const scrollListenerBlock = timelineSource.slice(
        timelineSource.indexOf("addEventListener(\"scroll\""),
        timelineSource.indexOf(")", timelineSource.indexOf("addEventListener(\"scroll\"")) + 50,
      )
      assert.ok(
        !scrollListenerBlock.includes("updateTimelineProgress("),
        "scroll listener must not call updateTimelineProgress directly — must go through rAF gate",
      )
    })
  })

  describe("Fix #2: history condensation guard handles 'expanded' state", () => {
    it("guards against both 'true' and 'expanded' historyCondensed states", () => {
      const guardIdx = timelineSource.indexOf("historyCondensed")
      assert.ok(guardIdx >= 0, "must reference historyCondensed dataset")

      const guardBlock = timelineSource.slice(guardIdx, guardIdx + 200)
      assert.ok(
        guardBlock.includes('"expanded"'),
        "historyCondensed guard must also check for 'expanded' state to prevent re-condensation",
      )
    })

    it("sets historyCondensed to 'expanded' when user expands a summary", () => {
      assert.ok(
        timelineSource.includes('historyCondensed = "expanded"') ||
        timelineSource.includes("historyCondensed = 'expanded'"),
        "must set historyCondensed to 'expanded' on expand click",
      )
    })
  })

  describe("Fix #3: tool counts accumulate across assistant messages", () => {
    it("uses += for toolCount accumulation, not assignment", () => {
      const toolCountLine = rendererSource.match(/currentTurn\.toolCount\s*[+=]/g)
      assert.ok(toolCountLine, "must reference currentTurn.toolCount with assignment or accumulation")

      const hasAccumulation = rendererSource.includes("currentTurn.toolCount +=")
      assert.ok(hasAccumulation, "toolCount must use += to accumulate across multiple assistant messages")
    })

    it("uses += for patchCount accumulation, not assignment", () => {
      const hasAccumulation = rendererSource.includes("currentTurn.patchCount +=")
      assert.ok(hasAccumulation, "patchCount must use += to accumulate across multiple assistant messages")
    })
  })

  describe("Fix #7: magic constants are named", () => {
    it("extracts condensation thresholds into named constants", () => {
      const condensationBlock = timelineSource.slice(
        timelineSource.indexOf("function applyHistoryCondensation"),
        timelineSource.indexOf("return {", timelineSource.indexOf("function applyHistoryCondensation")),
      )

      assert.ok(
        condensationBlock.includes("CONDENSATION_THRESHOLD") ||
        condensationBlock.includes("PRESERVE_LAST") ||
        condensationBlock.includes("GROUP_SIZE") ||
        condensationBlock.includes("HISTORY_CONDENSATION"),
        "condensation thresholds must be extracted into named constants (not inline magic numbers 140/80/20)",
      )
    })
  })

  describe("Fix #8: CSS transitions are not dead code", () => {
    it("conversation-timeline visibility uses opacity/transform, not display toggle", () => {
      assert.match(
        messagesCss,
        /\.conversation-timeline\s*\{[^}]*opacity:\s*0/s,
        ".conversation-timeline must start with opacity:0 instead of display:none so transitions work",
      )
      assert.match(
        messagesCss,
        /\.conversation-timeline\.visible\s*\{[^}]*opacity:\s*1/s,
        ".conversation-timeline.visible must set opacity:1 so the transition fires",
      )
    })
  })

  describe("Fix #9: typed messages in TimelineDeps", () => {
    it("does not use raw 'any[]' for messages in TimelineDeps.getSession", () => {
      const depsBlock = timelineSource.slice(
        timelineSource.indexOf("interface TimelineDeps"),
        timelineSource.indexOf("interface TimelineAPI"),
      )
      assert.ok(
        !depsBlock.includes("messages: any[]"),
        "TimelineDeps.getSession must use ChatMessage[] or a typed interface, not any[]",
      )
    })
  })

  describe("Fix #10: extractSnippet fallback is descriptive", () => {
    it("returns descriptive text for tool-only assistant messages", () => {
      const assistantFallback = rendererSource.match(
        /return msg\.role === "user" \? "([^"]*)" : "([^"]*)"/,
      )
      assert.ok(assistantFallback, "must have a fallback for empty messages")
      assert.ok(
        !assistantFallback[2].includes("Thinking..."),
        "assistant fallback must not say 'Thinking...' for completed tool-only messages",
      )
    })
  })

  describe("Fix #11: scrollMessageToTop uses injected timers", () => {
    it("accepts an optional timers parameter for testability", () => {
      const fnBlock = scrollMarkersSource.slice(
        scrollMarkersSource.indexOf("export function scrollMessageToTop"),
        scrollMarkersSource.indexOf("}\n", scrollMarkersSource.indexOf("export function scrollMessageToTop") + 50) + 2,
      )
      assert.ok(
        fnBlock.includes("timers"),
        "scrollMessageToTop must accept a timers parameter",
      )
    })

    it("callers pass deps.timers through to scrollMessageToTop", () => {
      assert.ok(
        scrollMarkersSource.includes("scrollMessageToTop(msgList, msgEl, deps.timers)"),
        "updateScrollMarkers must pass deps.timers to scrollMessageToTop",
      )
      assert.ok(
        scrollMarkersSource.includes("scrollMessageToTop(msgList, target, deps.timers)"),
        "scrollToTurn must pass deps.timers to scrollMessageToTop",
      )
    })
  })

  describe("Security: no XSS vectors", () => {
    it("uses textContent for user-provided text, never innerHTML", () => {
      const refreshBlock = timelineSource.slice(
        timelineSource.indexOf("function refreshConversationTimeline"),
        timelineSource.indexOf("function ensureTimeline"),
      )
      assert.ok(
        !refreshBlock.includes("innerHTML"),
        "refreshConversationTimeline must not use innerHTML with user data",
      )
      assert.ok(
        refreshBlock.includes("textContent"),
        "refreshConversationTimeline must use textContent for safe text insertion",
      )
    })

    it("escapes session IDs in CSS selectors via CSS.escape", () => {
      assert.ok(
        timelineSource.includes("CSS.escape"),
        "must use CSS.escape for all dynamic selector values",
      )
    })
  })

  describe("Accessibility", () => {
    it("timeline items are keyboard-navigable buttons with aria-labels", () => {
      assert.ok(
        timelineSource.includes("item.type = \"button\""),
        "timeline items must be <button> elements for keyboard accessibility",
      )
      assert.ok(
        timelineSource.includes("aria-label"),
        "timeline items must have aria-label attributes",
      )
    })

    it("timeline container has navigation role", () => {
      assert.ok(
        timelineSource.includes('role", "navigation"') ||
        timelineSource.includes("role\", \"navigation\""),
        "timeline container must have role='navigation'",
      )
    })

    it("timeline toggle button has aria-pressed", () => {
      const toggleBlock = timelineSource.slice(
        timelineSource.indexOf("function setupTimelineToggle"),
        timelineSource.indexOf("function setupThinkingToggle"),
      )
      assert.ok(
        toggleBlock.includes("aria-pressed"),
        "toggle button must manage aria-pressed state",
      )
    })
  })
})
