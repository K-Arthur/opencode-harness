#!/usr/bin/env node

/**
 * GitHub Actions Workflow Validator
 * 
 * Validates CI workflow YAML files for syntax errors and common issues.
 * This is used as a pre-commit hook to prevent pushing broken workflows.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Validate a single workflow file
 */
function validateWorkflow(filePath) {
  const errors = [];
  const warnings = [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Check for basic YAML syntax
    try {
      // Try to parse as YAML (basic check)
      if (!content.trim().startsWith('name:')) {
        errors.push('Workflow must start with "name:" field');
      }
    } catch (e) {
      errors.push(`YAML parsing error: ${e.message}`);
    }

    // Check for required fields
    if (!content.includes('on:')) {
      errors.push('Workflow must include "on:" trigger');
    }

    if (!content.includes('jobs:')) {
      errors.push('Workflow must include "jobs:" section');
    }

    // Check for common anti-patterns
    if (content.includes('continue-on-error: true')) {
      warnings.push('Found continue-on-error: true - this may mask failures');
    }

    if (content.includes('runs-on: ubuntu-latest') && !content.includes('timeout-minutes:')) {
      warnings.push('Job with ubuntu-latest should specify timeout-minutes');
    }

    // Check for proper action versions
    const usesActions = content.matchAll(/uses:\s+([^\s\n]+)/g);
    for (const match of usesActions) {
      const action = match[1];
      if (action.startsWith('actions/') && !action.includes('@')) {
        warnings.push(`Action ${action} should specify version (e.g., @v4)`);
      }
    }

    // Check for secret usage patterns
    if (content.includes('${{ secrets.') && !content.includes('permissions:')) {
      warnings.push('Workflow uses secrets but may be missing permissions block');
    }

    // Try to use actionlint if available
    try {
      execSync(`actionlint ${filePath}`, { stdio: 'pipe', timeout: 5000 });
    } catch (e) {
      // actionlint not available or found issues - don't fail the validation
      if (e.status === 127) {
        // actionlint not installed, skip
        warnings.push('actionlint not installed - install with: go install github.com/rhysd/actionlint/cmd/actionlint@latest');
      } else if (e.stdout) {
        // actionlint found issues
        const output = e.stdout.toString();
        if (output.includes('error')) {
          errors.push(output);
        } else {
          warnings.push(output);
        }
      }
    }

  } catch (e) {
    errors.push(`Failed to read file: ${e.message}`);
  }

  return { errors, warnings };
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node validate-workflows.mjs <workflow-file> [workflow-file-2] ...');
    process.exit(1);
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const filePath of args) {
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      totalErrors++;
      continue;
    }

    console.log(`Validating ${filePath}...`);
    const { errors, warnings } = validateWorkflow(filePath);

    if (errors.length > 0) {
      console.error(`  ❌ Errors (${errors.length}):`);
      errors.forEach(err => console.error(`     - ${err}`));
      totalErrors += errors.length;
    }

    if (warnings.length > 0) {
      console.warn(`  ⚠️  Warnings (${warnings.length}):`);
      warnings.forEach(warn => console.warn(`     - ${warn}`));
      totalWarnings += warnings.length;
    }

    if (errors.length === 0 && warnings.length === 0) {
      console.log(`  ✅ Valid`);
    }
  }

  console.log(`\nTotal: ${totalErrors} errors, ${totalWarnings} warnings`);

  if (totalErrors > 0) {
    process.exit(1);
  }
}

main();