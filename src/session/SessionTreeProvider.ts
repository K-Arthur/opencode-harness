import * as vscode from "vscode"
import { SessionStore, type OpenCodeSession } from "./SessionStore"

export class SessionTreeProvider implements vscode.TreeDataProvider<OpenCodeSession> {
  private _onDidChangeTreeData = new vscode.EventEmitter<OpenCodeSession | undefined | void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event
  private readonly disposables: vscode.Disposable[]

  constructor(private readonly sessionStore: SessionStore) {
    this.disposables = [
      this.sessionStore.onSessionsChanged(() => this.refresh()),
      this.sessionStore.onActiveSessionChanged(() => this.refresh()),
    ]
  }

  getTreeItem(session: OpenCodeSession): vscode.TreeItem {
    const item = new vscode.TreeItem(session.name, vscode.TreeItemCollapsibleState.None)
    item.description = session.id === this.sessionStore.activeId ? "active" : `${session.messages.length} messages`
    item.tooltip = `${session.name}\n${session.messages.length} messages\nLast active: ${new Date(session.lastActiveAt).toLocaleString()}`
    item.contextValue = "opencodeSession"
    item.command = {
      command: "opencode-harness.openStoredSession",
      title: "Open Session",
      arguments: [session.id],
    }
    return item
  }

  getChildren(): OpenCodeSession[] {
    return this.sessionStore.list()
  }

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose()
    }
    this._onDidChangeTreeData.dispose()
  }
}
