# Getting Started — Synapse

## Prerequisites

- **Python 3.11+**
- **Node.js 18+** (for frontend)
- **MongoDB** (local or Atlas) — see [mongodb.md](./mongodb.md)
- **OpenAI API key** (or Bifrost gateway) — see [bifrost.md](./bifrost.md)

---

## 1. Install Backend

```powershell
cd src
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 2. Configure Environment

```powershell
copy .env.example .env
```

Edit `.env` and set at minimum:

```env
OPENAI_API_KEY=sk-your-key-here
MONGODB_URI=mongodb://localhost:27017
```

See `.env.example` for the full reference. Key sections:

| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENAI_API_KEY` | LLM API key | *(required)* |
| `USE_BIFROST` | Route LLM calls through Bifrost | `true` |
| `BIFROST_URL` | Bifrost gateway URL | `http://localhost:8080/v1` |
| `BIFROST_VK` | Bifrost virtual key | *(required if Bifrost enabled)* |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017` |
| `MONGODB_DATABASE` | Database name | `synaps` |
| `CONTAINER_USE_ENABLED` | Enable container sandbox | `true` |
| `CONTAINER_USE_CLI_PATH` | Path to `cu` CLI | `container-use` |
| `REPOSITORIES_ROOT` | Where sandbox repos live | `C:/work/repositories` |
| `API_HOST` / `API_PORT` | Backend listen address | `127.0.0.1` / `8000` |
| `DEBUG` | Enable hot-reload | `true` |
| `OTEL_ENABLED` | OpenTelemetry tracing | `false` |
| `DEPLOY_AGENT_LOCAL_ENABLED` | Local deploy agent | `false` |
| `DEPLOY_AGENT_PROD_ENABLED` | Prod deploy agent | `false` |

## 3. Install Frontend

```powershell
cd src/ui
npm install
```

---

## Running

### Full Stack (recommended)

```powershell
# Terminal 1 — Backend
cd src
.\venv\Scripts\Activate.ps1
python main.py
```

```powershell
# Terminal 2 — Frontend
cd src/ui
npm run dev
```

- **UI:** http://localhost:5173
- **API docs:** http://localhost:8000/docs

### CLI Only (no UI)

```powershell
cd src
.\venv\Scripts\Activate.ps1
python -m cli "Create a simple hello world script"
```

The CLI auto-approves all gates. Generated files are saved to `artifacts/<project_id>/`.

---

## Container-Use Setup (Optional)

If you want agents to execute code in real containers:

1. Enable in `.env`:
   ```env
   CONTAINER_USE_ENABLED=true
   CONTAINER_USE_CLI_PATH=cu
   ```

2. Set base image:
   ```powershell
   container-use config base-image set python:3.11
   ```
   This writes `.container-use/environment.json`.

3. Test:
   ```powershell
   python -m sandbox.poc_container_demo
   ```

See [container-use.md](./container-use.md) for full details.

---

## Development

### Tests

```powershell
cd src
.\venv\Scripts\Activate.ps1
pytest tests/ -v
pytest --cov=. tests/
```

### Adding Agents

Agents are configured in MongoDB, not in Python code. All agents are `GenericAgent` instances.

**Via UI:** Navigate to Agent Configurations page → Create New Agent → set name, type, model, system prompt, allowed_phases, eval_keywords, tools.

**Via API:** `POST /api/configurations/agents/` with agent config JSON.

**Via seed file:** Add to `src/config/agents.yaml` → auto-seeded on startup.

Changes take effect on next project creation (agents are cloned per project).

### Frontend Production Build

```powershell
cd src/ui
npm run build
npm run preview
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "OpenAI API key not provided" | Set `OPENAI_API_KEY` in `.env` |
| Port 8000 in use | Change `API_PORT` in `.env` |
| Module not found | Run `pip install -r requirements.txt` |
| UI not connecting | Check backend is running, check browser console |
| LLM calls failing | Verify API key, check credits/rate limits |
| MongoDB connection refused | Start MongoDB or check `MONGODB_URI` |

---

## Next Steps

- [bifrost.md](./bifrost.md) — LLM gateway setup
- [mongodb.md](./mongodb.md) — Database details
- [infrastructure.md](./infrastructure.md) — Production K8s, observability (Prom/Jaeger/Grafana on logging host), CI/CD
