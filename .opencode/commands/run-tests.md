Run the project's test suite and analyze the results.

Steps:

1. Run `npm test` or `npx vitest run`
2. If tests fail, read the failing test files and the source code they test
3. Identify root cause — is it a test bug or a source bug?
4. Propose a fix with explanation



If $ARGUMENTS is provided, run only matching tests (e.g., a specific file or pattern).

Always report:
- Total tests: passed / failed / skipped
- Coverage summary if available
- Any flaky test patterns detected
