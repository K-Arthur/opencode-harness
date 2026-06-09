/**
 * Generate a stable webview-side ID with a prefix.
 *
 * Uses crypto.randomUUID when available (VS Code webview, modern browsers)
 * and falls back to a timestamp + random string for environments where
 * crypto.randomUUID is undefined.
 */
export function createWebviewId(prefix: string): string {
  const randomUUID = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID
  const id = randomUUID
    ? randomUUID.call(globalThis.crypto)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${id}`
}
