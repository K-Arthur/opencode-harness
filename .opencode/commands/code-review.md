Review the code changes in this project. For each file changed:

1. **Read** the file and understand the context
2. **Check** against these criteria:
   - Correctness: Does the logic do what it claims?
   - Security: Any injection, auth bypass, or data leak risks?
   - Performance: Any N+1 queries, unbounded loops, or memory leaks?
   - Readability: Are names intention-revealing? Is complexity justified?
   - Tests: Are edge cases covered? Can tests fail?

3. **Output** findings in this format:
   - **File**: path/to/file
   - **Line**: number
   - **Severity**: CRITICAL | IMPORTANT | SUGGESTION
   - **Issue**: description
   - **Fix**: recommended change

If $ARGUMENTS is provided, focus the review on those specific files or concerns.
Otherwise, review all staged or recently changed files (use `git diff --name-only`).
