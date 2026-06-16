import * as vscode from "vscode"
import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import { ThemeManager, type ThemeVariables } from "../theme/ThemeManager"
import { sanitizeCssValue } from "../utils/cssSanitizer"
import { log } from "../utils/outputChannel"

export class WebviewContent {
  constructor(private readonly extensionUri: vscode.Uri) {}

  build(webview: vscode.Webview, themeManager: ThemeManager): string {
    return this.buildInternal(webview, themeManager, null)
  }

  /**
   * Build the HTML for a popout panel dedicated to a single subagent detail.
   * Injects `?popout=1&subagentId=...&sessionId=...` into the page so the
   * webview knows to enter popout mode on init (hide the input, tabs, and
   * main message list; show only the subagent detail view).
   */
  buildForPopout(
    webview: vscode.Webview,
    themeManager: ThemeManager,
    parentSessionId: string,
    subagentId: string,
  ): string {
    return this.buildInternal(webview, themeManager, { parentSessionId, subagentId })
  }

  private buildInternal(
    webview: vscode.Webview,
    themeManager: ThemeManager,
    popout: { parentSessionId: string; subagentId: string } | null,
  ): string {
    const extRoot = this.extensionUri.fsPath

    const distHtmlPath = path.join(extRoot, "dist", "chat", "webview", "index.html")
    const srcHtmlPath = path.join(extRoot, "src", "chat", "webview", "index.html")
    const htmlPath = fs.existsSync(distHtmlPath) ? distHtmlPath : srcHtmlPath

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "chat", "webview", "main.js")
    )
    const markdownWorkerUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "chat", "webview", "markdownWorker.js")
    )
    const mermaidVendorUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "chat", "webview", "mermaid-vendor.js")
    )
    const katexVendorUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "chat", "webview", "katex-vendor.js")
    )
    const wordmarkDarkUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "chat", "webview", "media", "opencode-wordmark-dark.svg")
    )

    const distCssPath = path.join(extRoot, "dist", "chat", "webview", "styles.css")
    const srcCssPath = path.join(extRoot, "src", "chat", "webview", "css", "styles.css")
    const cssPath = fs.existsSync(distCssPath) ? distCssPath : srcCssPath

    const nonce = this.getNonce()
    let html: string
    try {
      html = fs.readFileSync(htmlPath, "utf8")
    } catch (err) {
      log.error("Could not read HTML template", err)
      return this.getFallbackHtml(webview, nonce)
    }
    let css = ""
    try {
      css = fs.readFileSync(cssPath, "utf8")
      if (typeof css !== "string") css = ""
    } catch (err) {
      // Non-fatal: panel will render without custom styles. Logged for diagnostics.
      log.warn("Could not read CSS file", cssPath)
    }
    // VS Code webviews do not support CSS @import. The built dist/ file has
    // imports resolved by esbuild, but when falling back to src/ CSS (dev
    // without build), we must inline @import statements manually.
    if (cssPath === srcCssPath && css.includes("@import")) {
      css = this.resolveCssImports(css, path.dirname(cssPath))
    }
    // CSP Security Notes:
    // - connect-src ${webview.cspSource}: Webview↔host uses postMessage only.
    //   This permits fetching the bundled markdown worker asset so it can be
    //   launched via a blob: URL, as required by VS Code webviews. CLI HTTP server
    //   (127.0.0.1:PORT) runs on extension host (Node.js), NOT in the webview.
    //   If future features need direct webview→CLI SSE, change to:
    //   `connect-src http://127.0.0.1:${port}`
    // - style-src 'unsafe-inline': Required by @vscode-elements/elements components
    //   which use inline styles for dynamic theming.
    // - script-src 'strict-dynamic': Allows nonce-loaded scripts to dynamically
    //   load other scripts (needed for toolkit component registration).
    // - worker-src blob: markdown rendering worker only; frame-src remains none.
    // - base-uri/form-action 'none': No navigation or form submission.
    const csp = [
      "default-src 'none'",
      `connect-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' 'strict-dynamic'`,
      `img-src ${webview.cspSource} data: https:`,
      `font-src ${webview.cspSource}`,
      `worker-src blob:`,
      `child-src blob:`,
      `frame-src 'none'`,
      `base-uri 'none'`,
      `form-action 'none'`,
    ].join("; ")

    const themeVars = themeManager.getThemeVariables()
    const themeStyle = this.buildThemeStyleTag(themeVars, nonce)

    html = html.replace(
      /<meta http-equiv="Content-Security-Policy" content="[^"]*">/,
      `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    )
    html = html.replace(
      '<link rel="stylesheet" href="styles.css">',
      `${themeStyle}<style nonce="${nonce}">${css}</style>`
    )

    // Inject popout-mode bootstrap (read by main.ts at init). We use a
    // module-script with the same nonce so it runs before the bundled
    // main.js (which is also nonced). We sanitize values to ASCII to keep
    // them out of HTML/script contexts.
    const popoutBootstrap = popout
      ? `<script nonce="${nonce}">window.__OC_POPOUT__=${JSON.stringify({ parentSessionId: popout.parentSessionId, subagentId: popout.subagentId })};</script>`
      : ""

    html = html.replace(
      '<script src="main.js"></script>',
      `${popoutBootstrap}<script nonce="${nonce}">window.__OC_MARKDOWN_WORKER_URI__ = "${markdownWorkerUri}";window.__OC_MERMAID_URI__ = "${mermaidVendorUri}";window.__OC_KATEX_URI__ = "${katexVendorUri}";</script><script nonce="${nonce}" src="${scriptUri}"></script>`
    )
    html = html.replace(
      'src="media/opencode-wordmark-dark.svg"',
      `src="${wordmarkDarkUri}"`
    )
    return html
  }

  /**
   * Resolve CSS @import "./file.css" statements by inlining the referenced files.
   * VS Code webviews do not support CSS @import, so we must resolve them at
   * serve-time when falling back to the source CSS (dev without build).
   * Only resolves simple @import "./..." and @import "..." (no url(), no media queries).
   * Max recursion depth of 3 to prevent infinite loops.
   */
  private resolveCssImports(css: string, baseDir: string, depth = 0): string {
    if (depth > 3) return css
    const importRegex = /@import\s+(?:"([^"]+)"|'([^']+)')\s*;/g
    let resolved = css
    let match: RegExpExecArray | null
    while ((match = importRegex.exec(css)) !== null) {
      const importPath = match[1] || match[2] || ""
      if (!importPath || importPath.startsWith("http://") || importPath.startsWith("https://")) continue
      const fullPath = path.resolve(baseDir, importPath)
      try {
        const imported = fs.readFileSync(fullPath, "utf8")
        const nested = this.resolveCssImports(imported, path.dirname(fullPath), depth + 1)
        resolved = resolved.replace(match[0], nested)
      } catch {
        log.warn(`Could not resolve CSS import: ${importPath} from ${baseDir}`)
      }
    }
    return resolved
  }

  private sanitizeCssValue(value: string): string | null {
    const result = sanitizeCssValue(value)
    if (result === null && value.trim()) {
      log.warn(`Blocked CSS value: "${value.trim().substring(0, 60)}"`)
    }
    return result
  }

  private buildThemeStyleTag(vars: ThemeVariables, nonce: string): string {
    const entries = Object.entries(vars.customVars)
      .filter(([, val]) => val)
      .filter(([, val]) => this.sanitizeCssValue(val) !== null)
      .map(([key, val]) => `${key}: ${this.sanitizeCssValue(val)};`)
      .join("\n")
    return `<style nonce="${nonce}" id="oc-theme-vars">:root {\n${entries}\n}\n/* theme-kind: ${vars.kind} */</style>`
  }

  private getNonce(): string {
    return crypto.randomBytes(32).toString("hex")
  }

  private getFallbackHtml(webview: vscode.Webview, nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: https:; base-uri 'none'; form-action 'none';">
  <style nonce="${nonce}">
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 2em; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
    .error-card { border: 1px solid var(--vscode-inputValidation-errorBorder, #f00); border-radius: 8px; padding: 2em; margin: 2em auto; max-width: 400px; text-align: center; }
    h2 { margin: 0 0 0.5em; }
    p { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="error-card">
    <h2>OpenCode UI Error</h2>
    <p>The chat panel could not be loaded because the UI bundle is missing or corrupted.</p>
    <p>Try rebuilding the extension with <code>npm run build</code> or reinstalling the extension.</p>
  </div>
</body>
</html>`
  }

  dispose(): void {}
}
