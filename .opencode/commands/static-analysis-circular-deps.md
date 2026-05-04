Run a dependency graph analyzer on the source directory.
Use the tool appropriate for your language (see project-gates.yaml: no-circular-dependencies).
Some languages (Go, Rust) reject circular imports at compile time natively.

Pass condition: Zero circular dependencies detected.
If cycles are found, extract a shared abstraction or invert the dependency direction.
