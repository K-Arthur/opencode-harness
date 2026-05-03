const esbuild = require("esbuild")

const watch = process.argv.includes("--watch")
const production = process.argv.includes("--production")

const config = {
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

if (watch) {
  esbuild.context(config).then((ctx) => ctx.watch())
} else {
  esbuild.build(config).catch(() => process.exit(1))
}
