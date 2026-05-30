import * as vscode from "vscode"
import * as path from "path"
import { log } from "./outputChannel"

// Sensitive file patterns that should trigger warnings
const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /\.env$/i,
  /\.env\./i,
  /\.npmrc$/i,
  /\.netrc$/i,
  /\.pgpass$/i,
  /\.s3cfg$/i,
  /\.git-credentials$/i,
  /credentials\.json$/i,
  /credentials\.ts$/i,
  /credentials\.js$/i,
  /service[-_]?account.*\.json$/i,
  /id_rsa$/i,
  /id_dsa$/i,
  /id_ed25519$/i,
  /\.p12$/i,
  /\.cer$/i,
  /\.pem$/i,
  /\.pgp$/i,
  /\.tfvars$/i,
  /config\.json$/i,
  /secrets?\./i,
  /secrets?\.ya?ml$/i,
  /\.key$/i,
  /api[-_]?key/i,
  /token/i,
  /password/i,
  /\.aws\/credentials/i,
  /\.ssh\/id_/i,
  /oauth.*token/i,
  /refresh.*token/i,
]

// Prompt injection patterns to detect in file contents
const INJECTION_PATTERNS: RegExp[] = [
  /ignore[\s\S]{0,200}(previous|above|all)[\s\S]{0,200}instructions/i,
  /you are now/i,
  /system[\s\S]{0,120}prompt/i,
  /<\|system\|>/i,
  /<\/\|system\|>/i,
  /act as (an? |the )/i,
  /pretend (to be|you are)/i,
  /forget (all|your) (instructions|training|constraints)/i,
  /developer[\s\S]{0,120}message/i,
  /reveal[\s\S]{0,120}(system|developer)[\s\S]{0,120}(prompt|message)/i,
]

const SECURITY_SCAN_CHAR_MAP: Record<string, string> = {
  "\u0430": "a",
  "\u0435": "e",
  "\u043E": "o",
  "\u0440": "p",
  "\u0441": "c",
  "\u0443": "y",
  "\u0445": "x",
}

export interface SecurityCheckResult {
  isSensitive: boolean
  sensitivePatterns: string[]
  hasInjectionRisk: boolean
  injectionPatterns: string[]
}

/**
 * Check if a file is potentially sensitive based on its filename/path
 */
export function isSensitiveFile(uri: vscode.Uri): boolean {
  const normalizedPath = uri.fsPath.replace(/\\/g, "/")
  const fileName = path.basename(normalizedPath)
  return SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(fileName) || pattern.test(normalizedPath))
}

/**
 * Check if file content contains potential prompt injection patterns
 */
export function containsInjectionPattern(content: string): boolean {
  const normalized = normalizeSecurityScanText(content)
  return INJECTION_PATTERNS.some(pattern => pattern.test(normalized))
}

export function normalizeSecurityScanText(content: string): string {
  return content.normalize("NFKC").replace(/[\u0430\u0435\u043E\u0440\u0441\u0443\u0445]/g, (char) => SECURITY_SCAN_CHAR_MAP[char] ?? char)
}

/**
 * Perform comprehensive security check on a file
 */
export async function checkFileSecurity(uri: vscode.Uri): Promise<SecurityCheckResult> {
  const result: SecurityCheckResult = {
    isSensitive: false,
    sensitivePatterns: [],
    hasInjectionRisk: false,
    injectionPatterns: [],
  }

  // Check filename patterns
  const fileName = path.basename(uri.fsPath)
  for (const pattern of SENSITIVE_FILE_PATTERNS) {
    if (pattern.test(fileName)) {
      result.isSensitive = true
      result.sensitivePatterns.push(pattern.source)
    }
  }

  // Check content for injection patterns
  try {
    const content = await vscode.workspace.fs.readFile(uri)
    const text = normalizeSecurityScanText(Buffer.from(content).toString("utf8"))
    
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        result.hasInjectionRisk = true
        result.injectionPatterns.push(pattern.source)
      }
    }
  } catch (err) {
    log.warn(`Failed to read file for security check: ${uri.fsPath}`, err)
  }

  return result
}

/**
 * Sanitize file content before sending to AI
 * Adds clear delimiters to distinguish user content from system prompts
 */
export function sanitizeForPrompt(content: string, fileName: string): string {
  return `
----- BEGIN USER FILE: ${fileName} -----
${content}
----- END USER FILE: ${fileName} -----
`.trim()
}

/**
 * Validate remote server URL for security
 */
export function validateServerUrl(url: string): { valid: boolean; warning?: string } {
  const trimmed = url.trim()
  
  if (!trimmed) {
    return { valid: true }
  }

  try {
    const parsed = new URL(trimmed)
    const isLocalhost = parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname.endsWith(".localhost")

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, warning: "Remote server URL must use http or https" }
    }
    
    // Require HTTPS for remote hosts. Loopback HTTP is allowed for local dev.
    if (parsed.protocol !== "https:" && !isLocalhost) {
      return {
        valid: false,
        warning: "Remote server URLs must use HTTPS unless the host is localhost or loopback."
      }
    }
    
    return { valid: true }
  } catch {
    return { valid: false, warning: 'Invalid URL format' }
  }
}

/**
 * Get a human-readable list of sensitive file types for user warnings
 */
export function getSensitiveFileTypes(): string[] {
  return [
    '.env (environment variables)',
    'credentials.json (API keys, tokens)',
    'id_rsa, id_dsa (SSH private keys)',
    '*.pem (certificates, private keys)',
    '*.key (encryption keys)',
    'config.json (configuration with secrets)',
  ]
}
