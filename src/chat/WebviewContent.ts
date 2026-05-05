import * as vscode from "vscode"
import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import { ThemeManager, type ThemeVariables } from "../theme/ThemeManager"
import { log } from "../utils/outputChannel"

export class WebviewContent {
  constructor(private readonly extensionUri: vscode.Uri) {}

  build(webview: vscode.Webview, themeManager: ThemeManager): string {
    const extRoot = this.extensionUri.fsPath

    const distHtmlPath = path.join(extRoot, "dist", "chat", "webview", "index.html")
    const srcHtmlPath = path.join(extRoot, "src", "chat", "webview", "index.html")
    const htmlPath = fs.existsSync(distHtmlPath) ? distHtmlPath : srcHtmlPath

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "chat", "webview", "main.js")
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
    // CSP Security Notes:
    // - connect-src 'none': Webview↔host uses postMessage only. CLI HTTP server
    //   (127.0.0.1:PORT) runs on extension host (Node.js), NOT in the webview.
    //   If future features need direct webview→CLI SSE, change to:
    //   `connect-src http://127.0.0.1:${port}`
    // - style-src 'unsafe-inline': Required by @vscode-elements/elements components
    //   which use inline styles for dynamic theming.
    // - script-src 'strict-dynamic': Allows nonce-loaded scripts to dynamically
    //   load other scripts (needed for toolkit component registration).
    // - worker/child/frame-src 'none': No sub-contexts needed.
    // - base-uri/form-action 'none': No navigation or form submission.
    const csp = [
      "default-src 'none'",
      `connect-src 'none'`,
      `style-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' 'strict-dynamic'`,
      `img-src ${webview.cspSource} data: https:`,
      `font-src ${webview.cspSource}`,
      `worker-src 'none'`,
      `child-src 'none'`,
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

    html = html.replace(
      '<script src="main.js"></script>',
      `<script nonce="${nonce}" src="${scriptUri}"></script>`
    )
    html = html.replace(
      'src="media/opencode-wordmark-dark.svg"',
      `src="${wordmarkDarkUri}"`
    )
    return html
  }

  private buildThemeStyleTag(vars: ThemeVariables, nonce: string): string {
    const entries = Object.entries(vars.customVars)
      .filter(([, val]) => val)
      .map(([key, val]) => `${key}: ${val};`)
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
}
