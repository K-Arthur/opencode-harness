/**
 * Schema Validator — validates LLM outputs against JSON schemas.
 *
 * Provides Zod-like validation without external dependencies.
 * Supports retry loops with validation error feedback, configurable
 * max retries with exponential backoff, and error classification.
 */

import { ValidationResult } from './types.js';

// ─── Schema Definition ──────────────────────────────────────────────────────

export type SchemaType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null';

export interface SchemaField {
  type: SchemaType;
  required?: boolean;
  items?: SchemaDefinition; // For arrays
  properties?: Record<string, SchemaField>; // For objects
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

export interface SchemaDefinition {
  type: SchemaType;
  properties?: Record<string, SchemaField>;
  required?: string[];
  items?: SchemaDefinition;
  additionalProperties?: boolean;
}

// ─── Validation Error ───────────────────────────────────────────────────────

export interface ValidationError {
  path: string;
  message: string;
  code: 'missing_field' | 'type_mismatch' | 'constraint_violation' | 'extra_field' | 'parse_error';
}

// ─── Validator Config ───────────────────────────────────────────────────────

export interface ValidatorConfig {
  maxRetries: number;
  baseDelayMs: number;
  strictMode: boolean; // Reject extra fields when true
}

const DEFAULT_CONFIG: ValidatorConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
  strictMode: false,
};

// ─── Schema Validator ───────────────────────────────────────────────────────

export class SchemaValidator {
  private config: ValidatorConfig;

  constructor(config: Partial<ValidatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Validate a response against a schema.
   * Returns a ValidationResult with parsed data or error details.
   */
  validate<T = unknown>(
    response: string,
    schema: SchemaDefinition
  ): ValidationResult<T> {
    // Step 1: Parse JSON
    let parsed: unknown;
    try {
      parsed = this.extractJson(response);
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse JSON: ${(error as Error).message}`,
        attempts: 1,
      };
    }

    // Step 2: Validate against schema
    const errors = this.validateValue(parsed, schema, '');
    if (errors.length > 0) {
      return {
        success: false,
        error: this.formatErrors(errors),
        attempts: 1,
      };
    }

    return {
      success: true,
      data: parsed as T,
      attempts: 1,
    };
  }

  /**
   * Validate with retry loop.
   * On failure, generates feedback for the LLM to correct the output.
   */
  async validateWithRetry<T = unknown>(
    response: string,
    schema: SchemaDefinition,
    retryFn: (errorFeedback: string, attempt: number) => Promise<string>
  ): Promise<ValidationResult<T>> {
    let result = this.validate<T>(response, schema);

    if (result.success) return result;

    for (let attempt = 1; attempt < this.config.maxRetries; attempt++) {
      // Generate feedback for the LLM
      const feedback = this.generateFeedback(result.error ?? 'Validation failed', schema);

      // Wait with exponential backoff
      await this.delay(this.config.baseDelayMs * Math.pow(2, attempt - 1));

      // Get corrected response
      const correctedResponse = await retryFn(feedback, attempt + 1);

      // Re-validate
      result = this.validate<T>(correctedResponse, schema);
      result.attempts = attempt + 1;

      if (result.success) return result;
    }

    return result;
  }

  /**
   * Generate a retry prompt with validation error feedback.
   */
  generateRetryPrompt(
    originalResponse: string,
    schema: SchemaDefinition,
    validationResult: ValidationResult
  ): string {
    if (validationResult.success) {
      return 'Response is valid. No correction needed.';
    }

    const feedback = this.generateFeedback(validationResult.error ?? 'Unknown error', schema);

    return `Your previous response failed validation. Please correct it.\n\n` +
      `Validation errors:\n${feedback}\n\n` +
      `Expected schema:\n${JSON.stringify(schema, null, 2)}\n\n` +
      `Your previous response:\n${originalResponse.slice(0, 2000)}\n\n` +
      `Please return a valid JSON response matching the schema exactly.`;
  }

  /**
   * Extract JSON from a response that may contain markdown or extra text.
   */
  private extractJson(response: string): unknown {
    const trimmed = response.trim();

    // Try direct parse
    try {
      return JSON.parse(trimmed);
    } catch {
      // Not needed
    }

    // Try extracting from markdown code blocks
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (codeBlockMatch?.[1]) {
      try {
        return JSON.parse(codeBlockMatch[1]);
      } catch {
        // Not needed
      }
    }

    // Try finding JSON object in text
    const startIdx = trimmed.indexOf('{');
    const endIdx = trimmed.lastIndexOf('}');
    if (startIdx !== -1 && endIdx > startIdx) {
      try {
        return JSON.parse(trimmed.slice(startIdx, endIdx + 1));
      } catch {
        // Not needed
      }
    }

    // Try finding JSON array in text
    const arrStartIdx = trimmed.indexOf('[');
    const arrEndIdx = trimmed.lastIndexOf(']');
    if (arrStartIdx !== -1 && arrEndIdx > arrStartIdx) {
      try {
        return JSON.parse(trimmed.slice(arrStartIdx, arrEndIdx + 1));
      } catch {
        // Not needed
      }
    }

    throw new Error('No valid JSON found in response');
  }

  /**
   * Validate a value against a schema definition.
   */
  private validateValue(
    value: unknown,
    schema: SchemaDefinition,
    path: string
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    // Type check
    const actualType = this.getType(value);
    if (actualType !== schema.type) {
      errors.push({
        path: path || 'root',
        message: `Expected type "${schema.type}" but got "${actualType}"`,
        code: 'type_mismatch',
      });
      return errors; // Can't validate further if type is wrong
    }

    // Object validation
    if (schema.type === 'object' && typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;

      // Check required fields
      if (schema.required) {
        for (const field of schema.required) {
          if (!(field in obj)) {
            errors.push({
              path: path ? `${path}.${field}` : field,
              message: `Missing required field "${field}"`,
              code: 'missing_field',
            });
          }
        }
      }

      // Validate properties
      if (schema.properties) {
        for (const [key, fieldSchema] of Object.entries(schema.properties)) {
          if (key in obj) {
            const fieldErrors = this.validateValue(
              obj[key],
              fieldSchema as SchemaDefinition,
              path ? `${path}.${key}` : key
            );
            errors.push(...fieldErrors);
          } else if (fieldSchema.required) {
            errors.push({
              path: path ? `${path}.${key}` : key,
              message: `Missing required field "${key}"`,
              code: 'missing_field',
            });
          }
        }
      }

      // Check for extra fields in strict mode
      if (this.config.strictMode && schema.properties && schema.additionalProperties === false) {
        const allowedKeys = new Set(Object.keys(schema.properties));
        for (const key of Object.keys(obj)) {
          if (!allowedKeys.has(key)) {
            errors.push({
              path: path ? `${path}.${key}` : key,
              message: `Unexpected field "${key}" (not allowed in strict mode)`,
              code: 'extra_field',
            });
          }
        }
      }
    }

    // Array validation
    if (schema.type === 'array' && Array.isArray(value) && schema.items) {
      for (let i = 0; i < value.length; i++) {
        const itemErrors = this.validateValue(
          value[i],
          schema.items,
          `${path}[${i}]`
        );
        errors.push(...itemErrors);
      }
    }

    // String constraints
    if (schema.type === 'string' && typeof value === 'string') {
      const fieldSchema = schema as unknown as SchemaField;
      if (fieldSchema.minLength && value.length < fieldSchema.minLength) {
        errors.push({
          path: path || 'root',
          message: `String length ${value.length} is less than minimum ${fieldSchema.minLength}`,
          code: 'constraint_violation',
        });
      }
      if (fieldSchema.maxLength && value.length > fieldSchema.maxLength) {
        errors.push({
          path: path || 'root',
          message: `String length ${value.length} exceeds maximum ${fieldSchema.maxLength}`,
          code: 'constraint_violation',
        });
      }
      if (fieldSchema.pattern && !new RegExp(fieldSchema.pattern).test(value)) {
        errors.push({
          path: path || 'root',
          message: `String does not match pattern "${fieldSchema.pattern}"`,
          code: 'constraint_violation',
        });
      }
      if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
        errors.push({
          path: path || 'root',
          message: `Value "${value}" is not one of allowed values: ${JSON.stringify(fieldSchema.enum)}`,
          code: 'constraint_violation',
        });
      }
    }

    // Number constraints
    if (schema.type === 'number' && typeof value === 'number') {
      const fieldSchema = schema as unknown as SchemaField;
      if (fieldSchema.minimum !== undefined && value < fieldSchema.minimum) {
        errors.push({
          path: path || 'root',
          message: `Value ${value} is less than minimum ${fieldSchema.minimum}`,
          code: 'constraint_violation',
        });
      }
      if (fieldSchema.maximum !== undefined && value > fieldSchema.maximum) {
        errors.push({
          path: path || 'root',
          message: `Value ${value} exceeds maximum ${fieldSchema.maximum}`,
          code: 'constraint_violation',
        });
      }
    }

    return errors;
  }

  /**
   * Get the schema type of a JavaScript value.
   */
  private getType(value: unknown): SchemaType {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value as SchemaType;
  }

  /**
   * Format validation errors for display.
   */
  private formatErrors(errors: ValidationError[]): string {
    return errors
      .map((e) => `- ${e.path}: ${e.message} [${e.code}]`)
      .join('\n');
  }

  /**
   * Generate feedback for the LLM to correct validation errors.
   */
  private generateFeedback(errorSummary: string, schema: SchemaDefinition): string {
    return `The response failed validation with the following errors:\n\n${errorSummary}\n\n` +
      `Please ensure your response:\n` +
      `1. Is valid JSON (no markdown, no extra text)\n` +
      `2. Contains all required fields: ${(schema.required ?? []).join(', ')}\n` +
      `3. Uses the correct types for each field\n` +
      `4. Does not include extra fields`;
  }

  /**
   * Delay utility for retry backoff.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
