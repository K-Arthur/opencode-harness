const esbuild = require("esbuild")
const fs = require("fs")
const path = require("path")

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
  entryPoints: [{ in: "src/chat/webview/main.ts", out: "chat/webview/main" }],
  bundle: true,
  format: "iife",
  platform: "browser",
  outdir: "dist",
  sourcemap: false,
  minify: production,
  // @vscode-elements/elements is loaded via <script> tag in index.html
  // (bundled.js) as a pre-built bundle that auto-registers all custom elements.
  logLevel: "info",
}

const markdownWorkerConfig = {
  entryPoints: [{ in: "src/chat/webview/markdownWorker.ts", out: "chat/webview/markdownWorker" }],
  bundle: true,
  format: "iife",
  platform: "browser",
  outdir: "dist",
  sourcemap: false,
  minify: production,
  logLevel: "info",
}

const cssConfig = {
  entryPoints: [{ in: "src/chat/webview/css/styles.css", out: "chat/webview/styles" }],
  bundle: true,
  outdir: "dist",
  minify: production,
  logLevel: "info",
  loader: {
    ".woff": "file",
    ".woff2": "file",
    ".ttf": "file",
    ".eot": "file",
  },
}

const mermaidVendorConfig = {
  entryPoints: [{ in: "src/chat/webview/vendor/mermaidEntry.ts", out: "chat/webview/mermaid-vendor" }],
  bundle: true,
  format: "iife",
  platform: "browser",
  outdir: "dist",
  minify: production,
  logLevel: "info",
}

const katexVendorConfig = {
  entryPoints: [{ in: "src/chat/webview/vendor/katexEntry.ts", out: "chat/webview/katex-vendor" }],
  bundle: true,
  format: "iife",
  platform: "browser",
  outdir: "dist",
  minify: production,
  logLevel: "info",
}

function copyWebviewAssets() {
  const outDir = path.join("dist", "chat", "webview")
  fs.mkdirSync(outDir, { recursive: true })

  // index.html
  fs.copyFileSync(
    path.join("src", "chat", "webview", "index.html"),
    path.join(outDir, "index.html")
  )

  // media
  const mediaDir = path.join(outDir, "media")
  fs.mkdirSync(mediaDir, { recursive: true })
  fs.copyFileSync(
    path.join("media", "opencode-wordmark-dark.svg"),
    path.join(mediaDir, "opencode-wordmark-dark.svg")
  )
}

if (watch) {
  copyWebviewAssets()
  Promise.all([
    esbuild.context(extensionConfig).then(ctx => ctx.watch()),
    esbuild.context(webviewConfig).then(ctx => ctx.watch()),
    esbuild.context(markdownWorkerConfig).then(ctx => ctx.watch()),
    esbuild.context(mermaidVendorConfig).then(ctx => ctx.watch()),
    esbuild.context(katexVendorConfig).then(ctx => ctx.watch()),
    esbuild.context(cssConfig).then(ctx => ctx.watch()),
  ])
} else {
  Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
    esbuild.build(markdownWorkerConfig),
    esbuild.build(mermaidVendorConfig),
    esbuild.build(katexVendorConfig),
    esbuild.build(cssConfig),
  ])
    .then(copyWebviewAssets)
    .catch(() => process.exit(1))
}
