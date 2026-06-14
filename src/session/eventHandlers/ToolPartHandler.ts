import { SdkEventLike, NormalizedOpencodeEvent, PartLike, ToolPartLike, NormalizerContext, EventHandler } from "./types"

export class ToolPartHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "message.part.updated"
  }

  private stableToolId(toolPart: ToolPartLike): string {
    return toolPart.id || toolPart.callID || `${toolPart.messageID || ""}:${toolPart.tool || "tool"}`
  }

  private stringify(value: unknown): string {
    return value === undefined ? "" : JSON.stringify(value)
  }

  /**
   * Sprint 2 / M1: defensively extract exit code from the SDK's free-form
   * `state.metadata` bag. The opencode server's bash tool convention isn't
   * pinned in the SDK types, so try the common key variants. Returns
   * undefined for missing/non-numeric values (the webview falls back to
   * regex parsing the output text via commandModel.readExitCode).
   */
  private extractExitCode(meta: Record<string, unknown> | undefined): number | undefined {
    if (!meta) return undefined
    const v = meta.exit_code ?? meta.exitCode ?? meta.exit ?? meta.status
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string") {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
    return undefined
  }

  /**
   * Sprint 2 / M1: defensively extract stderr stream from `state.metadata`.
   * Some servers ship both stdout and stderr in the single `output` string
   * (which the webview continues to render as a single combined block);
   * when the server DOES split them, this surfaces the split so the
   * bash-card renderer's stdout/stderr panels light up.
   */
  private extractStderr(meta: Record<string, unknown> | undefined): string | undefined {
    if (!meta) return undefined
    const v = meta.stderr ?? meta.error_output ?? meta.err
    return typeof v === "string" && v.length > 0 ? v : undefined
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const props = event.properties as { part?: PartLike } | undefined
    const part = props?.part
    if (!part || part.type !== "tool") return out

    const toolPart = part as ToolPartLike
    const statusKey = this.stableToolId(toolPart)
    const status = toolPart.state?.status

    if (toolPart.id) {
      context.partStatusKeys.set(toolPart.id, statusKey)
    }
    if (toolPart.callID) {
      context.partStatusKeys.set(toolPart.callID, statusKey)
    }

    const inputStr = this.stringify(toolPart.state?.input)
    const outputStr = this.stringify(toolPart.state?.output ?? toolPart.state?.error ?? "")
    const prevStatus = context.toolStatuses.get(statusKey)
    const prevInput = context.toolInputs.get(statusKey)
    const prevOutput = context.toolOutputs.get(statusKey)
    const alreadyStarted = context.toolStartedIds.has(statusKey)
    const statusChanged = prevStatus !== status
    const inputChanged = prevInput !== inputStr
    const outputChanged = prevOutput !== outputStr

    if (!statusChanged && !inputChanged && !outputChanged && status !== "completed" && status !== "error") {
      return out
    }

    if (status) context.toolStatuses.set(statusKey, status)
    context.toolInputs.set(statusKey, inputStr)
    context.toolOutputs.set(statusKey, outputStr)

    if (status === "pending" || status === "running") {
      if (!alreadyStarted) {
        context.toolStartedIds.add(statusKey)
        out.push({
          type: "tool_start",
          sessionId: toolPart.sessionID,
          data: { id: statusKey, tool: toolPart.tool, input: toolPart.state?.input, status },
        })
      } else if (statusChanged || inputChanged) {
        out.push({
          type: "tool_update",
          sessionId: toolPart.sessionID,
          data: { id: statusKey, tool: toolPart.tool, input: toolPart.state?.input, status },
        })
      }
    } else if (status === "completed" || status === "error") {
      if (!statusChanged && !outputChanged) return out
      // M1: defensively extract duration / exit code / stderr from the
      // free-form state bag so the bash card can light up its exit-code
      // chip, its stdout/stderr split panels, and the live duration. All
      // of these were defined on the wire type but never populated before.
      const stateRec = (toolPart.state ?? {}) as Record<string, unknown>
      const meta = typeof stateRec.metadata === "object" && stateRec.metadata !== null
        ? stateRec.metadata as Record<string, unknown>
        : undefined
      const time = stateRec.time as { start?: number; end?: number } | undefined
      const durationMs = time && typeof time.start === "number" && typeof time.end === "number"
        ? time.end - time.start
        : undefined
      out.push({
        type: "tool_end",
        sessionId: toolPart.sessionID,
        data: {
          id: statusKey,
          tool: toolPart.tool,
          ok: status === "completed",
          result: toolPart.state?.output ?? toolPart.state?.error ?? "",
          durationMs,
          exitCode: this.extractExitCode(meta),
          stderr: this.extractStderr(meta),
        },
      })
    }

    return out
  }
}
