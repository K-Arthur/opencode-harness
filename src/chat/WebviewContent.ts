import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import { ThemeManager, type ThemeVariables } from "../theme/ThemeManager"

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

    let html = fs.readFileSync(htmlPath, "utf8")
    let css = ""
    try {
      css = fs.readFileSync(cssPath, "utf8")
    } catch (err) {
      // Non-fatal: panel will render without custom styles. Logged for diagnostics.
      console.error("[opencode-harness] Could not read CSS file:", cssPath, err)
    }
    const nonce = this.getNonce()
    // CSP Security Notes:
    // - connect-src 'none': Webview↔host uses postMessage only. CLI HTTP server
    //   (127.0.0.1:PORT) runs on extension host (Node.js), NOT in the webview.
    //   If future features need direct webview→CLI SSE, change to:
    //   `connect-src http://127.0.0.1:${port}`
    // - style-src 'unsafe-inline': Required by @vscode/webview-ui-toolkit components
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
    // Transform toolkit.min.js script — loaded via <script> tag because
    // esbuild drops the toolkit's side-effect import during bundling
    const toolkitUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "chat", "webview", "toolkit.min.js")
    )
    html = html.replace(
      '<script src="toolkit.min.js"></script>',
      `<script nonce="${nonce}" src="${toolkitUri}"></script>`
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
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    let nonce = ""
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return nonce
  }
}
