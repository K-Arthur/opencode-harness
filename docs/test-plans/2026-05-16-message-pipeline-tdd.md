# TDD Test Plan — SDK-Aligned Message Pipeline

**Date:** 2026-05-16
**Spec:** [../specs/2026-05-16-message-pipeline-alignment.md](../specs/2026-05-16-message-pipeline-alignment.md)
**ADR:** [../adrs/ADR-008-sdk-aligned-message-pipeline.md](../adrs/ADR-008-sdk-aligned-message-pipeline.md)

This is the RED list. Every test below should be written and failing
against current `master` before any implementation lands. Tests are
grouped by layer; PRs land in the same order.

## Status (2026-05-17)

| Layer | Status | Pass / Total | Notes |
|---|---|---|---|
| 1 — Single converter (`sdkMessageConverter`) | ✅ landed | 27 / 27 | Meta-test L1-T26 enforces single Part dispatcher |
| 2 — `CanonicalBlock` discriminated union | ✅ landed | 12 / 13 (1 skip) | L2-T2 (`LegacyBlock` removed) deferred to v2 cleanup |
| 3 — StreamCoordinator delegates | 🟡 partial | 3 / 7 (4 skip) | L3-T3..T6 (live stream reducer) deferred to Layer 3b |
| 4 — ChatProvider thinking handler | ✅ landed | 5 / 5 | |
| 5 — Versioned state migration | ✅ landed | 10 / 10 | L5-T9..T11 golden fixtures await real-user snapshots |
| 6 — Session title bidirectional sync | 🟡 partial | 10 / 11 (1 skip) | L6-T11 (`session.deleted`) deferred; L6-T12..T14 Playwright separate |
| 7 — Render newly-supported part types | ✅ landed | 9 / 9 | Minimal chips; richer presentation can replace without converter churn |

**Unit suite delta:** 1390 → 1465 pass (+75), 1 pre-existing fail (unrelated `timeline jumps`), 7 skipped (deferred sub-layers).


## Conventions

- `*.test.ts` — Node test runner via `tsx` (`npm run test:unit`).
- `*.spec.ts` under `tests/visual/` — Playwright webview tests.
- `*.test.mjs` under `tests/unit/` — plain Node test runner.
- Each test name describes a single behavioral assertion in the
  imperative ("rejects_X", "renders_Y", "syncs_Z"). One behavior per test.

## Layer 1 — `sdkMessageConverter` becomes the single converter

**File:** `src/session/sdkMessageConverter.test.ts`

L1-T1. `partToBlock_returns_text_block_for_TextPart_with_text`
L1-T2. `partToBlock_returns_null_for_synthetic_TextPart`
L1-T3. `partToBlock_returns_null_for_ignored_TextPart`
L1-T4. `partToBlock_returns_reasoning_block_for_ReasoningPart`
L1-T5. `partToBlock_returns_reasoning_block_with_time_range`
L1-T6. `partToBlock_returns_file_block_for_image_FilePart`
L1-T7. `partToBlock_returns_file_block_for_non_image_FilePart_with_source_path`
L1-T8. `partToBlock_returns_tool_block_for_pending_ToolPart`
L1-T9. `partToBlock_returns_tool_block_for_running_ToolPart_with_input`
L1-T10. `partToBlock_returns_tool_block_for_completed_ToolPart_with_output`
L1-T11. `partToBlock_returns_tool_block_for_error_ToolPart_with_message`
L1-T12. `partToBlock_returns_step_start_block`
L1-T13. `partToBlock_returns_step_finish_block_with_tokens_and_cost`
L1-T14. `partToBlock_returns_snapshot_block`
L1-T15. `partToBlock_returns_patch_block_with_file_list`
L1-T16. `partToBlock_returns_agent_block_with_name`
L1-T17. `partToBlock_returns_retry_block_with_attempt_and_error`
L1-T18. `partToBlock_returns_compaction_block_marking_auto_flag`
L1-T19. `partToBlock_returns_subtask_block_with_prompt_description_agent`
L1-T20. `partToBlock_passes_streaming_opt_through_to_reasoning_block`
L1-T21. `partToBlock_uses_part_id_as_block_id_for_streaming_identity`
L1-T22. `sdkMessageToChatMessage_drops_synthetic_text_only_messages`
L1-T23. `sdkMessageToChatMessage_preserves_message_role_id_sessionId`
L1-T24. `sdkMessageToChatMessage_uses_time_completed_when_present_else_created`
L1-T25. `sdkMessagesToChatMessages_preserves_order_and_drops_nulls`

**Structural assertion (A2):**

L1-T26. `meta_only_sdkMessageConverter_switches_on_part_type` — scans `src/`
for `switch (.*part\.type)` and asserts the only matching file is
`sdkMessageConverter.ts`.

## Layer 2 — `CanonicalBlock` discriminated union

**File:** `src/chat/webview/types.test.ts` (extending existing file)

L2-T1. `Block_is_assignable_from_each_CanonicalBlock_variant`
L2-T2. `LegacyBlock_export_removed` — assertion against `types.ts` source.
L2-T3. `isToolBlock_narrows_to_tool_variant`
L2-T4. `isReasoningBlock_narrows_to_reasoning_variant`
L2-T5. `isStepFinishBlock_narrows_to_step_finish_variant`
L2-T6. `block_with_unknown_type_fails_typecheck` — compile-time test
using `// @ts-expect-error` markers.

## Layer 3 — `StreamCoordinator` delegates to converter

**File:** `src/chat/handlers/StreamCoordinator.partsToBlocks.test.ts` (new)

L3-T1. `partsToBlocks_delegates_to_sdkMessageConverter_partToBlock`
L3-T2. `partsToBlocks_no_longer_contains_inline_type_switch` — structural
L3-T3. `stream_part_update_replaces_block_by_part_id`
L3-T4. `stream_part_update_preserves_block_order_when_replacing`
L3-T5. `stream_part_update_appends_new_block_when_part_id_unseen`
L3-T6. `stream_part_removed_drops_block_by_id`
L3-T7. `reconnect_replay_uses_partsToBlocks_directly_no_drift`

## Layer 4 — `ChatProvider` "thinking" event delegates

**File:** `src/chat/ChatProvider.thinking.test.ts` (new)

L4-T1. `thinking_event_produces_block_via_sdkMessageConverter`
L4-T2. `thinking_event_sets_streaming_true`
L4-T3. `thinking_event_uses_canonical_field_text_not_content`

## Layer 5 — Migration

**File:** `src/chat/webview/state.migration.test.ts` (new)

L5-T1. `migrate_legacy_state_adds_schemaVersion_1`
L5-T2. `migrate_renames_block_type_tool_call_to_tool`
L5-T3. `migrate_renames_block_field_content_to_text_on_reasoning`
L5-T4. `migrate_renames_block_type_thinking_to_reasoning`
L5-T5. `migrate_copies_session_name_to_session_title`
L5-T6. `migrate_preserves_message_order`
L5-T7. `migrate_is_idempotent_when_schemaVersion_already_set`
L5-T8. `migrate_refuses_state_with_higher_schemaVersion_than_supported`

**Golden fixtures:** `tests/fixtures/state-snapshots/{pre-v1-a,pre-v1-b,pre-v1-c}.json`
captured from three real users. Each gets a round-trip test:

L5-T9. `migrate_pre_v1_a_renders_identical_block_tree_post_migration`
L5-T10. `migrate_pre_v1_b_renders_identical_block_tree_post_migration`
L5-T11. `migrate_pre_v1_c_renders_identical_block_tree_post_migration`

## Layer 6 — Session title bidirectional sync

**File:** `src/session/SessionStore.title.test.ts` (new)

L6-T1. `setTitle_writes_local_state`
L6-T2. `setTitle_calls_client_session_update_with_new_title`
L6-T3. `setTitle_validation_rejects_empty_string`
L6-T4. `setTitle_validation_rejects_oversize_string`
L6-T5. `setTitle_no_op_when_cliSessionId_missing`
L6-T6. `setTitle_marks_session_as_not_auto_titled`

**File:** `src/session/eventHandlers/SessionUpdatedHandler.test.ts` (new)

L6-T7. `session_updated_event_updates_local_title_for_known_session`
L6-T8. `session_updated_event_is_ignored_for_unknown_session_id`
L6-T9. `session_updated_event_fires_sessions_changed`
L6-T10. `session_created_event_creates_local_record_when_missing`
L6-T11. `session_deleted_event_removes_local_record`

**Integration (Playwright):** `tests/visual/session-title-sync.spec.ts`

L6-T12. `rename_in_extension_reaches_server_within_one_round_trip`
L6-T13. `rename_on_server_appears_in_extension_via_session_updated_event`
L6-T14. `auto_title_from_first_user_message_propagates_to_server`

## Layer 7 — Unsupported part types now render

**File:** `src/chat/webview/renderer.parts.test.ts` (new)

L7-T1. `renders_step_start_as_minimal_chip`
L7-T2. `renders_step_finish_with_token_summary`
L7-T3. `renders_patch_as_file_list_summary`
L7-T4. `renders_compaction_as_fold_marker`
L7-T5. `renders_retry_as_warning_chip`
L7-T6. `renders_agent_as_agent_indicator`
L7-T7. `renders_subtask_as_nested_block`
L7-T8. `renders_snapshot_as_timeline_marker`

## Layer 8 — Renderer fallback removal (deferred to v2)

These are written now but skipped (`it.skip`) until v2 release:

L8-T1. `renderer_no_longer_reads_block_content_fallback`
L8-T2. `renderer_no_longer_reads_legacy_text_field_on_reasoning`
L8-T3. `renderer_no_longer_accepts_tool_call_underscored_type`

## Coverage & mutation gates

- Overall coverage ≥ 80%, new code ≥ 90% (constitution §13).
- Mutation score on `src/session/sdkMessageConverter.ts` ≥ 85% (spec A8).
- All 1390 existing tests stay green at every PR (spec A9).

## TDD discipline

Each layer:
1. Land RED test commit (`test: …`) with every test in this layer failing.
2. Implement to green (`feat: …` / `refactor: …`).
3. Refactor + document (`refactor: …`, update `docs/TechSpec.md`).
4. Verify all prior layers' tests still green.

No skipping phases. The constitution requires RED-phase evidence in the
commit log (§14).

## Out of test scope (this plan)

- SSE transport reliability (already covered by `StreamCoordinator.transport.test.ts`).
- Tool-result diff derivation (existing `DiffApplier` tests cover this).
- Theming / a11y / layout.
