# GitHub Pipeline Memory & Debugging Tracker

**Session Start**: 2026-07-27  
**Objective**: Audit and repair all failing GitHub Actions jobs, implement automated log extraction, and harden CI/CD pipeline  
**Platform**: CachyOS (Arch-based Linux)  
**Stack**: React, JavaScript, Python, C/C++

## Session Progress Log

### 2026-07-27 - Initial Audit Phase
- **Status**: ✅ Completed workspace tracker initialization, workflow audit, and research
- **Next Steps**: Analyze current workflow failures and root causes

## Workflow Audit Results

### Current Workflows Identified
1. **ci.yml** - Main CI pipeline with 12 jobs:
   - typecheck (matrix: Node 20, 22)
   - lint (depends on typecheck)
   - build (depends on lint)
   - unit (depends on build, with continue-on-error)
   - message-contract (depends on build)
   - roundtrip (depends on build)
   - architecture (independent)
   - secrets-scan (independent)
   - integration (depends on build, timeout 12min)
   - webview (depends on build, timeout 15min)
   - visual (depends on build, timeout 25min)
   - screenshots-verify (depends on build, timeout 10min)

2. **codeql.yml** - CodeQL analysis (push to main, PRs, scheduled weekly)
3. **screenshots-update.yml** - Manual workflow dispatch for updating screenshot baselines
4. **dependabot.yml** - Dependency updates (npm weekly, github-actions monthly)

### Research Findings - Log Extraction & Debugging Tools
**Top Tools Identified:**
1. **gha-failure-analysis** - AI-powered root cause analysis with semantic log processing
2. **ai_summary_action** - LLM-powered analysis with PR comments and issue creation
3. **actions-ai-advisor** - Multi-language support with clickable file links
4. **ci-fix-coach** - Claude-powered diagnosis with actionable fix suggestions
5. **gha-fail-digest** - Local CLI for log summarization

**Recommended Implementation:** `actions-ai-advisor` for zero-config setup with multi-language support

### Research Findings - Caching Strategies
**Key Insights:**
- Use `actions/cache@v6` with Node.js 24 runtime (requires runner 2.327.1+)
- Cache keys should use `hashFiles()` for lockfiles
- Separate caches by OS using `${{ runner.os }}`
- Use `restore-keys` for fallback to closest matching cache
- For Node.js: cache `~/.npm` (not `node_modules`)
- For Python: cache pip cache directory
- For C/C++: cache build artifacts and dependencies

**Current Implementation Issues:**
- Using `actions/setup-node@v4` with built-in npm caching (good)
- No explicit Python/C++ caching (not applicable for this project)
- Missing cache key optimization for different Node versions

### Research Findings - Local Testing with act
**Key Insights:**
- `act` available in CachyOS extra repository
- Requires Docker for container execution
- Use `-P ubuntu-latest=-self-hosted` for local execution without Docker
- Best for Linux workflows (90% accuracy)
- Use `act push -j <job-name>` for specific job testing

**Current Project Compatibility:**
- Act can be installed via CachyOS: `pacman -S act`
- Linux workflows should work well with act
- Integration tests requiring xvfb may need special handling

## Root Cause Analysis Registry

### Job Failures Identified
*(To be populated as failures are discovered)*

## Workflow Changes Applied

### YAML Structural Changes
*(To be populated as changes are made)*

## Log Extraction & Debugging Tools

### Scripts Implemented
*(To be populated as scripts are created)*

## Testing & Verification Results

### Local act Runner Tests
*(To be populated as tests are executed)*

### Automated Log Extractor Verification
*(To be populated as verification is performed)*

## Next Steps & Outstanding Tasks

### Immediate Priorities
1. Complete .github/workflows/ audit
2. Research GitHub Actions best practices
3. Analyze current workflow failures
4. Implement automated log extraction

### Future Enhancements
*(To be populated as additional improvements are identified)*

## References & Documentation

### External Research
*(To be populated with research findings)*

### Internal Documentation Updates
*(To be populated as docs are updated)*
