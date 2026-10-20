from __future__ import annotations

import asyncio
import logging
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from backend.app.config import settings
from backend.app.observability import reset_request_id, set_request_id
from backend.app.presentation.api import router

logger = logging.getLogger(__name__)

app = FastAPI(title="Synapse Research API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(router)


@app.middleware("http")
async def trace_requests(request: Request, call_next):
    trace_enabled = settings().http_trace_enabled and request.url.path.startswith("/api/")
    if not trace_enabled:
        return await call_next(request)

    request_id = uuid4().hex
    token = set_request_id(request_id)
    started_at = perf_counter()

    if trace_enabled:
        logger.info(
            "pav.request.started request_id=%s method=%s path=%s content_length=%s",
            request_id,
            request.method,
            request.url.path,
            request.headers.get("content-length", "-"),
        )

    try:
        response = await call_next(request)
    except Exception:
        if trace_enabled:
            logger.exception(
                "pav.request.failed request_id=%s method=%s path=%s duration_ms=%.1f",
                request_id,
                request.method,
                request.url.path,
                (perf_counter() - started_at) * 1000,
            )
        raise
    finally:
        reset_request_id(token)

    if trace_enabled:
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "pav.request.completed request_id=%s method=%s path=%s status_code=%s duration_ms=%.1f",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            (perf_counter() - started_at) * 1000,
        )
    return response


async def _serve() -> None:
    import uvicorn

    config = settings()
    await uvicorn.Server(uvicorn.Config(app, host=config.host, port=config.port, log_level="info")).serve()


if __name__ == "__main__":
    asyncio.run(_serve())
