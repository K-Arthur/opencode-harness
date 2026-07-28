const core = require('@actions/core');
const { exec } = require('@actions/exec');
const fs = require('fs');
const path = require('path');

async function run() {
  try {
    const logPath = core.getInput('log-path', { required: true });
    const outputFormat = core.getInput('output-format') || 'markdown';
    const outputFile = core.getInput('output-file');

    // Verify log file exists
    if (!fs.existsSync(logPath)) {
      core.setFailed(`Log file not found: ${logPath}`);
      return;
    }

    // Run the extraction script
    const scriptPath = path.join(__dirname, '../../..', 'scripts', 'extract-ci-failures.mjs');
    const args = [logPath];
    
    if (outputFormat) {
      args.push('--format', outputFormat);
    }

    let output = '';
    let error = '';

    const options = {
      listeners: {
        stdout: (data) => {
          output += data.toString();
        },
        stderr: (data) => {
          error += data.toString();
        }
      }
    };

    await exec('node', [scriptPath, ...args], options);

    if (error) {
      core.warning(`Extraction warnings: ${error}`);
    }

    // Output results
    if (outputFile) {
      fs.writeFileSync(outputFile, output);
      core.info(`Results saved to ${outputFile}`);
    } else {
      core.info('Extraction Results:');
      core.info(output);
    }

    // Set output for GitHub Actions
    core.setOutput('results', output);
    core.setOutput('has-failures', output.includes('failure') || output.includes('error'));

  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

run();