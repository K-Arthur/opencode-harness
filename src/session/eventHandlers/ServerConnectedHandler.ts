import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"

export class ServerConnectedHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "server.connected" || eventType === "server.disconnected"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    return [{
      type: event.type === "server.connected" ? "server_connected" : "server_disconnected",
      data: event.properties,
    }]
  }
}
