// Flat ESLint config (ESLint v9). The repo ships eslint + typescript-eslint as
// devDependencies and CI runs `npx eslint src/`, but no config file existed —
// so the lint step failed on "couldn't find a config" every run.
//
// Adoption is INCREMENTAL (off → warn → error). Type-checking is owned by
// `tsc --noEmit` (npm run typecheck); this config adds correctness + hygiene
// rules tsc does not cover. Errors fail CI; warnings are a visible, tracked
// backlog to pay down and then promote to "error".
//
// Backlog snapshot (2026-06-02, see docs/performance-audit.md §I):
//   ~98  @typescript-eslint/no-unused-vars   (locals/params; 55 unused imports already targetable)
//   ~88  @typescript-eslint/no-explicit-any  (some justified per CLAUDE.md — needs review, not blind fix)
//    ~4  @typescript-eslint/no-require-imports (may be intentional cycle-breakers — review before converting)
import tsplugin from "@typescript-eslint/eslint-plugin"
import tsparser from "@typescript-eslint/parser"

export default [
  {
    files: ["src/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.d.ts"],
    // Disable directives for rules not yet in this subset (e.g. no-control-regex)
    // are expected during incremental adoption; don't report them as "unused".
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      parser: tsparser,
      parserOptions: { sourceType: "module", ecmaVersion: 2022 },
    },
    plugins: { "@typescript-eslint": tsplugin },
    rules: {
      // ── Enforced (error): correctness tsc does not cover ───────────────────
      "no-debugger": "error",
      "no-cond-assign": ["error", "except-parens"],
      // `while (true)` SSE read loops are intentional; only flag constant ifs.
      "no-constant-condition": ["error", { checkLoops: false }],
      // no-control-regex intentionally NOT enabled: Ollama/CLI line parsing uses
      // deliberate \x00-\x1f stripping regexes (8 legitimate sites).
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-dupe-else-if": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "no-unsafe-negation": "error",
      // Empty catch blocks are an established best-effort-cleanup idiom here.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-fallthrough": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-async-promise-executor": "error",
      // Paid down 2026-06-02 (3 `isOpen ? close() : open()` ternary-as-statement
      // sites rewritten to if/else); now enforced.
      "@typescript-eslint/no-unused-expressions": "error",

      // ── Incremental backlog (warn): visible in CI, promote to "error" once 0 ──
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "warn",
    },
  },
]
