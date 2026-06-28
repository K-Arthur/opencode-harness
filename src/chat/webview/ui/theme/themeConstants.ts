/**
 * Shared constants for the theme customizer modules.
 *
 * The CSS variable map is the single source of truth for mapping override keys
 * to their CSS variable names. Both `colorSections.ts` (for picker resolution)
 * and `previewStrip.ts` (for live preview) import from here to avoid
 * duplicating the mapping.
 */

/**
 * Maps override keys to their CSS variable names.
 * Used by colorSections (for picker fallback resolution) and previewStrip
 * (for applying overrides to the preview element).
 */
export const PREVIEW_CSS_VAR_MAP: ReadonlyArray<readonly [string, string]> = [
  ["accentColor", "--oc-accent"],
  ["panelBg", "--oc-bg"],
  ["panelFg", "--oc-fg"],
  ["editorBg", "--oc-editor-bg"],
  ["editorFg", "--oc-editor-fg"],
  ["elementBg", "--oc-element-bg"],
  ["borderColor", "--oc-border"],
  ["mutedFg", "--oc-muted"],
  ["errorColor", "--oc-error"],
  ["successColor", "--oc-success"],
  ["warningColor", "--oc-warning"],
  ["infoColor", "--oc-info"],
  ["userMessageBg", "--oc-user-msg-bg"],
  ["userMessageFg", "--oc-user-msg-fg"],
  ["assistantMessageBg", "--oc-assistant-msg-bg"],
  ["assistantMessageFg", "--oc-assistant-msg-fg"],
  ["inputBg", "--oc-input-bg"],
  ["inputBorder", "--oc-input-border"],
  ["mentionBg", "--oc-mention-bg"],
  ["toolReadColor", "--tool-read-color"],
  ["toolWriteColor", "--tool-write-color"],
  ["toolExecColor", "--tool-exec-color"],
  ["toolCallColor", "--oc-tool-call-color"],
  ["thinkingBg", "--oc-thinking-bg"],
  ["thinkingBorder", "--oc-thinking-border"],
  ["skillBadgeBg", "--oc-skill-badge-bg"],
  ["skillBadgeFg", "--oc-skill-badge-fg"],
  ["syntaxComment", "--oc-syn-comment"],
  ["syntaxKeyword", "--oc-syn-keyword"],
  ["syntaxString", "--oc-syn-string"],
  ["syntaxNumber", "--oc-syn-number"],
  ["syntaxFunction", "--oc-syn-function"],
  ["syntaxType", "--oc-syn-type"],
  ["syntaxVariable", "--oc-syn-variable"],
  ["syntaxOperator", "--oc-syn-operator"],
  ["syntaxPunctuation", "--oc-syn-punctuation"],
  ["diffAdded", "--oc-diff-added"],
  ["diffRemoved", "--oc-diff-removed"],
  ["diffContext", "--oc-diff-context"],
  ["diffHunkHeader", "--oc-diff-hunk-header"],
  ["diffAddedBg", "--oc-diff-added-bg"],
  ["diffRemovedBg", "--oc-diff-removed-bg"],
  ["markdownHeading", "--oc-markdown-heading"],
  ["markdownLink", "--oc-markdown-link"],
  ["markdownCode", "--oc-markdown-code"],
  ["markdownBlockQuote", "--oc-markdown-blockquote"],
  ["markdownStrong", "--oc-markdown-strong"],
] as const

/**
 * Look up the CSS variable name for a given override key.
 * @param key - The override key (e.g. `accentColor`).
 * @returns The CSS variable name (e.g. `--oc-accent`), or `undefined`.
 */
export function getCssVarForKey(key: string): string | undefined {
  return PREVIEW_CSS_VAR_MAP.find(([k]) => k === key)?.[1]
}
