---
name: add-mcp-litellm
description: Publishes an already deployed internal MCP through LiteLLM for the Codesynapse team. Adds the server, creates a toolset, grants access, and creates a scoped AI APIs key. Use when the MCP is on an internal cluster, before registering it in Synapse.
---

# Publish a deployed MCP through LiteLLM

This skill starts with an MCP server that is already deployed. Do not deploy or modify the MCP itself. Do not register anything in Synapse; that is `add-mcp-synapse`.

The task is complete only when a scoped or approved global key can list the required tools and `MCP_PUBLIC_URL` has been recorded.

## Configuration

Read configuration from process environment variables or from `env.example` copied to `.env`.
Never print secret values. A `.env` file does not load itself: an agent must read it into its own process before making requests.

Use:

- `LITELLM_ADMIN_URL`: LiteLLM base URL, normally `https://admin.duckduck.cloud`.
- `LITELLM_ADMIN_KEY`: LiteLLM Full Access of ADMIN key. A UI **Management** key is not enough:
  this LiteLLM build does not put `/v1/mcp/server` or `/v1/mcp/toolset` in `management_routes`, so
  those calls return `403`.
- `LITELLM_TEAM`: normally `Codesynapse`.
- `LITELLM_MCP_KEY`: existing scoped AI APIs key, if one already exists. Leave empty when this
  skill must create it. In the LiteLLM UI this key type is **AI APIs**.
- `MCP_SERVER_ID`: alias/id to publish, no spaces. Hyphens become underscores in LiteLLM.
- `MCP_INTERNAL_URL`: deployed MCP URL as reachable from LiteLLM.
- `MCP_UPSTREAM_TOKEN`: optional Bearer token required by the deployed MCP.
- `MCP_PUBLIC_URL`: existing public URL, if already published.

`LITELLM_ADMIN_KEY` and `LITELLM_MCP_KEY` are different credentials:

- the Full Access key creates servers, toolsets, grants and keys;
- the scoped AI APIs key is later stored in Synapse and is used for MCP data-plane access.

Never store the Full Access key in Synapse.

If `GET {LITELLM_ADMIN_URL}/v1/mcp/server` or `GET {LITELLM_ADMIN_URL}/v1/mcp/toolset` returns `403` with `LITELLM_ADMIN_KEY`, stop and ask for a Full Access key. Do not retry those routes with `LITELLM_MCP_KEY`.

## 1. Choose the path

If the MCP uses an internal-cluster address such as `http://10.32...`, this skill is required before Synapse. Do not register that internal address in Synapse.

If `MCP_PUBLIC_URL` and an approved scoped/global `LITELLM_MCP_KEY` already exist, do not create a duplicate blindly. A public URL alone does not prove that the MCP is global. For a global MCP, confirm in LiteLLM that it is explicitly approved as global, then verify its URL, global key and effective tools; this is the only case that may skip toolset, Codesynapse grant and scoped-key creation. For every non-global MCP, independently verify the server, toolset membership, Codesynapse team grants and key scope; create or repair each missing component before continuing.

## Human quick path

1. In LiteLLM, add the deployed server and verify its tools.
2. Create a toolset with the required tools.
3. Add the server, selected tools and toolset to Codesynapse without removing existing grants.
4. Create a Codesynapse key scoped to that server, tools and toolset.
5. Verify the effective tool list with the new key.

The detailed API and safety procedure follows.

## 2. Publish through LiteLLM

The agent uses the management API. A person may perform the equivalent steps in the LiteLLM UI:

`{LITELLM_ADMIN_URL}/#/`

All management API requests use:

```text
Authorization: Bearer <LITELLM_ADMIN_KEY>
Content-Type: application/json
```

If `GET /v1/mcp/server` or `GET /v1/mcp/toolset` returns `403`, stop. A **Management** key cannot call these MCP admin routes. Do not retry them with `LITELLM_MCP_KEY`.

### 2.1 Find or create the MCP server

Call:

```text
GET {LITELLM_ADMIN_URL}/v1/mcp/server
```

Reuse a server only when its alias, URL, transport and upstream authentication match. An alias collision with different settings is a conflict: report it instead of overwriting the server.

The same internal URL may already be published under another alias. That is not a conflict for a new publication: create the requested new alias and leave every existing alias unchanged.

If no exact match exists, call:

```text
POST {LITELLM_ADMIN_URL}/v1/mcp/server
```

Body:

```json
{
  "server_name": "<MCP_SERVER_ID with hyphens replaced by underscores>",
  "alias": "<MCP_SERVER_ID with hyphens replaced by underscores>",
  "description": "Published for Synapse",
  "url": "<MCP_INTERNAL_URL>",
  "transport": "http"
}
```

When `MCP_UPSTREAM_TOKEN` is non-empty, add:

```json
{
  "static_headers": {
    "Authorization": "Bearer <MCP_UPSTREAM_TOKEN>"
  }
}
```

If the MCP uses another authentication format, stop and ask for the exact header name and value.

For newly created aliases, use underscores when the deployed LiteLLM API rejects hyphens. Never rename an existing working alias: use the exact alias returned by LiteLLM.

Record the returned `server_id` and actual `alias`. Set:

```text
MCP_PUBLIC_URL={LITELLM_ADMIN_URL}/{alias}/mcp
```

### 2.2 Read the available tool names

Call:

```text
GET {LITELLM_ADMIN_URL}/mcp-rest/tools/list?server_id={server_id}
```

LiteLLM may return prefixed RPC names such as `{alias}-query_graph_readonly`. Toolset members and key `mcp_tool_permissions` must use the **bare** names LiteLLM stores (`query_graph_readonly`).
Strip a leading `{alias}-` or `{alias}_` prefix when building the toolset and key. Do not fail because the list endpoint shows prefixed names and the stored permissions show bare names.

Select only the tools required by the intended Synapse prototype. Prefer read-only tools. Exclude delete, update, write and unbounded mutate tools unless the user explicitly requires them. If both
`query_graph` and `query_graph_readonly` exist, include only `query_graph_readonly` unless the user asked for writes.

### 2.3 Find or create the toolset

Call:

```text
GET {LITELLM_ADMIN_URL}/v1/mcp/toolset
```

Reuse a toolset only if both its name and members match.

If the intended name already belongs to a toolset with different members, do not POST the same name: LiteLLM requires unique toolset names. Create a collision-free name such as
`<normalized MCP_SERVER_ID>_tools_<first 8 characters of a SHA-256 hash of the sorted
server_id/tool_name pairs>`. This name is deterministic, so a later rerun can find and reuse it.

If no exact member match exists, create the toolset:

```text
POST {LITELLM_ADMIN_URL}/v1/mcp/toolset
```

Body:

```json
{
  "toolset_name": "<normalized MCP_SERVER_ID>_tools",
  "description": "MCP tools available to Synapse",
  "tools": [
    {
      "server_id": "<server_id>",
      "tool_name": "<bare tool name, without alias prefix>"
    }
  ]
}
```

Record `toolset_id`.

### 2.4 Grant the server and toolset to Codesynapse

1. Call `GET {LITELLM_ADMIN_URL}/team/list`.
2. Find the team matching `LITELLM_TEAM` case-insensitively.
3. Call `GET {LITELLM_ADMIN_URL}/team/info?team_id={team_id}`.
4. Copy the complete current `object_permission`.
5. Add `server_id` to `mcp_servers` and `toolset_id` to `mcp_toolsets`.
6. For a newly granted server, create `mcp_tool_permissions[server_id]` with every selected tool
   name. If this server already has a restricted list, merge the selected names into it.
7. If this server is already granted without a per-tool restriction, do not silently narrow the
   team's access. Preserve it, or ask for explicit approval before adding a restriction. The new
   key remains restricted by its own `object_permission`.
8. Preserve every unrelated permission and remove duplicate IDs.
9. Call `POST {LITELLM_ADMIN_URL}/team/update`. Build the body programmatically so
   `object_permission` remains an object:

```python
update_body = {
    "team_id": team_id,
    "object_permission": merged_object_permission,
}
```

Never replace the team's permission object with only the new MCP: that would remove access to other team resources.

### 2.5 Create the scoped key

Call:

```text
POST {LITELLM_ADMIN_URL}/key/generate
```

Use the Codesynapse `team_id`, a clear key alias and permissions restricted to the new MCP and its selected tools/toolset. The request must include:

```json
{
  "team_id": "<team_id>",
  "key_alias": "synapse-<MCP_SERVER_ID>",
  "key_type": "llm_api",
  "allowed_routes": ["llm_api_routes"],
  "object_permission": {
    "mcp_servers": ["<server_id>"],
    "mcp_toolsets": ["<toolset_id>"],
    "mcp_tool_permissions": {
      "<server_id>": ["<selected bare tool name>"]
    }
  }
}
```

Store the returned `key` as `LITELLM_MCP_KEY`. Do not print it.

Do not treat extra wrapper fields in the immediate `/key/generate` `object_permission` as a mismatch. LiteLLM may normalize or expand that object in the HTTP response. Verify the **persisted** key instead:

```text
GET {LITELLM_ADMIN_URL}/key/info?key=<LITELLM_MCP_KEY>
Authorization: Bearer <LITELLM_ADMIN_KEY>
```

If `/key/info` is unavailable, use
`GET {LITELLM_ADMIN_URL}/key/list?key_alias=<alias>&return_full_object=true` and select the matching dict entry. Ignore list items that are not objects.

Require the stored record to contain the intended `team_id`, `allowed_routes` (`llm_api_routes`), MCP server, toolset and selected bare tool names. Stop only if those persisted fields differ.

### 2.6 Gate: verify the scoped key

Using only `LITELLM_MCP_KEY`, call:

```text
GET {LITELLM_ADMIN_URL}/mcp-rest/tools/list?server_id={server_id}
x-litellm-api-key: Bearer <LITELLM_MCP_KEY>
```

Do not send `LITELLM_ADMIN_KEY` on this request.

Continue only when:

- the list is not empty;
- every required tool is present, matching either the bare name or `{alias}-{bare}`;
- unwanted write tools are absent.

Also call `GET {LITELLM_ADMIN_URL}/team/list` with only `LITELLM_MCP_KEY` and require `403`. The key must not reach a management route.

An HTTP response by itself is insufficient. These gates verify effective MCP permissions and route separation.

### 2.7 Human UI equivalent

1. Open `{LITELLM_ADMIN_URL}/#/`.
2. Add the deployed MCP server using `MCP_INTERNAL_URL` and Streamable HTTP.
3. Confirm that LiteLLM can list the MCP tools.
4. Create a toolset containing the required tools.
5. Open the Codesynapse team and add both the MCP server and the toolset without removing existing grants.
6. Create a key owned by Codesynapse with type **AI APIs**. Select the required MCP server, tools and toolset. The UI may show the server and the toolset as two entries; that is expected.
7. Save the key as `LITELLM_MCP_KEY`. Use a **Full Access** key only as `LITELLM_ADMIN_KEY`, never as a Synapse header.
8. Verify the effective tool list using that key.

## 3. Report

Complete the task only when:

- `MCP_PUBLIC_URL` is recorded;
- the scoped/global key lists the required tools;
- unwanted write tools are absent from that key;
- the Full Access / master key is not the key intended for Synapse;
- unrelated LiteLLM servers, toolsets, grants and keys remain unchanged.

Return:

- LiteLLM alias and public URL;
- whether the server, toolset, grants and key were created, reused, or skipped;
- bare tool names granted to the key.

Never include credentials in the report. Pass `MCP_PUBLIC_URL` and `LITELLM_MCP_KEY` to
`add-mcp-synapse` without printing the key.
