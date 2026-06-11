# Coding Agent Tools: Methodology, Skills, and Slash Commands Research

## 1. Per-Tool Findings

### 1.1 Claude Code (Anthropic)

**Slash Commands:**
- Built-in commands: `/help`, `/compact`, `/init`, `/memory`, `/model`, `/agents`, `/skills`, `/permissions`, `/bug`, `/desktop`, `/loop`, `/schedule`, `/statusline`, `/btw`, `/add-dir`, `/reload-plugins`
- Bundled skills (prompt-based, invoked via `/`): `/code-review`, `/batch`, `/debug`, `/run`, `/verify`, `/run-skill-generator`, `/claude-api`
- Custom commands merged into skills system: `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` both create `/deploy`
- Autocomplete with argument hints (`argument-hint` frontmatter)
- Commands follow Agent Skills open standard (agentskills.io)

**Skills/Workflows:**
- **SKILL.md** files with YAML frontmatter + markdown body
- Locations: Enterprise (managed), Personal (`~/.claude/skills/`), Project (`.claude/skills/`), Plugin
- Frontmatter controls: `description`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `hooks`, `paths`, `shell`
- Dynamic context injection: `` !`git diff HEAD` `` runs shell commands before skill loads
- String substitution: `$ARGUMENTS`, `$ARGUMENTS[N]`, `$name`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_SKILL_DIR}`
- Supporting files: templates, examples, scripts in skill directory
- Content lifecycle: stays in context across turns, survives compaction (first 5000 tokens, 25000 combined budget)
- Live change detection: watches skill directories for file changes
- Auto-discovery from parent/nested directories for monorepo support

**Methodology/Task Routing:**
- **Plan mode**: Read-only exploration before editing. Uses Plan subagent for research.
- **Auto mode**: Background classifier reviews commands automatically
- **Accept Edits mode**: Auto-accepts file edits
- Built-in subagents: **Explore** (Haiku, read-only, fast), **Plan** (read-only, planning research), **general-purpose** (all tools)
- Claude automatically delegates to subagents based on task description
- Effort levels: `low`, `medium`, `high`, `xhigh`, `max`

**Custom Instructions:**
- **CLAUDE.md** files: managed policy, user (`~/.claude/CLAUDE.md`), project (`./CLAUDE.md`), local (`./CLAUDE.local.md`)
- **Auto memory**: Claude writes notes itself across sessions (build commands, debugging insights)
- `.claude/rules/` directory with path-specific rules via `paths` frontmatter
- `@path/to/import` syntax for importing additional files
- Target: under 200 lines per CLAUDE.md file

**Subagent/Multi-Agent:**
- Custom subagents in `.claude/agents/` or `~/.claude/agents/`
- Frontmatter: `name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation: worktree`, `color`
- Foreground (blocking) vs background (concurrent) execution
- Persistent memory: `user`, `project`, or `local` scope
- Agent teams for sustained parallelism
- `@-mention` syntax for explicit subagent invocation
- `--agent <name>` to run entire session as a subagent

**Key Architecture Insights:**
- Hooks system: `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStart`, `SubagentStop`, `InstructionsLoaded`
- Context window visualization shows what's loaded
- Auto-compaction carries invoked skills forward
- Plugin system with `.claude-plugin/plugin.json`

---

### 1.2 OpenAI Codex CLI

**Slash Commands:**
- Minimal slash command system compared to Claude Code
- Primary interaction is natural language with `/` commands for basic operations
- Uses `AGENTS.md` for project instructions (similar to CLAUDE.md)

**Skills/Workflows:**
- `.codex/` directory for configuration
- `.codex/environments/` for environment-specific settings
- AGENTS.md file for persistent instructions
- Less mature skill system than Claude Code

**Methodology/Modes:**
- Three approval modes: `suggest` (read-only), `auto-edit` (auto-approve edits), `full-auto` (auto-approve everything)
- Sandboxed execution in auto modes
- No explicit plan/build distinction

**Custom Instructions:**
- AGENTS.md at project root
- `.codex/` directory for configuration

**Subagent/Multi-Agent:**
- Cloud-based Codex Web for parallel task execution
- No local multi-agent orchestration documented

**Key Architecture:**
- Written in Rust (96.1%)
- Both CLI (`codex-cli/`) and Rust core (`codex-rs/`)
- SDK available for programmatic use
- Apache 2.0 licensed

---

### 1.3 Cline (VS Code Extension + CLI)

**Slash Commands:**
- CLI commands: `cline mcp` (manage MCP servers), `cline connect` (connect to platforms), `cline schedule` (scheduled agents)
- In-chat: Plan/Act mode toggle
- Headless mode for CI/CD with JSON output

**Skills/Workflows:**
- `.clinerules` files for project-specific rules
- `.cline/skills/` directory for skills
- `.agents/skills/` directory (shared standard)
- Rules auto-picked up by CLI, VS Code, and JetBrains
- Skills let model load specific rules when needed

**Methodology/Modes:**
- **Plan mode**: Explores codebase, asks questions, lays out strategy (read-only)
- **Act mode**: Executes the plan with file edits and commands
- Toggle between modes; every edit requires approval (or auto-approve)
- Checkpoints for undo capability

**Custom Instructions:**
- `.clinerules` files (coding standards, architecture, deployment, testing)
- CLAUDE.md also read (for compatibility)
- Rules picked up automatically across all surfaces

**Subagent/Multi-Agent:**
- **Multi-Agent Teams**: Coordinator agent breaks work into subtasks, delegates to specialists
- `cline --team-name auth-sprint "..."` for team coordination
- **Kanban**: Web-based multi-agent task board with per-card worktrees, auto-commit, dependency chains
- SDK (`@cline/sdk`) for building custom agents
- Scheduled agents via cron

**Key Architecture:**
- TypeScript (97.8%)
- SDK-based plugin system with `createTool()` and lifecycle hooks
- Connectors for Slack, Telegram, Discord, Google Chat, WhatsApp, Linear
- Apache 2.0 licensed

---

### 1.4 Cursor (AI Code Editor)

**Slash Commands:**
- `@` mentions for files, symbols, docs, web
- Agent mode with multi-step task execution
- Rules system for custom behavior

**Skills/Workflows:**
- Rules: `.cursor/rules/` directory, `.cursorrules` file
- Rule types: Always, Auto Attached (glob patterns), Agent Requested, Manual
- Skills mentioned in docs navigation but details limited from fetch

**Methodology/Modes:**
- **Agent mode**: Multi-step task execution with tool use
- **Ask mode**: Q&A without code changes
- **Edit mode**: Direct code modifications
- Tab completion / ghost suggestions for inline edits

**Custom Instructions:**
- `.cursorrules` file at project root
- `.cursor/rules/` directory with typed rules
- Rule frontmatter: `description`, `globs`, `alwaysApply`

**Subagent/Multi-Agent:**
- Background agents (cloud-based)
- BugBot for automated bug detection
- No local multi-agent orchestration documented

---

### 1.5 Windsurf/Codeium

**Methodology/Modes:**
- **Cascade**: Multi-step agentic flow with tool use
- Automated context selection
- "Flows" concept for multi-step workflows

**Custom Instructions:**
- `.windsurfrules` file
- Global rules configurable in settings

**Key Architecture:**
- Proprietary, closed-source
- Deep IDE integration
- Context-aware codebase understanding

---

### 1.6 Aider (Python CLI)

**Slash Commands:**
- `/code`, `/ask`, `/architect`, `/help` - mode switching
- `/chat-mode <mode>` - sticky mode switch
- `/model` - change model
- `/add`, `/drop` - manage files in chat
- `/run`, `/test` - execute commands
- `/undo`, `/diff` - git operations
- `/lint`, `/voice` - utilities
- Per-message mode override: `/code <msg>`, `/ask <msg>`

**Skills/Workflows:**
- No formal skill system
- Conventions file: `.aider.conf.yml`, `--read` for read-only context
- `/conventions` for specifying coding standards
- Scripting support for automation

**Methodology/Modes:**
- **code**: Makes changes to code (default)
- **ask**: Discusses code, answers questions, no changes
- **architect**: Two-model approach - architect proposes, editor implements
- **help**: Answers questions about aider itself
- **Ask/Code workflow**: Bounce between `/ask` (discuss plan) and `/code` (implement)
- Architect mode pairs reasoning model (o1) with editor model (GPT-4o)

**Custom Instructions:**
- `.aider.conf.yml` for configuration
- `--read` flag for read-only context files
- Conventions via `/conventions` or `--read`
- `.aider/` directory for project settings

**Subagent/Multi-Agent:**
- No multi-agent system
- Architect mode is closest: two-model pipeline (architect + editor)
- Scripting API for programmatic use

**Key Architecture:**
- Python (80%)
- Tree-sitter for code parsing (100+ languages)
- Repository map for codebase understanding
- Multiple edit formats (diff, whole-file, unified-diff)
- LLM leaderboards for benchmarking models
- 88% of new code written by Aider itself (Singularity metric)

---

### 1.7 Continue (VS Code Extension)

**Slash Commands:**
- Slash commands were a core feature (now repo is read-only/archived)
- `/edit`, `/comment`, `/share` and custom commands
- Configurable via `config.json`

**Skills/Workflows:**
- `skills/` directory in repo
- `.continue/` directory for configuration
- Custom slash commands definable in config
- Context providers for adding context

**Methodology/Modes:**
- Chat, Edit, and Agent modes
- No explicit plan/build distinction

**Custom Instructions:**
- `config.json` for all configuration
- `.continue/` directory
- System prompts configurable

**Key Architecture:**
- TypeScript (83.9%)
- Now archived/read-only (final 2.0.0 release)
- CLI, VS Code extension, JetBrains plugin
- Pioneered open-source coding agent space

---

### 1.8 GitHub Copilot Chat

**Slash Commands:**
- `/explain` - explain selected code
- `/fix` - fix problems in selected code
- `/tests` - generate unit tests
- `/doc` - generate documentation
- `/workspace` - workspace-wide questions
- `@workspace`, `@terminal`, `@vscode` - participant mentions

**Skills/Workflows:**
- Copilot Instructions: `.github/copilot-instructions.md`
- Custom instructions in settings
- No formal skill/plugin system

**Methodology/Modes:**
- **Ask mode**: Q&A
- **Edit mode**: Code modifications
- **Agent mode** (Copilot Edits): Multi-file editing with tool use
- Inline chat for quick questions

**Custom Instructions:**
- `.github/copilot-instructions.md`
- Settings-based custom instructions
- Per-language instructions

**Subagent/Multi-Agent:**
- Copilot Coding Agent (cloud): Autonomous PR creation from issues
- GitHub Copilot App: Directs agents from issue to merge
- No local multi-agent

---

## 2. Common Patterns Across Tools

### 2.1 Slash Command Patterns
| Pattern | Tools Using It |
|---------|---------------|
| `/` prefix for commands | All tools |
| Mode switching via commands | Aider (`/code`, `/ask`), Claude Code (plan mode) |
| File management commands | Aider (`/add`, `/drop`), Claude Code (`/add-dir`) |
| Help/documentation | All tools (`/help`) |
| Custom command definition | Claude Code (skills), Continue (config), Cline (skills) |
| Argument substitution | Claude Code (`$ARGUMENTS`), Aider (inline) |
| Autocomplete/typeahead | Claude Code, Cursor, Cline |

### 2.2 Skills/Workflow Patterns
| Pattern | Tools Using It |
|---------|---------------|
| Markdown-based skill definitions | Claude Code (SKILL.md), Cline (.clinerules, skills) |
| YAML frontmatter for configuration | Claude Code, Cursor rules, Cline |
| Hierarchical scoping (user/project/enterprise) | Claude Code, Cline |
| Dynamic context injection (shell commands) | Claude Code (`!`command``) |
| Auto-discovery from description | Claude Code |
| Supporting files in skill directory | Claude Code |
| Agent Skills open standard | Claude Code, Cline (.agents/skills) |

### 2.3 Mode Patterns
| Pattern | Tools Using It |
|---------|---------------|
| Plan/Read-only mode | Claude Code, Cline, Aider (ask) |
| Act/Edit/Code mode | Claude Code, Cline, Aider (code) |
| Auto-approve mode | Claude Code (auto), Codex (full-auto), Cline (auto-approve) |
| Two-model pipeline | Aider (architect/editor) |
| Effort/reasoning levels | Claude Code (low-high-max) |

### 2.4 Custom Instructions Patterns
| Pattern | Tools Using It |
|---------|---------------|
| Project-root markdown file | All tools (CLAUDE.md, AGENTS.md, .cursorrules, .clinerules, .windsurfrules, copilot-instructions.md) |
| User-level global instructions | Claude Code (~/.claude/CLAUDE.md), Cline |
| Path-specific rules | Claude Code (.claude/rules/ with `paths`), Cursor (globs) |
| Auto-generated instructions | Claude Code (`/init`), auto memory |
| Import/include syntax | Claude Code (`@path`) |

### 2.5 Multi-Agent Patterns
| Pattern | Tools Using It |
|---------|---------------|
| Subagent delegation | Claude Code (built-in + custom) |
| Parallel agent teams | Claude Code, Cline (Kanban) |
| Coordinator/worker pattern | Cline (multi-agent teams) |
| Persistent agent memory | Claude Code (user/project/local scope) |
| Background/concurrent agents | Claude Code, Cline |
| SDK for custom agents | Claude Code (Agent SDK), Cline (@cline/sdk) |
| Cloud-based parallel agents | Codex (Codex Web), Copilot (Coding Agent) |

---

## 3. Best Practices Extracted

### 3.1 Slash Command Design
1. **Progressive disclosure**: Start with a few essential commands, reveal more via `/help` or autocomplete
2. **Dual invocation**: Both user (`/command`) and model (auto-detect) should be able to trigger workflows
3. **Argument handling**: Support `$ARGUMENTS`, positional args, and named args for flexibility
4. **Autocomplete with hints**: Show argument hints during typeahead (Claude Code's `argument-hint`)
5. **Per-message vs sticky modes**: Aider's pattern of per-message `/code <msg>` vs sticky `/chat-mode code`

### 3.2 Skill/Workflow Design
1. **Lazy loading**: Only load skill descriptions into context; load full content on invocation (Claude Code)
2. **Invocation control**: Separate `disable-model-invocation` (manual only) from `user-invocable` (model only)
3. **Hierarchical scoping**: Enterprise > Personal > Project with clear override rules
4. **Dynamic context**: Pre-process shell commands before sending to model (Claude Code's `` !`command` ``)
5. **Supporting files**: Keep SKILL.md concise (<500 lines), reference external files for detail
6. **Content lifecycle**: Skills persist across turns; budget for compaction (5000 tokens per skill, 25000 combined)
7. **Open standard**: Follow Agent Skills standard for cross-tool compatibility

### 3.3 Mode/Methodology Design
1. **Plan before Act**: Read-only exploration phase before editing (Claude Code, Cline, Aider)
2. **Approval spectrum**: suggest → acceptEdits → auto → bypassPermissions (Claude Code)
3. **Two-model pipeline**: Separate reasoning from editing for better results (Aider architect mode)
4. **Effort levels**: Let users control depth of reasoning (Claude Code: low/medium/high/xhigh/max)
5. **Mode indication**: Clear visual indicator of current mode (Aider's prompt prefix)

### 3.4 Custom Instructions Design
1. **Size limits**: Target <200 lines per instruction file (Claude Code recommendation)
2. **Specificity**: "Use 2-space indentation" > "Format code properly"
3. **Path-scoping**: Load rules only when working with matching files to save context
4. **Auto-memory**: Let the model accumulate learnings across sessions (Claude Code)
5. **Import system**: `@path/to/file` for modular instruction organization

### 3.5 Multi-Agent Design
1. **Context isolation**: Subagents get their own context window; only summary returns to parent
2. **Tool restriction**: Read-only agents for exploration, full agents for implementation
3. **Model routing**: Use cheaper/faster models (Haiku) for exploration, expensive for implementation
4. **Persistent memory**: Agents accumulate knowledge across sessions (user/project/local scope)
5. **Foreground vs background**: Blocking for interactive, concurrent for independent tasks
6. **Delegation control**: Model auto-delegates based on description; user can @-mention to force

---

## 4. Design Principles for Our Extension

### 4.1 What We Should Adopt

1. **Skills as first-class citizens** (Claude Code model):
   - SKILL.md with YAML frontmatter + markdown body
   - Hierarchical scoping (user/project)
   - Auto-invocation from description + manual `/` invocation
   - Dynamic context injection
   - Argument substitution (`$ARGUMENTS`, `$0`, `$name`)
   - Supporting files in skill directory

2. **Plan/Act mode toggle** (Cline + Claude Code):
   - Plan mode: read-only exploration, ask questions, propose strategy
   - Act/Build mode: execute with file edits and commands
   - Auto mode: background classifier for approval
   - Clear visual indicator of current mode

3. **Hierarchical custom instructions**:
   - Project-level (AGENTS.md or equivalent)
   - User-level (~/.config/)
   - Path-specific rules with glob patterns
   - Size guidance (<200 lines)

4. **Subagent architecture** (Claude Code model):
   - Built-in agents: Explore (fast, read-only), Plan (research)
   - Custom agents with tool restrictions
   - Foreground/background execution
   - Persistent memory across sessions

5. **Progressive disclosure UX**:
   - Essential commands always visible
   - Secondary actions in overflow menu
   - Autocomplete with argument hints
   - Keyboard shortcuts for power users

### 4.2 What We Should Avoid

1. **Overloading context**: Don't load all skills/rules at once; use lazy loading (Claude Code's description-only approach)
2. **Too many modes**: Aider's 4 modes (code/ask/architect/help) is the sweet spot; avoid mode explosion
3. **Proprietary lock-in**: Follow open standards (Agent Skills, MCP) for portability
4. **Silent failures**: Always show what the model is doing (Cline's approval model)
5. **Unbounded skill content**: Set token budgets for skill persistence across compaction
6. **Missing mode indicators**: Users must always know what mode they're in

### 4.3 Specific Recommendations for OpenCode Harness

Based on our existing architecture (plan/build/auto modes, slash commands, skills):

1. **Align skill format with Agent Skills standard** - We already have skills; ensure SKILL.md frontmatter matches Claude Code's schema for cross-tool compatibility
2. **Add `disable-model-invocation` and `user-invocable` controls** - Let skill authors control who triggers skills
3. **Add dynamic context injection** - `` !`command` `` preprocessing for skills (e.g., inject git diff, test results)
4. **Implement skill content lifecycle** - Budget tokens for skills across compaction; re-attach most recent
5. **Add path-specific rules** - `.opencode/rules/` with `paths` frontmatter for conditional loading
6. **Add Explore subagent** - Fast, read-only agent using cheaper model for codebase exploration
7. **Add auto-memory** - Let the model save learnings across sessions
8. **Improve mode indication** - Status bar + input area should clearly show current mode
9. **Add effort levels** - Let users control reasoning depth per-message or per-session
10. **Consider two-model pipeline** - Architect mode (reasoning model → editor model) for complex tasks

---

## 5. Research Papers and Technical Articles

### 5.1 ReAct (Reasoning and Acting) Pattern
- **Paper**: "ReAct: Synergizing Reasoning and Acting in Language Models" (Yao et al., 2022)
- **Key insight**: Interleave reasoning traces with actions for better task completion
- **Adoption**: All agentic coding tools use this pattern (think → act → observe → think)
- **Relevance**: Our plan/build/auto modes map to different ReAct configurations

### 5.2 Plan-and-Execute Workflows
- **Paper**: "Plan-and-Solve Prompting" (Wang et al., 2023)
- **Key insight**: Explicit planning step before execution improves complex task performance
- **Adoption**: Claude Code (plan mode), Cline (Plan/Act), Aider (ask/code workflow)
- **Relevance**: Our plan mode should enforce read-only exploration before build mode

### 5.3 Reflexion/Self-Improvement
- **Paper**: "Reflexion: Language Agents with Verbal Reinforcement Learning" (Shinn et al., 2023)
- **Key insight**: Agents that reflect on failures and retry perform better
- **Adoption**: Aider's lint-test cycle (auto-fix lint/test failures), Claude Code's `/verify`
- **Relevance**: Build mode should include automatic verification and retry loops

### 5.4 Task Decomposition
- **Paper**: "Tree of Thoughts" (Yao et al., 2023), "Decomposed Prompting" (Khot et al., 2022)
- **Key insight**: Breaking complex tasks into subtasks improves accuracy
- **Adoption**: Claude Code (subagent delegation), Cline (multi-agent teams with coordinator)
- **Relevance**: Subagent architecture for complex multi-file changes

### 5.5 Prompt Routing and Classification
- **Paper**: "Routing to Specialized Models" (various, 2023-2024)
- **Key insight**: Classifying task type and routing to specialized models/prompts improves quality
- **Adoption**: Claude Code (model routing per subagent, effort levels), Aider (architect/editor model split)
- **Relevance**: Our model tier system and plan_turn routing align with this

### 5.6 Command Palette UX
- **VS Code Command Palette**: Fuzzy search, recent commands, keyboard-first
- **Sublime Text**: Instant fuzzy search, multi-cursor from search results
- **Best practices**:
  - Fuzzy matching with ranked results
  - Recent/frequent command history
  - Keyboard navigation (↑/↓/Enter/Escape)
  - Category grouping
  - Argument hints in placeholder text
  - Progressive disclosure (show common commands first)

### 5.7 Cognitive Load and Progressive Disclosure
- **Principle**: Show only what's needed at each step; reveal complexity on demand
- **Application to coding agents**:
  - Primary controls always visible (mode, model, send)
  - Secondary controls in overflow (settings, checkpoints, MCP)
  - Contextual actions appear when relevant (diff accept/reject during streaming)
  - Keyboard shortcuts for power users without cluttering UI
  - Skill descriptions in context; full content only on invocation

---

## 6. Summary Table

| Feature | Claude Code | Codex CLI | Cline | Cursor | Aider | Continue | Copilot |
|---------|:-----------:|:---------:|:-----:|:------:|:-----:|:--------:|:-------:|
| Slash commands | Rich | Basic | Moderate | Moderate | Rich | Moderate | Basic |
| Skills system | Advanced | Basic | Moderate | Rules | None | Basic | None |
| Plan mode | Yes | No | Yes | No | Yes (ask) | No | No |
| Auto mode | Yes | Yes | Yes | Agent | No | No | Agent |
| Custom instructions | CLAUDE.md | AGENTS.md | .clinerules | .cursorrules | .aider.conf | config.json | copilot-instructions |
| Path-specific rules | Yes | No | No | Yes (globs) | No | No | No |
| Auto memory | Yes | No | No | No | No | No | No |
| Subagents | Advanced | No | Teams | Background | Architect | No | Cloud |
| Multi-agent | Yes | Cloud | Kanban | No | No | No | Cloud |
| Dynamic context | Yes | No | No | No | No | No | No |
| Open standard | Agent Skills | No | Agent Skills | No | No | No | No |
| Open source | Partial | Yes | Yes | No | Yes | Archived | No |
