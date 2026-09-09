# Marketing website copy: dual OpenCode runtimes

The repository does not contain a deployable marketing website. This file is
the implementation-ready copy handoff for the website or Marketplace landing
page; it keeps the product promise aligned with the shipped behavior.

## Hero

### One OpenCode workspace. Two runtimes.

Use OpenCode or OpenCode 2 from one focused VS Code chat panel. Keep both
installed, choose your preferred runtime, and switch cleanly when your current
response is idle.

Primary CTA: Install for VS Code
Secondary CTA: View runtime compatibility

## Feature card

### Runtime choice you can see

The header selector shows Auto, OpenCode, and OpenCode 2. A verified badge
reports which server actually answered the compatibility handshake, including
the runtime version when available.

## Trust / expectations

- Auto detection is deterministic and checks OpenCode 2 before the stable
  runtime.
- Switching preserves drafts and queued prompts.
- One panel uses one active backend at a time, so sessions and event streams
  cannot cross-contaminate.
- OpenCode 2 is preview support; unsupported operations are identified instead
  of silently approximated.
- Both executables can remain installed. Concurrent external use requires the
  user's own isolated OpenCode data/config roots.

## Compatibility CTA copy

See the [OpenCode runtime compatibility matrix](../compatibility/opencode-runtime-matrix.md)
for supported workflows, preview limitations, install channels, and verified
platform evidence.

## Screenshot guidance

The runtime selector should be visible in a narrow dark VS Code panel with the
badge reading OpenCode 2 · verified, and a second state should show Not
connected. Do not label a screenshot with a runtime unless the fixture also
dispatches a verified runtime_status state.
