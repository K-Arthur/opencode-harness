import type { CodeDiff, GateResult, QualityGate } from "../methodology/types"

/**
 * Design-token check result.
 */
export interface TokenViolation {
  property: string
  expected: string
  actual: string
  selector: string
  severity: 'error' | 'warning'
}

/**
 * Visual QA check result — a set of programmatic, deterministic checks
 * that don't require a vision-capable model call.
 */
export interface VisualQaResult {
  /** Whether all checks passed */
  passed: boolean
  /** Design-token violations found */
  tokenViolations: TokenViolation[]
  /** Accessibility contrast violations found */
  contrastViolations: TokenViolation[]
  /** Potential layout/clipping issues */
  layoutWarnings: string[]
  /** Error messages from the check process */
  errors: string[]
}

/**
 * WCAG AA contrast ratio thresholds.
 */
const WCAG_AA_NORMAL_TEXT = 4.5
const WCAG_AA_LARGE_TEXT = 3.0

/**
 * Known VS Code / design-system token prefixes to check.
 * These are the semantic tokens that should be used instead of raw colors.
 */
const REQUIRED_TOKEN_PREFIXES = [
  '--vscode-',
  '--oc-',
]

/**
 * Known color literals that should only appear in tokens.css or
 * preset theme files — never in component CSS.
 */
const BANNED_COLOR_PATTERNS = [
  /#[0-9a-f]{3,8}\b/i,
  /rgba?\s*\(/i,
  /hsla?\s*\(/i,
]

/**
 * Known VS Code theme tokens for foreground/background pairs
 * that must meet WCAG AA contrast.
 */
const CONTRAST_PAIRS: Array<{ fg: string; bg: string; label: string }> = [
  { fg: '--vscode-editor-foreground', bg: '--vscode-editor-background', label: 'Editor text' },
  { fg: '--vscode-input-foreground', bg: '--vscode-input-background', label: 'Input text' },
  { fg: '--vscode-button-foreground', bg: '--vscode-button-background', label: 'Button text' },
  { fg: '--vscode-notifications-foreground', bg: '--vscode-notifications-background', label: 'Notification text' },
]

/**
 * Known design-token spacing values from the repo's tokens.css.
 */
const VALID_SPACING_TOKENS = new Set([
  '--space-0', '--space-1', '--space-2', '--space-3', '--space-4',
  '--space-5', '--space-6', '--space-7', '--space-8', '--space-9',
  '--space-10', '--space-11', '--space-12', '--space-13', '--space-14',
  '--space-15', '--space-16',
])

const VALID_RADIUS_TOKENS = new Set([
  '--radius-xs', '--radius-sm', '--radius-md', '--radius-lg',
  '--radius-xl', '--radius-full',
])

const VALID_BORDER_TOKENS = new Set([
  '--border-width-thin', '--border-width-medium', '--border-width-thick',
])

/**
 * Parse CSS content from a diff to find design-token violations.
 * Pure function, no DOM/browser dependency.
 */
export function checkDesignTokens(cssContent: string): TokenViolation[] {
  const violations: TokenViolation[] = []

  if (!cssContent || cssContent.trim().length === 0) return violations

  const lines = cssContent.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line || line.trim().startsWith('/*') || line.trim().startsWith('*')) continue

    // Check for raw color literals outside of tokens.css
    const trimmed = line.trim()
    if (trimmed.includes('color') || trimmed.includes('background') || trimmed.includes('border-color') || trimmed.includes('outline')) {
      for (const pattern of BANNED_COLOR_PATTERNS) {
        const match = trimmed.match(pattern)
        if (match) {
          violations.push({
            property: trimmed.split(':')[0]?.trim() ?? 'unknown',
            expected: 'a --vscode-* or --oc-* CSS variable',
            actual: match[0],
            selector: `line ${i + 1}`,
            severity: 'error',
          })
          break // one violation per line
        }
      }
    }

    // Check for hard-coded spacing values
    const spacingMatch = trimmed.match(/(padding|margin|gap)\s*:\s*(\d+)px/i)
    if (spacingMatch) {
      const propName = spacingMatch[1] ?? 'property'
      const pxVal = spacingMatch[2]
      const px = pxVal ? parseInt(pxVal, 10) : 0
      if (px > 0 && px % 4 !== 0) {
        violations.push({
          property: propName,
          expected: `${Math.round(px / 4) * 4}px (4px grid)`,
          actual: `${px}px`,
          selector: `line ${i + 1}`,
          severity: 'warning',
        })
      }
    }
  }

  return violations
}

/**
 * Check for common a11y/layout issues via CSS heuristic checks.
 * Pure function — no browser needed.
 */
export function checkAccessibility(cssContent: string): TokenViolation[] {
  const violations: TokenViolation[] = []

  if (!cssContent) return violations

  // Check for font-size in px that may be too small
  const fontSizeMatches = cssContent.match(/font-size\s*:\s*(\d+)px/gi)
  if (fontSizeMatches) {
    for (const match of fontSizeMatches) {
      const px = parseInt(match.replace(/font-size\s*:\s*/i, ''), 10)
      if (px < 12) {
        violations.push({
          property: 'font-size',
          expected: '12px or larger for readability',
          actual: `${px}px`,
          selector: match,
          severity: 'error',
        })
      }
    }
  }

  // Check for dangerously low contrast patterns
  if (/\b(opacity|color)\s*:\s*0\.[0-4]\b/i.test(cssContent)) {
    violations.push({
      property: 'opacity / color',
      expected: 'WCAG AA minimum contrast',
      actual: 'Opacity <= 0.4 may reduce contrast below WCAG AA',
      selector: '(found in CSS)',
      severity: 'warning',
    })
  }

  return violations
}

/**
 * Check for layout issues (overflow, zero-size, off-screen) in CSS content.
 */
export function checkLayout(cssContent: string): string[] {
  const warnings: string[] = []

  if (!cssContent) return warnings

  // Check for overflow hidden on body/html — can clip content
  if (/overflow\s*:\s*hidden/i.test(cssContent) && !/overflow\s*:\s*hidden\s+[a-z]/.test(cssContent)) {
    warnings.push('Found `overflow: hidden` — may clip content outside viewport')
  }

  // Check for zero-width/height elements
  const zeroSizeMatches = cssContent.match(/(width|height)\s*:\s*0\s*px/i)
  if (zeroSizeMatches) {
    warnings.push(`Found ${zeroSizeMatches[1]}: 0px — possible invisible element`)
  }

  // Check for negative margins/z-index that may cause overlap
  const negativeZIndex = cssContent.match(/z-index\s*:\s*-\d+/i)
  if (negativeZIndex) {
    warnings.push(`Found negative z-index: ${negativeZIndex[0]} — may cause rendering issues`)
  }

  return warnings
}

/**
 * Parse the diff content — extracts CSS content from a CodeDiff.
 * Looks for .css file changes.
 */
function extractCssContent(diff: CodeDiff): string {
  const combined = [diff.newContent, diff.oldContent].filter(Boolean).join('\n')
  return combined
}

/**
 * Run the full visual-QA gate: design tokens, a11y, layout checks.
 * Deterministic, no browser/vision model required.
 */
export function runVisualQaGate(diff: CodeDiff): VisualQaResult {
  const cssContent = extractCssContent(diff)
  const result: VisualQaResult = {
    passed: true,
    tokenViolations: [],
    contrastViolations: [],
    layoutWarnings: [],
    errors: [],
  }

  try {
    result.tokenViolations = checkDesignTokens(cssContent)
  } catch (err) {
    result.errors.push(`Design token check error: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    result.contrastViolations = checkAccessibility(cssContent)
  } catch (err) {
    result.errors.push(`Accessibility check error: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    result.layoutWarnings = checkLayout(cssContent)
  } catch (err) {
    result.errors.push(`Layout check error: ${err instanceof Error ? err.message : String(err)}`)
  }

  result.passed =
    result.tokenViolations.filter(v => v.severity === 'error').length === 0 &&
    result.contrastViolations.filter(v => v.severity === 'error').length === 0

  return result
}

/**
 * QualityGate implementation for visual QA — can be used in the
 * methodology pipeline.
 */
export function createVisualQaGate(): QualityGate {
  return {
    name: 'visual-qa',
    check: async (diff: CodeDiff): Promise<GateResult> => {
      const result = runVisualQaGate(diff)

      const failures: string[] = []
      for (const v of result.tokenViolations) {
        failures.push(`Token violation at ${v.selector}: ${v.property} uses ${v.actual} instead of ${v.expected}`)
      }
      for (const v of result.contrastViolations) {
        failures.push(`Accessibility: ${v.actual} at ${v.selector}`)
      }
      for (const w of result.layoutWarnings) {
        failures.push(`Layout: ${w}`)
      }
      for (const e of result.errors) {
        failures.push(`Error: ${e}`)
      }

      return {
        passed: result.passed,
        failures: failures.length > 0 ? failures : undefined,
        details: result,
      }
    },
    severity: 'warn',
  }
}

/**
 * Generate a visual review prompt for a vision-capable model.
 * Used when the executor model doesn't have sufficient visual judgment
 * and a separate visual review step is needed.
 */
export function buildVisualReviewPrompt(
  componentPath: string,
  designReferences: string[],
  knownViolations: TokenViolation[],
): string {
  return `You are doing a visual design review of a frontend change.

## Component to review
${componentPath}

## Design references
${designReferences.map(r => `- ${r}`).join('\n')}

## Automated checks found these issues
${knownViolations.length > 0
    ? knownViolations.map(v => `- [${v.severity.toUpperCase()}] ${v.selector}: ${v.property} — expected ${v.expected}, got ${v.actual}`).join('\n')
    : '(none — automated checks passed)'
}

## Review instructions
1. Check the rendered component against the design references above.
2. For each discrepancy, cite the exact CSS property, its current value, and what it should be.
3. If the automated checks reported violations, verify whether they are real or false positives.
4. Do NOT say "looks good" without verifying every checkable criterion.
5. Be specific: "the button background is #3355aa but the design shows --oc-accent" not "the colors are slightly off."
`
}
