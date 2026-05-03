const esbuild = require("esbuild")

const watch = process.argv.includes("--watch")
const production = process.argv.includes("--production")

const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  outdir: "dist",
  sourcemap: !production,
  minify: production,
  treeShaking: true,
  logLevel: "info",
}

const webviewConfig = {
  entryPoints: [{ in: "src/chat/webview/main.js", out: "chat/webview/main" }],
  bundle: true,
  format: "iife",
  platform: "browser",
  outdir: "dist",
  sourcemap: !production,
  minify: production,
  treeShaking: true,
  logLevel: "info",
}

if (watch) {
  Promise.all([
    esbuild.context(extensionConfig).then(ctx => ctx.watch()),
    esbuild.context(webviewConfig).then(ctx => ctx.watch())
  ])
} else {
  Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig)
  ]).catch(() => process.exit(1))
}
