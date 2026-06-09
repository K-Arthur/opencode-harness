import { defineConfig } from "@vscode/test-cli"

export default defineConfig({
  // Integration tests run inside the Extension Development Host
  files: "tests/integration/**/*.test.mjs",
  version: "stable",
  workspaceFolder: "./",
  mocha: {
    ui: "bdd",
    timeout: 30000,
    color: true,
    reporter: "spec",
  },
})