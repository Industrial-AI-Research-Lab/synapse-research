---
name: create-agents-workflow
description: Creates and tests Synapse agents and a workflow on top of already registered MCP tools. Determines the smallest suitable agent and workflow design from the user's goal, applies it through the Synapse API, and verifies a real MCP call. Use after add-mcp-synapse or when prototyping a new Synapse use case.
---

# Create Synapse agents and a workflow

Use this skill after the required MCP tools have been registered in the target Synapse tenant.

Do not impose a fixed workflow architecture. Determine the agents and nodes from the user's actual
goal. A single-agent workflow is valid; multiple agents, critics and validators are optional.

The task is complete only when a test project finishes and its journal proves that an allowed MCP
tool was called.

## Configuration

Read connection settings from process environment variables or from `env.example` copied to
`.env`. Never print secret values. A `.env` file does not load itself: an agent must read it into
its own process.

Use only:

- `SYNAPSE_URL`: target Synapse, default `https://synapse.bonpp.com`.
- `SYNAPSE_TENANT_ID`: target tenant and bundle API value.
- `SYNAPSE_ADMIN_EMAIL` / `SYNAPSE_ADMIN_PASSWORD`: tenant-admin login.

Root credentials are unnecessary when creating configurations in the admin's own tenant.

Do not put prototype names, prompts, model names, tool IDs or test questions in `.env`. Obtain
them from the user, the `add-mcp-synapse` result and the Synapse API.

Different Synapse installations do not share MCP tools, agents or workflows. Perform every step on
the same URL and tenant.

## Human quick path

1. Open **MCP Tools** and confirm the required tools are enabled.
2. Define the use case and the smallest set of agents required.
3. Create each agent with a non-empty prompt and only its required MCP tools.
4. Build and validate the workflow in **Workflows**.
5. Set and verify `execution_mode`, runtime limits and any approval gates through the API or config
   bundle.
6. Create a control project from the Home/Projects UI.
7. Wait for a terminal status and verify the answer plus Tool Call/Tool Result journal entries.

The detailed API and safety procedure follows.

## 1. Collect the required inputs

The agent needs:

- the user's prototype goal;
- the exact enabled MCP tool IDs produced by `add-mcp-synapse`;
- constraints such as read-only access or required output format;
- a control question and, when known, its expected answer.

Ask only for information that cannot be obtained from the registered MCP schemas or Synapse.

If the user has not chosen a model:

1. Call `GET {SYNAPSE_URL}/api/settings/models`.
2. For each candidate call
   `GET {SYNAPSE_URL}/api/settings/model-config/{URL-encoded model_id}`.
3. Require `tool_calling` in the model's `capabilities`.

Choose a tool-capable model. Ask the user only when several choices have material cost or behavior
differences.

## 2. Verify the MCP tools

Authenticate:

```text
POST {SYNAPSE_URL}/api/auth/login
```

Body:

```json
{
  "email": "<SYNAPSE_ADMIN_EMAIL>",
  "password": "<SYNAPSE_ADMIN_PASSWORD>"
}
```

Use the returned `access_token` as `Authorization: Bearer <token>`.

Call `GET {SYNAPSE_URL}/api/auth/me`. Require `tenant_id == SYNAPSE_TENANT_ID` and role
`tenant_admin` or `root` before any mutation.

Call:

```text
GET {SYNAPSE_URL}/api/configurations/mcp-tools/?enabled_only=true
```

For every tool planned for an agent, verify:

- it exists in this tenant;
- it is enabled;
- its catalog `id` or catalog `name` matches the intended allowlist value;
- its schema contains the parameters the use case needs.

Use only the exact catalog `id` or `name` in `allowed_mcp_tools`; do not use an upstream
`rpc_name`, which is not a Synapse allowlist identifier.

Stop and run `add-mcp-synapse` if the required tools are missing. If the MCP is still only on an
internal-cluster URL, run `add-mcp-litellm` first.

## 3. Design the smallest suitable prototype

Choose the minimum number of agents and nodes needed for the user's goal.

Use one agent when one responsibility can call the MCP and answer the user.

Use multiple agents only when responsibilities are genuinely separate, for example:

- one agent gathers evidence and another applies domain rules;
- different phases require different tool allowlists;
- an independent review is explicitly required.

Add a validator only when the result can be checked by a clear rule. Bound every retry loop.

Use read-only tools for the normal control test. `approval_mode: human` does not protect a write
phase by itself. If a write operation must be tested, add an explicit `approval_gate` node before
the write phase and require the user to approve that gate.

Before writing configuration, summarize:

```text
Agents:
- <agent id>: purpose; allowed MCP tools

Workflow:
start → <phase nodes> → end

Control test:
<question> → <expected answer or verification rule>
```

If the user already asked to create the prototype and the design follows their stated constraints,
this summary is informational and does not require another confirmation. Ask before proceeding only
when a missing choice would materially change behavior, access or cost.

## 4. Build the agents

For every agent define:

- a unique lowercase ID: letters, digits and underscores; must start with a letter; length 2-64;
- `type: generic`;
- `agent_class: GenericAgent`;
- a configured tool-capable model;
- a non-empty system prompt;
- its allowed phases;
- only the built-in and MCP tools required for its responsibility;
- a finite `step_limit`;
- `enabled: true`.

Use only the exact MCP catalog `id` or `name` returned by Synapse. They may be canonical public IDs
or short wire names; never substitute the upstream `rpc_name`.

Do not grant write tools unless the user explicitly requires them.

Each prompt must state:

- the agent's responsibility;
- where the complete user request is stored;
- which MCP tools it may use and when;
- any required graph, dataset, collection or other tool argument;
- that tools must be called as real functions rather than printed as JSON;
- the required output format;
- what must never be exposed, such as credentials or unnecessary tool internals.

Do not submit agents with empty prompts.

## 5. Build the workflow

Every workflow needs:

- a unique lowercase ID: letters, digits and underscores; must start with a letter; length 2-64;
- a clear name and description;
- `execution_mode`, normally `static` for a predictable prototype;
- finite `run_timeout_seconds` and `max_iterations`;
- a `start` node;
- one or more phase nodes;
- an `end` node;
- valid edges;
- consistent context `reads` and `writes`;
- direct `agent_type` values matching the saved agent IDs exactly.

### Minimal valid example

Use this shape only when one agent is sufficient:

```json
{
  "_id": "<prototype>_demo",
  "name": "<prototype>_demo",
  "description": "Answer the user through the registered MCP",
  "execution_mode": "static",
  "run_timeout_seconds": 300,
  "max_iterations": 20,
  "nodes": [
    {
      "id": "start",
      "type": "start"
    },
    {
      "id": "answer",
      "type": "phase",
      "task_type": "<prototype>_answer",
      "phase_label": "<prototype>_answer",
      "agent_selection": "direct",
      "agent_type": "<prototype>_agent",
      "reads": ["user_prompt"],
      "writes": ["<prototype>_answer"]
    },
    {
      "id": "end",
      "type": "end"
    }
  ],
  "edges": [
    {
      "from": "start",
      "to": "answer"
    },
    {
      "from": "answer",
      "to": "end"
    }
  ],
  "is_default": false
}
```

Extend this graph only when the use case requires more phases. Do not copy the OSDU
analyst/critic workflow into unrelated prototypes.

## 6. Dry-run and apply through the API

Prefer one config bundle so agents and workflow are reviewed together.

Build:

```json
{
  "version": 1,
  "items": {
    "agents": [
      {
        "_id": "<prototype>_agent",
        "type": "generic",
        "name": "<prototype>_agent",
        "agent_class": "GenericAgent",
        "model": "<tool-capable model>",
        "system_prompt": "<non-empty prompt>",
        "allowed_phases": ["<prototype>_answer"],
        "allowed_tools": [],
        "allowed_mcp_tools": ["<exact enabled MCP tool ID>"],
        "step_limit": 30,
        "enabled": true
      }
    ],
    "workflows": [
      {
        "_id": "<prototype>_demo",
        "name": "<prototype>_demo",
        "description": "Answer the user through the registered MCP",
        "execution_mode": "static",
        "run_timeout_seconds": 300,
        "max_iterations": 20,
        "nodes": [
          {
            "id": "start",
            "type": "start"
          },
          {
            "id": "answer",
            "type": "phase",
            "task_type": "<prototype>_answer",
            "phase_label": "<prototype>_answer",
            "agent_selection": "direct",
            "agent_type": "<prototype>_agent",
            "reads": ["user_prompt"],
            "writes": ["<prototype>_answer"]
          },
          {
            "id": "end",
            "type": "end"
          }
        ],
        "edges": [
          {
            "from": "start",
            "to": "answer"
          },
          {
            "from": "answer",
            "to": "end"
          }
        ],
        "is_default": false
      }
    ],
    "tools": [],
    "run_configurations": [],
    "a2a_servers": []
  }
}
```

Before sending it, assert:

- every system prompt is non-empty;
- every model is available to the tenant;
- every MCP allowlist value resolves to an enabled tool;
- no unintended write tool is present;
- every direct `agent_type` matches an agent ID;
- node reads/writes and edges are internally consistent;
- all retry loops are bounded.

Dry-run:

```text
POST {SYNAPSE_URL}/api/admin/config-bundle/dry-run
```

Build the request body programmatically so `bundle` remains an object rather than an escaped
string:

```python
request_body = {
    "bundle": bundle,
    "target_tenant_id": os.environ["SYNAPSE_TENANT_ID"],
}
```

Serialize `request_body` as JSON so `bundle` stays a JSON object. If `bundle` is sent as an
escaped string, dry-run or apply returns HTTP `422`.

Inspect every per-item result:

- continue automatically only when every intended agent and workflow action is `insert`;
- stop on every error;
- treat `update` as a potential overwrite;
- show the existing and proposed configurations and require explicit user authorization before
  applying an update;
- otherwise choose new collision-free IDs and dry-run again.

Apply only after a clean dry-run:

```text
POST {SYNAPSE_URL}/api/admin/config-bundle/apply
```

Use the same parsed object body as dry-run. Do not rebuild it by hand. Apply is partial-failure
tolerant, so inspect every result even when the HTTP request succeeds.

If apply or a later create call returns HTTP `4xx`, read the response JSON `detail` and stop. Do
not retry blindly. HTTP `422` on `/api/admin/config-bundle/apply` means the request body failed
schema validation (usually `bundle` was a string, or `target_tenant_id` was missing). Config-bundle
item errors are `400` or a `200` with per-item `action: error`, not `422`.

Do not create the same objects through `POST /api/configurations/agents` or
`POST /api/configurations/workflows` after a clean bundle dry-run. Those CRUD routes require `id`,
not `_id`; sending only `_id` returns `422`. If CRUD is used instead of apply, copy `_id` into
`id` and omit `_id`.

After apply, read the objects back:

```text
GET {SYNAPSE_URL}/api/configurations/agents/{agent_id}
GET {SYNAPSE_URL}/api/configurations/workflows/{workflow_id}
```

Compare the stored IDs, prompts, models, allowlists, mode, runtime limits, nodes and edges with the
design.

### Human UI equivalent

A person may create the same objects in:

- **Configuration → Agents**
- **Configuration → Workflows**

Save non-empty prompts, copy MCP IDs from **MCP Tools**, validate the workflow, and confirm its
execution mode through the workflow API or config bundle after saving. The visual editor does not
reliably set `execution_mode` for a new workflow.

To run the control test in the UI:

1. Open **Projects** and create a new project.
2. Select the created workflow.
3. Submit a read-only control question.
4. Wait for a completed or failed terminal status.
5. Open the project journal and verify the Tool Call and Tool Result records.

The current Projects UI does not expose `approval_mode`; set it explicitly only through the API.

## 7. Run the control project

Create:

```text
POST {SYNAPSE_URL}/api/projects
```

Body:

```json
{
  "user_prompt": "<control question>",
  "workflow_id": "<created workflow ID>",
  "approval_mode": "auto"
}
```

This automatic example is allowed only when every allowed tool and the control question are
verified non-mutating. Prefer a separate read-only control workflow when the production workflow
contains write tools.

If a write operation must be tested, the workflow must contain an explicit `approval_gate` before
the write phase; create the project with `approval_mode: human` and wait for the user to approve
that gate.

Project creation returns before background execution finishes. Poll:

```text
GET {SYNAPSE_URL}/api/projects/{project_id}
```

Wait until the project reaches `completed` or another terminal status. Use a finite timeout; do not
poll forever.

Then fetch:

```text
GET {SYNAPSE_URL}/api/projects/{project_id}/messages?include_journal=true
```

## 8. Verify the result

The test passes only when:

- the project completed successfully;
- the user received an answer;
- the answer matches the known expected result or the user's verification rule;
- the journal contains a `tool_call` and `tool_result` paired by `run_id` and `tool_call_id`;
- the matching `tool_result` event has `status == "ok"`;
- the journal's invoked wire name maps through the MCP catalog to an ID/name in that agent's
  allowlist;
- no prohibited write tool was called.

If the expected answer is unknown, return the answer and the MCP journal evidence for user review.

For multi-agent workflows also verify which agent made each call and that agents did not use tools
outside their own responsibility.

## OSDU acceptance example

OSDU is a test fixture, not a mandatory workflow design.

Use:

- graph: `osdu-volve-extended`;
- question: `Сколько узлов Well в графе?`;
- expected answer: `11`;
- actual enabled tool IDs from the selected Synapse, for example
  `ogp_query_graph_readonly` and `ogp_get_node_schema`.

A minimal one-agent workflow is sufficient for this acceptance test. A separate critic workflow
may be tested independently when review behavior itself is under test.

## Report

Return:

- Synapse URL and tenant;
- created agent IDs and purposes;
- workflow ID and compact graph;
- MCP allowlists;
- project ID and terminal status;
- control question and answer;
- successful MCP tool call used as evidence.

Never include passwords, tokens or secret headers.
