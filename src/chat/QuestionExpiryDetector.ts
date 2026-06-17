/**
 * QuestionExpiryDetector — categorizes question reply/reject failures and
 * detects stale questions that have likely expired on the server.
 *
 * Root cause: The server may expire unanswered questions after an internal
 * TTL. When the extension tries to reply to an expired question, the server
 * returns "Question request not found". This module detects that pattern and
 * categorizes the error so callers can present the right UX (retry vs. give
 * up vs. continue without answer).
 *
 * @module QuestionExpiryDetector
 */

/** Time after which an unanswered question is considered likely stale. */
export const STALENESS_WARNING_MS = 5 * 60 * 1000 // 5 minutes

export type ErrorCategory = "expired" | "transient" | "server_rejected" | "unknown"

export interface QuestionReplyErrorClassification {
  category: ErrorCategory
  userFacingMessage: string
  retryable: boolean
  technicalDetail: string
}

export interface QuestionExpiryContext {
  createdAt: number
  answered: boolean
  thresholdMs?: number
}

/** Patterns that indicate the server no longer knows about this question. */
const EXPIRED_PATTERNS = [
  /Question\.NotFoundError/i, // Server-side Effect tagged error class
  /QuestionNotFoundError/i, // JSON-serialized variant
  /_tag.*Question.*NotFound/i, // Serialized _tag field
  /question\s+request\s+not\s+found/i,
  /request\s+not\s+found/i,
  /unknown\s+request/i,
  /question\s+not\s+found/i,
  /reply\s+for\s+unknown\s+request/i, // Server log message
  /reject\s+for\s+unknown\s+request/i,
  /requestID.*not\s+found/i,
  /not\s+found.*requestID/i,
]

/** Patterns that indicate transient/network errors (retryable). */
const TRANSIENT_PATTERNS = [
  /econnrefused/i,
  /econnreset/i,
  /etimedout/i,
  /enotfound/i,
  /enetunreach/i,
  /fetch\s+failed/i,
  /socket\s+hang\s+up/i,
  /timeout/i,
  /network/i,
  /5\d{2}\s/, // 5xx HTTP status
  /internal\s+server\s+error/i,
]

/** Patterns that indicate server-side rejection (non-retryable). */
const SERVER_REJECTED_PATTERNS = [
  /4\d{2}\s/, // 4xx HTTP status (but not 404 which is "not found" = expired)
  /bad\s+request/i,
  /forbidden/i,
  /unauthorized/i,
]

/**
 * Categorize an error from a question reply/reject SDK call.
 *
 * Returns a classification with user-facing message, retryability, and
 * the original technical detail for logging.
 */
export function categorizeQuestionReplyError(
  error: unknown,
): QuestionReplyErrorClassification {
  const raw = extractErrorString(error)
  const technicalDetail = raw

  if (!raw) {
    return {
      category: "unknown",
      userFacingMessage: "Failed to send your answer. Please try again.",
      retryable: false,
      technicalDetail: "null/undefined error",
    }
  }

  // Check expired first (highest specificity)
  if (EXPIRED_PATTERNS.some((p) => p.test(raw))) {
    return {
      category: "expired",
      userFacingMessage:
        "This question has expired on the server. The model can continue without your answer.",
      retryable: false,
      technicalDetail,
    }
  }

  // Check transient (retryable)
  if (TRANSIENT_PATTERNS.some((p) => p.test(raw))) {
    return {
      category: "transient",
      userFacingMessage:
        "Could not send your answer due to a network issue. You can retry.",
      retryable: true,
      technicalDetail,
    }
  }

  // Check server rejection (non-retryable 4xx)
  if (SERVER_REJECTED_PATTERNS.some((p) => p.test(raw))) {
    return {
      category: "server_rejected",
      userFacingMessage:
        "The server rejected your answer. This may indicate an incompatible answer format.",
      retryable: false,
      technicalDetail,
    }
  }

  return {
    category: "unknown",
    userFacingMessage: "Failed to send your answer. Please try again.",
    retryable: false,
    technicalDetail,
  }
}

/**
 * Check whether a question is likely stale/expired based on its age.
 *
 * Returns `true` when the question has been pending longer than the
 * staleness threshold. Answered questions are never considered stale.
 * Questions with unknown creation time (createdAt=0) are never flagged.
 */
export function isQuestionExpired(
  ctx: QuestionExpiryContext,
  thresholdMs?: number,
): boolean {
  if (ctx.answered) return false
  if (ctx.createdAt === 0) return false
  const threshold = thresholdMs ?? ctx.thresholdMs ?? STALENESS_WARNING_MS
  return Date.now() - ctx.createdAt > threshold
}

/** Extract a searchable string from an unknown error value. */
function extractErrorString(error: unknown): string {
  if (error === null || error === undefined) return ""
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
