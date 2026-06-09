import type * as vscode from "vscode"

const KEY = "opencode-skill-disabled"

export interface SkillPreferencesStoreLike {
  isEnabled(skillId: string): boolean
  setEnabled(skillId: string, enabled: boolean): void
  getDisabled(): ReadonlySet<string>
}

export class SkillPreferencesStore implements SkillPreferencesStoreLike {
  private disabled: Set<string>

  constructor(private readonly storage: Pick<vscode.Memento, "get" | "update">) {
    const raw = storage.get<string[]>(KEY, [])
    this.disabled = new Set(Array.isArray(raw) ? raw : [])
  }

  isEnabled(skillId: string): boolean {
    return !this.disabled.has(skillId)
  }

  setEnabled(skillId: string, enabled: boolean): void {
    const before = this.disabled.has(skillId)
    if (enabled) {
      if (!before) return
      this.disabled.delete(skillId)
    } else {
      if (before) return
      this.disabled.add(skillId)
    }
    void this.storage.update(KEY, Array.from(this.disabled))
  }

  getDisabled(): ReadonlySet<string> {
    return this.disabled
  }
}
