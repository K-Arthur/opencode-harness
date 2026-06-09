# Skills ↔ Methodology Runtime Integration

**Status:** Accepted (landed 2026-05-17)
**Date:** 2026-05-17

## Context

The extension shipped three pieces of skills/methodology infrastructure that
were not actually connected to the chat send-path:

1. **Skills modal** (header button → `#skills-modal`) listed agents and local
   `~/.agents/skills` entries with enable/disable toggles, but the modal
   never opened: `setupButtonsModule` was called with
   `skillsModalOpen: skillsModalApi?.open` while `skillsModalApi` was still
   `null`, so the click handler at
   [src/chat/webview/ui/buttonSetup.ts:100](../../src/chat/webview/ui/buttonSetup.ts#L100)
   resolved to `undefined`. Toggles emitted `toggle_skill` to the host,
   which had a stub handler (`Agent enable/disable is not supported by the
   opencode server API.`). No state was persisted; `resolveAllSkills`
   hardcoded `enabled: true`.

2. **`SkillTriggerEngine`** (`src/skills/SkillTriggerEngine.ts`) compiled
   ~20 regex rules (TDD, SADD, frontend/backend/db, code review, …) but
   had zero callers outside its own tests. The rules never influenced
   what was sent to the model.

3. **`MethodologyAdvisor`** (`src/methodology/MethodologyAdvisor.ts`) was
   already wired through `StreamCoordinator.applyMethodologyAdvice`,
   prepending a `[methodology]` addendum to outgoing prompts. It worked
   in isolation — classification + strategy hint — but did not consult
   the skill triggers, so the addendum couldn't mention domain skills.

## Decision

Treat the methodology advisor as the **integration point** for skill
trigger output. Three changes:

### 1. Modal wiring — pass a thunk

```ts
// Before (in main.ts init()):
skillsModalOpen: skillsModalApi?.open  // skillsModalApi is null here
// After:
skillsModalOpen: () => skillsModalApi?.open?.()  // resolved at click time
```

### 2. Persist enable/disable in `SkillPreferencesStore`

A small `vscode.Memento`-backed store (`src/skills/SkillPreferencesStore.ts`)
holds the set of *disabled* skill IDs (key `opencode-skill-disabled`).
The router's `toggle_skill` handler writes through it and re-emits
`skills_list`. `resolveAllSkills` reads it to populate the `enabled` flag.

We store disabled-set (not enabled-set) so newly discovered skills
default to enabled without a migration.

### 3. Plug `SkillTriggerEngine` into `MethodologyAdvisor`

`MethodologyAdvisor` now accepts a constructor option:

```ts
type SkillHinter = (text: string) => string[]
new MethodologyAdvisor({ skillHinter })
```

When present, the advisor calls the hinter, dedups, caps at 4 entries,
and appends `\nRelevant skills: A, B, C.` to its prompt addendum.
`ChatProvider` builds the hinter as
`text => skillTriggerEngine.getTriggeredSkills(text).filter(id => skillPreferences.isEnabled(id))`,
giving us a single chain:

```
user prompt
  → SkillTriggerEngine.getTriggeredSkills
  → SkillPreferencesStore.isEnabled filter
  → MethodologyAdvisor addendum (already injected by StreamCoordinator)
  → opencode server as a text Part
```

## Why this shape

- **Single addendum.** Every classified prompt already gets one
  `[methodology]` text Part. Adding a second Part for skills would
  double the "system noise" budget and make tab-level opt-out
  (`methodologyDisabled`) split-brain — disabling methodology would
  paradoxically leave skill hints flowing.
- **Best-effort.** The hinter is wrapped in try/catch; engine failure
  or bad config never blocks the user's send. Same posture as the
  existing methodology advice.
- **Pure / testable.** `MethodologyAdvisor` stays synchronous and
  pure. The hinter is the only injection point; tests can pass a
  stub returning a known list.
- **Reuses the SDK contract.** Opencode treats Parts as opaque text.
  We never extend a server schema; the integration is entirely
  client-side, so it survives any server upgrade.

## Consequences

**Positive**
- The "Manage skills" button now opens the panel.
- Toggling a skill is durable across reloads and demonstrably affects
  what the model sees on the next prompt.
- `SkillTriggerEngine` is no longer dead code; the rules now do work
  on every classified turn.
- Provides a natural future seam for `ConfidenceScorer.recordSkillUsage`
  — the hinter call is the "suggested" event, and a post-stream
  observer can attribute the "effective" event when the model's
  response references a suggested skill.

**Negative / accepted trade-offs**
- Skills "fire" only on prompts that the methodology advisor accepts
  (≥ 12 chars, not a slash command, methodology enabled). Very short
  prompts won't surface skill hints. This is consistent with the
  rest of the methodology layer.
- The addendum grows by up to ~120 chars on prompts that trigger
  multiple skills. The cap of 4 entries keeps this bounded.
- We don't (yet) call `recordSkillUsage` — counts in the modal stay
  flat until that follow-up lands.

## Alternatives Considered

1. **Separate "skill hint" text Part.** Rejected — see "Single
   addendum" above. Easier to govern one block.
2. **Per-session skill enable/disable.** Rejected — current opencode
   sessions don't carry user-facing skill preferences. A global
   preference matches the modal's existing UX.
3. **Server-side skill toggling.** Rejected — the opencode server's
   agent list is its own surface; we don't have an API to disable
   agents on the server. Local preference is sufficient and stays
   correct when the server restarts.

## References

- `src/skills/SkillPreferencesStore.ts` (new)
- `src/skills/SkillTriggerEngine.ts`
- `src/methodology/MethodologyAdvisor.ts`
- `src/chat/ChatProvider.ts` (advisor construction with skill hinter)
- `src/chat/WebviewEventRouter.ts` (`toggle_skill`, `resolveAllSkills`)
- `src/chat/webview/main.ts` (thunk fix at `skillsModalOpen`)
- `src/chat/webview/skills-modal.ts` (unchanged — already correct)
