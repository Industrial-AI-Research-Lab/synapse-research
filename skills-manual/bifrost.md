# Bifrost Skill — Synapse

## What It Is

Bifrost is an LLM gateway that provides observability, caching, and failover for all LLM calls in Synapse. It sits between the backend and OpenAI (or other providers).

**Tracks:** LLM API calls, prompts/responses, token usage, costs, latency, errors, retries.  
**Does NOT track:** Tool executions, DB operations, container events, agent task assignments.

---

## Configuration

### Environment Variables

```bash
USE_BIFROST=true
BIFROST_URL=http://localhost:8080/v1                    # Local dev
# BIFROST_URL=http://bifrost.synapse.svc.cluster.local:8080/v1  # Kubernetes
# OPENAI_API_KEY=sk-your-key-here               # Optional — better to set keys via Bifrost Web UI
BIFROST_FALLBACK_MODELS=openai/gpt-4o,openai/gpt-4o-mini  # Optional fallback chain
```

### Deployment Methods

| Method | How |
|--------|-----|
| **Local (Docker)** | `docker run -d --name bifrost -p 8080:8080 -v ${PWD}/bifrost-data:/app/data maximhq/bifrost:v1.4.11` |
| **Kubernetes secret** | Add `USE_BIFROST`, `BIFROST_URL` to `backend-secrets` secret (API keys managed via Bifrost UI) |
| **Helm values** | Set `backend.extraEnv` in `values.yaml` |

> **Docker Desktop note:** Containers auto-restart after host reboot unless explicitly stopped/removed — no `--restart` flag or compose file needed for local dev.

> **Volume mount (`/app/data`):** Persists Bifrost's configuration, API keys, request cache, and analytics data. Always use the same `-v` mount to survive container recreation.

### API Key Setup

After starting Bifrost, open the Web UI at `http://localhost:8080` to add provider keys. You can add an **OpenRouter** key here to access 200+ models through a single key — this is recommended over setting individual provider keys via env vars.

If you prefer env vars, you can pass `-e OPENAI_API_KEY=sk-...` to the Docker run command, but the Web UI is more flexible (supports multiple providers, key rotation, etc.).

---

## Model Naming

Bifrost requires `provider/model` format. The `LLMClient` handles this automatically when `USE_BIFROST=true`:

| Direct OpenAI | Via Bifrost |
|---------------|-------------|
| `gpt-4o` | `openai/gpt-4o` |
| `gpt-4o-mini` | `openai/gpt-4o-mini` |
| `gpt-5-chat-latest` | `openai/gpt-5-chat-latest` |

Multi-provider support: `anthropic/claude-3-5-sonnet-20241022`, `bedrock/...`, etc.

---

## Fallback Behavior

1. Try the requested model first
2. On 429/503/timeout → try fallback models in order
3. Return error only if all models fail

Configure via `BIFROST_FALLBACK_MODELS` (comma-separated, `provider/model` format).

---

## Key Code

- **LLM Client:** `src/llm/client.py` — `_format_model_name()` adds provider prefix, `_apply_model_gates()` enforces temperature rules
- **Model Gates:** GPT-5 models forced to `temperature=1.0` (except `gpt-5-chat-latest`)

---

## Verification

```powershell
# Backend startup should show:
# Bifrost enabled with fallbacks: ['openai/gpt-4o', 'openai/gpt-4o-mini']

# Check Bifrost logs
docker logs bifrost -f

# Bifrost Web UI
start http://localhost:8080
# → Logs, Analytics, Providers, Settings
```

---

## Upgrade Bifrost

```powershell
# 1. (Optional) Back up existing data
Copy-Item -Recurse ./bifrost-data ./bifrost-data-backup-$(Get-Date -Format yyyy-MM-dd)

# 2. Pull the new image
docker pull maximhq/bifrost:v<NEW_VERSION> # e.g. docker pull maximhq/bifrost:v1.4.11

# 3. Stop and remove the old container (data is safe in the volume)
docker stop bifrost
docker rm bifrost

# 4. Start with the new version — same volume mount
docker run -d --name bifrost -p 8080:8080 `
  -v ${PWD}/bifrost-data:/app/data `
  maximhq/bifrost:v<NEW_VERSION>

# 5. Verify
docker logs bifrost -f
```

**Key points:**
- The `-v ${PWD}/bifrost-data:/app/data` volume mount preserves all config and data across upgrades.
- Replace `v<NEW_VERSION>` with the target release (e.g. `v1.5.0`). Check [GitHub releases](https://github.com/maximhq/bifrost/releases) for changelogs.
- Works on **Windows (PowerShell + Docker Desktop)**, macOS, and Linux — `${PWD}` resolves correctly in all three. The backtick (`` ` ``) is PowerShell's line-continuation character; on bash/zsh use `\` instead.

---

## Disable Bifrost

Set `USE_BIFROST=false` in `.env` and restart. Backend will call OpenAI directly.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Backend still calling OpenAI directly | Verify `USE_BIFROST=true`, restart backend |
| Connection refused | Check Bifrost is running (`docker ps`), URL is correct |
| 401 Unauthorized | Verify API key is set in Bifrost Web UI (or via env var), provider has access |
| Model not found | Ensure `provider/model` format, check `/v1/models` endpoint |

**Docs:** https://docs.getbifrost.ai | **GitHub:** https://github.com/maximhq/bifrost
