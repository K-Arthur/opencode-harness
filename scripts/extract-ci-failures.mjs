#!/usr/bin/env node

/**
 * CI Failure Log Extractor
 * 
 * This script extracts and summarizes failure information from CI logs.
 * It can process local log files or fetch logs from GitHub Actions.
 * 
 * Usage:
 *   node scripts/extract-ci-failures.mjs <log-file-path>
 *   node scripts/extract-ci-failures.mjs --github <run-id>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Parse a log file and extract failure information
 */
function extractFailures(logContent) {
  const lines = logContent.split('\n');
  const failures = [];
  let currentJob = null;
  let currentStep = null;
  let errorContext = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect job boundaries
    if (line.match(/##\[group\]/) || line.match(/Job:/)) {
      currentJob = line.replace(/##\[group\]/, '').trim();
      currentStep = null;
      errorContext = [];
    }

    // Detect step boundaries  
    if (line.match(/##\[group\]/) && currentJob) {
      currentStep = line.replace(/##\[group\]/, '').trim();
      errorContext = [];
    }

    // Detect error patterns
    if (line.match(/error|Error|ERROR|failed|Failed|FAILED/) && 
        !line.match(/warning|Warning|WARNING/)) {
      errorContext.push({
        line: i + 1,
        content: line.trim(),
        job: currentJob,
        step: currentStep
      });
    }

    // Detect GitHub Actions error annotations
    const errorMatch = line.match(/::error file=(.+?),line=(.+?),col=(.+?)::(.+)/);
    if (errorMatch) {
      failures.push({
        type: 'annotation',
        file: errorMatch[1],
        line: errorMatch[2],
        column: errorMatch[3],
        message: errorMatch[4],
        job: currentJob,
        step: currentStep
      });
    }

    // Detect test failures
    const testFailureMatch = line.match(/(✔|✖)\s+(.+)/);
    if (testFailureMatch && testFailureMatch[2].includes('✖')) {
      failures.push({
        type: 'test',
        name: testFailureMatch[2].replace('✖', '').trim(),
        job: currentJob,
        step: currentStep
      });
    }

    // Detect timeout failures
    if (line.match(/timeout|Timeout|TIMEOUT/)) {
      failures.push({
        type: 'timeout',
        message: line.trim(),
        job: currentJob,
        step: currentStep
      });
    }
  }

  // Add error context blocks
  errorContext.forEach(ctx => {
    if (ctx.content.length > 0) {
      failures.push({
        type: 'error',
        message: ctx.content,
        line: ctx.line,
        job: ctx.job,
        step: ctx.step
      });
    }
  });

  return failures;
}

/**
 * Format failures as markdown
 */
function formatFailuresAsMarkdown(failures) {
  if (failures.length === 0) {
    return '✅ No failures detected in logs';
  }

  let markdown = '# CI Failure Analysis\n\n';
  markdown += `Found ${failures.length} failure(s):\n\n`;

  // Group by job
  const byJob = {};
  failures.forEach(f => {
    const job = f.job || 'Unknown Job';
    if (!byJob[job]) byJob[job] = [];
    byJob[job].push(f);
  });

  Object.entries(byJob).forEach(([job, jobFailures]) => {
    markdown += `## ${job}\n\n`;
    
    jobFailures.forEach(f => {
      if (f.type === 'annotation') {
        markdown += `- **File Error**: \`${f.file}:${f.line}:${f.column}\`\n`;
        markdown += `  - ${f.message}\n`;
      } else if (f.type === 'test') {
        markdown += `- **Test Failure**: ${f.name}\n`;
      } else if (f.type === 'timeout') {
        markdown += `- **Timeout**: ${f.message}\n`;
      } else {
        markdown += `- **Error**: ${f.message}\n`;
        if (f.step) markdown += `  - Step: ${f.step}\n`;
        if (f.line) markdown += `  - Line: ${f.line}\n`;
      }
      markdown += '\n';
    });
  });

  return markdown;
}

/**
 * Format failures as JSON
 */
function formatFailuresAsJSON(failures) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    totalFailures: failures.length,
    failures: failures
  }, null, 2);
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node extract-ci-failures.mjs <log-file-path> [--format json|markdown]');
    process.exit(1);
  }

  const logPath = args[0];
  const format = args.includes('--format') ? args[args.indexOf('--format') + 1] : 'markdown';

  if (!fs.existsSync(logPath)) {
    console.error(`Error: Log file not found: ${logPath}`);
    process.exit(1);
  }

  const logContent = fs.readFileSync(logPath, 'utf-8');
  const failures = extractFailures(logContent);

  if (format === 'json') {
    console.log(formatFailuresAsJSON(failures));
  } else {
    console.log(formatFailuresAsMarkdown(failures));
  }
}

main();