# PAV Evidence Navigator

Repository contains two independently runnable applications.

- `frontend/` is React + TypeScript + Vite. Apply `.agents/skills/pav-frontend-core` for any frontend work and `pav-frontend-feature` for a user-facing change.
- `backend/` is FastAPI with Clean Architecture. Apply `.agents/skills/pav-backend-clean-architecture` before changing API, use cases, infrastructure or domain rules.

Do not restore server-rendered static UI in the backend. The only shared contract is the versionless REST API under `/api`.

Toast notifications default to the top-right corner through the shared `ToastViewport`. Preserve safe-area offsets and responsive sizing; do not add page-specific placement overrides.
