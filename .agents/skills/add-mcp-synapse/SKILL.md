---
name: add-mcp-synapse
description: Registers an already published MCP in a Synapse tenant, imports its tools, and verifies them. Use after add-mcp-litellm, or when a public LiteLLM MCP URL and scoped or global key already exist.
---

# Register a published MCP in Synapse

This skill starts with a public MCP URL that Synapse can reach. Do not deploy the MCP itself. Do not create LiteLLM servers, toolsets, grants or keys; that is `add-mcp-litellm`.

If the MCP still uses only an internal-cluster address such as `http://10.32...`, stop and run
`add-mcp-litellm` first. Do not register an internal-cluster address directly in Synapse.

The task is complete only when the required tools are enabled in the selected Synapse tenant and their exact IDs have been recorded for agent configuration.

## Configuration

Read configuration from process environment variables or from `env.example` copied to `.env`.
Never print secret values. A `.env` file does not load itself: an agent must read it into its own process before making requests.

Use:

- `MCP_SERVER_ID`: server ID to use inside Synapse, no spaces.
- `MCP_PUBLIC_URL`: LiteLLM public MCP URL, normally `{LITELLM_ADMIN_URL}/{alias}/mcp`.
- `LITELLM_MCP_KEY`: scoped AI APIs key from `add-mcp-litellm`, or an approved global key.
- `SYNAPSE_URL`: target Synapse, default `https://synapse.bonpp.com`.
- `SYNAPSE_TENANT_ID`: expected tenant and safety check.
- `SYNAPSE_ADMIN_EMAIL` / `SYNAPSE_ADMIN_PASSWORD`: tenant-admin login.

Root credentials are not needed for normal work inside the admin's own tenant.

Never store a LiteLLM Full Access key in Synapse. Only `LITELLM_MCP_KEY` goes into the Synapse MCP header `x-litellm-api-key`.

If the user names one Synapse but `SYNAPSE_URL` points to another, stop and ask which installation to use. Synapse installations do not share tenants, MCP tools, agents or workflows.

If `MCP_PUBLIC_URL` or `LITELLM_MCP_KEY` is missing, stop and run `add-mcp-litellm`, or ask for an already published URL and scoped/global key.

## Human quick path

1. Open **MCP Tools → Add & Configure**.
2. Use `MCP_PUBLIC_URL`, `streamable-http`, timeout `120000`, and
   `x-litellm-api-key: Bearer <LITELLM_MCP_KEY>`.
3. Discover, import and enable the required tools, then run the server health check.

The detailed API and safety procedure follows.

## 1. Register the MCP in Synapse

The agent uses the API. A person may use:

**Configuration → MCP Tools → Add & Configure**

### 1.1 Authenticate and verify the tenant

Call:

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

Call:

```text
GET {SYNAPSE_URL}/api/auth/me
```

Require `tenant_id == SYNAPSE_TENANT_ID` and role `tenant_admin` or `root` before any mutation. The MCP routes use the tenant from the token; `SYNAPSE_TENANT_ID` does not select another tenant.

### 1.2 Discover tools

For LiteLLM, call:

```text
POST {SYNAPSE_URL}/api/configurations/mcp-tools/mcp-servers/discover
```

Body:

```json
{
  "server_id": "<MCP_SERVER_ID>",
  "endpoint": "<MCP_PUBLIC_URL>",
  "mode": "streamable-http",
  "timeout_seconds": 120,
  "headers": [
    {
      "name": "x-litellm-api-key",
      "value": "Bearer <LITELLM_MCP_KEY>"
    }
  ]
}
```

Discovery must return at least one tool. Select the required tools from that response.

Before import, require every discovered tool name to match `[A-Za-z0-9_-]+`. Synapse cannot import an MCP RPC name containing dots, slashes, spaces or other characters. Do not rename an unsupported upstream name because invocation requires the exact name; stop and report it.

### 1.3 Import the selected tools

Call:

```text
POST {SYNAPSE_URL}/api/configurations/mcp-tools/batch
```

Use:

- `mcp_server`: `MCP_SERVER_ID`;
- `metadata.external_mcp.endpoint`: `MCP_PUBLIC_URL`;
- `metadata.external_mcp.mode`: `streamable-http`;
- `metadata.external_mcp.timeout_seconds`: `120`;
- `metadata.external_mcp.headers`: the LiteLLM header list;
- one `tools` entry for each selected discovery result;
- canonical tool `id`: lowercase `{MCP_SERVER_ID}.{discovered_tool_name}` with spaces replaced by
  underscores;
- exact discovered `name`, `description` and `schema`.

Before calling `/batch`, list all tenant MCP tools, including disabled ones:

```text
GET {SYNAPSE_URL}/api/configurations/mcp-tools/?enabled_only=false
```

Select those whose `mcp_server` equals `MCP_SERVER_ID`.

- Compare each existing tool's RPC name and `metadata.external_mcp` endpoint, mode, headers and
  timeout with the intended configuration.
- Stop on any mismatch; do not overwrite it silently.
- Remove exact existing matches from the create request.
- Submit only missing tools.
- If no tools are missing, skip `/batch`.

The batch endpoint is all-or-nothing and returns `409` when any requested tool conflicts, so never mix existing and missing tools in one request.

### 1.4 Merge and save tenant MCP JSON

Call:

```text
GET {SYNAPSE_URL}/api/configurations/mcp-tools/mcp-servers/cursor-json
```

Parse the returned `cursor_json` string. Preserve every existing `mcpServers` entry and add:

```json
{
  "<MCP_SERVER_ID>": {
    "url": "<MCP_PUBLIC_URL>",
    "transport": "streamable-http",
    "timeout": 120000,
    "headers": {
      "x-litellm-api-key": "Bearer <LITELLM_MCP_KEY>"
    },
    "disabled": false
  }
}
```

Save the complete merged document with:

```text
PUT {SYNAPSE_URL}/api/configurations/mcp-tools/mcp-servers/cursor-json
```

The request body is:

```json
{
  "cursor_json": "<the complete merged MCP JSON serialized as a string>"
}
```

Never save an empty document or a document containing only the new server. Omitting existing servers removes them from the tenant.

### 1.5 Human UI equivalent

1. Open **MCP Tools → Add & Configure**.
2. Paste the server JSON into **JSON to parse and fill form**.
3. Click **Parse and fill form**.
4. Confirm **HTTP Streamable**.
5. Click **Discover Tools**.
6. Select the required tools.
7. Click **Import Selected**.
8. Confirm every required tool is enabled.

## 2. Verify and report

Call:

```text
GET {SYNAPSE_URL}/api/configurations/mcp-tools/?enabled_only=true
```

Then call:

```text
POST {SYNAPSE_URL}/api/configurations/mcp-tools/mcp-servers/health-check
```

Body:

```json
{
  "server_ids": ["<MCP_SERVER_ID>"]
}
```

Complete the task only when:

- the matching health-check entry has `status: ok`;
- discovery returned tools;
- required tools are enabled in the intended tenant;
- the scoped/global key works;
- a Full Access / master LiteLLM key is not stored in Synapse;
- unrelated MCP servers remain unchanged.

Record tool IDs exactly as Synapse displays them. They may be public IDs such as `server-name.tool_name` or assigned wire names such as `ogp_query_graph_readonly`. Do not rebuild or rename them.

Return:

- target Synapse URL and tenant;
- Synapse MCP server ID;
- public MCP URL;
- exact enabled tool IDs.

Never include credentials in the report. Pass the exact enabled tool IDs to `create-agents-workflow`.
