Run a copy-paste duplication detector on the source directory.
Use the tool appropriate for your language (see project-gates.yaml: no-code-duplication).

Pass condition: Duplicated lines < 5% of total source lines (min-tokens: 50).
If above threshold, extract duplicated logic to a shared utility before committing.

Evidence: AX experiment — treatment-v6 achieved 2.50% with explicit DRY gate;
treatment-v3 reached 7.99% without it.
