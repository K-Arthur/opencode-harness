import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"




const source = readFileSync(resolve(__dirname, "WebviewContent.ts"), "utf8")

void describe("WebviewContent.ts", () => {
  void it("exports WebviewContent class", () => {
    assert.ok(source.includes("export class WebviewContent"), "WebviewContent class must be exported")
  })

  void it("has constructor accepting extensionUri", () => {
    assert.ok(
      source.includes("private readonly extensionUri: vscode.Uri"),
      "constructor must accept vscode.Uri"
    )
  })

  void it("has public build method with expected signature", () => {
    assert.ok(
      source.includes("build(webview: vscode.Webview, themeManager: ThemeManager): string"),
      "build method must accept webview and themeManager"
    )
  })

  void it("reads HTML and CSS from disk", () => {
    assert.ok(source.includes('fs.existsSync(distHtmlPath)'), "must check dist HTML path")
    assert.ok(source.includes('fs.readFileSync(htmlPath, "utf8")'), "must read HTML file")
    assert.ok(source.includes('fs.readFileSync(cssPath, "utf8")'), "must read CSS file")
  })

  void it("has private buildThemeStyleTag method", () => {
    assert.ok(source.includes("private buildThemeStyleTag("), "must have buildThemeStyleTag")
    assert.ok(source.includes("customVars"), "must access customVars from theme")
    assert.ok(source.includes("theme-kind:"), "must include theme-kind in style tag")
  })

  void it("has private getNonce method for CSP nonce generation", () => {
    assert.ok(source.includes("private getNonce("), "must have getNonce method")
    assert.ok(source.includes("crypto.randomBytes"), "must generate random nonce")
    assert.ok(source.includes('return crypto.randomBytes(32).toString("hex")'), "must generate random hex nonce")
  })

  void it("builds a Content Security Policy header", () => {
    assert.ok(source.includes("Content-Security-Policy"), "CSP header must be present")
    assert.ok(source.includes("default-src 'none'"), "CSP must have default-src 'none'")
    assert.ok(source.includes("script-src"), "CSP must have script-src")
    assert.ok(source.includes("style-src"), "CSP must have style-src")
    assert.ok(source.includes("img-src"), "CSP must have img-src")
  })

  void it("replaces script src and stylesheet in HTML template", () => {
    assert.ok(source.includes('html.replace('), "must replace placeholders in HTML")
    assert.ok(source.includes('main.js'), "must handle main.js")
    assert.ok(source.includes('styles.css'), "must handle styles.css link")
    assert.ok(source.includes('opencode-wordmark-dark.svg'), "must handle wordmark image")
  })

  void it("includes webview URI resolution for extension resources", () => {
    assert.ok(source.includes("webview.asWebviewUri("), "must resolve URIs for webview")
  })

  void it("has private sanitizeCssValue method that delegates to utility", () => {
    assert.ok(source.includes("sanitizeCssValue"), "must have sanitizeCssValue method")
    assert.ok(source.includes("import { sanitizeCssValue } from"), "must import sanitizeCssValue from utility")
    assert.ok(source.includes("Blocked CSS value"), "must log blocked values")
  })

  void it("resolves CSS @import statements when reading source CSS (fallback path)", () => {
    // esbuild resolves @import at build time into dist/styles.css, but when
    // falling back to src/chat/webview/css/styles.css (dev without build),
    // WebviewContent must resolve @imports by inlining the imported files.
    assert.ok(
      source.includes("resolveCssImports"),
      "WebviewContent must resolve @import via resolveCssImports method"
    )
    assert.ok(
      source.includes("distCssPath") && source.includes("srcCssPath"),
      "must check both dist and src CSS paths"
    )
  })

  void it("includes font-src in CSP for webview resource origin", () => {
    assert.ok(source.includes("font-src"), "CSP must have font-src directive")
    assert.ok(source.includes("cspSource"), "font-src must use webview.cspSource")
  })
})
