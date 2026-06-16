/**
 * Declarative screenshot catalog.
 *
 * Each entry defines what fixture to load, what viewport to use,
 * what to wait for before capturing, and where to write the PNG.
 *
 * This is the single source of truth for the screenshot pipeline.
 * `generate.spec.ts` reads this to produce PNGs.
 * `verify.spec.ts` reads this to assert baseline fidelity.
 * `syncReadme.ts` reads this to regenerate the README image block.
 */
import type { FrameOptions } from "./frame"

export interface ScreenshotEntry {
  /** Filename (without extension) — also the fixture key */
  name: string
  /** Human-readable caption for README / marketplace */
  caption: string
  /** Fixture JSON filename (under tests/visual/screenshots/fixtures/sessions/) */
  fixture: string
  /** Additional host messages to dispatch AFTER init_state */
  extraMessages?: Array<Record<string, unknown>>
  /** Playwright viewport override (defaults to 420×800 — panel-only) */
  viewport?: { width: number; height: number }
  /** Options passed to injectFrame() */
  frameOptions?: FrameOptions
  /** CSS selectors that must be visible before capture */
  waitSelectors: string[]
}

/** Default viewport: narrow panel width, tall enough for full conversation view. */
export const SHOT_VIEWPORT_DEFAULT = { width: 420, height: 800 }

export const catalog: ScreenshotEntry[] = [
  {
    name: "overview",
    caption: "Chat interface with model selection, session controls, and project context",
    fixture: "overview.json",
    waitSelectors: [
      ".message.assistant",
      ".msg-text.markdown-content",
      "#model-label",
    ],
  },
  {
    name: "coding-workflow",
    caption: "AI-assisted refactoring with tool calls, code diffs, and structured responses",
    fixture: "coding-workflow.json",
    waitSelectors: [
      ".message.assistant",
      "details.tool-call",
      ".diff-block",
      ".msg-text.markdown-content",
    ],
  },
  {
    name: "context-management",
    caption: "Context-aware coding with file references, @-mentions, and usage tracking",
    fixture: "context-management.json",
    waitSelectors: [
      ".message.user",
      ".message.assistant",
      "details.tool-call",
    ],
  },
  {
    name: "tool-execution",
    caption: "Transparent tool execution with search, read, edit, and run operations",
    fixture: "tool-execution.json",
    waitSelectors: [
      ".message.assistant",
      "details.tool-call",
    ],
  },
  {
    name: "sessions",
    caption: "Multi-session management with tab switching and conversation history",
    fixture: "sessions.json",
    waitSelectors: [
      ".message.assistant",
      "[role='tab']",
    ],
  },
  {
    name: "review-changes",
    caption: "Code change review with diff preview, accept/discard controls, and per-file navigation",
    fixture: "review-changes.json",
    waitSelectors: [
      ".diff-block",
      ".diff-block--pending",
      ".message.assistant",
    ],
  },
  {
    name: "model-controls",
    caption: "Model and provider selection with Claude, GPT, Gemini, and 75+ models",
    fixture: "model-controls.json",
    extraMessages: [
      {
        type: "model_list",
        items: [
          { providerID: "anthropic", providerName: "Anthropic", models: [
            { id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet" },
            { id: "anthropic/claude-opus-4-7", name: "Claude Opus" },
            { id: "anthropic/claude-haiku-4-5", name: "Claude Haiku" },
          ]},
          { providerID: "openai", providerName: "OpenAI", models: [
            { id: "openai/gpt-4o", name: "GPT-4o" },
            { id: "openai/o3", name: "o3" },
          ]},
          { providerID: "google", providerName: "Google", models: [
            { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
            { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
          ]},
        ],
      },
    ],
    waitSelectors: [
      "#model-label",
      ".message.assistant",
    ],
  },
  {
    name: "build-mode",
    caption: "Auto mode with multi-step tool chains, autonomous coding, and test verification",
    fixture: "build-mode.json",
    waitSelectors: [
      ".message.assistant",
      "details.tool-call",
    ],
  },
]
