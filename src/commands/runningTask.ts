import * as vscode from "vscode"
import { log } from "../utils/outputChannel"
import { SessionStore } from "../session/SessionStore"
import { buildSessionPickItems, pickRunningSession, type SessionPickCandidate } from "./sessionQuickPick"

export interface RunningTaskNav {
  /** Session ids of tabs that are currently streaming. */
  getStreamingSessionIds: () => string[]
  /** Open (or focus) the session as a chat tab in the webview. */
  openSessionInWebview: (sessionId: string) => Promise<void>
}

/**
 * "OpenCode: Jump to Running Session" — one action to reach whatever the
 * agent is doing right now. 0 running → gentle pointer back to the chat;
 * 1 → jump straight there; several → Quick Pick (streaming-first ordering).
 */
export function registerJumpToRunningTaskCommand(
  context: vscode.ExtensionContext,
  sessionStore: SessionStore,
  nav: RunningTaskNav
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-harness.jumpToRunningTask", async () => {
      try {
        const pick = pickRunningSession(
          nav.getStreamingSessionIds().map((id) => ({ id, isStreaming: true }))
        )

        if (pick.kind === "none") {
          const choice = await vscode.window.showInformationMessage(
            "No OpenCode session is currently running.",
            "Open Chat"
          )
          if (choice === "Open Chat") {
            await vscode.commands.executeCommand("opencode-harness.openChat")
          }
          return
        }

        let targetId: string | undefined
        if (pick.kind === "single") {
          targetId = pick.id
        } else {
          const wanted = new Set(pick.ids)
          const known = new Map(
            sessionStore
              .list()
              .filter((s) => wanted.has(s.id))
              .map((s) => [s.id, s] as const)
          )
          const candidates: SessionPickCandidate[] = pick.ids.map((id) => {
            const s = known.get(id)
            return {
              id,
              title: s ? SessionStore.displayName(s) : "Untitled session",
              lastActiveAt: s?.lastActiveAt ?? 0,
              messageCount: s?.messages.length ?? 0,
              ...(s?.model ? { model: s.model } : {}),
              isActive: id === sessionStore.activeId,
              isStreaming: true,
            }
          })
          const picked = await vscode.window.showQuickPick(
            buildSessionPickItems(candidates, Date.now()),
            { placeHolder: "Jump to a running session", title: "OpenCode: Running Sessions" }
          )
          targetId = picked?.id
        }

        if (!targetId) return
        await vscode.commands.executeCommand("opencode-harness.chat.focus")
        await nav.openSessionInWebview(targetId)
      } catch (err) {
        log.error("Jump to running session failed", err)
        vscode.window.showErrorMessage("Failed to jump to the running session.")
      }
    })
  )
}
