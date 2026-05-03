import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"

export class SkillManager implements vscode.TreeDataProvider<{ id: string; name: string; description: string; enabled: boolean; filePath: string; isBuiltIn: boolean }> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>()
  onDidChangeTreeData = this._onDidChangeTreeData.event

  private skills: { id: string; name: string; description: string; enabled: boolean; filePath: string; isBuiltIn: boolean }[] = []

  constructor() { this.refresh() }

  getTreeItem(element: { id: string; name: string; description: string; enabled: boolean }): vscode.TreeItem {
    const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None)
    item.description = element.description
    item.iconPath = new vscode.ThemeIcon(element.enabled ? "check" : "circle-slash")
    item.contextValue = element.enabled ? "enabled-skill" : "disabled-skill"
    return item
  }

  getChildren(): { id: string; name: string; description: string; enabled: boolean; filePath: string; isBuiltIn: boolean }[] {
    return this.skills
  }

  async refresh(): Promise<void> {
    this.skills = await this.discoverSkills()
    this._onDidChangeTreeData.fire()
  }

  private async discoverSkills(): Promise<{ id: string; name: string; description: string; enabled: boolean; filePath: string; isBuiltIn: boolean }[]> {
    const items: typeof this.skills = []
    const homeDir = process.env.HOME || process.env.USERPROFILE || ""
    const skillDirs = [
      path.join(homeDir, ".agents", "skills"),
      path.join(homeDir, ".opencode", "skills"),
    ]
    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length > 0) skillDirs.push(path.join(folders[0].uri.fsPath, ".opencode", "skills"))

    for (const dir of skillDirs) {
      try {
        if (!fs.existsSync(dir)) continue
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillMd = path.join(dir, entry.name, "SKILL.md")
            if (fs.existsSync(skillMd)) {
              const content = fs.readFileSync(skillMd, "utf8")
              const firstLine = content.split("\n")[0].replace(/^#\s*/, "")
              items.push({ id: entry.name, name: entry.name, description: firstLine || "No description", enabled: true, filePath: skillMd, isBuiltIn: dir.includes(".agents") })
            }
          }
        }
      } catch { /* skip */ }
    }
    return items
  }

  async enableSkill(skillId: string): Promise<void> {
    const skill = this.skills.find((s) => s.id === skillId)
    if (skill) { skill.enabled = true; this._onDidChangeTreeData.fire() }
  }

  async disableSkill(skillId: string): Promise<void> {
    const skill = this.skills.find((s) => s.id === skillId)
    if (skill) { skill.enabled = false; this._onDidChangeTreeData.fire() }
  }

  dispose(): void { this._onDidChangeTreeData.dispose() }
}
