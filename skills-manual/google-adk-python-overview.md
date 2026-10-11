# Google ADK (Agent Development Kit) — Python Overview

> Research based on: [official docs](https://google.github.io/adk-docs/), [GitHub repo](https://github.com/google/adk-python), [DeepWiki](https://deepwiki.com/google/adk-python)
> All claims below are evidence-backed from these sources.

---

## What It Is

Google ADK (Agent Development Kit) is an **open-source, code-first Python framework** for building, evaluating, and deploying AI agents. Created by Google, released April 2025 under Apache 2.0 license.

**Repo stats (live):** 18,389 stars | 3,076 forks | 589 open issues | Python 3.10–3.14 | Bi-weekly releases via PyPI (`google-adk`)

**Design philosophy:** Make agent development feel like software development — code-first (Python classes/functions, not YAML), model-agnostic, deployment-agnostic, with pluggable service backends.

---

## Core Architecture (Layered)

```
┌─────────────────────────────────────────────────────────┐
│  CLI / Web UI Layer                                      │
│  adk run | adk web | adk eval | adk deploy              │
│  (click CLI, FastAPI server, dev UI)                     │
├─────────────────────────────────────────────────────────┤
│  Runtime Layer                                           │
│  Runner (stateless) → InvocationContext → PluginManager  │
├─────────────────────────────────────────────────────────┤
│  Agent Layer                                             │
│  LlmAgent | SequentialAgent | ParallelAgent | LoopAgent  │
│  BaseAgent (custom agents)                               │
├─────────────────────────────────────────────────────────┤
│  LLM Flow Layer                                          │
│  BaseLlmFlow → SingleFlow → reason-act loop              │
├─────────────────────────────────────────────────────────┤
│  Model Layer                                             │
│  Gemini | AnthropicLlm/Claude | LiteLlm (100+ models)   │
├─────────────────────────────────────────────────────────┤
│  Tool Layer                                              │
│  FunctionTool | McpToolset | BigQueryToolset | OpenAPI    │
├─────────────────────────────────────────────────────────┤
│  Service Layer (pluggable backends)                      │
│  SessionService | ArtifactService | MemoryService        │
│  CredentialService                                       │
└─────────────────────────────────────────────────────────┘
```

*Source: DeepWiki architecture diagram, `src/google/adk/` package structure*

---

## Key Concepts

### Agents

Three categories (from docs):

| Type | Class(es) | Purpose |
|------|-----------|---------|
| **LLM Agents** | `LlmAgent`, `Agent` | LLM-powered reasoning, tool use, dynamic routing |
| **Workflow Agents** | `SequentialAgent`, `ParallelAgent`, `LoopAgent` | Deterministic flow control (no LLM for orchestration) |
| **Custom Agents** | Extend `BaseAgent` | Any custom logic |

**Multi-agent composition:** Agents have `sub_agents` — parent agents delegate to children. LLM decides when to invoke sub-agents based on their `description`. Workflow agents control execution order deterministically.

```python
# From README.md — multi-agent example
coordinator = LlmAgent(
    name="Coordinator",
    model="gemini-2.5-flash",
    description="I coordinate greetings and tasks.",
    sub_agents=[greeter, task_executor]  # LLM routes between these
)
```

### Runner (Stateless Execution)

The `Runner` class is intentionally **stateless** (from DeepWiki source analysis):
- Does NOT hold conversation history in memory
- Fetches session state from `SessionService` at start of each invocation
- Delegates all persistence to service interfaces
- Enables horizontal scaling and resumability

**Invocation flow:**
1. `Runner.run_async()` → `SessionService.get_session()` (load all events/state)
2. Create `InvocationContext` (bundles session, services, config)
3. `LlmAgent.run_async()` → `BaseLlmFlow._run_one_step_async()`
4. Reason-act loop: preprocess → LLM call → postprocess → tool execution → yield events
5. Events persisted via `append_event()` and streamed to client
6. Optional: `CompactionRequestProcessor` summarizes old events

### Tools

**Built-in tools:**
- `google_search` — web search
- Code execution (container-based, Vertex AI sandbox)
- BigQuery tools
- MCP protocol integration (`McpToolset`)
- OpenAPI spec tools (auto-generated from specs)
- `load_web_page` — web scraping

**Custom tools:** Any Python function decorated or wrapped as `FunctionTool`. Supports async.

**Tool confirmation flow (HITL):** Guard tool execution with explicit confirmation and custom input — human-in-the-loop before dangerous tool calls.

### Session, State, Memory

| Concept | Scope | Purpose |
|---------|-------|---------|
| **Session** | Single conversation thread | Chronological events + temporary state |
| **State** (`session.state`) | Within one session | Key-value data for current conversation |
| **Memory** | Cross-session | Searchable knowledge base spanning past sessions |

**Service backends (pluggable via URI):**

| Service | In-Memory | SQLite | Cloud SQL/Spanner | Vertex AI | GCS |
|---------|-----------|--------|-------------------|-----------|-----|
| SessionService | ✅ | ✅ (`sqlite:///`) | ✅ | ✅ (`vertexai://`) | — |
| ArtifactService | ✅ | — | — | — | ✅ (`gs://`) |
| MemoryService | — | — | — | ✅ (`vertexai://`) | — |

*Source: `cli/utils/service_factory.py`, official sessions docs*

### Evaluation Framework

ADK includes a built-in evaluation system (from eval docs):

- **Two evaluation dimensions:**
  1. **Trajectory evaluation** — did the agent take the right steps/tools?
  2. **Final response evaluation** — is the output correct/relevant?

- **Three ways to run evals:**
  1. `adk web` — visual eval in dev UI with trace view
  2. `pytest` — programmatic tests
  3. `adk eval` — CLI batch evaluation

- **User simulation:** `LlmBackedUserSimulator` for automated multi-turn testing

### Deployment

| Target | Method | Managed? |
|--------|--------|----------|
| **Vertex AI Agent Engine** | `adk deploy agent_engine` | Fully managed, auto-scaling |
| **Cloud Run** | `adk deploy cloud_run` | Managed containers |
| **GKE** | `adk deploy gke` | Kubernetes |
| **Any Docker host** | Manual Dockerfile | Self-managed |

All deployments use the same agent code — only backend service URIs change.

### A2A (Agent-to-Agent) Protocol

ADK integrates with Google's [A2A protocol](https://github.com/google-a2a/A2A/) for **remote agent-to-agent communication**:
- `RemoteA2aAgent` — call remote A2A-compliant agents
- `A2aAgentExecutor` — expose ADK agents as A2A services

### Plugins

Extensibility via `BasePlugin` interface with lifecycle hooks:
- `before_agent_run`, `after_agent_run`, etc.
- `PluginManager` in `runners.py` orchestrates plugin execution
- Example: `ContextFilterPlugin` (event compaction)

### Agent Config (No-Code)

Agents can also be defined without code via [Agent Config](https://google.github.io/adk-docs/agents/config/) — declarative JSON/YAML agent definitions.

---

## Dependency Profile

From `pyproject.toml` — the core package has **heavy** dependencies:

**Google Cloud (required, not optional):**
- `google-cloud-aiplatform[agent_engines]` — Vertex AI
- `google-cloud-bigquery` + `google-cloud-bigquery-storage`
- `google-cloud-bigtable`
- `google-cloud-dataplex`
- `google-cloud-discoveryengine`
- `google-cloud-pubsub`
- `google-cloud-secret-manager`
- `google-cloud-spanner`
- `google-cloud-speech`
- `google-cloud-storage`
- `google-genai`

**Other core deps:**
- `fastapi`, `uvicorn`, `starlette` — web server
- `pydantic` — data validation
- `sqlalchemy` + `sqlalchemy-spanner` — ORM
- `mcp` — MCP protocol
- `opentelemetry-*` (7 packages) — observability
- `graphviz` — graph rendering
- `httpx`, `requests` — HTTP clients
- `authlib` — OAuth for REST API tools

**Optional extensions** (extras):
- `anthropic` — Anthropic model support
- `litellm` — 100+ model providers
- `crewai[tools]` — CrewAI integration (Python 3.11 only)
- `langgraph` — LangGraph agent integration
- `docker` — container code executor
- `kubernetes` — GKE code executor

---

## Pros

1. **Code-first design** — Agents defined as Python classes/functions. Full IDE support, version control, testing, type hints. No opaque YAML/JSON configs required (though available as option).

2. **Model-agnostic** — Unified `BaseLlm` interface works with Gemini (native), Anthropic/Claude (native adapter), and 100+ models via LiteLLM. Not locked to Gemini despite Google origin.

3. **Stateless Runner pattern** — Runner fetches state from service on each invocation. Enables horizontal scaling, session resumability, and clean separation of concerns. Well-suited for serverless/container deployments.

4. **Rich tool ecosystem** — Native MCP support, OpenAPI spec tools, BigQuery, Google Search, code execution sandboxes, custom Python functions. Tool confirmation (HITL) built in.

5. **Built-in evaluation framework** — Trajectory + response evaluation, user simulation, CLI/web/pytest integration. Unusual for agent frameworks to include this out of the box.

6. **Multi-agent orchestration** — First-class support for agent hierarchies with `sub_agents`, deterministic workflow agents (Sequential/Parallel/Loop), and LLM-driven dynamic routing.

7. **Pluggable persistence** — All storage (sessions, artifacts, memory, credentials) behind base interfaces. Swap from in-memory to Cloud SQL/Spanner/GCS via URI config.

8. **Deployment CLI** — One-command deploy to Cloud Run, GKE, or Vertex AI Agent Engine. Same code runs locally and in production.

9. **A2A protocol** — Standard for inter-agent communication across services/organizations. Forward-looking interoperability.

10. **Active development** — 18.4k stars, bi-weekly releases, Google-backed, multi-language (Python, TypeScript, Go, Java). Community repo for extensions.

11. **Dev UI** — Built-in web UI (`adk web`) for testing, debugging, and showcasing agents with trace visualization.

12. **Plugin system** — Extensibility via lifecycle hooks without modifying core code. Clean separation of cross-cutting concerns (logging, telemetry, compaction).

---

## Cons

1. **Massive dependency footprint** — Core install pulls in 30+ Google Cloud packages (BigQuery, Spanner, Bigtable, Dataplex, Speech, PubSub, etc.) even if you never use them. The `pyproject.toml` lists ALL Google Cloud deps as **required**, not optional. This bloats installs significantly and creates version conflict risk.

2. **Google Cloud gravity** — While technically model-agnostic, the framework is deeply optimized for the Google ecosystem. Managed deployment targets are exclusively Google Cloud (Agent Engine, Cloud Run, GKE). Non-Google deployments require manual Docker packaging. Memory service only has Vertex AI implementation.

3. **High open issue count** — 589 open issues as of research date. For a project less than 1 year old, this suggests either rapid feature velocity outpacing stability, or community adoption outpacing maintainer capacity.

4. **Opinionated agent structure** — Mandatory directory convention (`my_agent/__init__.py` + `agent.py` with `root_agent` or `app`). `AgentLoader.load()` discovers agents by importing module and looking for these specific names. Less flexible than arbitrary Python entrypoints.

5. **Gemini-optimized internals** — Native `Gemini` model class has full feature support. Other models go through `LiteLlm` or `AnthropicLlm` adapters which may lag in feature parity (e.g., streaming, function calling format differences, reasoning/thinking tokens).

6. **Session state limitations** — In-memory session service loses all data on restart. Production requires Cloud SQL, Spanner, or Vertex AI — all Google Cloud. No native Redis, MongoDB, or PostgreSQL session backend (SQLite available for local dev only via `aiosqlite`).

7. **No native non-Google memory backends** — `BaseMemoryService` only has `VertexAiMemoryBankService` as a concrete implementation. No local or non-Google memory store out of the box.

8. **CrewAI integration limited** — `crewai[tools]` only works on Python 3.11 (not 3.12+) due to `chromadb/pypika` dependency conflicts. Noted directly in `pyproject.toml`.

9. **Event compaction complexity** — The `CompactionRequestProcessor` summarizes old events to manage context window, but this adds non-trivial complexity to debugging and understanding agent behavior in long conversations.

10. **Young ecosystem** — First release April 2025. While actively developed, documentation can be sparse for edge cases, and the community (adk-python-community repo: 153 stars, 43 open issues) is still small relative to alternatives like LangChain or CrewAI.

11. **OpenTelemetry version pinning** — OTel deps are pinned to `<1.39.0` due to "current agent_engines exporter constraints" (from pyproject.toml comment). This can conflict with other OTel-instrumented services in your stack.

12. **No built-in approval/human-gate workflow** — Tool confirmation (HITL) exists for individual tool calls, but there's no built-in workflow-level approval gate system (like Synapse's ApprovalManager). You'd need to implement this as custom agent logic.

---

## Comparison with Synapse's Architecture

| Aspect | Google ADK | Synapse |
|--------|-----------|---------|
| **Agent definition** | Code classes (`LlmAgent`, `BaseAgent`) or config | Config-driven `GenericAgent` from MongoDB |
| **Orchestration** | `sub_agents` hierarchy + workflow agents | Dynamic DAG (`WorkflowEngine`) from MongoDB |
| **Task assignment** | LLM-driven routing via `sub_agents` descriptions | Auction system with bid collection + critic validation |
| **State management** | `SessionService` (pluggable backends) | `SharedContext` cache + `MessageStore` (MongoDB) |
| **Tool execution** | `BaseTool.run_async()` (in-process or sandbox) | `MCPToolExecutor` → Container-Use (Docker isolation) |
| **Approval gates** | Tool confirmation (per-tool HITL) | Workflow-level `ApprovalManager` with dedup + timeout |
| **Deployment** | CLI-driven (Cloud Run, GKE, Agent Engine) | Custom deploy pipeline (build → push → K8s + health checks) |
| **Evaluation** | Built-in (`adk eval`, trajectory + response) | None built-in |
| **Model support** | Gemini native, Anthropic native, LiteLLM for 100+ | OpenAI API compatible via Bifrost proxy |
| **Persistence** | Pluggable services (in-memory, SQLite, Cloud SQL, Spanner) | MongoDB (single backend, well-integrated) |
| **Multi-agent comm** | A2A protocol (remote), `sub_agents` (local) | Event system (SSE) + message store |

### Key Takeaways for Synapse Context

**What ADK does well that Synapse could learn from:**
- Built-in evaluation framework — Synapse has no automated agent testing
- Stateless runner pattern — enables horizontal scaling without shared state
- Plugin system — clean extensibility hooks
- Model-agnostic layer — structured `BaseLlm` interface vs Synapse's single OpenAI-compatible path

**What Synapse does that ADK doesn't:**
- Auction-based task assignment with critic validation — more sophisticated than LLM routing
- Workflow-level approval gates with dedup and timeout — ADK only has per-tool HITL
- Dynamic workflow DAGs from database — ADK workflow agents are code-defined
- Container-Use isolation — full Docker sandboxing per project vs ADK's in-process tools
- File artifact management with versioning and snapshots — ADK artifacts are simpler

---

## Quick Start (Evidence from docs)

```bash
pip install google-adk
```

```python
# my_agent/agent.py
from google.adk.agents import Agent
from google.adk.tools import google_search

root_agent = Agent(
    name="search_assistant",
    model="gemini-2.5-flash",
    instruction="You are a helpful assistant. Answer user questions using Google Search.",
    description="An assistant that can search the web.",
    tools=[google_search]
)
```

```bash
adk web   # Launch dev UI with hot reload
adk run   # Run in terminal
adk eval  # Run evaluations
adk deploy cloud_run  # Deploy to Cloud Run
```

---

## Sources

- [Official docs](https://google.github.io/adk-docs/) — feature descriptions, agent types, deployment options
- [GitHub repo](https://github.com/google/adk-python) — README.md, pyproject.toml (dependency list), repo stats
- [DeepWiki](https://deepwiki.com/google/adk-python) — architecture analysis, code flow diagrams, design patterns
- [pyproject.toml](https://github.com/google/adk-python/blob/main/pyproject.toml) — exact dependency list and version constraints
