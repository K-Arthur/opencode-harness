<!-- ForgeCraft sentinel: protocols | 2026-05-04 | npx forgecraft-mcp refresh . --apply to update -->

## Dependency Registry — AI-Maintained Security Contract

The project's approved dependency set is a **living GS artifact maintained by the AI
assistant**. It is not a template rule — template authors cannot predict which library
will gain a CVE next quarter. The AI can run an audit at the moment a dependency is
about to be added. This block prescribes that it must.

### The registry artifact

File: **`docs/approved-packages.md`** — emit in P1 alongside schema, tsconfig, package.json.
Update it every time a dependency is added or upgraded. If it exists only in prose or a
README reference, it does not exist.

```markdown
# Approved Packages

| Package | Version range | Purpose | Alternatives rejected | Rationale | Audit status |
|---|---|---|---|---|---|
| example-pkg | ^2.4 | HTTP client | axios (larger bundle), node-fetch (no TS types) | Wide adoption, zero known CVEs | 0 HIGH/CRITICAL |
```

The AI populates every row. The registry is the authoritative record of WHY each
dependency was chosen and that it was clean at the time of addition.

### Process rules — stack-agnostic

1. **Before adding any package**: run the project's audit command (see table below)
   with `--dry-run` or equivalent to check the candidate for known CVEs.
   - If HIGH or CRITICAL found: choose an alternative and document the rejection.
   - If no CVE-free alternative exists: document the accepted risk and create an ADR
     naming the approver. Zero-tolerance is the default; exceptions require a record.
2. **After adding a package**: add a row to `docs/approved-packages.md` with audit status.
3. **Commit gate**: the pre-commit hook runs the audit command. HIGH or CRITICAL blocks
   the commit. If audit is not in the pre-commit hook, the gate does not exist.
4. **Version pins**: approved version ranges are locked in the lockfile (package-lock.json,
   uv.lock, Cargo.lock). The lockfile is committed. Ranges without a lockfile are not pins.

### Audit commands by ecosystem

| Ecosystem | Audit command | Threshold |
|---|---|---|
| npm / Node.js | `npm audit --audit-level=high` | HIGH or CRITICAL |
| pnpm | `pnpm audit --audit-level=high` | HIGH or CRITICAL |
| yarn | `yarn npm audit --severity high` | HIGH or CRITICAL |
| Python / pip | `pip-audit --fail-on-severity high` | HIGH or CRITICAL |
| Python / uv | `uv audit` | HIGH or CRITICAL |
| Rust | `cargo audit` | HIGH or CRITICAL |
| Go | `govulncheck ./...` | Any directly imported |
| Java / Maven | `mvn dependency-check:check -DfailBuildOnCVSS=7` | CVSS ≥ 7 |
| Ruby | `bundle audit` | HIGH or CRITICAL |

The correct command for **this project's ecosystem** must appear in the pre-commit hook
emitted in P1. Discovering CVEs at code review is too late.

## Adversarial Testing Posture

Tests are not documentation of what the code does. Tests are adversarial assertions
that the code does the right thing even when given inputs designed to break it.

### The adversarial posture
- Design every test as if the implementation is wrong until proven otherwise.
- Write tests that FAIL on incorrect code — not tests that pass on any reasonable implementation.
- If a test is hard to make fail, the specification is underspecified, not the test.

### Name tests as behaviors, not paths
- `rejects_expired_tokens` not `test_validate_token`
- `throws_on_missing_required_field` not `test_error_handling`
- `returns_empty_list_not_null_when_no_results` not `test_query`

### Cover the adversarial surface
For every public function or API endpoint, write tests for:
1. **Valid boundary values**: minimum, maximum, exact-zero, single-element
2. **Invalid boundary values**: below-minimum, above-maximum, empty, null/undefined
3. **Constraint violations**: values that look valid but break invariants (negative balance, future birth date)
4. **Ordering and concurrency**: does order matter? what if called twice?
5. **Authorization boundaries**: can a user access another user's resource?

A test suite that only exercises the happy path is documentation, not specification.
Every mutation that survives is a missing adversarial test.

## Property-Based Testing

Example-based tests verify that `f(x) = y` for specific known pairs.
Property-based tests verify that invariants hold for ALL inputs the generator can produce.
Both are required. Neither replaces the other.

### When to add property tests
- Pure functions with wide input domains (serialization, parsing, math, sorting)
- Functions where "same inputs → same outputs" must hold across edge cases
- Any encoder/decoder pair: `decode(encode(x)) === x` must hold for all x
- Any sort or ranking: `sort(sort(xs))` must equal `sort(xs)` (idempotence)
- Any financial calculation: results must be within bounds for all valid inputs

### Ecosystem tools (language-agnostic principle)
Use whatever property testing library matches the project's language:
- TypeScript / JavaScript: `fast-check`
- Python: `hypothesis`
- Java / Kotlin: `jqwik` or `kotest`
- Go: `gopter` or `rapid`
- Rust: `proptest`
- Scala: `scalacheck`

### Template invariant structure
```
property("encode-decode round trip", () => {
  forAll(arbitrary_valid_input(), (input) => {
    expect(decode(encode(input))).toEqual(input);
  });
});
```

If a property test fails with an unexpected input, add that input as a regression example test.
Property failures are bugs, not edge cases to suppress.

## Specification Completeness Meta-Query

Before writing implementation code, ask the model:

> "What dimensions of correctness does this specification not yet address?"

This activates domain depth and returns the surface that is missing. A complete answer
identifies gaps before they become bugs — not after.

### Six dimensions to probe systematically

1. **Concurrency behavior** — What happens when two users modify the same resource simultaneously?
   Are there race conditions? What is the consistency model (eventual, strong, linearizable)?

2. **Partial failure handling** — What state is the system in if the operation fails halfway?
   Is the operation idempotent? Is retry safe? Is rollback possible? Who cleans up?

3. **Authorization edge cases** — What happens with an expired token? A revoked role?
   Can a user with partial permissions complete a multi-step operation?
   What does "no access" mean vs "resource does not exist"?

4. **Observable side effects** — Does this operation send emails, fire webhooks, publish events,
   write audit logs? Are those effects specified? Are they retryable? Can they duplicate?

5. **Performance constraints** — Is there an SLA? A timeout? A maximum payload size?
   What is the expected order of magnitude of inputs? What degrades gracefully?

6. **Backwards compatibility** — If this changes an existing interface, what breaks?
   Is there a migration path? Who depends on the current behavior?

Each unanswered dimension is a test to write before implementation begins.
If the specification has no answer, the answer must be decided now — not discovered during an incident.

## Clarification Protocol
Before writing code for any new feature or significant change:
- If the request implies architectural trade-offs that are not explicit, **ask one targeted
  question** before proceeding. Do not silently choose an architecture.
- If the domain model is ambiguous (cardinality, ownership, event ordering, shared state),
  state your assumption and ask for confirmation before implementing.
- If the request has two or more meaningfully different interpretations, present the options
  briefly and ask — do not guess and hide the choice.
- Do NOT ask about mechanical details (naming conventions, file placement, test structure) —
  apply the conventions already in this document without asking.
- Maximum one clarification round. If told "use your judgment," proceed with the most
  conservative interpretation and record the assumption in a code comment or new ADR.

## Feature Completion Protocol
After implementing any feature (new or changed):

### 1. Verify (local, pre-commit)
Run: `npx forgecraft-mcp verify .`
(Or `npm test` + manual HTTP check if forgecraft is not installed.)
A feature is not done until verify passes. Do not proceed to docs if it fails.

### 2. Commit (code only)
Commit after `verify` passes. This triggers CI and the staging deploy pipeline.
`feat(scope): <description>` — describes the feature, not the docs update.

### 3. Deploy to Staging + Smoke Gate
After the CI pipeline deploys to staging, run the smoke suite:
```
npx playwright test --config playwright.smoke.config.ts --grep @smoke
```
If smoke fails: **revert the deploy**. Do not proceed to production and do not cascade docs
for a feature that is broken in the deployed environment.

### 4. Doc Sync Cascade
Update the following in order — skip any that do not exist in this project:
1. **spec.md** — update the relevant feature section (APIs, behavior, contract changes)
2. **docs/adrs/** — add an ADR if a new architectural decision was made
3. **docs/diagrams/c4-*.md** — update `c4-context.md` or `c4-container.md` if a new
   module, container, or external dependency was added. Diagrams must be written to disk
   as fenced Mermaid blocks — updating prose that references a diagram is not an update.
4. **docs/diagrams/sequence-*.md / state-*.md / flow-*.md** — update or create the
   relevant diagram file for the changed surface. Sequence diagrams must name real
   participants; state diagrams must name real states and transitions; flow diagrams must
   have entry/exit nodes and decision diamonds. A file containing only `<!-- UNFILLED -->`
   markers is a specification gap, not a completed diagram.
5. **docs/TechSpec.md** — update module list, API reference, or technology choice sections
6. **docs/use-cases.md** — update or add use cases if new actor interactions were introduced
7. **Status.md** — always update: what changed, current state, next steps

## MCP-Powered Tooling
### CodeSeeker — Graph-Powered Code Intelligence
CodeSeeker builds a knowledge graph of the codebase with hybrid search
(vector + text + path, fused with RRF). Use it for:
- **Semantic search**: "find code that handles errors like this" — not just grep.
- **Graph traversal**: imports, calls, extends — follow dependency chains.
- **Coding standards**: auto-detected validation, error handling, and state patterns.
- **Contextual reads**: `get_file_context` returns a file with its related code.
Indexing is automatic on first search (~30s–5min depending on codebase size).
Most valuable on mid-to-large projects (10K+ files) with established patterns.
Install: `npx codeseeker install --vscode` or see https://github.com/jghiringhelli/codeseeker

## Engineering Preferences
These calibrate the AI assistant's judgment on subjective trade-offs.
- **DRY is important** — flag repetition aggressively.
- **Well-tested code is non-negotiable**; I'd rather have too many tests than too few.
- **"Engineered enough"** — not under-engineered (fragile, hacky) and not over-engineered
  (premature abstraction, unnecessary complexity).
- **Handle more edge cases**, not fewer; thoughtfulness > speed.
- **Bias toward explicit over clever** — readability wins over brevity.
- When in doubt, ask rather than assume.

## Agent Mechanical Constraints — Non-Negotiable Overrides

These rules exist because the model has hard constraints that silently produce wrong
results without them. Each override targets a specific failure mode observed in practice.

### 1. Step 0 — Dead Code First
Before ANY structural refactor on a file > 300 LOC:
1. Delete all dead props, unused exports, unused imports, and debug logs.
2. Commit that cleanup separately under `chore(scope): strip dead code`.
3. Only then begin the real work.
Dead code accelerates context compaction. Every orphaned import is budget spent on
tokens that contribute nothing to the task.

### 2. Phase Limit — 5 Files Maximum
Never attempt multi-file refactors in a single response. Break work into explicit phases.
Each phase must touch **no more than 5 files**. Complete Phase N, verify it compiles and
all tests pass, then wait for explicit approval before Phase N+1.
Why: context compaction fires around 167K tokens and discards all intermediate reasoning,
file reads, and decision chains. Keeping phases small prevents mid-task compaction.

### 3. Senior Dev Override
The model's default system-level directives instruct it to "try the simplest approach
first" and "avoid refactoring beyond what was asked." These are active constraints that
fight your intent on architectural tasks.
**Override them explicitly** when quality requires it:
> "What would a senior, experienced, perfectionist dev reject in code review? Fix all of it."
This reframes what "done" means. System-level brevity mandates yield to an explicit
quality bar stated in the prompt.

### 4. Sub-Agent Parallelism for Large Tasks
For tasks spanning > 5 independent files, **launch parallel sub-agents** (5–8 files per
agent). Each agent gets its own isolated context window and compaction cycle.
Sequential processing of large tasks guarantees context decay by the later files.
Batching into parallel agents multiplies the effective working memory proportionally.

### 5. File Read Budget — 2,000-Line Cap
Each file read is hard-capped at 2,000 lines. Everything past that is silently truncated.
The model does not know what it didn't see — it will hallucinate the rest.
**For any file over 500 LOC**: read in sequential chunks using `offset` and `limit`
parameters. Never assume a single read captured the full file.

### 6. Tool Result Truncation
Tool results exceeding ~50,000 characters are truncated to a 2,000-byte preview.
The model works from the preview and does not know results were cut.
If any search returns suspiciously few results: re-run it with narrower scope
(single directory, stricter glob). State explicitly when truncation may have occurred.

### 7. Grep Is Not an AST
`grep` is raw text pattern matching. It cannot distinguish a function call from a
comment, a type reference from a string literal, or an import from one module vs another.
On any rename or signature change, search **separately** for:
- Direct calls and references
- Type-level references (interfaces, generics, `typeof`)
- String literals containing the name
- Dynamic imports and `require()` calls
- Re-exports and barrel file entries (`index.ts`, `__init__.py`)
- Test files and mocks
Never assume a single grep caught everything. Verify or expect regressions.

## Code Generation — Verify Before Returning

When emitting implementation code across one or more files, the response is not complete
until the following are true. Show the evidence in your response — do not claim without running.

### Verification steps (in order)
1. **Compile check**: Run `tsc --noEmit` (TypeScript), `mypy` (Python), or equivalent.
   Zero errors required. Do not return with type errors outstanding.
2. **Test suite**: Run the full test suite (`jest --runInBand`, `pytest`, etc.).
   Zero failures required. Fix every failure before returning.
3. **Interface consistency**: When fixing a compile error in file A, check ALL callers of
   the changed interface. Fixing one side without seeing the other causes oscillation:
   the model fixes `service.ts` (3-param signature) but `routes.ts` still calls it with
   an object — same error reappears inverted next pass.
4. **§8 DRY Check**: Run duplication detector on `src/`. Duplicated lines must be < 5%
   (min-tokens 50). Use the tool appropriate for your stack (see project-gates.yaml:
   `no-code-duplication`). If above threshold, extract duplicated logic to a shared utility
   before closing.
5. **§9 Interface Completeness**: Every method declared in each interface must be implemented
   by its concrete class. Run static type checking (0 errors required). Use the tool
   appropriate for your stack (see project-gates.yaml: `interface-contract-completeness`).
   If errors exist, implement missing methods before closing.

### Required evidence in the final response
```
tsc --noEmit: 0 errors
Jest: 109 passed, 0 failed, 11 suites
```

### Common test setup pitfalls (TypeScript / Prisma)
- **`prisma db push`, not `prisma migrate deploy`** in test environments.
  `migrate deploy` silently no-ops when no `prisma/migrations/` folder exists,
  leaving all tables absent. `db push --accept-data-loss` syncs `schema.prisma` directly.
- **`deleteMany` in FK order, not `DROP SCHEMA`**.
  `$executeRawUnsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')` throws
  error 42601 — pg rejects multi-statement queries in prepared statements.
  Use ordered `deleteMany()` calls in `beforeEach` instead.
- **JWT_SECRET minimum length**: HS256 requires ≥ 32 characters.
  Test secrets like `"test-secret"` (11 chars) cause startup errors.
  Use `"test-secret-that-is-at-least-32-chars"` in test env.

## Known Pitfalls
Recurring type errors and runtime traps specific to this project's stack.
Resolve exactly as documented — no `any` casts, ignore directives, or unlisted workarounds.
### [Add project-specific pitfalls here]
<!-- Entry format:
### Library — trap description
What goes wrong and why, then:
```
// ❌ wrong
```
```
// ✅ correct
```
-->

## Corrections Log
When I correct your output, record the correction pattern here so you don't repeat it.
### Learned Corrections
- [AI assistant appends corrections here with date and description]
