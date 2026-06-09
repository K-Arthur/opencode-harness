/**
 * Generates an opencode-compatible user message id.
 *
 * opencode (server v1.16.2+) validates the user message `id` with
 * `Identifier.schema("message")` — a Zod refine that rejects anything not starting
 * with "msg" ("Expected a string starting with \"msg\""). It also relies on ids being
 * time-ordered: `session.messages()` and our backfill list/sort by id.
 *
 * This mirrors opencode's `Identifier.ascending("message")` exactly so client-generated
 * user-message ids sort correctly against the server-generated assistant ids that follow
 * (the opencode server runs on localhost, so it shares this clock):
 *
 *   prefix "_" + 12 lowercase-hex chars (low 48 bits of `Date.now() * 0x1000 + counter`,
 *   big-endian) + 14 base62 random chars  →  total 26 chars after the prefix.
 *
 * Source: sst/opencode `packages/opencode/src/id/id.ts`.
 *
 * Isomorphic: the id originates in the chat webview (where it is reused as the local
 * optimistic bubble id) AND must equal the id sent to the server, so this module is
 * imported by both the webview and the extension-host bundles. It therefore relies on
 * the Web Crypto API (`globalThis.crypto.getRandomValues`, present in VS Code webviews
 * and Node 19+) rather than node's `crypto.randomBytes`.
 */

const PREFIX = "msg"
/** Total id length excluding the "<prefix>_" — 12 hex (time) + 14 random = 26. */
const ID_LENGTH = 26
const TIME_HEX_LENGTH = 12
const RANDOM_LENGTH = ID_LENGTH - TIME_HEX_LENGTH
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const TIME_MASK_48 = (1n << 48n) - 1n

let lastTimestamp = 0
let counter = 0

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length)
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(out)
    return out
  }
  // Fallback for environments without Web Crypto. The time-ordered prefix already
  // guarantees ordering; this only needs to avoid same-millisecond collisions.
  for (let i = 0; i < length; i++) out[i] = (Math.random() * 256) | 0
  return out
}

function randomBase62(length: number): string {
  const bytes = randomBytes(length)
  let result = ""
  for (let i = 0; i < length; i++) {
    // bytes[i] is always defined for i < length (randomBytes returns `length` bytes).
    result += BASE62[(bytes[i] as number) % 62]
  }
  return result
}

export function generateUserMessageId(): string {
  const currentTimestamp = Date.now()
  if (currentTimestamp !== lastTimestamp) {
    lastTimestamp = currentTimestamp
    counter = 0
  }
  counter++

  // Ascending: use the packed value directly (descending would apply bitwise NOT).
  const now = (BigInt(currentTimestamp) * 0x1000n + BigInt(counter)) & TIME_MASK_48
  const timeHex = now.toString(16).padStart(TIME_HEX_LENGTH, "0")

  return `${PREFIX}_${timeHex}${randomBase62(RANDOM_LENGTH)}`
}
