# AI Methodology Enhancement Research Report

**Project:** opencode-harness Extension  
**Date:** 2026-05-15  
**Research Focus:** AI Development Methodologies for Model-Aware Strategy Selection

---

## Executive Summary

This report presents comprehensive research on AI development methodologies, model routing strategies, prompt engineering techniques, and open standards for the opencode-harness extension. The goal is to enable the extension to proactively leverage the most effective AI/agent development methodologies across all models, with special emphasis on enabling lower-intelligence models to intelligently select and apply optimal approaches for each task.

**Key Findings:**
- The extension already has a solid foundation with `ModelSkillRegistry`, skills infrastructure, prompt management, and MCP integration
- No single methodology fits all scenarios; a hybrid, model-capability-aware approach is required
- Lower-intelligence models benefit significantly from structured prompting, planning modes, and context optimization
- Spec-driven development provides architectural rigor while speed-focused methodologies (GSD) enable rapid iteration
- Deterministic execution separation through schema validation is critical for reliability

---

## 1. Current Codebase Analysis

### 1.1 Existing Implementation

The opencode-harness extension already implements several key components relevant to methodology selection:

#### ModelSkillRegistry (`src/skills/ModelSkillRegistry.ts`)
- **Purpose:** Manages model-specific skill metadata and capabilities
- **Key Features:**
  - `ModelCapabilities` interface defining context windows, supported categories, preferred/avoided skills
  - `ModelSkillInfo` interface with performance, cost, latency, and quality scores
  - Pre-configured capabilities for Claude 3.5/4.x, GPT-4/5, Gemini 2.5 families
  - Weighted scoring algorithm for model-skill pair evaluation
  - Methods for finding best model for a skill and best skills for a model

#### Skills Infrastructure
- Skills modal UI with category filtering and search
- Skill suggestion manager with embedding-based recommendations
- Integration with MCP servers for skill discovery

#### Prompt Management
- `PromptManager` for workspace prompt scanning and custom commands
- Prompt stash manager for session-specific and global prompts
- Template-based prompt system with variable substitution

#### MCP Integration
- `McpServerManager` for managing MCP server connections
- MCP configuration UI in webview
- Integration with model context protocol for tool and resource access

#### Session Management
- Agent listing and management
- Multi-agent support through `SessionManager.listAgents()`
- State management across sessions with `StatePushService`

### 1.2 Gaps and Opportunities

**Existing Strengths:**
- Model capability profiling is already implemented
- Skills system provides a framework for methodology-specific capabilities
- MCP integration enables protocol-based tool access
- Frontend has UI infrastructure for methodology selection (tabs, panels, modals)

**Missing Capabilities:**
- No explicit methodology selection or routing logic
- No task complexity analysis for methodology matching
- No planning mode vs execution mode separation
- No adversarial agent pattern implementation
- No spec-driven development workflow integration
- No deterministic execution separation with schema validation
- No context window optimization strategies
- No model tiering based on intelligence levels

---

## 2. AI Development Methodologies Research

### 2.1 BMAD (Breakthrough Method of Agile AI-driven Development)

**Source:** https://docs.bmad-method.org/

**Core Principles:**
- **Persona-based specialization:** Distinct AI personas (Business Analyst, Product Manager, System Architect, Developer, QA Engineer)
- **Structured handoffs:** Explicit protocols for passing work between personas
- **Front-loaded artifacts:** Structured documents (briefs, specs, architecture docs, test plans) before code
- **Rigorous process:** Mirrors human engineering team practices

**Strengths:**
- Reduces context drift through structured artifacts
- Ensures thoroughness with explicit verification steps
- Clear separation of concerns across personas
- Well-documented handoff protocols

**Weaknesses:**
- Can be slow for small, rapidly changing projects
- Significant learning curve due to complexity
- Front-heavy approach may delay value delivery
- Over-engineered for simple tasks

**Best For:**
- Large-scale enterprise projects with defined scope
- Projects requiring architectural rigor
- Teams with multiple developers coordinating
- Regulatory or compliance-heavy environments

### 2.2 GSD (Get Stuff Done)

**Source:** https://gsd.build/

**Core Principles:**
- **Execution speed prioritization:** Optimizes for rapid iteration
- **Clear task decomposition:** Splits complex tasks into plan, execute, review phases
- **Clean context windows:** Each phase operates with focused context
- **Less formal structure:** Emphasizes getting work done over process

**Strengths:**
- Fast time-to-value for simple projects
- Reduces context rot through phase separation
- Minimal overhead for straightforward tasks
- Proven at major tech companies

**Weaknesses:**
- Less architectural rigor than BMAD
- May accumulate technical debt without oversight
- Less suitable for complex, multi-person projects
- Limited formal verification steps

**Best For:**
- Quick prototypes and MVPs
- Individual developer workflows
- Small teams with tight deadlines
- Projects where speed matters more than formal structure

### 2.3 Hermes Framework

**Source:** https://www.mindstudio.ai/blog/ai-agent-frameworks-compared-bmad-gsd-hermes

**Core Principles:**
- **Interface-centric design:** Focuses on communication protocols, not workflows
- **Standardized message formats:** Defines agent-to-agent communication contracts
- **Coordination mechanisms:** Provides patterns for multi-agent orchestration
- **Composable with other methodologies:** Can enhance BMAD or GSD workflows

**Strengths:**
- Protocol-based approach is reusable across methodologies
- Solves multi-agent communication failures
- Standardized interfaces reduce integration complexity
- Composable nature enables hybrid approaches

**Weaknesses:**
- Not a complete workflow solution (needs to be combined with other methodologies)
- Can seem over-engineered until communication failures are experienced
- Retrofitting into existing frameworks is challenging
- Requires upfront architecture work

**Best For:**
- Complex multi-agent systems
- Projects with reliable communication requirements
- Teams building agent frameworks
- Scenarios where communication failures are costly

### 2.4 Comparative Analysis

| Aspect | BMAD | GSD | Hermes |
|--------|------|-----|--------|
| **Primary Focus** | Structure & Specialization | Speed & Execution | Communication & Protocols |
| **Workflow Type** | Sequential personas | Phased decomposition | Interface definition |
| **Best For** | Large enterprise projects | Quick prototypes | Multi-agent systems |
| **Learning Curve** | High | Low | Medium |
| **Overhead** | High | Low | Medium |
| **Rigor** | Very High | Low | Medium |
| **Composability** | Low | Low | High |

---

## 3. Model Routing and Selection Strategies

### 3.1 Portkey Conditional Routing

**Source:** https://portkey.ai/docs/product/ai-gateway/conditional-routing

**Mechanism:**
- Uses `conditions` object with query operators (`$eq`, `$ne`, `$in`, `$nin`, `$regex`, `$gt`, `$gte`, `$lt`, `$lte`)
- Supports logical operators (`$and`, `$or`) for complex routing logic
- Routes requests based on request parameters and metadata

**Example Patterns:**
```javascript
// User plan-based routing
{ "query": { "metadata.user_plan": { "$eq": "paid" } }, "then": "finetuned-gpt4" }

// Parameter-based routing
{ "query": { "params.model": { "$eq": "smartest" } }, "then": "smartest-model-target" }

// Complex routing with logical operators
{ "query": { 
    "$and": [
      { "metadata.complexity": { "$gte": 8 } },
      { "params.task_type": { "$in": ["refactoring", "architecture"] } }
    ]
  }, 
  "then": "claude-opus-4-7" 
}
```

**Applicability to opencode-harness:**
- Can be implemented using existing `ModelSkillRegistry` scoring
- Metadata can include task complexity, domain, and model intelligence tier
- Enables dynamic routing based on task characteristics

### 3.2 Model Capability-Aware Strategy Selection

**Key Components:**

**1. Task Complexity Analysis**
- **Factors:** Codebase size, number of affected files, architectural impact, dependencies
- **Metrics:** Cyclomatic complexity, churn rate, coupling metrics
- **Classification:** Simple (<5), Medium (5-8), Complex (8+), Very Complex (10+)

**2. Model Intelligence Profiling**
- **High Intelligence:** Claude Opus 4.7, GPT-5, Gemini 2.5 Pro
- **Medium Intelligence:** Claude Sonnet 4.6, GPT-4 Turbo, Gemini 2.5 Flash
- **Lower Intelligence:** Claude Haiku 4.5, GPT-5 Mini, smaller models

**3. Dynamic Routing Logic**
```
IF task_complexity >= 8 AND domain == "architecture" THEN
  route_to: high_intelligence_model
  methodology: BMAD (structured, persona-based)
ELSE IF task_complexity >= 5 AND domain == "feature" THEN
  route_to: medium_intelligence_model
  methodology: Spec-anchored SDD
ELSE IF task_complexity < 5 AND urgency == "high" THEN
  route_to: any_available_model
  methodology: GSD (speed-focused)
ELSE
  route_to: cost_optimized_model
  methodology: Standard single-agent
END IF
```

**4. Fallback Strategies**
- **Model unavailability:** Cascade to next best model in tier
- **Cost constraints:** Use lower-intelligence model with enhanced prompting
- **Latency constraints:** Prioritize faster models over quality
- **Quality constraints:** Use higher-intelligence model regardless of cost

### 3.3 Intelligence Thresholds for Methodology Selection

**High Intelligence Models (Claude Opus 4.7, GPT-5, Gemini 2.5 Pro):**
- Can handle: BMAD workflows, complex multi-agent coordination, adversarial agent patterns
- Recommended for: Architecture decisions, complex refactoring, multi-file changes
- Prompting: Standard conversational prompting sufficient

**Medium Intelligence Models (Claude Sonnet 4.6, GPT-4 Turbo, Gemini 2.5 Flash):**
- Can handle: Spec-anchored SDD, parallel agent workflows, structured reasoning
- Recommended for: Feature implementation, debugging, documentation
- Prompting: Requires structured prompts with clear constraints

**Lower Intelligence Models (Claude Haiku 4.5, GPT-5 Mini):**
- Can handle: GSD workflows, single-agent tasks, well-defined scopes
- Recommended for: Quick fixes, simple refactoring, code generation
- Prompting: Requires enhanced prompting (planning mode, verbose instructions, iterative refinement)

---

## 4. Prompt Engineering for Lower-Intelligence Models

### 4.1 Plan Mode vs Act Mode

**Source:** https://www.prompthub.us/blog/prompt-engineering-for-ai-agents

**Concept:**
- **Plan Mode:** Agent gathers context, asks clarifying questions, brainstorms ideas
- **Act Mode:** Agent executes the plan step-by-step with confirmation after each step
- **Transition:** Clear strategy in place before switching to execution

**Implementation Pattern:**
```
SYSTEM: You are in PLAN MODE. Your goal is to understand the task and create a detailed plan.
- Ask clarifying questions about scope, constraints, and requirements
- Break down the task into discrete steps
- Identify potential risks and dependencies
- Do NOT execute any code or file operations
- When ready, explicitly state: "PLAN COMPLETE. Ready for ACT MODE."

[User confirms plan]

SYSTEM: You are now in ACT MODE. Execute the plan step-by-step.
- Only use one tool per message
- Wait for confirmation after each execution
- Explain your reasoning before each action
- If you encounter an issue, stop and reassess
```

**Benefits for Lower-Intelligence Models:**
- Reduces cognitive load by separating planning from execution
- Enables error detection before cascading failures
- Provides clear stopping points for user intervention
- Improves task completion rates

### 4.2 Structured Tool Usage

**Pattern:**
- XML-like syntax for tool calls with explicit parameters
- Examples provided for each tool
- Clear documentation of when and how to use each tool
- Modular toolset with well-defined boundaries

**Example:**
```
<tool_call>
  <name>write_to_file</name>
  <parameters>
    <path>/home/user/project/src/main.ts</path>
    <content>import { express } from 'express'
// ... rest of code
    </content>
  </parameters>
</tool_call>
```

**Benefits:**
- Consistent tool usage reduces errors
- Easier debugging when tool calls fail
- Clear separation between reasoning and action
- Better tool selection by lower-intelligence models

### 4.3 Context Optimization Techniques

**Source:** https://airbyte.com/agentic-data/ai-context-window-optimization-techniques

**1. Retrieval Augmented Generation (RAG)**
- Break documents into semantic chunks
- Generate embeddings for search
- Retrieve only relevant segments at query time
- Reduces token costs by sending only relevant chunks

**2. Prompt Compression**
- Progressive summarization: Summarize conversation history every few turns
- Multi-level summarization: Maintain summaries at different granularities
- Keyphrase extraction: Works well for technical documentation
- Extractive compression with rerankers: Filters noise while keeping relevant passages

**3. Selective Context Strategies**
- Episodic memories: Few-shot examples demonstrating desired behavior
- Procedural memories: Instructions that steer agent behavior
- Semantic memories: Task-relevant facts
- Dynamic context assembly based on current task

**4. Semantic Chunking**
- Document-aware chunking: Preserves tables, code blocks, headers
- Recursive character splitting: Breaks at natural boundaries
- LLM-based semantic chunking: Analyzes content structure for logical break points

**5. Summarization for Multi-Turn Conversations**
- Keep recent messages in full context (last 5-7 turns)
- Compress older messages into summaries
- Preserve system message and most recent exchanges
- Tool-based external memory for current data access

**Benefits for Lower-Intelligence Models:**
- Reduces context window pressure
- Focuses attention on most relevant information
- Enables longer conversations without context overflow
- Improves response quality by reducing noise

### 4.4 Conversational Prompting

**Pattern:**
- Verbose instructions with explicit constraints
- Step-by-step guidance for complex tasks
- Clear examples of desired behavior
- Explicit error handling instructions

**Example:**
```
You are a coding assistant helping with a TypeScript project.

IMPORTANT RULES:
1. Always read the entire file before making changes
2. Explain your reasoning before each code change
3. If you're unsure, ask for clarification
4. Test your changes by running the relevant tests
5. If a test fails, explain why and how to fix it

WORKFLOW:
1. First, understand the current code structure
2. Identify the files that need to be changed
3. Make one change at a time
4. Verify each change works before moving on
5. Summarize what you've done when complete

If you encounter an error:
- Stop and read the error message carefully
- Explain what the error means
- Propose a solution
- Wait for confirmation before proceeding
```

**Benefits:**
- Provides guardrails for lower-intelligence models
- Reduces hallucinations and incorrect actions
- Enables recovery from errors
- Improves task completion rates

### 4.5 Iterative Refinement

**Pattern:**
- Break complex tasks into smaller iterations
- Request feedback after each iteration
- Refine approach based on feedback
- Document decisions and reasoning

**Example:**
```
Let's implement this feature in iterations:

ITERATION 1: Basic structure
- Create the main function signature
- Add basic error handling
- Write a simple test

[Review and feedback]

ITERATION 2: Add complexity
- Implement the core logic
- Add validation
- Expand test coverage

[Review and feedback]

ITERATION 3: Polish and optimize
- Add error messages
- Optimize performance
- Finalize documentation

[Review and final approval]
```

**Benefits:**
- Reduces cognitive load per iteration
- Enables course correction early
- Improves final quality through feedback
- Makes progress visible and trackable

---

## 5. Model Context Protocol (MCP) and Open Standards

### 5.1 MCP Overview

**Source:** https://modelcontextprotocol.io/llms-full.txt

**Definition:**
MCP is an open standard that standardizes how applications provide context to LLMs, acting as a "USB-C port for AI applications."

**Core Concepts:**
- **Clients:** Applications that connect to MCP servers (Claude, ChatGPT, VS Code, Cursor)
- **Servers:** Expose data sources, tools, and apps to clients
- **Resources:** Data that can be read (files, database records, API responses)
- **Tools:** Functions that can be called (file operations, API calls, computations)
- **Prompts:** Pre-defined templates for common tasks
- **Tasks:** Long-running operations with status updates
- **Elicitation:** Protocol for extracting structured data from unstructured content

**Benefits:**
- **Developers:** Reduces development time and complexity
- **AI applications:** Access to ecosystem of data sources and tools
- **End-users:** More capable AI applications that can access data and take actions

**Ecosystem Support:**
- Claude, ChatGPT, VS Code, Cursor, MCPJam, and many others
- Build once, integrate everywhere

### 5.2 MCP in opencode-harness

**Current Implementation:**
- `McpServerManager` for managing MCP server connections
- MCP configuration UI in webview
- Integration with model context protocol for tool and resource access

**Opportunities:**
- Use MCP for methodology-specific tool discovery
- Expose methodology selection as MCP tools
- Integrate with spec-driven development through MCP resources
- Enable cross-agent communication via MCP protocols

### 5.3 Open Protocol Integration

**Key Protocols:**
- **MCP:** Tool and resource access
- **Hermes:** Agent-to-agent communication
- **OpenAI API:** Standard LLM interface
- **WebSocket:** Real-time communication
- **JSON Schema:** Structured data validation

**Integration Strategy:**
- Use MCP for tool discovery and invocation
- Implement Hermes-style message formats for agent coordination
- Use JSON Schema for deterministic execution validation
- Leverage WebSocket for streaming responses

---

## 6. Spec-Driven Development (SDD)

### 6.1 Overview

**Source:** https://www.augmentcode.com/guides/what-is-spec-driven-development

**Definition:**
Spec-driven development converts AI agent ambiguity into executable contracts by defining clear specifications that constrain what AI agents generate.

### 6.2 Six Elements of a Good Spec

1. **Outcomes:** What success looks like when work is done
   - Not: "build an auth flow"
   - Better: "A user can sign up with email/password, receive a verification email, and log in without error. The session persists across page refreshes."

2. **In-scope and out-of-scope boundaries:** Explicit boundaries prevent scope creep
   - In-scope: Email/password authentication
   - Out-of-scope: OAuth, social login, 2FA

3. **Constraints and assumptions:** Tech stack decisions, API limits, performance requirements
   - "Must use Next.js 14 with App Router"
   - "API rate limit: 100 requests/minute"
   - "Page load time: <2 seconds"

4. **Decisions already made:** Database schema, encryption library, deployment strategy
   - "Database: PostgreSQL with Prisma ORM"
   - "Encryption: bcrypt with cost factor 12"
   - "Deployment: Vercel with edge functions"

5. **Task breakdown:** Discrete sub-tasks for parallel execution and verification
   - Sub-task 1: Database schema migration
   - Sub-task 2: API endpoint implementation
   - Sub-task 3: Frontend form component
   - Sub-task 4: Integration testing

6. **Verification criteria:** Acceptance criteria and verification steps
   - "All tests pass with 100% coverage"
   - "No security vulnerabilities in SAST scan"
   - "Performance benchmarks meet targets"

### 6.3 Core SDD Patterns

**1. Spec-First Development**
- Specs come before code
- Code remains primary deliverable
- Specs constrain what AI agents generate
- Best for teams new to SDD

**2. Spec-Anchored Development**
- Adds governance layers and constitutional constraints
- Supervision checkpoints for approval
- Audit trails for compliance
- Best for regulated environments or multi-team coordination

**3. Spec-as-Source Development**
- Specs literally become source code
- Maximum specification authority
- Risk of heavy up-front specification
- Best for highly regulated industries

### 6.4 Adversarial Agent Pattern

**Structure:**
- **Coordinator:** Breaks down spec and delegates tasks to Implementors
- **Implementors:** Work from sub-specs to complete tasks
- **Verifier:** Checks output against spec before marking complete
- **Opposing goals:** Implementors optimize for completion, Verifier for finding failures

**Benefits:**
- Separate verification reduces bias
- Forces explicit verification criteria in specs
- Enables safer parallel workflows
- Catches conflicts before merge

**Implementation in opencode-harness:**
- Use existing agent infrastructure
- Implement Verifier as separate agent type
- Integrate with spec management through MCP resources
- Leverage `SessionManager.listAgents()` for coordination

### 6.5 Vibe Coding vs Spec-Driven Development

**Source:** https://towardsdatascience.com/from-vibe-coding-to-spec-driven-development/

**Vibe Coding:**
- Short prompt, generate code, check result, iterate
- Works for simple projects
- Lacks best practices and shared conventions
- Context decay in larger projects
- No persistence of reasoning

**Spec-Driven Development:**
- Front-loaded thinking: architectural decisions, requirements, documentation
- Structured markdown specification in repository
- Decouples specification from implementation
- Preserves context across sessions and agents
- Aligns humans and agents around non-negotiables

**SDD Workflow:**
1. **Constitution:** Mission, tech stack, roadmap
2. **Feature Development:** Specification, implementation, validation
3. **Replanning:** Revisit constitution, review decisions, ensure alignment

---

## 7. Deterministic Execution Separation

### 7.1 Overview

**Source:** https://ai.pydantic.dev/

**Concept:**
Separate LLM reasoning from deterministic code execution to improve reliability and reduce non-determinism.

### 7.2 Pydantic AI Framework

**Key Features:**
- **Schema validation:** Pydantic models constrain structured data returned by agents
- **JSON Schema generation:** Automatically builds schemas from type definitions
- **Validation guarantees:** Ensures data correctness at end of run
- **Function tools:** Register functions that LLM may call for deterministic logic

**Example:**
```python
from pydantic import BaseModel
from pydantic_ai import Agent, RunContext

class CustomerResult(BaseModel):
    name: str
    email: str
    status: str

@agent.instructions
async def get_customer(ctx: RunContext[Dependencies]) -> CustomerResult:
    customer = await ctx.deps.db.get_customer(ctx.deps.customer_id)
    return CustomerResult(
        name=customer.name,
        email=customer.email,
        status=customer.status
    )
```

**Benefits:**
- Type safety prevents malformed data
- Validation catches errors before they propagate
- Deterministic code execution reduces non-determinism
- Clear separation between reasoning and computation

### 7.3 Implementation in opencode-harness

**Current State:**
- No explicit schema validation for agent outputs
- No separation between LLM reasoning and code execution
- No deterministic execution guarantees

**Opportunities:**
- Add JSON Schema validation for tool inputs/outputs
- Implement schema-based validation for agent responses
- Separate LLM calls from file operations
- Add audit trails for deterministic execution

**Integration Points:**
- Extend `ModelSkillRegistry` with schema definitions
- Add validation layer in `StreamCoordinator`
- Implement schema validation in `ChatFileOps`
- Leverage TypeScript interfaces for type safety

---

## 8. Frontend Implementation Analysis

### 8.1 Current Frontend Patterns

**Webview Architecture (`src/chat/webview/main.ts`):**
- State management through `createState()`
- Tab-based UI with `createTabBar`, `switchToTab`, `closeTab`
- Model management with `setupModelManager`, `setupModelDropdown`
- Skills modal with category filtering and search
- Context usage panel and monitoring
- MCP configuration UI
- Prompt stash management

**Key Components:**
- `StatePushService`: Pushes state updates to webview
- `WebviewEventRouter`: Handles events from webview
- `ThemeController`: Manages theme synchronization
- `SessionLifecycleService`: Manages session lifecycle
- `CommandExecutionService`: Executes slash commands

### 8.2 Methodology-Specific UI Opportunities

**1. Methodology Selection UI**
- Add methodology selector to model dropdown
- Display current methodology in status strip
- Show methodology-specific guidance in sidebar

**2. Planning Mode UI**
- Toggle between plan/act modes
- Display plan summary before execution
- Show progress through plan steps

**3. Spec Management UI**
- Spec editor with markdown preview
- Spec version history
- Spec validation indicators
- Adversarial agent pattern visualization

**4. Context Optimization UI**
- Context usage breakdown by type
- Compression controls and settings
- RAG configuration interface
- Semantic chunking visualization

**5. Agent Coordination UI**
- Agent status dashboard
- Message flow visualization
- Handoff protocol indicators
- Parallel execution monitoring

### 8.3 Integration with Existing Patterns

**Tabs:**
- Use existing tab system for methodology-specific views
- Create methodology-specific tabs (Plan, Execute, Verify)
- Leverage `createTabUI` for dynamic tab creation

**Modals:**
- Extend skills modal for methodology selection
- Add spec editor modal
- Create agent coordination modal

**State Management:**
- Extend `WebviewState` with methodology field
- Use `StatePushService` for methodology updates
- Leverage existing state synchronization patterns

---

## 9. Recommended Strategies

### 9.1 Hybrid Methodology Approach

**Core Principle:**
No single methodology fits all scenarios. Implement a model-capability-aware routing system that selects the optimal methodology based on task complexity, model intelligence, and project context.

**Methodology Selection Matrix:**

| Task Complexity | Model Intelligence | Urgency | Recommended Methodology |
|----------------|-------------------|---------|------------------------|
| Very Complex (10+) | High | Low | BMAD (full persona-based) |
| Very Complex (10+) | Medium | Low | Spec-anchored SDD with adversarial pattern |
| Very Complex (10+) | Low | Any | Escalate to higher intelligence model |
| Complex (8-10) | High | Any | Spec-anchored SDD |
| Complex (8-10) | Medium | Low | Spec-anchored SDD |
| Complex (8-10) | Medium | High | GSD with planning mode |
| Complex (8-10) | Low | Any | GSD with enhanced prompting |
| Medium (5-7) | Any | High | GSD (speed-focused) |
| Medium (5-7) | Any | Low | Spec-first SDD |
| Simple (<5) | Any | Any | Standard single-agent with good prompts |

### 9.2 Model Tiering Implementation

**High Intelligence Tier (Claude Opus 4.7, GPT-5, Gemini 2.5 Pro):**
- Can use any methodology
- Recommended for: Architecture, complex refactoring, multi-file changes
- Prompting: Standard conversational
- Cost: Higher, but justified for complex tasks

**Medium Intelligence Tier (Claude Sonnet 4.6, GPT-4 Turbo, Gemini 2.5 Flash):**
- Can use: Spec-anchored SDD, GSD with planning mode, parallel workflows
- Recommended for: Features, debugging, documentation
- Prompting: Structured with clear constraints
- Cost: Balanced for most tasks

**Lower Intelligence Tier (Claude Haiku 4.5, GPT-5 Mini):**
- Can use: GSD, single-agent tasks, well-defined scopes
- Recommended for: Quick fixes, simple refactoring, code generation
- Prompting: Enhanced (planning mode, verbose, iterative)
- Cost: Lowest, good for routine tasks

### 9.3 Enhanced Prompting for Lower-Intelligence Models

**Required Enhancements:**
1. **Planning Mode:** Always start with plan mode for complex tasks
2. **Verbose Instructions:** Provide explicit step-by-step guidance
3. **Structured Tool Usage:** Use XML-like syntax for tool calls
4. **Context Optimization:** Apply RAG and compression techniques
5. **Iterative Refinement:** Break tasks into smaller iterations
6. **Error Handling:** Clear instructions for recovery from errors
7. **Verification:** Explicit verification criteria after each step

**Implementation:**
- Extend `PromptManager` with model-specific prompt templates
- Add planning mode toggle to prompt options
- Implement context optimization in `ContextEngine`
- Add iterative refinement workflow to `StreamCoordinator`

### 9.4 Spec-Driven Development Integration

**Implementation Strategy:**
1. **Phase 1: Spec Management**
   - Add spec storage and versioning
   - Implement spec editor UI
   - Add spec validation

2. **Phase 2: Spec-First Workflow**
   - Integrate spec creation before task execution
   - Add spec-based task decomposition
   - Implement spec-driven code generation

3. **Phase 3: Adversarial Pattern**
   - Implement Verifier agent
   - Add spec-based verification
   - Enable parallel agent workflows

**Integration Points:**
- Use `PromptManager` for spec templates
- Leverage `SessionManager` for agent coordination
- Extend `ModelSkillRegistry` with spec-specific skills
- Use MCP for spec resources and tools

### 9.5 Deterministic Execution Separation

**Implementation:**
1. **Schema Validation**
   - Add JSON Schema definitions for tool inputs/outputs
   - Implement validation layer in `StreamCoordinator`
   - Add schema-based validation for agent responses

2. **Execution Separation**
   - Separate LLM calls from file operations
   - Add audit trails for all deterministic operations
   - Implement rollback mechanisms for failed operations

3. **Error Handling**
   - Clear error messages with recovery instructions
   - Automatic retry with fallback strategies
   - User intervention points for critical failures

---

## 10. Identified Gaps in Current Approaches

### 10.1 Methodology Selection
- **Gap:** No explicit methodology selection or routing logic
- **Impact:** Cannot leverage optimal methodologies for different scenarios
- **Solution:** Implement model-capability-aware routing system

### 10.2 Task Complexity Analysis
- **Gap:** No task complexity analysis for methodology matching
- **Impact:** Cannot make informed methodology selection decisions
- **Solution:** Implement task complexity scoring based on multiple factors

### 10.3 Planning Mode
- **Gap:** No separation between planning and execution modes
- **Impact:** Lower-intelligence models struggle with complex tasks
- **Solution:** Implement planning mode with clear transition to execution

### 10.4 Spec-Driven Development
- **Gap:** No spec-driven development workflow integration
- **Impact:** Cannot leverage architectural rigor of SDD
- **Solution:** Integrate spec management and spec-based workflows

### 10.5 Adversarial Agent Pattern
- **Gap:** No adversarial agent pattern implementation
- **Impact:** Self-verification is biased and less reliable
- **Solution:** Implement separate Verifier agent with opposing goals

### 10.6 Deterministic Execution
- **Gap:** No schema validation or execution separation
- **Impact:** Non-deterministic behavior and potential data corruption
- **Solution:** Add schema validation and separate LLM reasoning from execution

### 10.7 Context Optimization
- **Gap:** No context window optimization strategies
- **Impact:** Context overflow in long conversations
- **Solution:** Implement RAG, compression, and selective context strategies

### 10.8 Model Tiering
- **Gap:** No explicit model tiering based on intelligence levels
- **Impact:** Cannot optimize methodology selection for model capabilities
- **Solution:** Implement intelligence tiering with methodology mappings

---

## 11. Implementation Recommendations

### 11.1 Phased Approach

**Phase 1: Foundation (Weeks 1-2)**
- Implement task complexity analysis
- Add model intelligence tiering
- Implement basic methodology routing
- Add planning mode for lower-intelligence models

**Phase 2: Spec Integration (Weeks 3-4)**
- Implement spec management system
- Add spec editor UI
- Integrate spec-driven workflows
- Implement spec-based task decomposition

**Phase 3: Advanced Features (Weeks 5-6)**
- Implement adversarial agent pattern
- Add deterministic execution separation
- Implement context optimization strategies
- Add agent coordination UI

**Phase 4: Polish and Testing (Weeks 7-8)**
- Comprehensive testing across methodologies
- Performance optimization
- Documentation and user guides
- Rollout and monitoring

### 11.2 Technical Priorities

**High Priority:**
1. Task complexity analysis and scoring
2. Model intelligence tiering
3. Basic methodology routing
4. Planning mode implementation
5. Enhanced prompting for lower-intelligence models

**Medium Priority:**
6. Spec management system
7. Spec-driven workflows
8. Context optimization strategies
9. Schema validation layer
10. Agent coordination UI

**Low Priority:**
11. Adversarial agent pattern
12. Deterministic execution separation
13. Advanced agent coordination
14. Cross-agent communication protocols
15. Multi-agent parallel execution

### 11.3 Risk Mitigation

**Risks:**
1. **Complexity:** Adding many methodologies may increase complexity
   - **Mitigation:** Start with simple routing, add complexity gradually
2. **Performance:** Additional analysis may slow down response times
   - **Mitigation:** Cache analysis results, optimize scoring algorithms
3. **User Confusion:** Too many options may confuse users
   - **Mitigation:** Provide sensible defaults, hide advanced options
4. **Model Availability:** Not all users have access to high-intelligence models
   - **Mitigation:** Implement fallback strategies, optimize for available models
5. **Breaking Changes:** Changes may break existing workflows
   - **Mitigation:** Maintain backward compatibility, provide migration guides

---

## 12. Conclusion

The opencode-harness extension has a solid foundation for implementing AI methodology enhancements. The existing `ModelSkillRegistry`, skills infrastructure, prompt management, and MCP integration provide the building blocks needed for model-capability-aware methodology selection.

**Key Takeaways:**
1. **Hybrid Approach:** No single methodology fits all scenarios; implement model-capability-aware routing
2. **Lower-Intelligence Support:** Enhanced prompting, planning mode, and context optimization are critical
3. **Spec-Driven Development:** Provides architectural rigor while maintaining flexibility
4. **Deterministic Execution:** Schema validation and execution separation improve reliability
5. **Frontend Parity:** UI enhancements needed to expose methodology selection and monitoring

**Next Steps:**
1. Design architecture based on research findings
2. Create detailed implementation plan
3. Begin Phase 1 implementation
4. Iterate based on user feedback

The research phase is complete. The next phase will focus on designing the architecture and creating a detailed implementation plan.
