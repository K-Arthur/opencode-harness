Implement the behavior described in $ARGUMENTS using strict TDD. Follow this exact
sequence. Do not collapse phases. Each gate requires actual test runner output.

---

## PHASE 1 — Define and RED

1. **State the behavior** (one sentence, active voice):
   > "When [precondition], [actor] [action], and [postcondition]."
   If you cannot state this precisely, stop. Ask for clarification before writing anything.

2. **Write the test** — one test, one behavior. Name it as a specification:
   `it('returns empty cart when last item is removed', ...)`
   Write against the public interface, not implementation internals.

3. **Run the test now. Paste the full failure output below.**
   ```
   [PASTE FAILURE OUTPUT HERE]
   ```
   - If the test PASSES: the test is wrong. It is testing something that already exists
     or is vacuously true. Do not proceed. Rewrite the test.
   - If the test errors (import failure, missing module): fix the import, run again,
     confirm the error is now a test assertion failure, not a setup failure.
   - If the test fails with the expected assertion: proceed to Phase 2.

4. **Commit the failing test:**
   ```
   git add tests/...
   git commit -m "test(scope): [RED] [behavior description]"
   ```
   The `[RED]` marker in the commit message is the machine-readable signal that this
   commit represents a known-failing test. Do not commit `src/` files in this commit.

---

## PHASE 2 — GREEN (minimum implementation)

5. **Write the minimum code** to make the test pass.
   - Minimum means: no code that is not required by the current red test.
   - Do not generalize, do not anticipate the next feature.
   - If you write more than ~20 lines to make one test pass, the test is too coarse.
     Split it: write a smaller test, make that pass first.

6. **Run the full test suite now. Paste the summary output.**
   ```
   [PASTE TEST OUTPUT HERE]
   ```
   - If new test fails: the implementation introduced a regression. Fix before committing.
   - If the target test still fails: the implementation is wrong. Do not commit.
   - If all tests pass: proceed to commit.

7. **Commit the implementation:**
   ```
   git add src/...
   git commit -m "feat(scope): [behavior description]"
   ```
   This commit should contain only `src/` (or equivalent) changes. No test changes.
   If you need to modify the test to make it pass, that is a test bug — fix the test
   in a separate commit first with an explanation of why the test was wrong.

---

## PHASE 3 — REFACTOR

8. **Inspect the implementation** for structure, not correctness:
   - Does this function have one responsibility?
   - Is there any duplication with existing code in `shared/`?
   - Is the naming consistent with the layer-scoped vocabulary in the constitution?
   - Is the complexity justified or can it be expressed more simply?

9. **Refactor one thing at a time. Run tests after each change.**
   A refactor that breaks a test is not a refactor — it is a behavior change.
   Revert it and find a correct structural change.

10. **Commit each refactor separately:**
    ```
    git commit -m "refactor(scope): [what changed and why]"
    ```

---

## Repeat for next behavior

Return to Phase 1 with the next behavior. The commit log for a complete feature
will read as an alternating sequence: test → feat → refactor → test → feat → ...

---

## Failure modes to call out explicitly

If you find yourself in any of these states, stop and flag it:
- **"I'll write the test after, the implementation is straightforward"** — this is the
  most common collapse. The implementation is never so straightforward that the test
  adds no information. Write the test first.
- **"The test passes already"** — the behavior already existed, or the test is wrong.
  Investigate before proceeding.
- **"I need to change the test to make it pass"** — this is acceptable only if the
  test was incorrectly specified. Commit the test fix with explanation first.
- **Multiple behaviors failing at once** — you wrote too much implementation at once
  in Phase 2. Revert to the minimum, pass the test, then add the next behavior in a
  new RED cycle.
