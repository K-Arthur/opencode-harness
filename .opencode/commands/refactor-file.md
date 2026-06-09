Refactor the file specified in $ARGUMENTS following project conventions.

Analysis steps:
1. Read the file completely
2. Check against SOLID principles:
   - **S**: Does each function/class have one responsibility?
   - **O**: Can behavior be extended without modifying existing code?
   - **L**: Are subtypes substitutable?
   - **I**: Are interfaces focused?
   - **D**: Are dependencies injected?
3. Check project conventions:
   - Max function length: 50 lines
   - Max file length: 300 lines
   - Max parameters: 5 (use parameter object if more)
   - Intention-revealing names, no abbreviations
4. Propose changes grouped by priority:
   - MUST: Violations of project standards
   - SHOULD: Improvements to readability/maintainability
   - COULD: Optional enhancements

Make changes incrementally. Run tests after each change to verify nothing breaks.
