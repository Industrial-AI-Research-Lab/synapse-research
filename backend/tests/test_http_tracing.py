from __future__ import annotations

import logging
from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend.app import main
from backend.app.config import Settings
from backend.app.infrastructure import synapse_client
from backend.app.infrastructure.synapse_client import SynapseClient, _log_destination
from backend.app.observability import reset_request_id, set_request_id


class _Response:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload
        self.status_code = 200

    def json(self) -> dict[str, object]:
        return self._payload


class _HttpClient:
    def __init__(self, **_kwargs: object) -> None:
        pass

    def __enter__(self) -> "_HttpClient":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def post(self, _path: str, **_kwargs: object) -> _Response:
        return _Response({"access_token": "token"})

    def request(self, _method: str, _path: str, **_kwargs: object) -> _Response:
        return _Response({"id": "project-42"})


def test_http_trace_setting_is_disabled_by_default_and_can_be_enabled(monkeypatch) -> None:
    monkeypatch.delenv("PAV_HTTP_TRACE_ENABLED", raising=False)
    assert Settings(_env_file=None).http_trace_enabled is False
    assert Settings(_env_file=None, PAV_HTTP_TRACE_ENABLED=True).http_trace_enabled is True


def test_http_trace_records_request_lifecycle_without_the_body(monkeypatch, caplog) -> None:
    monkeypatch.setattr(
        main,
        "settings",
        lambda: SimpleNamespace(http_trace_enabled=True),
    )

    with caplog.at_level(logging.INFO), TestClient(main.app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert len(response.headers["X-Request-ID"]) == 32
    assert "pav.request.started" in caplog.text
    assert "pav.request.completed" in caplog.text
    assert "method=GET path=/api/health" in caplog.text


def test_http_trace_is_off_by_default(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "settings",
        lambda: SimpleNamespace(http_trace_enabled=False),
    )

    with TestClient(main.app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert "X-Request-ID" not in response.headers


def test_http_trace_preserves_validation_after_large_declared_upload(monkeypatch, caplog) -> None:
    monkeypatch.setattr(
        main,
        "settings",
        lambda: SimpleNamespace(http_trace_enabled=True),
    )

    with caplog.at_level(logging.INFO), TestClient(main.app) as client:
        response = client.post(
            "/api/documents",
            content=b"",
            headers={
                "Content-Length": str(20 * 1024 * 1024 + 1024 * 1024 + 1),
                "Content-Type": "application/octet-stream",
            },
        )

    assert response.status_code == 422
    assert len(response.headers["X-Request-ID"]) == 32
    assert "status_code=422" in caplog.text


def test_synapse_trace_records_destination_without_credentials_or_prompt(
    monkeypatch, caplog
) -> None:
    monkeypatch.setattr(synapse_client.httpx, "Client", _HttpClient)
    config = SimpleNamespace(
        synapse_url="https://user:password@synapse.test",
        synapse_timeout=30.0,
        synapse_user="researcher@example.test",
        synapse_password="not-exposed",
        synapse_workflow_id="default_build",
        synapse_approval_mode="human",
        synapse_configured=True,
        http_trace_enabled=True,
    )
    token = set_request_id("request-123")
    try:
        with caplog.at_level(logging.INFO):
            result = SynapseClient(config).create_project("private research question")
    finally:
        reset_request_id(token)

    assert result == {"id": "project-42"}
    assert "pav.synapse.login.started request_id=request-123" in caplog.text
    assert "pav.synapse.request.completed request_id=request-123" in caplog.text
    assert "destination=https://synapse.test" in caplog.text
    assert "user:password" not in caplog.text
    assert "researcher@example.test" not in caplog.text
    assert "not-exposed" not in caplog.text
    assert "private research question" not in caplog.text


def test_log_destination_redacts_credentials_and_tolerates_invalid_port() -> None:
    assert (
        _log_destination("https://user:password@[::1]:8000/api")
        == "https://[::1]:8000/api"
    )
    assert _log_destination("http://synapse.test:not-a-port") == "http://synapse.test"
