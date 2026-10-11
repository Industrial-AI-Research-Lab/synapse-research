# MongoDB Skill — Synapse

## Connection

- **Database name:** `synaps` (env default is `synapse`, but deployed DB is `synaps`)
- **Driver:** Motor (async Python MongoDB driver)
- **Backend:** `src/storage/mongo_backend.py`

### Environment Variables

```bash
USE_MONGODB=true
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/
MONGODB_DATABASE=synapse    # Default; deployed as "synaps"
MONGODB_ENABLE_TRANSACTIONS=true  # Requires replica set
```

### Setup Options

| Option | Command |
|--------|---------|
| **Atlas (cloud)** | Sign up at mongodb.com/cloud/atlas → free M0 tier → get connection string |
| **Docker (local)** | `docker run -d --name synapse-mongo -p 27017:27017 -e MONGO_INITDB_ROOT_USERNAME=admin -e MONGO_INITDB_ROOT_PASSWORD=password -v synapse-mongo-data:/data/db mongo:7` |
| **Native install** | Download from mongodb.com/try/download/community |

For local/single-node: set `MONGODB_ENABLE_TRANSACTIONS=false`.

---

## Collections

### Active — Runtime

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `messages` | **SSOT** — all communication & approvals | `project_id`, `sequence`, `type`, `subtype`, `status`, `data` |
| `projects` | Project metadata + embedded context | `project_id`, `status`, `current_phase`, `context`, `version` |
| `runs` | Workflow run tracking (fork/branch) | `run_id`, `project_id`, `run_status`, `workflow_phase` |
| `file_artifacts` | Versioned file storage | `project_id`, `path`, `content`, `version`, `checkpoint_sequence` |
| `message_sequences` | Atomic sequence counters | `project_id`, `sequence` |
| `events` | Event log (30-day TTL) | `project_id`, `timestamp`, `event_type` |
| `tasks` | Task execution history | `task_id`, `project_id`, `status` |
| `container_logs` | Container stdout/stderr | `project_id` |
| `deployments` | Project deployment records | `project_id` |
| `system_info` | Backend version tracking | — |

### Active — Configuration (managed via UI + seed files)

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `agent_configurations` | Dynamic agent configs (GenericAgent) | `_id`, `name`, `type`, `model`, `system_prompt`, `allowed_phases`, `eval_keywords`, `enabled` |
| `workflow_definitions` | Workflow DAGs (nodes, edges) | `_id`, `name`, `nodes[]`, `edges[]` |
| `tool_configurations` | Tool definitions for agents | `_id`, `name`, `description`, `parameters` |
| `users` | User accounts (multitenancy) | `email`, `hashed_password`, `tenant_id` |
| `tenant_settings` | Per-tenant settings | `tenant_id`, `settings` |

Seeded from `src/config/agents.yaml`, `src/config/workflows.json`, `src/config/tools.yaml` on startup (upsert only if changed). Editable via `/api/configurations/` endpoints and UI.

### Legacy (still in DB, no longer written to)

| Collection | Migrated To |
|------------|-------------|
| `contexts` | `projects.context` |
| `approvals` | `messages` (type=approval) |
| `artifacts` | `file_artifacts` |
| `snapshots` | Deprecated; message-based revert replaces it |

---

## Common Queries

```python
# Get project
await self.projects.find_one({"project_id": pid})

# Get messages (ordered)
cursor = self.messages.find({"project_id": pid}).sort("sequence", 1)

# Atomic sequence increment
await self.message_sequences.find_one_and_update(
    {"project_id": pid},
    {"$inc": {"sequence": 1}},
    upsert=True, return_document=ReturnDocument.AFTER
)

# Get latest file version
await self.file_artifacts.find_one(
    {"project_id": pid, "path": path, "deleted_at": None},
    sort=[("version", -1)]
)

# Optimistic concurrency update
result = await self.projects.find_one_and_update(
    {"project_id": pid, "version": expected_version},
    {"$set": updates, "$inc": {"version": 1}},
    return_document=ReturnDocument.AFTER
)
# If result is None → 409 Conflict
```

---

## Indexes

Created automatically at startup. Key indexes:

- `projects`: `project_id` (unique), `status + created_at`
- `messages`: `project_id + sequence` (unique compound), `project_id + type`
- `file_artifacts`: `project_id + path + version`
- `events`: `timestamp` (TTL 30 days), `project_id + timestamp`

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `ServerSelectionTimeoutError` | Check MongoDB is running, port 27017 not blocked |
| `Authentication failed` | Verify username/password in `MONGODB_URI` |
| `Transactions not supported` | Set `MONGODB_ENABLE_TRANSACTIONS=false` or use replica set |
| `ModuleNotFoundError: motor` | `pip install -r requirements.txt` |
