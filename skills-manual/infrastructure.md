# Infrastructure Skill — Synapse

## Observability (Jaeger + Prometheus + Grafana + Loki)

The full observability stack runs on a **dedicated logging server** (`10.0.0.3` private). Application clusters (production, staging, dev) ship telemetry to it over the Hetzner private network.

### Layout

| Component | Location | Endpoint |
|-----------|----------|----------|
| **Jaeger** (all-in-one 1.52, Badger KV) | Docker compose on logging host, `/opt/observability/` | OTLP HTTP `10.0.0.3:4318`, UI `https://jaeger.synapse.bonpp.com/` |
| **Prometheus** v2.54.1 (30d retention, remote_write receiver) | Docker compose on logging host, `/opt/observability/` | `10.0.0.3:9090` (private only) |
| **Loki** | Docker compose on logging host, `/opt/logging/` | `10.0.0.3:3100` (private only) |
| **Grafana** | Docker compose on logging host, `/opt/logging/` | `https://logs.synapse.bonpp.com/` |
| **Caddy** (TLS + basicauth) | Docker compose on logging host, `/opt/logging/` | ports 80/443 |
| **Grafana Alloy** (DaemonSet) | Each app cluster, `monitoring` ns | ships logs to Loki + metrics to Prometheus via remote_write |
| **kube-state-metrics + node-exporter** | Production cluster only, `monitoring` ns (standalone charts) | scraped by local Alloy |

### Backend Config

```env
OTEL_ENABLED=true
OTEL_ENDPOINT=http://10.0.0.3:4318/v1/traces
OTEL_SERVICE_NAME=synapse-backend
```

Only OTLP HTTP (4318) is exposed; gRPC (4317) is not.

### Jaeger UI Authentication

Caddy-level HTTP basic auth (bcrypt hash in `/opt/logging/caddy/Caddyfile`). Credentials file: `/opt/observability/jaeger-basicauth.txt` on the logging host (mode 600).

```
jaeger.synapse.bonpp.com {
    basic_auth {
        admin <bcrypt-hash>
    }
    reverse_proxy jaeger:16686
}
```

To rotate: generate a new bcrypt with `caddy hash-password`, replace the hash in `Caddyfile`, `docker compose -f /opt/logging/docker-compose.yml restart caddy`.

### Metrics Pipeline

Alloy (in cluster) scrapes and forwards to the logging Prometheus. Config at `ConfigMap monitoring/alloy` (`config.alloy`). External labels added by Alloy: `cluster=synapse`, `host=production` (or staging/dev).

Active scrape jobs (production):

| Job | Target |
|-----|--------|
| `kubelet` | `discovery.kubernetes role=node` :10250 (bearer token, TLS insecure-skip) |
| `cadvisor` | same, `/metrics/cadvisor` |
| `kube-state-metrics` | `kube-prometheus-kube-state-metrics.monitoring.svc.cluster.local:8080` |
| `node-exporter` | `kube-prometheus-prometheus-node-exporter.monitoring.svc.cluster.local:9100` |
| `coredns` | `kube-system` pods with label `k8s-app=kube-dns`, :9153 |

Dev and staging run neither kube-state-metrics nor node-exporter, and the kubelet's `/metrics` carries ~40k k3s API-server series per node, so their Alloy ships a lean set (~300 series each): `kubelet-resource` (`/metrics/resource`: node and per-pod CPU/memory), cAdvisor's root-cgroup (`id="/"`) disk usage/size and major page faults, the kubelet's container-start and running-pod counters, and the kernel's OOM-kill counter (`node_vmstat_oom_kill`, from Alloy's built-in node exporter limited to its `vmstat` collector). `infra/alloy/deploy-alloy.sh` picks the set from `ENVIRONMENT`.

Remote-write URL on Alloy: `http://10.0.0.3:9090/api/v1/write` (set via `PROM_REMOTE_WRITE_URL` env).

### Verification

```bash
# From logging host — confirm all cluster jobs up
curl -s 'http://10.0.0.3:9090/api/v1/query?query=up{host="production"}' | jq

# From logging host — confirm recent traces
curl -u admin:... 'http://127.0.0.1:16686/api/services'

# From cluster — confirm backend ships traces
kubectl -n synapse exec deploy/synapse-synapse-backend -c backend -- \
  printenv OTEL_ENDPOINT
# http://10.0.0.3:4318/v1/traces

# From cluster — confirm Alloy is running and scraping
kubectl -n monitoring get ds alloy
kubectl -n monitoring logs ds/alloy -c alloy --tail=50 | grep -i 'remote_write\|scrape'
```

### Troubleshooting

| Problem | Fix |
|---------|-----|
| No traces appearing | Check `OTEL_ENDPOINT` in backend, reachability from cluster to `10.0.0.3:4318` over Hetzner private net |
| UI 401 loop | Verify basicauth credentials in `/opt/observability/jaeger-basicauth.txt` |
| `up=0` on some job | `kubectl -n monitoring logs ds/alloy -c alloy` — likely scrape target moved/renamed |
| Samples not appearing | Check `/opt/observability/data/prom/` disk space on logging host, check Alloy logs for `remote_write` errors |
| Metrics gap after uninstall | KSM/node-exporter are installed via standalone `prometheus-community` charts (releases `ksm` and `node-exporter` in `monitoring` ns). Reinstall if missing. |

### Retention

- **Prometheus:** 30 days TSDB (`--storage.tsdb.retention.time=30d` in compose file)
- **Jaeger:** persistent (Badger), no TTL configured — monitor `/opt/observability/data/jaeger/` size
- **Loki:** see `/opt/logging/loki/` config

---

## Bifrost LLM Gateway

### Architecture

- **Bifrost** (`maximhq/bifrost:v1.4.4`): LLM Gateway with built-in UI authentication
- **Authelia is NOT used** — Bifrost handles its own auth natively since v1.4.4
- **Traefik**: TLS termination only, no forwardAuth middleware on Bifrost ingress

### Deployment

Deploy via GitHub Actions workflow **"Deploy Bifrost (LLM Gateway)"**:

1. Add GitHub Secrets: `LLM_GATEWAY_DOMAIN`, `SSH_HOST`, `SSH_KEY`
2. Optionally set `BIFROST_ALLOWED_ORIGINS` (default `*`)
3. Run workflow

### Deployed Manifests

The `deploy-bifrost.yml` workflow renders and applies these 5 files from `deploy/k8s/bifrost/`:

| File | Purpose |
|------|---------|
| `05a-bifrost-pvc.yaml` | Bifrost persistent volume (data storage) |
| `06-bifrost-deploy.yaml` | Bifrost deployment & service |
| `07-bifrost-ingress.yaml` | TLS ingress — no middleware, Bifrost's own auth |
| `09-redirect-middleware.yaml` | Traefik HTTP→HTTPS redirect middleware |
| `10-bifrost-http-redirect.yaml` | HTTP ingress (port 80) with redirect to HTTPS |

### Key Config Notes

- **Bifrost ingress**: TLS + websecure only — no `router.middlewares` annotation
- **WebSocket origins**: Set via `BIFROST_ALLOWED_ORIGINS` env var (default `*`)
- **Auth**: Handled by Bifrost's built-in UI — configure credentials in Bifrost dashboard at `https://<LLM_GATEWAY_DOMAIN>`

### Bifrost Troubleshooting

| Problem | Fix |
|---------|-----|
| WebSocket origin errors | Set `BIFROST_ALLOWED_ORIGINS` to include your domain or `*` |
| Bifrost UI inaccessible | Check pod: `kubectl -n synapse logs deploy/bifrost` |
| PVC not bound | `kubectl -n synapse describe pvc bifrost-data` |

---

## TLS / Cert-Manager

### What It Is

cert-manager with Porkbun DNS01 webhook for automatic Let's Encrypt TLS certificates under `*.apps.<ROOT_DOMAIN>`.

### Components

- **cert-manager** — Kubernetes certificate management controller
- **porkbun-webhook** — DNS01 solver for Porkbun domains
- **ClusterIssuer** — Let's Encrypt ACME config with Porkbun DNS01

### Setup

One-time setup via Helm charts in `deploy/k8s/`. Certificates auto-renew. Managed by `docker-build.yml` workflow (Porkbun secret + ClusterIssuer + wildcard cert steps).

---

## Production Environment

### Kubernetes Cluster

- **Namespace:** `synapse` — backend, frontend, Bifrost, Authelia, docker-registry, redis
- **Namespace:** `monitoring` — Alloy (DaemonSet), standalone kube-state-metrics, standalone prometheus-node-exporter
- **Namespace:** `synapse-apps` — deploy-agent deployed user apps
- **Key Deployments:** `synapse-synapse-backend`, `synapse-synapse-frontend`, `bifrost`, `authelia`, `docker-registry`
- **Secrets:** `backend-secrets` (contains `OPENAI_API_KEY`, `MONGODB_URI`, Bifrost, OTEL, deploy agent vars)

Jaeger, Prometheus, Grafana, Loki do **not** run in the cluster — see the Observability section above.

### Common Operations

```bash
# Check backend status
kubectl -n synapse get pods
kubectl -n synapse logs -f deploy/synapse-synapse-backend -c backend

# Restart backend
kubectl -n synapse rollout restart deploy/synapse-synapse-backend

# Check version / build info
kubectl -n synapse exec deploy/synapse-synapse-backend -c backend -- env | grep -E "BUILD|VERSION|GITHUB_RUN"

# Update env vars
kubectl -n synapse edit secret backend-secrets
kubectl -n synapse rollout restart deploy/synapse-synapse-backend
```

### CI/CD

- **`docker-build.yml`** — main workflow: build images, push to registry, create K8s secrets, Helm upgrade, restart
- **`deploy-bifrost.yml`** — manual: deploy/update Bifrost LLM gateway
- Helm chart at `deploy/helm/synapse/`
- Docker images built and pushed on merge to `main`

> The `deploy-jaeger.yml` workflow and `infra/k8s/jaeger/` + `infra/k8s/jaeger-authelia/` manifests are **dead code** since the observability migration — Jaeger now runs on the logging host (see Observability section). Do not run that workflow against the prod cluster.

### Monitoring

- **Grafana:** `https://logs.synapse.bonpp.com/` — dashboards (Loki logs + Prometheus metrics)
- **Jaeger UI:** `https://jaeger.synapse.bonpp.com/` — distributed traces (basicauth)
- **Bifrost UI:** `https://llm.synapse.bonpp.com/` — LLM call logs, token usage, costs
- **kubectl logs:** Raw backend application logs
- **MongoDB Atlas:** Database metrics (if using Atlas)
