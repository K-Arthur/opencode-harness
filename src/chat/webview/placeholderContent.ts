/**
 * Decide whether a streaming placeholder bubble carries any rendered content.
 *
 * Why this exists (M7): at stream_end the orchestrator removes the live
 * placeholder before appending the server's authoritative message, but only if
 * the placeholder is "empty". The original heuristic looked solely at text
 * length and would delete a bubble that already showed tool calls, a diff, a
 * skill badge, or a question — losing visible state for a text-less turn.
 *
 * Content = non-trivial text OR any non-text block element.
 */
const NON_TEXT_BLOCK_SELECTOR =
  "details.tool-call, details.tool-group, .diff-block, .skill-badge, .question-block"

export function placeholderHasRenderedContent(placeholder: Element): boolean {
  const textEl = placeholder.querySelector(".streaming-text, .msg-text")
  const textLen = textEl?.textContent?.trim().length ?? 0
  if (textLen > 2) return true
  return placeholder.querySelector(NON_TEXT_BLOCK_SELECTOR) !== null
}
