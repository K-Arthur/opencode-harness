import * as vscode from "vscode"
import { log } from "./outputChannel"

// Sensitive file patterns that should trigger warnings
const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /\.env$/i,
  /\.env\./i,
  /credentials\.json$/i,
  /credentials\.ts$/i,
  /credentials\.js$/i,
  /id_rsa$/i,
  /id_dsa$/i,
  /\.pem$/i,
  /config\.json$/i,
  /secrets?\./i,
  /\.key$/i,
  /api[-_]?key/i,
  /password/i,
  /\.aws\/credentials/i,
  /\.ssh\/id_/i,
  /oauth.*token/i,
  /refresh.*token/i,
]

// Prompt injection patterns to detect in file contents
const INJECTION_PATTERNS: RegExp[] = [
  /ignore.*previous.*instructions/i,
  /you are now/i,
  /system.*prompt/i,
  /<\|system\|>/i,
  /<\/\|system\|>/i,
  /act as (an? |the )/i,
  /pretend (to be|you are)/i,
  /forget (all|your) (instructions|training|constraints)/i,
]

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
  const fileName = uri.fsPath.split('/').pop() || ''
  return SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(fileName))
}

/**
 * Check if file content contains potential prompt injection patterns
 */
export function containsInjectionPattern(content: string): boolean {
  // Only check first 10KB to avoid performance issues
  const sample = content.slice(0, 10240)
  return INJECTION_PATTERNS.some(pattern => pattern.test(sample))
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
  const fileName = uri.fsPath.split('/').pop() || ''
  for (const pattern of SENSITIVE_FILE_PATTERNS) {
    if (pattern.test(fileName)) {
      result.isSensitive = true
      result.sensitivePatterns.push(pattern.source)
    }
  }

  // Check content for injection patterns
  try {
    const content = await vscode.workspace.fs.readFile(uri)
    const text = Buffer.from(content).toString('utf8')
    
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text.slice(0, 10240))) {
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
    
    // Check for HTTPS in production (allow localhost HTTP for dev)
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && !parsed.hostname.startsWith('127.')) {
      return {
        valid: true,
        warning: 'Warning: Using HTTP instead of HTTPS. Consider using a secure connection.'
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
