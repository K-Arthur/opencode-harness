<!-- ForgeCraft sentinel: testing | 2026-05-04 | npx forgecraft-mcp refresh . --apply to update -->

## Testing Pyramid

```
         /  E2E  \          ← 5-10% of tests. Core journeys only.
        / Integration \      ← 20-30%. Real dependencies at boundaries.
       /    Unit Tests   \   ← 60-75%. Fast, isolated, every public function.
```

### Coverage Targets
- Overall minimum: 80% line coverage (blocks commit)
- New/changed code: 90% minimum (measured on diff)
- Critical paths: 95%+ (data pipelines, auth, PHI handling, financial calculations)
- Mutation score (MSI) — overall: ≥ 65% (blocks PR merge)
- Mutation score (MSI) — new/changed code: ≥ 70% (measured on diff)
- Note: Line coverage and mutation score are both required. 80% line coverage can coexist
  with 58% MSI when tests execute code without asserting its behavior (confirmed in Shattered
  Stars). Run stryker-mutator immediately after writing each test batch, not only pre-release.
  Tooling: stryker-mutator (JS/TS), mutmut (Python), Pitest (Java).

### Test Rules
- Every test name is a specification: `test_rejects_duplicate_member_ids` not `test_validation`
- No empty catch blocks. No `assert True`. No tests that can't fail.
- Test files colocated: `[module].test.[ext]` or in `tests/` mirroring src structure.
- Flaky tests are bugs — fix or quarantine, never ignore.
- After writing tests for any module, run Stryker on that module before moving on.
  Surviving mutants = missing assertions. Fix before proceeding.

### Test Doubles Taxonomy
Use the correct double for the job:
- **Stub**: Returns canned data. No assertions on calls. Use when you need to control input.
- **Spy**: Records calls. Assert after the fact. Use to verify side effects.
- **Fake**: Working implementation with shortcuts (in-memory DB). Use for integration-speed tests.
- **Mock**: Pre-programmed expectations. Assert call patterns. Use sparingly — they couple to implementation.
Prefer stubs and fakes over mocks. Tests that mock everything test nothing.

### Test Data Builders
- Use Builder or Factory pattern for test data: `UserBuilder.anAdmin().withName('Alice').build()`.
- One builder per domain entity. Builders provide sensible defaults so tests only specify what matters.
- No raw object literals scattered across tests. Centralize in `tests/fixtures/` or `tests/builders/`.

### Property-Based Testing
- For pure functions with wide input ranges, add property tests (fast-check, Hypothesis, QuickCheck).
- Define invariants, not examples: "sorting is idempotent", "encode then decode = identity".
- Property tests complement, not replace, example-based tests.

## Test-Driven Development (TDD)

### Red-Green-Refactor — The Only Cycle
1. **RED**: Write a failing test that describes the desired behavior. Run it. It MUST fail.
   If it passes, the test is wrong — it's not testing what you think.
2. **GREEN**: Write the minimum code to make the test pass. No more.
3. **REFACTOR**: Clean up while all tests stay green. No new behavior in this step.
Repeat. Every feature, every function, every bug fix follows this cycle.

### Tests Are Specifications, Not Confirmations
- Write tests against **expected behavior**, never against current implementation.
- A test that passes on broken code is worse than no test — it provides false confidence.
- Never weaken an assertion to match what the code currently does. If the code disagrees
  with the spec, the code is wrong.
- Never write a test suite after the fact that just "locks in" existing behavior without
  verifying it's correct.

### Bug Fix Protocol
- **Every bug fix starts with a failing test** that reproduces the bug.
- The test must fail before the fix and pass after. No exceptions.
- If you can't write a reproducing test, you don't understand the bug well enough to fix it.

### One Behavior Per Test
- Each test verifies exactly one behavior or rule.
- A test with multiple unrelated assertions is testing multiple things — split it.
- Test name = the specification: `rejects_expired_tokens`, not `test_auth`.

## TDD Enforcement — Forbidden Patterns and Gate Protocol

Instructions describe a process. Gates enforce it. This block defines what is
structurally prohibited, what output is required at each gate, and how the
commit sequence makes the TDD cycle auditable.

### Forbidden Patterns (non-negotiable)
The following are architecture violations, not style preferences:
- **NEVER write an implementation file before running and showing a failing test.**
  Stating that "the test would fail" is not equivalent to running it. Run it.
- **NEVER write tests after implementation** except for bug fix reproduction tests on
  pre-existing code not yet covered. Even then: write the test, show it fails, fix,
  show it passes.
- **NEVER weaken an assertion** to make a test pass. If the assertion disagrees with
  the output, the implementation is wrong.
- **NEVER skip the refactor phase** because "the code is clean enough." The refactor
  phase exists to enforce separation of concerns under green. Skipping it is a
  commitment not to separate concerns in that increment.
- **NEVER commit a `feat:` or `fix:` with no corresponding `test:` commit** preceding
  it in the same branch. The test commit is the audit trail that the red phase occurred.

### The Session Gate Protocol
TDD across a multi-step session requires explicit checkpoints the AI reports and the
human can verify. At each gate, the AI must output the actual test runner output,
not a summary of what it expects.

```
┌─────────────────────────────────────────────────────┐
│  PHASE 1: RED                                       │
│  Action:  Write test for the specified behavior     │
│  Gate:    Run test — paste full failure output      │
│  Block:   Cannot proceed until failure is shown     │
│  Commit:  test(scope): [RED] describe behavior      │
└───────────────────┬─────────────────────────────────┘
                    │ failure confirmed
┌───────────────────▼─────────────────────────────────┐
│  PHASE 2: GREEN                                     │
│  Action:  Write minimum implementation              │
│  Gate:    Run test — paste full passing output      │
│  Block:   Cannot proceed until passing is shown     │
│  Commit:  feat(scope): implement to satisfy test    │
└───────────────────┬─────────────────────────────────┘
                    │ green confirmed
┌───────────────────▼─────────────────────────────────┐
│  PHASE 3: REFACTOR                                  │
│  Action:  Improve structure, not behavior           │
│  Gate:    Run full suite — paste summary output     │
│  Block:   Cannot commit if any test regresses       │
│  Commit:  refactor(scope): clean without behavior   │
└─────────────────────────────────────────────────────┘
```

### Commit Sequence as Audit Trail
The git log for any feature must be readable as:
```
test(cart): [RED] add test for removing last item empties cart
feat(cart): remove last item empties cart
refactor(cart): extract empty-check to CartState predicate
```
This sequence is auditable. An AI that wrote the `feat:` commit without the preceding
`test:` commit either skipped the red phase entirely or conflated it with implementation.
The commit hook `pre-commit-tdd-check.sh` detects the second pattern before it lands.

### Why Instructions Alone Are Not Sufficient
A language model generating in a single context window experiences no time delay between
writing a test and writing an implementation that passes it. The RED phase is structurally
collapsed. The gates above exist precisely to make the phases non-simultaneous:
- The test commit must happen before the implementation can be written.
- The failure output must be produced (by running the code) before the game state is known.
- The model cannot "know" the failure output without actually running the test,
  because the failure messages are not in the training distribution for this specific code.
These gates transform TDD from a discipline into a constraint.

## Data Guardrails ⚠️
- NEVER sample, truncate, or subset data unless explicitly instructed.
- NEVER make simplifying assumptions about distributions, scales, or schemas.
- State exact row counts, column sets, and filters for every data operation.
- If data is too large for in-memory, say so — don't silently downsample.

## Techniques
Named techniques, algorithms, and domain frameworks active in this project.
Each name activates the AI's full training on that technique — no explanation needed.
A technique named here is available at the full depth of the model's training on it.
### Active Techniques
<!-- Add project-specific techniques below.
     Examples: RAPTOR indexing · BM25+vector hybrid with RRF fusion ·
     PCA geometric validation · deontic modal logic · CQRS · Saga pattern -->
- [Add named techniques here]

## Testing Architecture

### Test Types by Scope and Purpose
Listed from fastest/most-isolated to slowest/most-integrated:

| Type | Description | Tooling |
|---|---|---|
| **Unit — Solitary** | Single unit; mock all collaborators. | Jest, Vitest, pytest |
| **Unit — Sociable** | Single unit; allow fast non-I/O collaborators (no mocking real logic). | Jest, Vitest, pytest |
| **Integration — Narrow (DB)** | Exercise one layer against a real local DB; no external services. | Testcontainers, SQLite, in-process Postgres |
| **Integration — Service** | Service + stubs for external deps via WireMock or equivalent. | WireMock, Wiremock-rs, msw |
| **Contract / Consumer-Driven (CDC)** | Consumer writes pact file; provider verifies. Prevents API breakage without full E2E infra. | Pact, Spring Cloud Contract |
| **API / Subcutaneous** | HTTP or WebSocket layer below the UI; tests the full request-response cycle without browser. | Supertest, Playwright APIRequestContext, httpx |
| **Acceptance / BDD** | Given-When-Then; orthogonal to pyramid — level is a performance choice, not semantic. | Cucumber, behave, should-style assertions |
| **E2E** | Full user flows in a real browser. Keep minimal — expensive and brittle. Reserve for highest-value journeys. | Playwright, Cypress |
| **Visual Regression** | Pixel-diff baseline + LLM visual analysis for judgment-requiring defects. | Percy, Chromatic, Playwright snapshots |
| **Smoke** | Deployed environment only. Strictly happy-path. Binary pass/fail deploy gate. | Playwright, custom health check suite |
| **Regression** | Discipline: full suite green before merge. Not a test type — a required gate. | All layers |
| **Security — SAST** | Static analysis at commit: code pattern scanning and dep vulnerability scanning. | Semgrep, SonarQube, ESLint security plugins, npm audit, Snyk |
| **Security — DAST** | Dynamic analysis at staging: automated attack surface probing. | OWASP ZAP, Burp Suite |
| **Security — Penetration** | Adversarial session at release candidate gate; OWASP Top 10 coverage. | Manual + OWASP ZAP, Burp Suite |
| **Mutation** | Tests the tests: injects code mutations and verifies the suite catches them. Tracked at PR; required above threshold at RC. | Stryker (JS), PIT (Java), mutmut (Python) |
| **Property-Based / Fuzz** | Auto-generates input space against stated invariants. Fuzzing is the adversarial variant. | fast-check (JS), Hypothesis (Python) |
| **Accessibility / a11y** | WCAG 2.1 AA. Automated at PR; full manual audit at RC. | axe-core, Playwright @axe-core, Lighthouse |
| **Performance: Load / Stress / Soak** | At staging. Required before production on systems with SLAs. | k6, Locust, Gatling |
| **Chaos / Resilience** | Random fault injection against deployed environment; named resilience contracts. | Toxiproxy, ChaosMesh, custom fault injection |
| **Exploratory** | Manual, session-based, scheduled. Charter-driven. Findings become regression tests. | Manual + session notes |

### Variant Coverage Dimensions
For each test scope, the following input/condition variants are required:

- **Happy path** — nominal, valid inputs. Necessary but never sufficient.
- **Sad / Negative path** — correct rejection of invalid input or sequences.
- **Edge case / BVA** — boundary values: max, min, empty, null, type coercions.
- **Corner case** — intersection of two or more simultaneous edge conditions. Requires explicit enumeration.
- **State transition** — valid and invalid state machine transitions. Requires a state diagram as prerequisite.
- **Equivalence partitioning** — one representative from each equivalence class. Reduces test count without reducing coverage.
- **Error path** — infrastructure/dependency failure: timeout, 500, DB refused, queue full — conditions the user did not cause.
- **Security / Adversarial input** — SQL injection, XSS, path traversal, oversized payloads, malformed tokens. Required at every layer touching user-supplied data.
- **Random / Monkey** — unstructured random input. Subsumed by property-based layer.

**Variant coverage matrix** (✓ = required, ~ = structural constraint, — = not applicable):

| Variant | Unit | Integration | Contract | API | E2E | Smoke | Chaos |
|---|---|---|---|---|---|---|---|
| Happy path | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Sad / Negative | ✓ | ✓ | ✓ | ✓ | ~ | ~ happy-path only | — |
| Edge / BVA | ✓ | ✓ | — | ✓ | — | — | — |
| Corner case | ✓ | — | — | ✓ | — | — | — |
| State transition | ✓ | ✓ | — | ✓ | ✓ | — | — |
| Equivalence partition | ✓ | — | — | ✓ | — | — | — |
| Error path | ✓ | ✓ | — | ✓ | — | — | ✓ |
| Security / Adversarial | — | — | — | ✓ | — | — | ~ always adversarial |
| Random / Monkey | via property-based | — | — | — | — | — | ✓ |

### Test Pipeline Mapping
Each trigger gate accumulates the prior gates. A gate may not be skipped.

| Trigger | Gate Contents | Target Duration |
|---|---|---|
| **File save** | Unit only | ~seconds |
| **git commit / push** | Unit + integration + SAST + dependency scan + lint + regression gate | ~2–5 min |
| **Pull request** | All prior + contract + API/subcutaneous + E2E (core flows) + acceptance + visual regression + a11y (automated) + property-based | ~10–20 min |
| **Deploy to staging** | Smoke → DAST → performance baseline → chaos/resilience | ~45–60 min |
| **Release candidate** | All layers blocking + penetration test + full a11y audit + mutation score gate + compatibility matrix | Per schedule |
| **Production deploy** | Canary deploy + synthetic monitoring + A/B if applicable | Continuous |

> Mutation score gate: minimum 70% at PR, 80% at RC on changed code. Stryker/mutmut reports block promotion below threshold.

## Generative Specification: Testing Techniques

These five techniques are specific to GS practice and extend the standard taxonomy above.

### Adversarial Test Posture
The test is a hunter, not a witness.
- Tests are written to FAIL on incorrect code — to find the input or condition that exposes
  a violation, not to confirm the current behavior.
- Tests must be written against interfaces, not implementations.
  A test coupled to internal state fails on correct refactors and passes on behavioral violations
  that happen to preserve internal structure. That is the worst outcome.

### Expose-Store-to-Window (Interactive / Game / Real-Time UIs)
For applications with a shared state store (Redux, Zustand, Pinia, state machine), expose the
store to `window` in the test environment:
```typescript
if (process.env.NODE_ENV === 'test') {
  (window as any).__store = store;
}
```
Playwright tests can then assert both what the screen renders AND what the application believes
is true — the store's internal state — without coupling assertions to DOM structure. This catches
the failure class that renders correctly but corrupts internal state (score displays right, stored wrong;
entity in undefined state not yet manifested as a visual defect).

### Vertical Chain Test
A single UI action triggers Playwright, which then:
1. Queries the service layer response
2. Queries the database state and any affected indexes
3. Verifies correct propagation through every boundary the action crosses
4. Returns to the UI to confirm the visible outcome matches the stored state

Not a unit test, not a visual check, not a flow test: a chain verification. One trigger, inspected
at every boundary it crosses. Specify which critical flows receive this treatment in the test
architecture document. A defect anywhere in the chain (service logic, persistence, index consistency,
UI rendering) is surfaced in a single pass.

### Mutation Testing as Adversarial Audit
An AI-generated test suite carries a structural risk: tests written by a system that knows the
correct implementation may pass it rather than catch violations of it.
- Run Stryker (JS/TS) or mutmut (Python) against every AI-generated suite before accepting it.
- A test that passes a mutant is not testing the contract — it is confirming the absence of one
  specific mutation, no more.
- Coverage measures what was executed. Mutation score measures what was caught. The second is
  the meaningful metric.
- Gates: 70% mutation score at PR, 80% at release candidate on changed code.

### Multimodal Quality Gates (Generative Assets)
When content is AI-generated (images, audio, video), the acceptance criteria must be executable.
Manual review at scale is not a pipeline.

**Visual assets (sprite sheets, generated imagery):**
```python
# PCA-based orientation check
from sklearn.decomposition import PCA
pca = PCA(n_components=2).fit(ship_pixel_coordinates)
angle = np.degrees(np.arctan2(*pca.components_[0][::-1]))
assert abs(angle) <= 15, f"Sprite orientation {angle:.1f}° exceeds 15° tolerance"

# Symmetry check (horizontal flip similarity)
similarity = ssim(img_half_left, np.fliplr(img_half_right))
assert similarity >= 0.85, f"Symmetry {similarity:.2f} below 0.85 threshold"
```

**Audio assets:**
- Loudness normalization: assert target LUFS within ±1 dB of spec (pyloudnorm).
- Frequency profile: no asset competes in the 2–4 kHz presence range during dialogue.
- Silence detection: reject assets with generation artifacts (> X ms silence in unexpected positions).

**MCP-mediated inspection (judgment-requiring defects):**
An instrumented game/app state exposed through an MCP server lets a language model
evaluate whether a running scene satisfies its acceptance criteria without pre-scripting
every assertion. Feed the model the scene spec + MCP access; it reports violations.
This addresses defects that are easy to name but hard to encode as assertions.
