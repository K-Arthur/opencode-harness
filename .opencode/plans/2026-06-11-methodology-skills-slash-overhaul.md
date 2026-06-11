# Methodology / Skills / Slash Commands — Gap Analysis & Right-Sized Overhaul Plan

Date: 2026-06-11
Inputs: task spec (methodology+skills+slash overhaul), Qwen 3.7-max audit, code
verification pass (this document), `docs/research/coding-agent-tools-research.md`,
`docs/research/ai-methodology-enhancement-research-report.md`,
`docs/research/ai-coding-ux-patterns-report.md`.

## 1. Verification of the prior audit

Every load-bearing claim in the Qwen audit was re-verified against the code:

| Claim | Verdict | Evidence |
|---|---|---|
| 16 local slash commands, exact list | ✅ confirmed | `src/chat/webview/slash-commands.ts:45-62` |
| `/export` vs `/export-md` duplicate | ✅ confirmed | registry lines 56-57; both post `export_chat` |
| `/diagnose:generation` invisible (host-only, not in registry) | ✅ confirmed | `ChatCommands.ts:97`, absent from registry |
| Help table hand-written, drifts from registry | ✅ confirmed | `ChatCommands.help()` hardcodes the table |
| Dedup logic duplicated in `mentions.ts` | ✅ confirmed | `mentions.ts:39-40` reimplements `dedupServerCommands()` |
| Methodology = TaskClassifier+Catalog → short addendum | ✅ confirmed | `MethodologyAdvisor.renderAddendum()`; injected in `StreamCoordinator.applyMethodologyAdvice()` |
| Cascade pipeline (CascadeRouter, PromptEngine, QualityGate, PlanValidator, SchemaValidator, RefactoringEngine, SpecService, QualityEvaluator, ModelProfileRegistry, ToolRegistry) never connected to real prompts | ✅ confirmed | only `MethodologyOrchestrator`/`OutcomeTracker` referenced outside `src/methodology/`; orchestrator used solely for status-bar advisory |
| `OutcomeTracker.record()` never called | ✅ confirmed | only `setPersistenceFn` + `getConfidenceAdjustment` referenced |
| SKILL.md content never injected by extension; hint = names only | ✅ confirmed | `SkillTriggerEngine → skillHinter → "Relevant skills: …"` line |

## 2. New findings the prior audit missed

1. **`methodology_selected` is documented but never sent.** The doc comment on
   `applyMethodologyAdvice()` (StreamCoordinator.ts:225-230) claims the webview
   is notified; no such postMessage exists anywhere. The renderer actively
   *hides* the addendum (`renderer.ts:559` drops text starting `[methodology]`).
   Net effect: methodology guidance is fully invisible in the chat UI.
2. **Status bar can disagree with the actual addendum.** The status bar is fed by
   a *second, independent* classification pass (`orchestrator.advise(text)`)
   instead of the advice actually injected. Two code paths → drift risk, and a
   wasted classification per send.
3. **The per-tab opt-out is unreachable.** `applyMethodologyAdvice` reads
   `tab.methodologyDisabled` through an unsafe cast; nothing in the codebase
   ever sets that field and no UI/command exposes it. The spec's "override or
   disable methodology" requirement is currently impossible.
4. **Slash-during-streaming becomes steer text.** `sendMessage()`
   (sendLogic.ts:244-251) routes any input to `sendSteerPrompt()` while a
   stream is active — *before* the slash check on line 293. Typing `/clear`
   mid-stream sends the literal string "/clear" to the model as steering.
5. **Dead settings are user-visible.** `package.json` exposes
   `opencode.methodology.{cascadeEnabled,maxEscalations,qualityThreshold,
   maxTokensPerRequest,maxCostPerRequest,validationEnabled,maxValidationRetries,
   defaultStrategy}` — all feed only the never-executing cascade pipeline.
   Users can toggle knobs that do nothing.
6. **Skill toggle is misleading.** Disabling a skill in the modal only removes
   it from the *hint line*; the opencode server still discovers/loads the skill
   (`WebviewEventRouter.toggle_skill` comment admits this). The UI presents it
   as a real disable.
7. **Addendum is appended, not prepended.** Doc comments say "prepend"; code
   pushes the addendum *before* the user text into `parts` (so it precedes the
   prompt) — fine — but instructions+addendum+text ordering is only implicit
   and untested.

## 3. Gaps in the prior plan vs the task spec

- **No frontend/backend boundary decision.** opencode server already owns
  commands (`listCommands`/`sendCommand`), agents, skills, modes. The plan must
  state: server owns *execution* of server/MCP/skill commands and skill
  loading; the extension owns local UX commands, discovery UI, and prompt
  composition. Don't build a parallel skill executor.
- **No safety pass.** Spec demands: confirmation for destructive ops (`/clear`
  destroys a conversation with zero confirmation), blocked commands during
  invalid stream states (see finding 4), injection-safety of args forwarded to
  `sendCommand`.
- **No registry→help→docs single source of truth** (drift Issues 1/2/10 are all
  the same root cause: metadata lives in 3 places).
- **Right-sizing.** The spec's full registry-of-everything (15 task types × 12
  metadata fields, skill versioning, conflict resolution engines) would repeat
  the cascade-pipeline mistake: building machinery no request ever flows
  through. Research (`coding-agent-tools-research.md` §4.2) explicitly warns
  against over-engineering. The catalog already covers task-type routing; the
  fix is *visibility, override, honesty, and drift-elimination* — not more
  abstraction.
- **No commit discipline.** Working tree is ephemeral (see CLAUDE.md); the plan
  must land as small, committed phases.

## 4. Answers to the spec's research questions (grounded in docs/research/)

1. *How to decide methodology per prompt?* Lightweight heuristic classification
   (existing TaskClassifier) is the industry norm at this layer; LLM-based
   routing belongs server-side. Keep it cheap, synchronous, override-able.
2. *Auto vs user choice?* Auto by default, visible label, one-keystroke
   override (`/methodology …`), per-tab off switch. (Claude Code/Cline pattern:
   modes visible, never silent.)
3. *Guidance without bloat?* Addendum stays ≤ ~200 chars (current design is
   correct); never duplicate per-skill instructions — the server loads SKILL.md.
4. *Interaction with plan/build/auto?* Methodology is advisory prompt-shaping;
   modes are permission envelopes. They compose; never let methodology change
   mode silently.
5-7. *Skills:* server-native skills + Agent Skills standard (SKILL.md) are the
   substrate; the extension's job is discovery (modal), suggestion (trigger
   hints), invocation (palette entries tagged `source: "skill"`), and honest
   enable/disable semantics.
8-10. *Slash commands:* single typed registry; parse client-side for local
   commands; forward unknowns to the server; block during streaming with a
   clear message; never lose the user's prompt text.
11. *Safety:* confirmation for destructive (clear), no shell/eval of args,
   args forwarded verbatim to the SDK only.
12. *Testability:* registry metadata is data → property-test it; dispatcher is
   a pure function over (text, state) → message; help/docs generated from the
   registry can't drift.

## 5. Implementation plan (phased, committed per phase)

### Phase 1 — Slash registry consolidation (this session)
- Extend `LocalSlashCommand`: `aliases?`, `usage?`, `category`.
- Fold `export-md` into `/export` alias; add `diagnose:generation` to the
  registry (category `debug`) so it's discoverable.
- Add `resolveLocalCommand(nameOrAlias)` + `buildHelpTable()` generators.
- `ChatCommands.help()` renders the generated table (drift impossible).
- `mentions.ts` uses shared `dedupServerCommands()`.
- Tests: registry shape, alias resolution, help-table completeness.

### Phase 2 — Streaming slash guard (this session)
- Pure helper `classifyComposerInput(text, isStreaming)` →
  `prompt | steer | slash | slash-blocked`.
- `sendMessage()` consults it: slash during stream ⇒ system message
  ("stop the stream first"), input preserved. Tests for all branches.

### Phase 3 — Methodology visibility + override (this session)
- `applyMethodologyAdvice` posts `methodology_selected`
  `{sessionId, label, methodology, strategy, confidence, auto: true}`.
- Webview shows a compact, non-intrusive indicator (composer status strip).
- Status bar updated from the *same advice* (kill the second classification).
- `/methodology` command: no args → show state; `on|off` → per-tab toggle
  (typed `methodologyDisabled` field on Tab, cast removed). Host handler in
  ChatCommands; registry entry with usage hint.
- Defer: forcing a *specific* methodology id (needs catalog API for forced
  selection; listed as next improvement).

### Phase 4 — Honesty cleanups (this session)
- Skills modal copy: disable = "hidden from suggestions" (server may still
  load it).
- Remove dead `opencode.methodology.*` cascade settings from `package.json`
  (keep `enabled`; `defaultStrategy` removed until something reads it).

### Phase 5 — Docs (this session)
- `docs/slash-commands.md` (generated-table source of truth + flows),
  methodology override + skills semantics; Status.md note.

### Phase 6 — Verify (this session)
- `npm run typecheck`, `npm test`, `npm run build`, `npm run reinstall`;
  manual checklist for: normal prompt, slash during idle/stream, /help table,
  /methodology on/off, status bar consistency.

### Deferred (next sessions, in priority order)
1. Delete the quarantined cascade pipeline (CascadeRouter, PromptEngine,
   QualityGate, PlanValidator, SchemaValidator, RefactoringEngine, SpecService,
   QualityEvaluator, ModelProfileRegistry, ToolRegistry) + their tests, or land
   an ADR to keep them behind an experiment flag. ~30 files; do as its own PR.
2. Wire `OutcomeTracker.record()` from stream completion/abort so confidence
   adjustment learns (advice signature is already on the run).
3. Forced methodology override (`/methodology spec-first`), persisted per tab.
4. Merge duplicate TaskClassifiers (`src/skills/` vs `src/methodology/`).
5. Confirmation affordance for `/clear` (and any future destructive command)
   driven by a `destructive: true` registry flag.
6. VS Code palette parity for the remaining commands (Issue 5) — generate
   `package.json` contributions from the registry at build time.
7. Align local skill scanning with Agent Skills standard frontmatter
   (`disable-model-invocation`, `user-invocable`).
