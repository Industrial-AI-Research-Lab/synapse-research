# Container-Use Skill — Synapse

## What It Is

Container-Use is an MCP server that gives agents isolated container environments to create files and run commands. Code runs inside Docker containers, not on the host.

---

## Usage Rules

- **Always use environments for all file and shell operations.** No exceptions — all ops go through `environment_*` tools.
- **Do not run git inside the environment.** The server manages Git. Running git via `environment_run_cmd` can corrupt the environment.
- **Tell users how to view work:**
  - `container-use log <env_id>`
  - `container-use checkout <env_id>`
- **Uncommitted local changes are NOT included.** Environments are created from the last commit. Commit changes you want included.

---

## Setup

### 1. Install Container-Use CLI

```powershell
curl -fsSL https://raw.githubusercontent.com/dagger/container-use/main/install.sh | bash
cu --version
```

### 2. Configure Environment

In `src/.env`:
```bash
CONTAINER_USE_ENABLED=true
CONTAINER_USE_CLI_PATH=cu
```

### 3. Set Base Image

```powershell
container-use config base-image set python:3.11
```

This writes `.container-use/environment.json`:
```json
{ "workdir": "/workdir", "base_image": "python:3.11" }
```

### 4. Verify

```powershell
cd src
python main.py
# Look for: Container execution: ENABLED
```

---

## How It Works

1. `ContainerManager` spawns `cu stdio` as a subprocess (MCP server mode)
2. Communication is JSON-RPC over stdin/stdout via `mcp_client_sdk.py`
3. Per-project repos live under `REPOSITORIES_ROOT` (default: `C:\work\repositories`)
4. `.container-use/` config is copied into each per-environment repo before creation
5. `environment_create` provisions the container from the repo + config

### Preinstalled Python Libraries

The libraries agents keep reaching for (numpy, pandas, shapely, pyproj, pyogrio, geopandas) are installed by `setup_commands` in `.container-use/environment.json`. Setup commands run before the project code is copied in, so Dagger builds that layer once per engine and every environment reuses it; `install_commands` run after the copy and repeat for each new project.
- Pins must still support the base image's Python 3.11: the newest numpy and pyproj releases require 3.12.
- A project keeps the config copied into its repo when it was created, so only projects started after a change get the new libraries.

### Key Code Files

| File | Purpose |
|------|---------|
| `src/sandbox/container_manager.py` | Container lifecycle management |
| `src/sandbox/mcp_client_sdk.py` | stdio MCP client |
| `src/sandbox/repo_manager.py` | Git repo management per project |
| `src/tools/mcp_executor.py` | Tool → MCP bridge |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTAINER_USE_ENABLED` | `true` | Enable/disable container execution |
| `CONTAINER_USE_CLI_PATH` | `cu` | Path to container-use CLI |
| `REPOSITORIES_ROOT` | `C:\work\repositories` | Where per-project repos live |

---

## Manual Commands

```powershell
container-use list              # List environments
container-use log <env_id>      # View environment logs
container-use checkout <env_id> # Checkout environment files locally
cu shell <env_id>               # Shell into container
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `cu: command not found` | Install container-use CLI, add to PATH |
| `Cannot connect to Docker daemon` | Start Docker Desktop |
| Shows "DISABLED (simulated)" | Check `.env` has `CONTAINER_USE_ENABLED=true` |
| Environment missing code | Commit changes before creating environment |
