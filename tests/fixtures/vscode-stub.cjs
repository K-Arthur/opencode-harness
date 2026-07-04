// Minimal vscode stub for unit tests that transitively import outputChannel.ts.
// Loaded via --require (CJS) so it patches Module._resolveFilename before tsx
// resolves any extension-host imports.
"use strict"
const Module = require("module")
const path = require("path")
const stubPath = path.join(__dirname, "vscode-api.cjs")
const original = Module._resolveFilename.bind(Module)
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "vscode") return stubPath
  return original(request, parent, isMain, options)
}
