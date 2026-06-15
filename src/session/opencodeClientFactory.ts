import { createOpencodeClient as sdkCreateOpencodeClient, type OpencodeClient, type OpencodeClientConfig } from "@opencode-ai/sdk"
import {
  createOpencodeClient as sdkCreateV2Client,
  type OpencodeClient as V2OpencodeClient,
  type OpencodeClientConfig as V2OpencodeClientConfig,
} from "@opencode-ai/sdk/v2/client"

export type CreateOpencodeClient = (config?: OpencodeClientConfig & { directory?: string }) => OpencodeClient

export function createOpencodeClient(config?: OpencodeClientConfig & { directory?: string }): OpencodeClient {
  return sdkCreateOpencodeClient(config)
}

// --- v2 client (strangler migration) -------------------------------------------------
// The v2 SDK exposes namespaced APIs not present on v1 (e.g. `question.reply`/`reject`).
// We stand it up here as the single SDK touch point; AuthProvider builds it from the same
// baseUrl + auth as the v1 client so the two can never drift on connection/auth.
export type CreateV2Client = (config?: V2OpencodeClientConfig & { directory?: string }) => V2OpencodeClient

export function createV2Client(config?: V2OpencodeClientConfig & { directory?: string }): V2OpencodeClient {
  return sdkCreateV2Client(config)
}

export type { V2OpencodeClient }
