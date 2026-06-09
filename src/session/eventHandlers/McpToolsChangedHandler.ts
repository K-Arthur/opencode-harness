import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

/**
 * Normalizes the opencode `mcp.tools.changed` SDK event.
 *
 * MCP servers can connect/disconnect/reauth mid-session and each transition
 * changes the set of MCP-sourced slash commands the server exposes via
 * /command. The webview's command list used to go stale because we only
 * fetched commands at boot. Surfacing this event lets ChatProvider trigger
 * a fresh `list_commands` so the modal + inline dropdown stay in sync with
 * the MCP catalog.
 */
export class McpToolsChangedHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "mcp.tools.changed"
  }

  handle(event: SdkEventLike, _context: NormalizerContext): NormalizedOpencodeEvent[] {
    const props = event.properties as { server?: string } | undefined
    return [
      {
        type: "mcp_tools_changed",
        data: { server: props?.server },
      },
    ]
  }
}
