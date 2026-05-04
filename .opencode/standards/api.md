<!-- ForgeCraft sentinel: api | 2026-05-04 | npx forgecraft-mcp refresh . --apply to update -->

## Library / Package Standards

### Public API
- Clear, minimal public API surface. Export only what consumers need.
- Barrel file (index.ts / __init__.py) defines the public API explicitly.
- Internal modules prefixed with underscore or in internal/ directory.
- Every public API has JSDoc/docstring with examples.

### Versioning & Compatibility
- Semantic versioning: MAJOR.MINOR.PATCH.
- MAJOR: breaking API changes. MINOR: new features, backward compatible. PATCH: bug fixes.
- CHANGELOG.md maintained with every release.
- Deprecation warnings before removal (minimum 1 minor version).

### Distribution
- Package includes only dist/ and necessary runtime files.
- Types included (declaration files for TypeScript).
- Peer dependencies used for framework integrations.
- Minimize runtime dependencies — every dep is a risk.

### Testing
- Test against the public API, not internals.
- Test with multiple versions of peer dependencies.
- Integration tests simulate real consumer usage patterns.

### Documentation
- README with: install, quick start, API reference, examples.
- Usage examples for every major feature.
- Migration guide for every major version bump.
