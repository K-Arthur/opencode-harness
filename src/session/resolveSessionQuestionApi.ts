import type { V2OpencodeClient } from "./opencodeClientFactory"

export interface SessionQuestionApi {
  reply: (params: Record<string, unknown>) => Promise<Record<string, unknown>>
  reject: (params: Record<string, unknown>) => Promise<Record<string, unknown>>
}

/**
 * Resolve the session-scoped question API on the v2 SDK client.
 *
 * The v0.3.73 crash ("Cannot read properties of undefined (reading 'reply')")
 * happened because the code read `client.session.question` — but the SDK's
 * `OpencodeClient.session` returns `Session2`, which has NO `question`
 * getter. The session-scoped question API lives under `client.v2.session`
 * (Session3 → Question2 → POST /api/session/{sessionID}/question/{requestID}/reply).
 *
 * The v0.3.76 crash ("Cannot read properties of undefined (reading 'post')")
 * happened because `reply`/`reject` were extracted as bare function
 * references and returned in a plain `{ reply, reject }` object. The SDK's
 * generated methods read `this.client` internally (e.g.
 * `this.client.post(...)`); calling `api.reply(...)` then runs with `this`
 * bound to the `{ reply, reject }` wrapper — which has no `.client` — instead
 * of the real `question` instance. Binding to `question` below preserves the
 * receiver regardless of how the caller invokes the returned functions.
 *
 * This helper centralises the path resolution and throws a CLEAR, searchable
 * error if the SDK shape ever drifts, instead of a cryptic TypeError that
 * leaves the user with a stuck question bar and no recourse.
 */
export function resolveSessionQuestionApi(client: V2OpencodeClient): SessionQuestionApi {
  const v2 = (client as { v2?: unknown }).v2
  if (!v2 || typeof v2 !== "object") {
    throw new Error(
      "Question API unavailable: SDK client does not expose the v2 session namespace. " +
        "Update @opencode-ai/sdk and reload the window.",
    )
  }
  const session = (v2 as { session?: unknown }).session
  if (!session || typeof session !== "object") {
    throw new Error(
      "Question API unavailable: SDK client does not expose v2.session. " +
        "Update @opencode-ai/sdk and reload the window.",
    )
  }
  const question = (session as { question?: unknown }).question
  if (!question || typeof question !== "object") {
    throw new Error(
      "Question API unavailable: SDK client does not expose v2.session.question. " +
        "Update @opencode-ai/sdk and reload the window.",
    )
  }
  const reply = (question as { reply?: unknown }).reply
  const reject = (question as { reject?: unknown }).reject
  if (typeof reply !== "function" || typeof reject !== "function") {
    throw new Error(
      "Question API unavailable: SDK v2.session.question.reply/reject are not callable. " +
        "Update @opencode-ai/sdk and reload the window.",
    )
  }
  return {
    reply: (reply as (params: Record<string, unknown>) => Promise<Record<string, unknown>>).bind(question),
    reject: (reject as (params: Record<string, unknown>) => Promise<Record<string, unknown>>).bind(question),
  }
}
