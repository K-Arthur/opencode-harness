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
  sourcemap: !production,
  minify: production,
  // @vscode/webview-ui-toolkit is loaded via <script> tag in index.html
  // (toolkit.min.js) because its "sideEffects": false causes esbuild to
  // drop the custom element registration during bundling.
  logLevel: "info",
}

const cssConfig = {
  entryPoints: [{ in: "src/chat/webview/css/styles.css", out: "chat/webview/styles" }],
  bundle: true,
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

  // @vscode/webview-ui-toolkit — loaded via <script> tag in index.html
  // because esbuild drops the side-effect import due to "sideEffects": false
  // in the toolkit's package.json.
  const toolkitSrc = path.join(
    "node_modules", "@vscode", "webview-ui-toolkit", "dist", "toolkit.min.js"
  )
  if (fs.existsSync(toolkitSrc)) {
    fs.copyFileSync(toolkitSrc, path.join(outDir, "toolkit.min.js"))
  } else {
    console.warn("[esbuild] WARNING: toolkit.min.js not found at", toolkitSrc)
  }
}

if (watch) {
  copyWebviewAssets()
  Promise.all([
    esbuild.context(extensionConfig).then(ctx => ctx.watch()),
    esbuild.context(webviewConfig).then(ctx => ctx.watch()),
    esbuild.context(cssConfig).then(ctx => ctx.watch()),
  ])
} else {
  Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
    esbuild.build(cssConfig),
  ])
    .then(copyWebviewAssets)
    .catch(() => process.exit(1))
}