# OpenRouter Models Sync Skill — Synapse

## Pattern Overview

Synapse fetches available LLM models from OpenRouter's API, caches them, and serves them to the frontend for model selection.

---

## Architecture

```
OpenRouter API ──► Backend (fetch + cache) ──► Frontend (dropdown)
                   ↕ cache (in-memory + file)
```

---

## Backend

### Fetch & Cache (`src/llm/openrouter_models.py`)

1. **On startup or first request:** Fetch `GET https://openrouter.ai/api/v1/models`
2. **Parse response:** Extract model id, name, context length, pricing, provider
3. **Cache in memory** with TTL (default: 1 hour)
4. **Cache to file** (`data/openrouter_models.json`) for cold starts
5. **On subsequent requests:** Return cached data if TTL not expired

### API Endpoint

```
GET /api/models → returns cached model list
```

### Environment Variables

```bash
OPENROUTER_API_KEY=sk-or-...        # Required for OpenRouter access
OPENROUTER_CACHE_TTL=3600           # Cache TTL in seconds (default: 1 hour)
```

---

## Frontend

### Model Selector Component

- Fetches models via `GET /api/models` on mount
- Displays searchable dropdown grouped by provider
- Shows context length, pricing info
- Persists user's last-selected model in localStorage

---

## Key Implementation Details

- **Rate limiting:** OpenRouter has rate limits; caching prevents excessive calls
- **Fallback:** If fetch fails, serve stale cache (file-based)
- **Model filtering:** Backend filters out models without chat completion support
- **Pricing display:** Shows per-token costs from OpenRouter metadata

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Empty model list | Check `OPENROUTER_API_KEY` is set and valid |
| Stale models | Delete `data/openrouter_models.json` and restart |
| Slow first load | Expected — initial fetch takes 1-2s; subsequent requests use cache |
