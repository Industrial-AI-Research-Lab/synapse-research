# Synapse System Deep Dive — Part 2: Orchestration, Deploy, Data Flow
> Continuation of `system-deep-dive.md`. All facts from code + MongoDB MCP + SSH MCP.

---

## Orchestration — All Workflow Phases

### WorkflowEngine — Dynamic DAG Executor

**File:** `src/orchestration/workflow_engine.py` (501 lines)

The orchestrator does NOT use a hardcoded phase sequence. Instead, `run_workflow()` loads a **workflow definition** (DAG of nodes + edges) from MongoDB and delegates to `WorkflowEngine.execute()`.

```
Orchestrator.run_workflow(project_id):
  1. Load workflow_def from MongoDB (collection: workflow_definitions)
     → fallback: _get_fallback_build_workflow() if DB is empty
  2. WorkflowEngine.execute(project_id, workflow_def):
     → validate_dag(): exactly 1 start + 1 end node, no cycles (Kahn's algorithm)
     → Walk DAG from start node, max 50 iterations

Node types:
  • start/end      — entry/exit markers
  • phase          — runs agent via PhaseRunner (auction or direct)
                     Configured by: task_type, agent_selection, agent_type, description
  • approval_gate  — generic pause: request human yes/no via ApprovalManager
                     No hardcoded approval type — gate_label from node config
  • execution      — parallel task execution via TaskExecutor
  • deploy         — check env vars → request deploy approval → execute via DeployAgent

Phase transitions:
  • Auto-emits phase.{label}.started/completed on phase_label changes
  • Creates snapshots between phases
  • On gate rejection: follows "rejected" edge back (controlled retry loop)

Default workflow DAG (fallback, also seeded as "default_build"):
  start → req_gather(auction) → human_expert(direct) → req_finalizer(direct)
    → gate_req → planning(auction) → gate_plan → execution → gate_output → end
  Rejected edges: gate_req→req_gather, gate_plan→planning (retry loops)
```

The engine knows NOTHING about specific phases. New workflows (with arbitrary phases/agents) can be added in MongoDB without touching Python code. Editable via `/api/configurations/workflows/`.

---

### Project Start (ProjectManager.start_project)

```
1. gpt-5-nano title generation ("under 60 chars, title case")
2. project_id = uuid4(), run_id = uuid4()
3. SharedContext.initialize(user_prompt) → writes seq 1 to messages collection
4. projects collection: status="initialized", current_phase="requirements"
5. create_project_agents() → shallow copy each prototype, inject SharedContext + token
6. emit project_started → SSE
7. asyncio.create_task(run_workflow) → return project_id immediately to API caller
```

---

### Phase 1: Requirements

> **NOTE:** Every role is a GenericAgent instance loaded from MongoDB (`agents.yaml`).
> The behaviour below is defined by the `requirements_gatherer`, `human_expert`, and
> `requirements_finalizer` configs — there are no hardcoded agent classes.

```
1. emit phase.requirements.started
2. Auction (phase="requirements"):
   → GenericAgent with type=requirements_gatherer wins (eval_keywords match)
   → execute_task():
       call_llm_json: analyze prompt → {project_type, clarity_score, missing_info[]}
       call_llm_json: generate questions → [{question, category, priority}]
       writes messages seq N: "Analyzing... N questions to clarify."
3. GenericAgent with type=human_expert — DIRECT (no auction):
   → AUTONOMY MODE: HIGH (set in the human_expert system_prompt): answer ALL questions
   → Only escalate: API keys, credentials, passwords
   → Returns {answered_questions[], needs_human[], inferred_decisions{}}
4. GenericAgent with type=requirements_finalizer — DIRECT (no auction):
   → Receives human_expert output as task context (previous_output)
   → Creates final requirements document from answers + inferred decisions
   → Merges all answers → RequirementsSchema → contexts collection
   → writes messages seq N+1: "Requirements finalized"
5. emit phase.requirements.completed + create snapshot
6. GATE #1: ApprovalManager.request_approval("requirements")
   → dedup check in memory + DB → write approval message to messages collection
   → _snapshot_files_to_db() → file_artifacts collection
   → emit approval_requested → SSE → UI shows gate
7. wait_for_approval() (polls 1s, 1h timeout [3600s default])
   → User POSTs /api/approvals/{id}/approve
   → writes "[APPROVE]" user message + approval_result system message
   → continue
```

**Real MongoDB sequence** (project `d9bd1dd8-0f4d-4e4e-94bd-820432c52f22`):
```
seq 1: user   → full discord splitter prompt
seq 2: asst   → "Analyzing... 4 questions to clarify."
seq 3: asst   → "Requirements finalized for Text Processing Utility / Web Tool"
seq 4: approv → subtype=requirements, "Please review..."
seq 5: user   → "[APPROVE] general"
seq 6: system → subtype=approval_result, "General approved. Continuing workflow..."
```

---

### Phase 2: Planning

```
1. emit phase.planning.started
2. Auction (phase="planning"):
   → GenericAgent with type=planner wins (eval_keywords match)
   → GenericAgent.execute_task():
       _build_task_context() → sync get_full_context() → conversation_history: [] (empty!)
       Agent sees: user_prompt ✅, requirements ✅, task.description ✅
       Agent does NOT see: previous conversation messages ❌
       call_llm: create flat ordered task list with UUID task_ids
       Scale: vague prompts → 1-2 tasks; real projects → 5-12 tasks
       shared_context.update_plan() → contexts collection
       writes messages seq N: "Created plan with N tasks"
3. emit phase.planning.completed + snapshot
4. GATE #2: ApprovalManager.request_approval("plan", plan_data)
   → emit approval_requested → SSE
5. User may REFINE via two paths:
   a. POST /api/projects/{id}/messages → intent=feedback → refine_approval()
      → _refine_plan(): task description="Re-plan based on user feedback" (⚠️ generic, 
        actual feedback text NOT in description — known bug, see F11 task)
   b. POST /api/projects/{id}/refine/plan → same _refine_plan() flow
6. User approves → continue

NOTE: The planner role is a GenericAgent; like every GenericAgent it builds task context
from the sync get_full_context() → conversation_history: []. It still works because it
reads requirements and user_prompt from _cache. See F11 task for details.
```

**Real MongoDB sequence** (same project, continued):
```
seq 7:  asst   → "Created plan with 7 tasks"
seq 8:  approv → subtype=plan
seq 9:  user   → "i want it to be available on web (as web endpoint) update the plan"
seq 10: asst   → "Created plan with 6 tasks"
```
(User refined the plan mid-approval — orchestrator handled it correctly)

---

### Phase 3: Execution

```
TaskExecutor.execute_tasks() loop:
  Re-fetch plan from shared_context on EACH iteration (picks up /refine changes).
  
  For each task in flat list (until all done):
    1. emit execution_task_started
    2. execute_single_task():
       a. Snapshot: auction_started
       b. Auction (phase="execution"):
          → GenericAgent with type=coding bids (eval_keywords match coding tasks)
          → GenericAgent with type=qa bids on test tasks
          → CriticAgent (GenericAgent with type=critic) validates winner
       c. Snapshot: auction_completed, task_assigned
       d. emit TASK_ASSIGNED
       e. Snapshot: task_start (checkpoint for revert)
       f. agent.execute_with_retry(task, max_retries=3):
          → GenericAgent._execute_with_tools() → StreamingAgentRunner (30 tool rounds max)
          → On failure: retry with previous error in context
       g. Snapshot: task_completed
       h. artifact_store.create_file_checkpoint(project_id, latest_seq, run_id)
    3. add task_id to completed_task_ids
    4. emit execution_task_finished

Post-execution:
  _sync_container_to_repo():
    → container_manager.apply_environment() → cu CLI commits container → git branch
    → container_manager.checkout_environment() → cu CLI checks out on host
  
  _prepare_final_artifacts():
    → dedupe by path (longest content wins same-path conflicts)
    → _harvest_from_container() → read files DIRECTLY from Docker container
      (preferred: no git conflict issues)
    → fallback: read from container-use git branch on host
    → max 50 files
  
  artifact_store.snapshot_from_artifacts(force=True) → file_artifacts collection

```

### Container vs Git — Two-Tier File System Explained

This distinction is important for understanding post-execution file collection:

```
DOCKER CONTAINER (live runtime)
  Created by: cu mcp subprocess (JSON-RPC stdio)
  Location: inside dind Docker daemon on the backend pod
  When used: during execution — every coding-agent tool call writes here in real-time
  State: always most current, uncommitted changes included
  Read via: container_manager.read_file_from_container() → cu mcp JSON-RPC
  Auto-synced to: MongoDB file_artifacts on every create/edit tool call

GIT REPO (snapshotted state)
  Location: {REPOSITORIES_ROOT}/synapse-{project_id}/ on host filesystem
  Created by: RepoManager.ensure_repo() at container creation time
  Used by: container-use as the "environment source" (defines base image, mounts, env)
  Committed via: apply_environment() → cu CLI creates/updates branch "container-use/{id}"
  Checked out via: checkout_environment() → cu CLI checks out that branch on host
  Read via: standard Python file I/O after checkout

HARVEST PRIORITY (in _prepare_final_artifacts and _snapshot_files_to_db):
  1. Try CONTAINER (most current, no git conflicts, live state)
     → If container active and files returned: USE THESE
  2. Fallback GIT REPO (if container is gone/unreachable)
     → git branch -a to find container-use branch
     → git checkout that branch on host
     → read files from disk (skips files with git conflict markers)

WHY TWO TIERS?
  Container = live runtime (writes happen here, not yet committed to git)
  Git = committed snapshots (for recovery, revert, host-side access)
  Container is always fresher. Git is the durable fallback.
```

```
  GATE #3: ApprovalManager.request_approval("output", {artifacts, execution_result})
  
  update_project_status("completed") → emit PROJECT_COMPLETED
```

---

## Approval Gates

Three gates in every project. Each gate:

| Gate | Type | Data shown to user |
|------|------|-------------------|
| #1 | `requirements` | Q&A answers, inferred decisions, tech stack |
| #2 | `plan` | Flat task list with descriptions + complexity |
| #3 | `output` | All generated files (from file_artifacts) |

**Dedup protection (two-tier):** `ApprovalManager.request_approval()` runs two checks before creating a new gate:

```
1. In-memory check: scan pending_approvals dict
   → Same project_id + approval_type + status==PENDING already exists?
   → Return existing approval_id immediately (no duplicate gate created)

2. DB check: message_store.get_pending_approvals_for_project()
   → Scan messages collection for approval-type messages for this project
   → Return approval_id from existing DB record if found
```

Why two tiers?
- **In-memory** covers the fast path (same server run, no restart). O(n) scan over the dict.
- **DB** covers restart recovery: on server restart, the in-memory dict is empty. Without the DB check, a resumed project would create a *second* approval gate for the same phase, confusing the UI. The DB check finds the still-pending approval message and returns its approval_id instead.
- Together they also prevent race conditions where two concurrent workflow paths try to create the same gate (e.g. refine loop re-entering planning approval).

**Timeout:** 1 hour by default (3600s in `wait_for_approval`). The WorkflowEngine does NOT wrap with a separate outer timeout. After timeout: `status="waiting_approval_timeout"`, workflow pauses. Can be resumed later.

**Messages = single source of truth:** approvals, approve/reject actions, refinements all written to `messages` collection with sequence numbers. State recovery reads from messages.

---

## Deploy Agent & Prod Pipeline

**Triggered:** POST `/api/deployments/{project_id}` → GenericAgent (deploy config).execute_task()
**Not auctioned** — called directly. Max 3 repair attempts.

```
Attempt loop (max 3):

1. _build_deploy_spec(project_id):
   detect_stack(file_artifacts):
     package.json + react → "react"
     requirements.txt + app.py → "python"
     index.html only → "static"
   LLM confirms spec (gpt-5-chat-latest, temp=0.2):
     Input: file list + key config snippets
     Output: {stack, port, details{build_dir, entry}}
     Force port=8000 (override any LLM value)

2. deploy_service.deploy_from_artifacts_prod():

   a. Guard: DEPLOY_AGENT_PROD_ENABLED=true (set on cluster: yes)
   b. service_name = DNS-1035 slug from project_id
   c. deployment = {id, status:"running", namespace:"synapse-apps", port:8000}
   d. emit deploy_started

   e. build_and_push_from_artifacts():
      i.  Load from file_artifacts collection (DB-first, most current)
          Fallback: shared_context.artifacts
      ii. Write files into a temporary folder on the backend, removed after the push;
          the project's sandbox is never opened
      iii.Select Dockerfile template (dockerfile_for_stack):
            static  → nginx serving files
            python  → pip install + uvicorn
            react   → npm ci + npm build + nginx
            node    → npm ci + node server
      iv. docker build -t registry.synapse.bonpp.com/synapse/{slug}:{deployment_id} .
      v.  maybe_registry_login(registry.synapse.bonpp.com, username=ci)
      vi. docker push {image_ref}
      Returns: {ok, image_ref, diagnostics{last_step, failed_command, stderr_tail}}

   f. If build fails → emit deploy_failed → deploy agent (GenericAgent) attempts repair (step 3)

   g. ProdK8sDeployHelper.deploy():
      → kubectl apply: Deployment (1 replica), Service (ClusterIP), Ingress
        host = {service_name}.apps.bonpp.com
        annotations: traefik TLS + cert-manager letsencrypt
      → kubectl rollout status --timeout=120s

   h. Health checks:
      run_health_check_with_retry(url, retries=5, delay=10s)
      run_external_url_health_check()

   i. deployment.status = "succeeded"
      emit deploy_succeeded
      return {deployment, deploy_status:"succeeded", url:"{slug}.apps.bonpp.com"}

3. If failed: analyze_and_repair():
   LLM reads: last_step, failed_command, stderr_tail, stdout_tail
   → Applies code patches to shared_context.artifacts
   → If needs_delegation: the orchestrator runs the coding role once via _run_coding_fix()
     → GenericAgent (coding config).execute_task("Fix build/deploy error: {stderr} + recommendation")
     → Merges fixed artifacts back
   → Retry from step 1
```

---

## Container-Use Sandbox

Each project gets an isolated Docker container. The `dind` sidecar container on the backend pod provides Docker access.

```
ContainerManager.get_or_create_container(project_id):
  1. Check containers[project_id] cache
  2. RepoManager.ensure_repo("synapse-{project_id}")
     → Creates git repo at {REPOSITORIES_ROOT}/synapse-{project_id}
  3. Copy .container-use/environment.json into repo
     (defines: base image, mounts, env vars for the container)
  4. ContainerUseMCPClient(cli_path=/usr/local/bin/cu, environment_source=repo_path)
  5. cu list preflight (verify cu CLI works)
  6. client.connect() → spawn "cu mcp" as subprocess (stdio JSON-RPC)
  7. client.create_environment() → Docker container created, returns environment_id
  8. Store: {client, environment_id, repo_path, status:"running"}
```

**Tool call chain:**
```
GenericAgent.execute_tool(tool_id, params)
  → MCPToolExecutor.execute_tool(tool_id, project_id, params)
    → Flood guard (30 calls/5s per project+tool)
    → handler: _handle_create_file / _handle_read_file / _handle_run_command / etc.
      → ContainerManager.get_or_create_container(project_id)
      → client.call_tool("environment/writeFile"|"environment/runCommand"|...)
        → JSON-RPC over stdio → cu mcp process → Docker container
          → File written / command executed INSIDE container
      → artifact_store.upsert_file() ← auto-sync every write to MongoDB
```

---

## LLM Client & Bifrost

```
USE_BIFROST=true on cluster:
  AsyncOpenAI(base_url="http://bifrost.synapse.svc.cluster.local:8080/v1",
              api_key=BIFROST_VK)

Bifrost pod (bifrost-5bdbbc8db8-k4vr6):
  → Provider: openrouter
  → Fallback chain: openai/gpt-5.2-chat → openai/gpt-5.2-codex
  → Handles rate limits, retries, load distribution

chat_completion retry loop (max 3):
  → exponential backoff: 2s / 4s / 8s
  → Respects CancellationToken (raises if cancelled)
  → Strips temperature for reasoning models
  → Forces JSON mode if call_llm_json used

StreamingAgentRunner uses OpenAI Responses API:
  → Real-time thinking blocks → emit agent.streaming.thinking events → SSE → UI
  → Inline tool execution during stream (tool result appended, generation continues)
  → api_key_override: per-project ephemeral key stored in shared_context._ephemeral_api_key
```

---

## SharedContext & Persistence

```python
_cache = {
  "project_id": str,
  "created_at": str,     # datetime.utcnow().isoformat() at init
  "user_prompt": str,
  "requirements": {},    # RequirementsSchema (tech_stack, Q&A, clarity_score)
  "plan": {},            # {main_goal, tasks:[{task_id, description, type, complexity}]}
  "decisions": [],       # [{agent_id, decision, reasoning, metadata, timestamp}]
  "artifacts": [],       # [{type, path, content, metadata}]  ← stale; file_artifacts is truth
  "insights": [],        # [{key, value, category, timestamp}]
  "deploy_status": "not_started"|"deploying"|"succeeded"|"failed",
  "deploy_error": None,  # Error details if deploy failed
  "deployments": [],     # [{deployment_id, ingress_host, status, health}]
}

# Dynamic attributes (set at project creation, NOT persisted in _cache):
_model_override: str       # Project-level model override (from UI settings)
_ephemeral_api_key: str    # Per-project API key override
_cancelled: bool           # Cancellation flag (checked by agents in call_llm)
```

**Two context methods (⚠️ sync/async split — see F11 task):**
```python
get_full_context()        # SYNC — returns conversation_history: [] (empty!)
                          # Used by: ALL GenericAgent via _build_task_context()
get_full_context_async()  # ASYNC — reads from message_store → full conversation
                          # Not called by GenericAgent._build_task_context (which uses the sync method above)
```

**Persistence rules:**
- Every mutating method → `_sync_to_db()` → upserts `contexts` collection
- Messages NEVER stored in `_cache` → `messages` collection is single source of truth
- `get_full_context_async()` → reads messages from DB (but unused in production)
- On restart/recovery: `load_from_db()` rehydrates entire `_cache` from MongoDB

---

## Event System (SSE)

```
EventEmitter.emit(event_type, data):
  1. Append to in-memory ring buffer (last 1000 events)
  2. If not a streaming delta (.delta suffix): persist to events collection (MongoDB)
  3. put_nowait() to each subscriber queue for project_id + "global"
     → Non-blocking drop if queue full (prevents pipeline stall)
  4. Fire registered callbacks (persistence hooks, log snapshots)

SSE endpoint GET /api/events/{project_id}:
  → subscribe(project_id) → asyncio.Queue(maxsize=100)
  → stream_events(queue) generator:
      yields "event: {type}\ndata: {json}\nid: {timestamp}\n\n"
      yields ": keepalive\n\n" every 1s when idle
```

---

## MongoDB Schema (All Collections)

### Core Runtime

| Collection | Purpose |
|-----------|---------|
| `projects` | project_id, title, status, current_phase, user_prompt, approval_mode, created_at |
| `messages` | All conversation (user/asst/system/approval), sequence-numbered, single source of truth |
| `message_sequences` | Atomic next-sequence counters per project (findOneAndUpdate $inc) |
| `file_artifacts` | Generated files: project_id, path, content, run_id. Source of truth for deploy. |
| `contexts` | SharedContext cache: requirements, plan, artifacts, insights, deploy_status |
| `snapshots` | Point-in-time snapshots: type, label, phase, meta (for revert support) |
| `events` | Persisted SSE events (streaming .delta events excluded) |
| `runs` | Run tracking: run_id, status, phase per project |
| `container_logs` | Final container stdout/stderr snapshots (on project_completed/failed) |

### Configuration (dynamic, managed via UI)

| Collection | Purpose |
|-----------|---------|
| `agent_configurations` | Agent configs: _id, name, type, model, system_prompt, allowed_phases, eval_keywords, etc. Seeded from `agents.yaml`, editable via `/api/configurations/agents/` |
| `workflow_definitions` | Workflow DAGs: nodes (phase/gate/execution), edges. Seeded from `workflows.json`, editable via UI |
| `tool_configurations` | Tool definitions for agents. Seeded from `tools.yaml` |

### System

| Collection | Purpose |
|-----------|---------|
| `system_info` | backend_version (build_sha, hostname), models_cache, default_model |
| `users` | User accounts (email, hashed password, tenant_id) — multitenancy |
| `tenants` | Per-tenant settings (API keys, preferences) |

### Legacy (deprecated)

| Collection | Purpose |
|-----------|---------|
| `artifacts` | Legacy (superseded by file_artifacts) |
| `approvals` | Legacy approval storage (approvals now in messages) |
| `tasks` | Legacy task storage |
| `test` | Test data |

**Live project status distribution (513 total):**
```
running:                  224  (44%)
completed:                123  (24%)
initialized:               62  (12%)
cancelled:                 45  (9%)
waiting_approval_timeout:  30  (6%)
failed:                    29  (5%)
```

---

## Full Data Flow: User Prompt → End Result

Complete end-to-end trace based on real code paths and verified MongoDB data:

```
[1] USER → POST /api/projects
    Body: {user_prompt: "build a discord text splitter", approval_mode: "human"}

[2] FastAPI projects_router
    → orchestrator.start_project(user_prompt, approval_mode="human")
    → gpt-5-nano: generate title "Discord Text Splitter With 2000 Char Limit And Tables"
    → project_id=uuid4(), run_id=uuid4()
    → SharedContext.initialize() → MongoDB: contexts + messages(seq 1: user prompt)
    → MongoDB: projects {status:"initialized", current_phase:"requirements"}
    → emit project_started → SSE → UI shows project card
    → asyncio.create_task(run_workflow(project_id))
    ← return {project_id}  [UI can now subscribe to SSE stream]

[3] UI → GET /api/events/{project_id}
    ← SSE stream opens, keepalive pings every 1s

[4] ASYNC TASK: run_workflow(project_id)
    → Load workflow DAG from MongoDB (or fallback default_build)
    → WorkflowEngine.execute() walks DAG from start node

    NODE: req_gather (REQUIREMENTS PHASE)
    emit phase.requirements.started

    Auction [phase=requirements]:
      GenericAgent(type=requirements_gatherer).evaluate_task() → high score (eval_keywords match)
      Other agents → 0.0 (wrong phase / no keyword match)
      CriticAgent validates: approved
    emit auction.best_bid {agent_id:"requirements_gatherer@{id}"} → SSE

    GenericAgent(type=requirements_gatherer).execute_task():
      call_llm_json: analyze → {project_type:"web_tool", clarity_score:0.85}
      call_llm_json: questions → [{q:"Target platform?", cat:"technical", priority:"high"}, ...]
      MongoDB messages seq 2: "Analyzing... 4 questions to clarify."

    NODE: human_expert [direct]
    GenericAgent(type=human_expert).execute_task():
      Mode=high → answer all 4 questions automatically
      answered_questions: [{q:"Target platform?", a:"Web browser, JS/static"}, ...]
      needs_human: []  [nothing escalated in high mode]

    NODE: req_finalizer [direct]
    GenericAgent(type=requirements_finalizer).execute_task():
      Receives human_expert output as task context (previous_output)
      RequirementsSchema → MongoDB contexts
      MongoDB messages seq 3: "Requirements finalized for Text Processing Utility / Web Tool"

    emit phase.requirements.completed → SSE

    GATE #1: request_approval("requirements"):
      MongoDB messages seq 4: {type:"approval", subtype:"requirements"}
      _snapshot_files_to_db() → 0 files yet
      emit approval_requested → SSE → UI shows APPROVE button

    wait_for_approval() ... polling 1s ...

[5] USER → POST /api/approvals/{id}/approve
    → pending_approvals[id].status = APPROVED
    → MongoDB messages seq 5: user "[APPROVE] general"
    → MongoDB messages seq 6: system "General approved. Continuing workflow..."
    → wait_for_approval() unblocks

[6] ASYNC TASK: PLANNING PHASE
    update_project_phase("planning") → MongoDB + SSE
    emit phase.planning.started

    Auction [phase=planning]:
      GenericAgent(type=planner) → high score (eval_keywords match), others → 0.0
      CriticAgent validates: approved

    GenericAgent(type=planner).execute_task():
      _build_task_context() → sync get_full_context() → conversation_history: [] (empty)
      Sees: user_prompt ✅, requirements ✅, task.description ✅
      call_llm: create 7 tasks (project is real, multi-file)
      shared_context.update_plan() → MongoDB contexts
      MongoDB messages seq 7: "Created plan with 7 tasks"

    emit phase.planning.completed → SSE

    GATE #2: request_approval("plan"):
      MongoDB messages seq 8: {type:"approval", subtype:"plan", data:{tasks:[...]}}
      emit approval_requested → SSE → UI shows plan + APPROVE

    wait_for_approval() ...

[7] USER → sends refinement via chat or approval UI
    POST /api/projects/{id}/messages {content:"make it available as web endpoint"}
    → message_store.append_user_message() → seq 9
    → IntentClassifier → intent=feedback
    → route_user_message() → refine_approval("plan")
    → _refine_plan(): GenericAgent(type=planner).execute_task()
      task.description = "Re-plan based on user feedback" (⚠️ actual text NOT included)
    → MongoDB messages seq 10: asst "Created plan with 6 tasks"
    → New approval written → user approves

[8] ASYNC TASK: EXECUTION PHASE
    update_project_phase("execution") → MongoDB
    emit phase.execution.started

    TaskExecutor loop (6 tasks):

    TASK 1: "Create HTML structure with input/output sections"
      Auction [phase=execution]:
        GenericAgent(type=coding) → LLM eval → fit_score=0.92 (eval_keywords match)
        GenericAgent(type=qa) → fit_score=0.1 (not testing)
        CriticAgent validates: approved
      emit task_assigned {agent:"coding_agent@{id}"} → SSE

      GenericAgent(type=coding)._execute_with_tools():
        StreamingAgentRunner → OpenAI Responses API (via Bifrost):
          Thinking block: "I need to create index.html with two textareas..."
          → emit agent.streaming.thinking → SSE (real-time thinking in UI)
          Tool: create {path:"index.html", content:"<!DOCTYPE html>..."}
          → AgentToolDispatcher → MCPToolExecutor → ContainerManager
          → cu mcp JSON-RPC → Docker container → file written
          → artifact_store.upsert_file("index.html") → file_artifacts collection
          Tool: create {path:"style.css", content:"..."}
          → same path → file_artifacts
          Tool: bash {command:"echo 'done'"}
          → run_command in container → exit 0
          LLM text response: "Created index.html and style.css with..."
        Returns COMPLETED

      snapshot: task_completed
      artifact_store.create_file_checkpoint()

    TASK 2..6: same pattern
      → More files created: splitter.js, app.py (Flask endpoint), requirements.txt, ...
      → Each tool call writes to container + file_artifacts collection
      → SSE events for each task_started/finished

    All 6 tasks done. Loop exits.

[9] POST-EXECUTION
    _sync_container_to_repo():
      container_manager.apply_environment() → cu CLI: git commit in container
      container_manager.checkout_environment() → cu CLI: checkout on host

    _prepare_final_artifacts():
      _harvest_from_container() → read ALL files from Docker container directly
      6 files: index.html, style.css, splitter.js, app.py, requirements.txt, README.md
      dedupe by path (container = source of truth)

    artifact_store.snapshot_from_artifacts(force=True):
      Saves all 6 files to file_artifacts collection (MongoDB)
      These are now downloadable/viewable via API

    emit phase.execution.completed → SSE

    GATE #3: request_approval("output"):
      MongoDB: approval message with all 6 file artifacts
      emit approval_requested → SSE → UI shows file tree + APPROVE

    update_project_status("completed") → MongoDB
    emit PROJECT_COMPLETED → SSE → UI shows project as done

[10] USER → reviews output via UI
    GET /api/messages/{project_id} → full conversation history from messages collection
    GET /api/projects/{id} → project state from projects collection
    UI shows all generated files (from file_artifacts via API)

[11] OPTIONAL: USER → POST /api/deployments/{project_id}
    → GenericAgent (deploy config).execute_task():
      detect_stack → "python" (app.py + requirements.txt found)
      LLM spec: {stack:"python", port:8000, entry:"app.py"}
      build_and_push_from_artifacts():
        Load 6 files from file_artifacts (MongoDB, DB-first)
        Write to a temporary folder on the backend (not the sandbox)
        Dockerfile template: python → pip install + uvicorn
        docker build -t registry.synapse.bonpp.com/synapse/{slug}:{deployment_id}
        docker push → registry.synapse.bonpp.com (auth: ci/Temp1234!)
      ProdK8sDeployHelper:
        kubectl apply Deployment + Service + Ingress → namespace synapse-apps
        host: {slug}.apps.bonpp.com
        kubectl rollout status --timeout=120s → OK
      Health check: HTTP GET {slug}.apps.bonpp.com → 200 OK
      emit deploy_succeeded → SSE
      ← return {url: "https://{slug}.apps.bonpp.com"}

[FINAL STATE in MongoDB]
  projects: status="completed", current_phase="execution"
  messages: 15+ sequence entries (full audit trail)
  file_artifacts: 6 files with full content
  contexts: requirements + plan + artifacts + deploy_status="succeeded"
  events: ~50 events persisted (excluding streaming deltas)
  snapshots: phase_completed x3, task_start x6, task_completed x6, auction_* x6+
```
