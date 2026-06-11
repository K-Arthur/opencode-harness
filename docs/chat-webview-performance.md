# Chat Webview Performance Notes

> **2026-06-11:** the "two open sessions lag" report was root-caused to
> persistence amplification (full-state `vscode.setState` + full-store
> `globalState` writes on every debounced save) and the virtual-list
> dispose/`restoreAll` lifecycle — not to the streaming/render pipeline
> below. See `docs/performance-audit.md` §"2026-06-11" for the five root
> causes, fixes, and measurements. Key invariants to preserve:
> `vscode.setState` receives a bounded snapshot (50 msgs/session), never the
> raw state object; `SessionStore.flush` persists ≤200 msgs/session via
> `buildPersistedSessions`; virtual-list placeholders are observed (scrollback
> restore depends on it); already-open tabs switch locally via `openSession`,
> never through `resume_session`.

## Verified Hotspots

- The virtual message list now uses dynamic pruning thresholds instead of fixed 40/15/15 counts. It keeps focused, recently added, and active streaming messages attached.
- Message loading now starts at 20 messages per animation frame, then adapts between 8 and 60 messages to target an 8ms render budget.
- `ChunkBatcher` keeps the 10KB default size cap but adapts flush timing between 35ms and 150ms based on stream velocity. `stream_end` still flushes immediately before the terminal event is posted.
- Streaming text chunks are not markdown-rendered on every chunk; they update a text node. Final markdown renders and restored messages now benefit from bounded markdown and syntax-highlight caches. Very large final markdown blocks are eligible for the bundled worker path.
- Non-critical host-to-webview messages can be sent as `host_message_batch`; stream lifecycle, permission, error, session switch, and compaction lifecycle messages remain immediate.

## Tuning Knobs

- `ChunkBatcherOptions`: `minFlushMs`, `baseFlushMs`, `maxFlushMs`, `lowVelocityCharsPerMs`, `highVelocityCharsPerMs`, and `maxBatchSize`.
- `messageLoader.ts`: `CHUNK_SIZE`, `MIN_CHUNK_SIZE`, `MAX_CHUNK_SIZE`, and `TARGET_CHUNK_MS`.
- `virtualList.ts`: base prune threshold, long-session bonus, recent keep count, and per-side keep-alive caps.
- `renderer.ts`: `MARKDOWN_WORKER_MIN_CHARS`, `MARKDOWN_WORKER_MIN_CODE_CHARS`, `MARKDOWN_WORKER_TIMEOUT_MS`, markdown cache size, and highlight cache size.
- `AutoCompactor`: keeps the configured context threshold and minimum message count, then adds cooldown, token delta, and token density checks to avoid repeated auto-compactions during noisy tool-heavy sessions.

## VS Code Webview Constraints

- The transport remains VS Code `postMessage`; WebSocket/SSE belongs in the extension host, not the webview.
- VS Code webview workers must be loaded from `blob:` or `data:` URLs and cannot use dynamic `import()` or `importScripts()`.
- The extension now emits `dist/chat/webview/markdownWorker.js` as a single-file worker bundle. The webview fetches that local asset through `webview.asWebviewUri`, creates a `blob:` URL, and launches the worker from that blob.
- The CSP allows only the local webview resource origin for `connect-src` and `blob:` for `worker-src`; direct network transport remains disabled.
- Worker rendering is final-only. Active stream token display never waits for a worker response, and worker output is sanitized on the main thread before it is cached or inserted into the DOM.

## Testing

- Unit and contract coverage: `npm run test:unit` and `npm run test:message-contract`.
- Full default suite: `npm test`.
- VS Code Extension Development Host checks: `npm run test:integration`.
- Webview browser checks: `npm run test:webview`.
- Visual regression checks: `npm run test:visual`.

The webview sets `data-testid="prompt-input"` and `data-testid="send-button"` at startup so Playwright tests can target stable controls without depending on styling or layout.

## Verification Log

Fresh verification on 2026-05-22:

- `npm run typecheck`: passed.
- `npm run build`: passed and emitted `dist/chat/webview/markdownWorker.js`.
- `npm test`: passed, including unit, message-contract, and round-trip coverage.
- `npm run test:webview`: passed on the Chromium webview project.
- `npm run test:visual`: passed.
- `npm run test:integration`: passed in VS Code 1.121.0 after fixing stale integration-test harness assumptions about the extension id and async command enumeration.

## Frontend Console NLS Check

The reported VS Code console error:

```text
Error: !!! NLS MISSING: 19342 !!!
    at ... colorExtensionPoint.ts:50:1
```

does not match any current contribution from this extension. The manifest does not contribute workbench colors or themes, does not use package `%...%` localization placeholders, and the source does not call `workbench.action.setTheme`. The dev-host integration run also did not reproduce the `NLS MISSING`/`colorExtensionPoint` error. If this appears again, check installed VS Code language packs or other enabled extensions that contribute `contributes.colors`/`contributes.themes`, then capture the Extension Host log with the active extension list.
