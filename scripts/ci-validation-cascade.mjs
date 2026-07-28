#!/usr/bin/env node

/**
 * CI Validation Cascade
 * 
 * Runs a comprehensive validation cascade for CI/CD changes:
 * 1. YAML Syntactic Integrity
 * 2. Local act Runner Test
 * 3. Secret/Env Variable Audit
 * 4. Log Extraction Tooling Check
 * 
 * This ensures all CI/CD changes are validated before pushing.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALIDATION_STAGES = {
  YAML_SYNTAX: 'YAML Syntactic Integrity',
  ACT_TEST: 'Local act Runner Test',
  SECRET_AUDIT: 'Secret/Env Variable Audit',
  LOG_TOOLING: 'Log Extraction Tooling Check'
};

/**
 * Execute a command and return result
 */
function execCommand(command, options = {}) {
  try {
    const output = execSync(command, { 
      encoding: 'utf-8',
      stdio: 'pipe',
      ...options 
    });
    return { success: true, output };
  } catch (error) {
    return { 
      success: false, 
      output: error.stdout || '',
      error: error.stderr || error.message 
    };
  }
}

/**
 * Stage 1: YAML Syntactic Integrity
 */
function validateYamlSyntax() {
  console.log(`\n🔍 Stage 1: ${VALIDATION_STAGES.YAML_SYNTAX}`);
  
  const workflowFiles = [
    '.github/workflows/ci.yml',
    '.github/workflows/codeql.yml',
    '.github/workflows/screenshots-update.yml'
  ];

  let allValid = true;

  for (const file of workflowFiles) {
    if (!fs.existsSync(file)) {
      console.warn(`  ⚠️  File not found: ${file}`);
      continue;
    }

    console.log(`  Checking ${file}...`);
    const result = execCommand(`node ${path.join(__dirname, 'validate-workflows.mjs')} ${file}`);
    
    if (result.success) {
      console.log(`  ✅ ${file} is valid`);
    } else {
      console.error(`  ❌ ${file} has errors:`);
      console.error(`     ${result.error}`);
      allValid = false;
    }
  }

  return allValid;
}

/**
 * Stage 2: Local act Runner Test
 */
function validateActRunner() {
  console.log(`\n🔍 Stage 2: ${VALIDATION_STAGES.ACT_TEST}`);
  
  // Check if act is installed
  const actCheck = execCommand('which act');
  if (!actCheck.success) {
    console.warn(`  ⚠️  act is not installed. Install with: sudo pacman -S act`);
    console.warn(`  ⚠️  Skipping act tests`);
    return true; // Don't fail if act is not installed
  }

  console.log(`  ✅ act is installed: ${actCheck.output.trim()}`);

  // Test act configuration
  const actVersion = execCommand('act --version');
  if (actVersion.success) {
    console.log(`  ✅ act version: ${actVersion.output.trim()}`);
  } else {
    console.error(`  ❌ Failed to get act version`);
    return false;
  }

  // Dry run to validate workflow structure
  console.log(`  Running act dry-run...`);
  const dryRun = execCommand('act --dry-run', { timeout: 30000 });
  
  if (dryRun.success) {
    console.log(`  ✅ Workflows are valid for act execution`);
    return true;
  } else {
    console.error(`  ❌ act dry-run failed:`);
    console.error(`     ${dryRun.error}`);
    return false;
  }
}

/**
 * Stage 3: Secret/Env Variable Audit
 */
function validateSecretAudit() {
  console.log(`\n🔍 Stage 3: ${VALIDATION_STAGES.SECRET_AUDIT}`);
  
  const workflowFile = '.github/workflows/ci.yml';
  if (!fs.existsSync(workflowFile)) {
    console.warn(`  ⚠️  Main workflow file not found`);
    return true;
  }

  const content = fs.readFileSync(workflowFile, 'utf-8');
  
  // Check for hardcoded secrets
  const secretPatterns = [
    /api[_-]?key\s*=\s*['"][^'"]+['"]/gi,
    /password\s*=\s*['"][^'"]+['"]/gi,
    /token\s*=\s*['"][^'"]+['"]/gi,
    /secret\s*=\s*['"][^'"]+['"]/gi
  ];

  let hasHardcodedSecrets = false;
  secretPatterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) {
      console.error(`  ❌ Found potential hardcoded secrets:`);
      matches.forEach(match => console.error(`     ${match}`));
      hasHardcodedSecrets = true;
    }
  });

  if (!hasHardcodedSecrets) {
    console.log(`  ✅ No hardcoded secrets detected`);
  }

  // Check for proper secret usage
  if (content.includes('${{ secrets.')) {
    console.log(`  ✅ Using GitHub Actions secrets correctly`);
  }

  // Check for permissions block
  if (content.includes('permissions:')) {
    console.log(`  ✅ Permissions block is present`);
  } else {
    console.warn(`  ⚠️  No permissions block found`);
  }

  return !hasHardcodedSecrets;
}

/**
 * Stage 4: Log Extraction Tooling Check
 */
function validateLogTooling() {
  console.log(`\n🔍 Stage 4: ${VALIDATION_STAGES.LOG_TOOLING}`);
  
  const extractionScript = path.join(__dirname, 'extract-ci-failures.mjs');
  const actionDir = '.github/actions/ci-failure-extractor';
  
  // Check extraction script
  if (fs.existsSync(extractionScript)) {
    console.log(`  ✅ Log extraction script exists`);
    
    // Test script syntax
    const syntaxCheck = execCommand(`node --check ${extractionScript}`);
    if (syntaxCheck.success) {
      console.log(`  ✅ Extraction script syntax is valid`);
    } else {
      console.error(`  ❌ Extraction script has syntax errors`);
      return false;
    }
  } else {
    console.error(`  ❌ Log extraction script not found`);
    return false;
  }

  // Check custom action
  if (fs.existsSync(actionDir)) {
    console.log(`  ✅ Custom action directory exists`);
    
    const requiredFiles = ['action.yml', 'index.js', 'package.json'];
    let allFilesPresent = true;
    
    requiredFiles.forEach(file => {
      const filePath = path.join(actionDir, file);
      if (fs.existsSync(filePath)) {
        console.log(`  ✅ ${file} exists`);
      } else {
        console.error(`  ❌ ${file} not found`);
        allFilesPresent = false;
      }
    });

    return allFilesPresent;
  } else {
    console.error(`  ❌ Custom action directory not found`);
    return false;
  }
}

/**
 * Main validation cascade
 */
function main() {
  console.log('🚀 Starting CI Validation Cascade');
  console.log('=====================================');

  const results = {
    [VALIDATION_STAGES.YAML_SYNTAX]: validateYamlSyntax(),
    [VALIDATION_STAGES.ACT_TEST]: validateActRunner(),
    [VALIDATION_STAGES.SECRET_AUDIT]: validateSecretAudit(),
    [VALIDATION_STAGES.LOG_TOOLING]: validateLogTooling()
  };

  console.log('\n📊 Validation Results');
  console.log('====================');
  
  let allPassed = true;
  Object.entries(results).forEach(([stage, passed]) => {
    const status = passed ? '✅ PASSED' : '❌ FAILED';
    console.log(`${status}: ${stage}`);
    if (!passed) allPassed = false;
  });

  console.log('\n====================');
  if (allPassed) {
    console.log('🎉 All validation stages passed!');
    process.exit(0);
  } else {
    console.log('❌ Some validation stages failed. Please fix the issues above.');
    process.exit(1);
  }
}

main();