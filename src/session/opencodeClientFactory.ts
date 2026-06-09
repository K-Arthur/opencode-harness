import { createOpencodeClient as sdkCreateOpencodeClient, type OpencodeClient, type OpencodeClientConfig } from "@opencode-ai/sdk"

export type CreateOpencodeClient = (config?: OpencodeClientConfig & { directory?: string }) => OpencodeClient

export function createOpencodeClient(config?: OpencodeClientConfig & { directory?: string }): OpencodeClient {
  return sdkCreateOpencodeClient(config)
}
