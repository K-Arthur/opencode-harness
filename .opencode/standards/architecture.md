<!-- ForgeCraft sentinel: architecture | 2026-05-04 | npx forgecraft-mcp refresh . --apply to update -->

## Project Identity
- **Repo**: https://github.com/K-Arthur/opencode-harness
- **Primary Language**: typescript
- **Domain**: library
- **Sensitive Data**: NO
- **Project Tags**: `[UNIVERSAL]` `[LIBRARY]`
- **Release Phase**: development

## Code Standards
- Maximum function/method length: 50 lines. If a function reads like it does two things, decompose it.
- Split a file when you find yourself using "and" to describe what it does — not when it hits a line count.
- Maximum function parameters: 5. If more, use a parameter object.
- No circular imports — module dependency graph must be acyclic (hook-enforced).
- `tsconfig.json` must include `"strict": true` AND `"noUncheckedIndexedAccess": true`.
  `strict: true` alone does not narrow `process.env.*` from `string | undefined` — the second flag is required
  to catch unguarded environment variable access at compile time.
- Every public function/method must have a JSDoc comment with typed params and returns.
- Delete orphaned code. Do not comment it out. Git has history.
- Before creating a new utility, search the entire codebase for existing ones.
- Reuse existing patterns — check shared modules before writing new.
- No abbreviations in names except universally understood ones (id, url, http, db, api).
- All names must be intention-revealing. If you need a comment to explain what a variable
  holds, the name is wrong.

## Language Stack Constraints — Seed Defaults

These are **starting defaults for typescript projects** — use them to populate the
initial rows of `docs/approved-packages.md` in P1. They are not a permanent approved
list: the AI maintains the registry from here forward, keeps versions current, and
replaces any entry that develops a known CVE. The Dependency Registry block above
governs the process.

Before adding any dependency not listed here, apply the audit-before-add process.


### TypeScript / Node.js — Approved Toolchain

**Runtime & compiler**
- Node.js: `^20 LTS` minimum. NOT `^16` or `^18` (EOL or near-EOL).
- TypeScript: `^5.4` minimum. `tsconfig.json` must include `"strict": true` AND
  `"noUncheckedIndexedAccess": true`. The second flag is required to narrow
  `process.env.*` from `string | undefined` at compile time.

**Linting**
- `eslint@^9` + `@typescript-eslint/eslint-plugin@^8` + `@typescript-eslint/parser@^8`
- NOT `@typescript-eslint@^5` or `^6` — old `minimatch` transitive dep has known CVEs.
- NOT `tslint` — deprecated.

**Test runner**
- `vitest@^2` (preferred — native ESM, fast, Jest-compatible API) or `jest@^29`.
- NOT `mocha` + `chai` for new projects (weaker TypeScript support).
- NOT `jasmine` (no active maintenance for Node.js use).

**Formatting**
- `prettier@^3` — configured via `.prettierrc`, integrated with ESLint via
  `eslint-config-prettier`. NOT separate manual formatting.

## Production Code Standards — NON-NEGOTIABLE

These apply to ALL code including prototypes. "It's just a prototype" is never a valid
exception. Prototypes become production code within days at CC development speed.

### SOLID Principles
- **Single Responsibility**: One module = one reason to change. Use "and" to describe it? Split it.
- **Open/Closed**: Extend via interfaces and composition. Never modify working code for new behavior.
- **Liskov Substitution**: Any interface implementation must be fully swappable. No isinstance checks.
- **Interface Segregation**: Small focused interfaces. No god-interfaces.
- **Dependency Inversion**: Depend on abstractions. Concrete classes are injected, never instantiated
  inside business logic. **In practice**: define `IUserRepository`, `IOrderRepository`,
  `IEmailSender` etc. as interfaces in the domain/service layer first. Services depend on
  the interface. The Prisma/SQL/HTTP concrete implementation lives in the adapter layer and
  is injected at the composition root. Emit these interfaces in P1 alongside the schema —
  a service that imports a concrete class cannot be unit-tested, cannot be swapped, and
  is not Composable.

### Zero Hardcoded Values
- ALL configuration through environment variables or config files. No exceptions.
- ALL external URLs, ports, credentials, thresholds, feature flags must be configurable.
- ALL magic numbers must be named constants with documentation.
- Config is validated at startup — fail fast if required values are missing.

### Zero Mocks in Application Code
- No mock objects, fake data, or stub responses in source code. Ever.
- Mocks belong ONLY in test files.
- For local dev: create proper interface implementations selected via config.
- No `if DEBUG: return fake_data` patterns. Use dependency injection to swap implementations.
- No TODO/FIXME stubs returning hardcoded values. Use NotImplementedError with a description.

### Interfaces First
Before writing any implementation:
1. Define the interface/protocol/abstract class
2. Define the data contracts (input/output DTOs)
3. Write the consuming code against the interface
4. Write tests against the interface
5. THEN implement the concrete class

### Dependency Injection
- Every service receives dependencies through its constructor.
- A composition root (main.py / app.ts / container) wires everything.
- No service locator pattern. No global singletons. No module-level instances.

### Error Handling
- Custom exception hierarchy per module. No bare Exception raises.
- Errors carry context: IDs, timestamps, operation names.
- Fail fast, fail loud. No silent swallowing of exceptions.
- Domain code never returns HTTP status codes — that's the API layer's job.

### Modular from Day One
- Feature-based modules over layer-based. Each feature owns its models, service, repository, routes.
- Module dependency graph must be acyclic.
- Every module has a clear public API via index.ts exports.

## Layered Architecture (Ports & Adapters / Hexagonal)

```
┌─────────────────────────────┐
│  API / CLI / Event Handlers │  ← Thin. Validation + delegation only. No logic.
├─────────────────────────────┤     These are DRIVING ADAPTERS (primary).
│  Services (Business Logic)  │  ← Orchestration. Depends on PORT INTERFACES only.
├─────────────────────────────┤
│  Domain Models              │  ← Pure data + behavior. No I/O. No framework imports.
│  (Entities, Value Objects)  │     The inner hexagon. Zero external dependencies.
├─────────────────────────────┤
│  Port Interfaces            │  ← Abstract contracts (Repository, Gateway, Notifier).
│                             │     Defined by the domain, implemented by adapters.
├─────────────────────────────┤
│  Repositories / Adapters    │  ← DRIVEN ADAPTERS (secondary). All external I/O
│                             │     (DB, APIs, files, queues, email, caches).
├─────────────────────────────┤
│  Infrastructure / Config    │  ← DI container, env config, connection factories
└─────────────────────────────┘
```

### Ports (Interfaces owned by the domain)
- **Repository ports**: `UserRepository`, `OrderRepository` — data persistence contracts.
- **Gateway ports**: `PaymentGateway`, `EmailSender` — external service contracts.
- Ports are defined in the domain/service layer, never in the adapter layer.
- Port interfaces specify WHAT, never HOW.

### Adapters (Implementations of ports)
- **Driving adapters** (primary): HTTP controllers, CLI handlers, message consumers
  — they CALL the application through port interfaces.
- **Driven adapters** (secondary): PostgresUserRepository, StripePaymentGateway,
  SESEmailSender — they ARE CALLED BY the application through port interfaces.
- Adapters are interchangeable. Swap `PostgresUserRepository` for `InMemoryUserRepository`
  in tests without changing a single line of business logic.

### Data Transfer Objects (DTOs)
- Use DTOs at layer boundaries — never pass domain entities to/from the API layer.
- **Request DTOs**: validated at the API boundary (Zod schema → typed object).
- **Response DTOs**: shaped for the consumer, not mirroring the domain model.
- **Domain ↔ Persistence mapping**: repositories map between domain entities and DB rows/documents.
- DTOs are plain data objects — no methods, no behavior, no framework decorators.

### Layer Rules
- Never skip layers. API handlers do not call repositories directly.
- Dependencies point INWARD only. Inner layers never import from outer layers.
- Domain models have ZERO external dependencies.
- The domain layer does not know HTTP, SQL, or any framework exists.

## Clean Code Principles

### Command-Query Separation (CQS)
- **Commands** change state but return nothing (void).
- **Queries** return data but change nothing (no side effects).
- A function should do one or the other, never both.
- Exception: stack.pop() style operations where separation is impractical — document why.

### Guard Clauses & Early Return
- Eliminate deep nesting. Handle invalid cases first, return early.
- The happy path runs at the shallowest indentation level.
- Before:
  ```
  if (user) {
    if (user.isActive) {
      if (user.hasPermission) {
        // actual logic buried 3 levels deep
  ```
- After:
  ```
  if (!user) throw new NotFoundError(...);
  if (!user.isActive) throw new InactiveError(...);
  if (!user.hasPermission) throw new ForbiddenError(...);
  // actual logic at top level
  ```

### Composition over Inheritance
- Prefer composing objects via interfaces and delegation over class inheritance.
- Inheritance creates tight coupling and fragile hierarchies.
- Use inheritance ONLY for genuine "is-a" relationships (rare).
- When in doubt, compose: inject a collaborator, don't extend a base class.

### Law of Demeter (Principle of Least Knowledge)
- A method should only call methods on: its own object, its parameters, objects it creates,
  its direct dependencies.
- Do NOT chain through objects: `order.getCustomer().getAddress().getCity()` — BAD.
- Instead: `order.getShippingCity()` or pass the needed data directly.

### Immutability by Default
- Use `const` over `let`. Use `readonly` on properties and parameters.
- Prefer `ReadonlyArray<T>`, `Readonly<T>`, `ReadonlyMap`, `ReadonlySet`.
- When you need to "modify" data, create a new copy with the change.
- Mutable state is the #1 source of bugs. Restrict it to the smallest possible scope.

### Pure Functions
- A pure function: same inputs → same outputs, no side effects.
- Domain logic, validation, transformation, and calculation should be pure.
- Side effects (I/O, logging, database) are pushed to the edges (adapters).
- Pure functions are trivially testable — no mocks needed.

### Factory Pattern
- Use factories to encapsulate complex object construction.
- Factory methods on the class itself for simple cases: `User.create(dto)`.
- Factory classes/functions when construction involves dependencies or conditional logic.
- Factories are the natural companion to dependency injection — the DI container
  IS the top-level factory.

> **Design reference patterns** (DDD, CQRS, GoF) available on demand via `get_design_reference` tool.
