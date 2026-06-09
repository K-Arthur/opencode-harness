Run Stryker on the changed module to verify test assertions actually catch bugs.

```
npx stryker run
```

Pass condition: Mutation Score Indicator (MSI) >= 65% overall, >= 70% on new/changed code.
Surviving mutants = missing assertions. Add targeted assertions before proceeding.

Run after writing each test batch, not only pre-release.
