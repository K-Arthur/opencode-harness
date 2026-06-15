import {
  createOpencodeClient as sdkCreateV2Client,
  type OpencodeClient as V2OpencodeClient,
  type OpencodeClientConfig as V2OpencodeClientConfig,
} from "@opencode-ai/sdk/v2/client"

export type CreateV2Client = (config?: V2OpencodeClientConfig & { directory?: string }) => V2OpencodeClient

export function createV2Client(config?: V2OpencodeClientConfig & { directory?: string }): V2OpencodeClient {
  return sdkCreateV2Client(config)
}

export type { V2OpencodeClient }
