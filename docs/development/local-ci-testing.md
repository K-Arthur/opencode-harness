# Local CI Testing with act

This guide explains how to use `act` to run GitHub Actions workflows locally on CachyOS/Arch Linux for fast feedback and debugging.

## Installation

### Quick Setup
Run the provided setup script:
```bash
./scripts/setup-act.sh
```

### Manual Installation
```bash
# Install act via pacman
sudo pacman -S act

# Verify installation
act --version
```

## Configuration

The project includes pre-configured settings in `.actrc`:
- Uses self-hosted runner (no Docker required)
- Optimized for CachyOS/Arch Linux environment
- Configured to use the master branch

### Secrets Configuration
Create a `.secrets` file for local testing:
```bash
# Copy the template
cp .secrets.example .secrets

# Edit with your secrets
nano .secrets
```

Example `.secrets` file:
```
GITHUB_TOKEN=your_token_here
OPENAI_API_KEY=your_key_here
```

## Usage

### Basic Commands

```bash
# Run all jobs for a push event
act push

# Run all jobs for a pull request event
act pull_request

# Run a specific job
act -j typecheck

# Run multiple specific jobs
act -j typecheck -j lint -j build

# Dry run (show what would run without executing)
act --dry-run

# Verbose output for debugging
act -v

# Use secrets file
act --secret-file .secrets
```

### Job-Specific Testing

```bash
# Test typecheck job only
act -j typecheck

# Test build job only
act -j build

# Test unit tests only
act -j unit

# Test integration tests (requires xvfb)
act -j integration
```

### Matrix Builds

```bash
# Test specific Node.js version from matrix
act -j typecheck --matrix node-version:20

# Test all matrix variations
act -j typecheck
```

## Limitations & Workarounds

### Integration Tests
Integration tests require `xvfb` for virtual framebuffer:
```bash
# Install xvfb on CachyOS
sudo pacman -S xorg-server-xvfb

# Run integration tests with act
act -j integration
```

### Playwright Tests
Playwright tests may need additional setup:
```bash
# Install Playwright dependencies
npx playwright install --with-deps chromium

# Run Playwright tests with act
act -j webview
act -j visual
```

### Docker-based Actions
Some GitHub Actions may not work with self-hosted runner. If you encounter issues:
```bash
# Use Docker-based runner instead
act -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

## Workflow Validation

Before pushing, validate your workflow changes:
```bash
# Validate workflow syntax
node scripts/validate-workflows.mjs .github/workflows/ci.yml

# Run pre-commit hooks
pre-commit run --all-files
```

## Troubleshooting

### act Command Not Found
```bash
# Reinstall act
sudo pacman -S act
```

### Permission Denied
```bash
# Make setup script executable
chmod +x scripts/setup-act.sh
```

### Docker Issues
If you encounter Docker-related errors, use the self-hosted runner (default in `.actrc`):
```bash
# This is already configured in .actrc
act -P ubuntu-latest=-self-hosted
```

### Cache Issues
Local caching may differ from GitHub Actions:
```bash
# Clear act cache
rm -rf /tmp/.act-cache

# Run without cache
act --no-cache
```

## Best Practices

1. **Test Locally First**: Always run `act` before pushing to remote
2. **Use Specific Jobs**: Test individual jobs for faster feedback
3. **Validate Syntax**: Use workflow validation before testing
4. **Secrets Management**: Never commit real secrets to `.secrets`
5. **Environment Parity**: Be aware of local vs. remote differences

## Integration with Development Workflow

### Pre-commit Integration
The pre-commit hooks include CI validation:
```bash
# Install pre-commit hooks
pip install pre-commit
pre-commit install

# Hooks will run automatically on commit
```

### VS Code Integration
Consider using the "GitHub Local Actions" extension for VS Code to run act directly from the editor.

## Performance Tips

1. **Use Self-Hosted Runner**: Faster than Docker-based (default in `.actrc`)
2. **Cache Dependencies**: Leverage npm and build caches
3. **Test Specific Jobs**: Don't run entire pipeline for small changes
4. **Parallel Execution**: act can run jobs in parallel like GitHub Actions

## Continuous Local Testing

For automated local testing during development:
```bash
# Watch for changes and auto-test (requires inotifywait)
while inotifywait -e modify .github/workflows/; do
    act -j typecheck
done
```

## References

- [act Documentation](https://github.com/nektos/act)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Project AGENTS.md](../../AGENTS.md) for CI/CD policies