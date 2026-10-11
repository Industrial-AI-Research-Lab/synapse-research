# Synapse System Deep Dive — Part 1: Architecture & Agents
> All facts verified from live code, MongoDB MCP (synaps db), and SSH MCP (kubectl on live cluster).
> Build: `sha-46df638` | DB: `synaps` (66 MB) | 513 projects, 1,743 messages, 1,122 file_artifacts

---

## Live Cluster State (SSH-verified)

Pods in `synapse` namespace:

| Pod | Containers | Status |
|-----|-----------|--------|
| `synapse-synapse-backend-*` | **2**: `backend` + `dind` | Running |
| `synapse-synapse-frontend-*` | 1 | Running |
| `bifrost-*` | 1 | Running |
| `authelia-*` | 1 | Running |
| `redis-*` | 1 | Running |
| `docker-registry-*` | 1 | Running |

Jaeger and the Prometheus stack no longer run in-cluster — they live on the logging host (`10.0.0.3`). See [infrastructure.md](./infrastructure.md) for the split-host observability layout.

The `dind` (Docker-in-Docker) sidecar is what gives the backend real Docker access for container-use.

**Live env on `backend` container (kubectl exec verified):**
```
USE_BIFROST=true
BIFROST_URL=http://bifrost.synapse.svc.cluster.local:8080/v1
BIFROST_VK=sk-bf-612f6dca-...
BIFROST_FALLBACK_MODELS=openai/gpt-5.2-chat,openai/gpt-5.2-codex
CONTAINER_USE_ENABLED=true
CONTAINER_USE_CLI_PATH=/usr/local/bin/cu
DEPLOY_AGENT_PROD_ENABLED=true
DEPLOY_AGENT_REGISTRY_HOST=registry.synapse.***
DEPLOY_AGENT_APPS_DOMAIN=apps.***
MONGODB_DATABASE=synaps
```

---

## Server Startup — Boot Sequence

Entry: `src/main.py` → `uvicorn "api.main:app"` → `lifespan()` async context manager runs at startup.

```
1.  load_dotenv()
2.  Print build info (BUILD_SHA, BUILD_VERSION, GITHUB_RUN_NUMBER)
3.  MongoStorageBackend.initialize()
      → connect to MongoDB, write version to system_info collection
4.  LLMClient()
      → if USE_BIFROST=true: point AsyncOpenAI base_url to BIFROST_URL, auth=BIFROST_VK
5.  ToolRegistry() + load_from_db(storage) → load tool schemas from MongoDB
      (NOTE: tools also seeded from tools.yaml later in step 14; create_default_tools() is internal fallback if DB is empty)
6.  EventEmitter(storage_backend=storage)
7.  ContainerManager(cli_path=/usr/local/bin/cu, enabled=true)
8.  MCPToolExecutor(container_manager, storage)
9.  DeployService(storage, event_emitter, container_manager)
10. MessageStore(storage).initialize()    → message_sequences collection
11. ArtifactStore(storage).initialize()  → file_artifacts collection
12. container_manager.artifact_store = artifact_store   ← auto-sync wiring
13. Orchestrator(storage, llm_client, tool_registry, event_emitter,
                 container_manager, deploy_service, message_store, artifact_store)
      └── creates: TaskAuction(timeout=10), SnapshotManager, ProjectManager,
                   ApprovalManager, PhaseRunner, TaskExecutor, RevertManager,
                   WorkflowEngine (dynamic DAG executor)
14. load_agents_from_db(storage) → DYNAMIC agents from MongoDB:
      a. seed_agents(storage) → upsert from agents.yaml (only if changed)
      b. seed_workflows(storage) → upsert from workflows.json
      c. seed_tools(storage) → upsert from tools.yaml
      d. storage.get_agent_configurations(enabled_only=True)
      e. For each config → GenericAgent(cfg) → List[BaseAgent]
      ALL agents are GenericAgent instances. One class, different configs from MongoDB.
      No per-role agent classes exist — role and behaviour come entirely from config.
15. For each agent:
      → orchestrator.register_agent(agent) → inject_dependencies(shared_context=None, ...)
      → agent.mcp_executor = mcp_executor
      → agent.deploy_service = deploy_service (try/except safety guard)
16. Critic from agent pool (the GenericAgent with type=critic) → auction.critic_agent
17. ProjectLoader.startup_init()  → lazy-load mode, no eager state recovery
18. deps.set_*()  → make all singletons available to API routes
19. Auth bootstrap:
      → Create default tenant (__root__) if missing
      → Create default tenant_settings
      → Create root user from SYNAPSE_ROOT_EMAIL/PASSWORD env vars
20. Register event callbacks:
      → _persist_event: project_started, phase.requirements.completed,
        phase.planning.completed, phase.execution.completed,
        project_completed, project_failed → persist to DB
      → _snapshot_final_logs: phase.execution.completed,
        project_completed, project_failed → snapshot container logs
21. yield  (server is now running)
```

---

## API Layer

FastAPI at `src/api/main.py`. All routes under `src/api/routes/`.

**Key endpoints:**

| Method | Path | Action |
|--------|------|--------|
| `POST` | `/api/projects` | Create project + start async workflow (accepts `workflow_id`, `model_override`) |
| `GET` | `/api/projects/{id}` | Get project state |
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects/{id}/approve/{type}` | Approve a gate (legacy type-based) |
| `POST` | `/api/projects/{id}/approvals/{id}` | Approve by approval ID |
| `POST` | `/api/projects/{id}/refine/{type}` | Refine requirements/plan with feedback |
| `GET` | `/api/events/{project_id}` | SSE stream for this project |
| `POST` | `/api/projects/{id}/control` | cancel / revert |
| **Messages** | | |
| `GET` | `/api/projects/{id}/messages` | Full message history (sequence-ordered) |
| `POST` | `/api/projects/{id}/messages` | Send user message → intent classification → routing |
| `GET` | `/api/projects/{id}/messages/stream` | SSE stream for new messages |
| `GET` | `/api/projects/{id}/messages/pending-approval` | Current pending approval |
| **Configurations** | | |
| `GET/POST` | `/api/configurations/agents/` | CRUD agent configurations (MongoDB) |
| `GET/POST` | `/api/configurations/workflows/` | CRUD workflow definitions |
| `GET/POST` | `/api/configurations/tools/` | CRUD tool configurations |
| **Deploy** | | |
| `POST` | `/api/deployments/{project_id}` | Trigger deploy |

### Message Routing (Intent System)

When user sends a message via `POST /api/projects/{id}/messages`:

```
1. message_store.append_user_message() → MongoDB messages (always, first)
2. IntentClassifier (LLM, gpt-5-mini hardcoded):
   → Classifies intent: code_change | deploy | question | revert | approval | general
   (NOTE: "feedback" is NOT an LLM-classifiable intent — removed from classifier)
3. route_user_message() (intent_router.py):
   → question:    Direct LLM call with message history from DB (NOT an agent)
   → code_change: Create task → GenericAgent via execute_single_task
                  Post-task: sync container to repo, refresh artifacts,
                  supersede existing output approval, create NEW output approval,
                  append assistant summary message
   → approval/feedback/refine: If pending approval → refine_approval() → re-run planner/requirements
                  (router checks literal strings "approval"/"feedback"/"refine" for refinement)
   → revert:      revert_to_latest_user_message()
   → deploy:      seed deploy approval
   → general:     No action, message stored
```

**NOTE:** Intent classifier and question handler use hardcoded `gpt-5-mini`, ignoring project model override. See task 19 (Run Configurations).

---

## Agent Pool — Every Agent Explained

> **⚠️ IMPORTANT:** Every agent in the pipeline is a **GenericAgent** instance loaded from MongoDB via
> `load_agents_from_db()` (`agent_loader.py`). There are no per-role agent classes: each role
> (requirements, planner, coding, QA, critic, deploy) is the same `GenericAgent` driven by a different
> configuration from `agents.yaml`. The role behaviours are described below.

All agents extend `BaseAgent` (`src/agents/base.py`).

### GenericAgent — The Universal Agent Class

**File:** `src/agents/generic_agent.py` | **Used by:** ALL production agents

Every agent configuration from MongoDB becomes a GenericAgent instance:
```python
# agent_loader.py:56
agent = GenericAgent(cfg)  # cfg from MongoDB agent_configurations collection
```

GenericAgent reads from config: `model`, `temperature`, `system_prompt`, `allowed_phases`, `allowed_tools`, `eval_keywords`, `evaluation_model`, `use_streaming`, `reasoning_effort` (default "medium"), `name` (→ display_name), `step_limit` (default 30), `output_save_key`.

**Context access (what agents see):**
```
GenericAgent.execute_task(task)
  → _build_task_context(task)  [base.py:149]
    → shared_context.get_full_context()  [SYNC — returns conversation_history: []]
    → Returns: user_prompt ✅, plan ✅, artifacts ✅, conversation_history ❌ (empty)
  → task["description"]  ✅ (from plan or user input)
  → task["context"]      ✅ (additional context from task executor)
```

**Two execution paths:**
- `_execute_with_tools()` — if `allowed_tools` configured: StreamingAgentRunner or SimpleAgentRunner with tool calling
- `_execute_simple()` — if no tools: single LLM call → structured output

**Per-project cloning:** `ProjectManager.create_project_agents()` does `copy.copy(prototype)` for each agent, injects per-project `SharedContext` and `CancellationToken`, suffixes `agent_id` with `@{project_id}`.

**Why clone?** Prototypes are singletons registered once at startup. Cloning gives each project its own independent agent instance with its own `task_history`, `_read_paths`, conversation state, etc. — prevents cross-project state leakage between concurrent projects.

**Why `@{project_id}` suffix?** Makes every agent ID globally unique. SSE events, snapshots, and logs include `agent_id`, so the suffix lets you trace exactly which project's coding agent emitted a given event.

**Base class provides:**
- `bid_on_task()` → calls `evaluate_task()` + `_generate_bid_reasoning()`
- `execute_with_retry()` → calls `execute_task()` up to `max_retries` times with previous error context
- `call_llm()` → streaming via `stream_completion_with_callback()` if event_emitter present, else non-streaming. Retries 3× with exponential backoff (2/4/8s). Respects `CancellationToken`.
- `call_llm_json()` → same but forces JSON output mode
- `execute_tool()` → routes via `mcp_executor` to container. Emits `tool_started`/`tool_executed` events.
- `_emit_event()` → wrapper around event_emitter.emit() with project_id injection
- `can_bid_on_phase(phase)` → checks `allowed_phases` policy

> **On model resolution:** `call_llm()` resolves the actual model in this order:
> 1. Explicit `model=` kwarg passed at call site
> 2. `shared_context._model_override` — set at project creation if user selected a model
> 3. `self.model` — from agent config in MongoDB (fallback only)

---

### Agent Roles (all GenericAgent, config-driven)

There are no per-role agent classes. Every role below is the same `GenericAgent`
(`src/agents/generic_agent.py`) instantiated from one document in `agents.yaml`
(seeded into the `agent_configurations` collection, loaded by `agent_loader.py`).
What makes one instance behave as a planner and another as a coding agent is its
config: `type`, `system_prompt`, `model`, `allowed_phases`, `allowed_tools`, and
`output_save_key`. Roles that take part in a phase are chosen per task by the auction
(see the Auction System section); `human_expert`, `requirements_finalizer`, and
`deploy_agent` are invoked directly, not auctioned.

**Requirements — three configs, run in sequence (details in Part 2, Phase 1):**
- `requirements_gatherer` — analyzes the prompt and emits clarifying questions. Its
  `system_prompt` scales question count to prompt complexity (1-2 word prompt → 0-1
  questions; a real project → 3-7). Output shape: `{analysis:{project_type,
  clarity_score, missing_info, technologies_mentioned}, questions:[...]}`.
- `human_expert` — direct (not auctioned). Auto-answers the gatherer's questions and
  escalates only credentials, keys, personal data, and legal requirements. Its
  autonomy lives entirely in its `system_prompt`: the shipped prompt runs
  `AUTONOMY MODE: HIGH` at a 0.6 confidence threshold. There is no env var — change
  the behaviour by editing the `human_expert` entry in `agents.yaml`. Returns
  `{answered_questions[], needs_human[], inferred_decisions{}}`.
- `requirements_finalizer` — direct. Receives the expert's output as task context,
  merges the answers + inferred decisions into a `RequirementsSchema`, and saves it
  under `requirements` (→ `contexts` collection) via `output_save_key: "requirements"`.

**Planning — `planner`** (`output_save_key: "plan"`): produces a FLAT,
dependency-ordered task list (each task: `task_id`, `description`, `dependencies`).
The `system_prompt` scales scope — vague prompts → 1-2 tasks, real projects → many —
and the list is saved under `plan` (→ `contexts`). Like every GenericAgent it builds
task context from the sync `get_full_context()`, so `conversation_history` is empty;
it still works from `requirements` and `user_prompt` in `_cache` (see the F11 note in
Part 2).

**Execution — `coding` and `qa`:**
- `coding` (`use_streaming: true`, `step_limit: 30`; tools: create, read, edit, grep,
  glob, bash, web_search, todo_read, todo_write, task) runs
  `GenericAgent._execute_with_tools()` → `StreamingAgentRunner` against the OpenAI
  Responses API, streaming thinking tokens as `agent.streaming.thinking` events. Tool
  calls route through `AgentToolDispatcher` (`tool_dispatcher.py`), which enforces a
  read-before-edit discipline with a per-instance `_read_paths` set:
    - `create` → if the path already exists → error "File already exists; read then
      edit instead of create"; otherwise write and record the path (new files only).
    - `read` → read (with an optional line-range slice) and add the path to
      `_read_paths`, unlocking `edit` for it.
    - `edit` → if the file exists but is not in `_read_paths` → error "Read before
      Edit: file has not been read"; otherwise apply a unified diff.
    - `grep`/`glob` do a pure-Python file walk (not container `grep`); `bash` refuses
      `grep`/`rg` ("Use the grep tool") and `cat`-based writes ("Use create/edit"),
      otherwise runs the command in the container.
  The loop runs until the model returns text with no tool call or the step limit is
  reached, then returns a COMPLETED/FAILED `ResultSchema`.
- `qa` — reviews code for syntax, logic, security, and best-practice issues and
  reports `{validation_status, issues_found[], overall_assessment}`.

**Auction validation — `critic`** (type `critic`, all phases): not a task executor.
The GenericAgent whose type is `critic` is registered as `auction.critic_agent` and
validates each auction winner via `TaskAuction._validate_with_critic()` (see the
Auction System section).

**Deploy — `deploy_agent`** (type `integration`, `allowed_phases: []` so never
auctioned, `step_limit: 8`; tools: deploy_from_artifacts, detect_stack,
analyze_and_repair): invoked directly on a deploy approval. The orchestrator builds a
fresh `GenericAgent` from the `deploy_agent` config, injects `deploy_service` + the
project `shared_context`, and drives a repair loop (max 3 attempts):

```
For attempt 1..3:
  1. detect_stack + build deploy spec (LLM); port forced to 8000
  2. deploy_service.deploy_from_artifacts_prod(...)   [→ see Deploy Pipeline, Part 2]
  3. deploy_status == "succeeded"? → COMPLETED
  4. Failed → analyze_and_repair() (LLM patches artifacts). If it reports
     needs_delegation, the orchestrator runs the coding role once via
     _run_coding_fix(): resolve the `coding_agent` config → GenericAgent on the same
     shared_context → execute_task() with the build error + recommendation as the
     task description; fixed files flow back through shared_context. Then retry.
After 3 failed attempts: FAILED.
```

---

## Auction System

**File:** `src/orchestration/auction.py` | **Bid collection timeout:** 10s (`TaskAuction(timeout=10)`) | **Overall phase timeout:** 120s (`PhaseRunner` wraps `run_auction()` in `asyncio.wait_for(timeout=120.0)`)

```
TaskAuction.run_auction(task, agent_pool, token, phase)

1. emit AUCTION_STARTED event (fire-and-forget asyncio.create_task)

2. _collect_bids(task, eligible_agents):
   → Filter: agent.can_bid_on_phase(phase)
   → Parallel asyncio.gather: each eligible agent.bid_on_task(task)
     → agent sets _bidding_phase=True (so streaming events show phase="bidding")
     → agent.evaluate_task(task) → fit_score (0-1)
     → agent._generate_bid_reasoning(task, fit_score) → string
     → returns {agent_id, agent_type, fit_score, reasoning, timestamp}
   → Collect all bids that succeed (failures skipped)

3. If no bids:
   → Fallback by task_type: pick the agent whose agent_type matches (coding→coding, qa→qa) at fit_score=0.8
   → If no fallback: emit AUCTION_NO_BIDS, return winner=None

4. best_bid = max(bids, key=lambda b: b["fit_score"])
   → emit AUCTION_BEST_BID event

5. Critic validation (if critic_agent set):
   → critic GenericAgent (type=critic) via TaskAuction._validate_with_critic(task, best_bid, bids)
   → Fail-open: only an explicit approved=False rejects, then retry with the second-best bid

6. emit AUCTION_COMPLETED event

7. Return {winner: agent, winning_bid: bid, all_bids: [...], critic_validation: {...}}

8. Caller: TaskExecutor.execute_single_task
   → emit TASK_ASSIGNED event
   → create snapshots: auction_started, auction_completed, task_assigned, task_start
   → agent.execute_task(task) [wrapped in execute_with_retry]
   → create snapshot: task_completed
   → create file_checkpoint in artifact_store
```

---

## See Part 2 for:
- **WorkflowEngine** — dynamic DAG executor (nodes + edges from MongoDB)
- Full workflow phases (Requirements → Planning → Execution → Output)
- Approval gates in detail
- Deploy pipeline (build → push → K8s)
- Container-Use sandbox internals
- LLM Client + Bifrost routing
- SharedContext + MongoDB persistence
- Event system (SSE)
- MongoDB schema (all 19 collections)
- Complete data flow from user prompt to end result

→ `docs/skills/system-deep-dive-part2.md`
