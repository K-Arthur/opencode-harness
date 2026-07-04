// Minimal vscode API stub — satisfies outputChannel.ts and other
// extension-host imports when running unit tests outside the VS Code host.
"use strict"
const noop = () => {}
const noopChannel = { appendLine: noop, show: noop, dispose: noop }
module.exports = {
  window: {
    createOutputChannel: () => noopChannel,
    showErrorMessage: noop,
    showInformationMessage: noop,
    showWarningMessage: noop,
    createStatusBarItem: () => ({ text: "", show: noop, dispose: noop }),
    activeTextEditor: undefined,
    visibleTextEditors: [],
    onDidChangeActiveTextEditor: () => ({ dispose: noop }),
    onDidChangeVisibleTextEditors: () => ({ dispose: noop }),
    withProgress: (_opts, cb) => cb({ report: noop }, { onCancellationRequested: noop, isCancellationRequested: false }),
  },
  workspace: {
    getConfiguration: () => ({ get: (_key, def) => def, has: () => false }),
    onDidChangeConfiguration: () => ({ dispose: noop }),
    onDidCloseTextDocument: () => ({ dispose: noop }),
    textDocuments: [],
    fs: { readFile: async () => Buffer.from(""), writeFile: async () => {} },
  },
  languages: {
    registerCodeLensProvider: () => ({ dispose: noop }),
    createDiagnosticCollection: () => ({ set: noop, clear: noop, dispose: noop }),
  },
  commands: {
    registerCommand: () => ({ dispose: noop }),
    executeCommand: async () => undefined,
  },
  Uri: {
    file: (p) => ({ fsPath: p, scheme: "file", toString: () => p }),
    parse: (s) => ({ fsPath: s, scheme: "file", toString: () => s }),
  },
  Range: class { constructor(sl, sc, el, ec) { this.start = { line: sl, character: sc }; this.end = { line: el, character: ec } } },
  Position: class { constructor(l, c) { this.line = l; this.character = c } },
  EventEmitter: class { constructor() { this._listeners = [] } event(l) { this._listeners.push(l) } fire(d) { this._listeners.forEach(l => l(d)) } dispose() { this._listeners = [] } },
  Disposable: class { constructor(fn) { this._fn = fn } dispose() { this._fn?.() } static from(...d) { return new module.exports.Disposable(() => d.forEach(x => x?.dispose())) } },
  TextEditorDecorationType: class { dispose() {} },
  ThemeColor: class { constructor(id) { this.id = id } },
  OverviewRulerLane: { Center: 2 },
  DecorationRangeBehavior: { OpenOpen: 0 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { One: 1, Two: 2, Beside: -2 },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  CancellationTokenSource: class { constructor() { this.token = { isCancellationRequested: false, onCancellationRequested: noop } } cancel() { this.token.isCancellationRequested = true } dispose() {} },
  env: { language: "en", uiKind: 1, appName: "VS Code" },
}
