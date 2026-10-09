from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app.application.synapse_service import SynapseAttachment, SynapseService
from backend.app.infrastructure.synapse_client import SynapseClient
from backend.app.main import app
from backend.app.presentation import api


class _DocumentStore:
    def __init__(self, files: dict[str, Path]) -> None:
        self._files = files
        self.opened: list[str] = []

    def open_file(self, document_id: str) -> dict[str, object]:
        self.opened.append(document_id)
        path = self._files[document_id]
        return {"path": path, "filename": path.name}


class _RecordingSynapseGateway:
    def __init__(self) -> None:
        self.calls: list[tuple[str, list[SynapseAttachment]]] = []

    def create_project(self, prompt: str) -> dict[str, object]:
        raise AssertionError("The document workflow must use create_document_research")

    def create_document_research(
        self, prompt: str, attachments: list[SynapseAttachment]
    ) -> dict[str, object]:
        self.calls.append((prompt, attachments))
        return {
            "id": "project-42",
            "status": "running",
            "current_phase": "knowledge_collection",
            "title": "Исследование по документам",
            "deployments": [
                {"url": "https://result.synapse.test/collection-42"}
            ],
        }

    def get_project(self, project_id: str) -> dict[str, object]:
        raise AssertionError("Not used in this test")

    def project_url(self, project_id: str) -> str:
        return f"https://dev.synapse.test/monitor/{project_id}"


def test_document_research_forwards_unique_selected_pdf_files(tmp_path: Path) -> None:
    first = tmp_path / "first.pdf"
    second = tmp_path / "second.pdf"
    first.write_bytes(b"first")
    second.write_bytes(b"second")
    gateway = _RecordingSynapseGateway()
    documents = _DocumentStore({"doc-1": first, "doc-2": second})
    service = SynapseService(gateway, evidence_service=None, document_service=documents)

    project = service.start_document_research(
        "Какие ПАВ сохраняют растворимость?", ["doc-1", "doc-1", "doc-2"]
    )

    assert documents.opened == ["doc-1", "doc-2"]
    assert len(gateway.calls) == 1
    prompt, attachments = gateway.calls[0]
    assert "Какие ПАВ сохраняют растворимость?" in prompt
    assert [attachment.filename for attachment in attachments] == ["first.pdf", "second.pdf"]
    assert project == {
        "project_id": "project-42",
        "status": "running",
        "phase": "knowledge_collection",
        "title": "Исследование по документам",
        "awaiting_approval": False,
        "result_preview": "",
        "result_url": "https://result.synapse.test/collection-42",
        "synapse_url": "https://dev.synapse.test/monitor/project-42",
    }


class _FakeResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self._payload


class _RecordingHttpClient:
    instances: list["_RecordingHttpClient"] = []

    def __init__(self, **_kwargs: object) -> None:
        self.calls: list[tuple[str, str, dict[str, object]]] = []
        self.__class__.instances.append(self)

    def __enter__(self) -> "_RecordingHttpClient":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def post(self, path: str, **kwargs: object) -> _FakeResponse:
        self.calls.append(("POST", path, kwargs))
        return _FakeResponse({"access_token": "token"})

    def request(self, method: str, path: str, **kwargs: object) -> _FakeResponse:
        self.calls.append((method, path, kwargs))
        return _FakeResponse({"id": "project-42"})


class _UnavailableHttpClient:
    def __init__(self, **_kwargs: object) -> None:
        return None

    def __enter__(self) -> "_UnavailableHttpClient":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def post(self, _path: str, **_kwargs: object) -> _FakeResponse:
        raise httpx.ConnectError("connection refused")


class _TimedOutHttpClient(_UnavailableHttpClient):
    def post(self, _path: str, **_kwargs: object) -> _FakeResponse:
        raise httpx.ReadTimeout("timed out")


def test_synapse_client_uploads_document_research_as_multipart(
    monkeypatch, tmp_path: Path
) -> None:
    source = tmp_path / "source.pdf"
    source.write_bytes(b"pdf")
    _RecordingHttpClient.instances.clear()
    monkeypatch.setattr(
        "backend.app.infrastructure.synapse_client.httpx.Client", _RecordingHttpClient
    )
    config = SimpleNamespace(
        synapse_url="https://synapse.test",
        synapse_timeout=30.0,
        synapse_user="researcher@example.test",
        synapse_password="not-exposed",
        synapse_workflow_id="default_build",
        synapse_document_workflow_id="knowledge_collection_v2",
        synapse_document_run_config_id="agent-owned-models",
        synapse_approval_mode="human",
        synapse_configured=True,
        synapse_ui_url="https://dev.synapse.test",
    )

    result = SynapseClient(config).create_document_research(
        "Подготовь ответ", [SynapseAttachment(filename="source.pdf", path=source)]
    )

    assert result == {"id": "project-42"}
    request_client = _RecordingHttpClient.instances[0]
    method, path, kwargs = request_client.calls[1]
    assert (method, path) == ("POST", "/api/projects")
    assert kwargs["data"] == {
        "user_prompt": "Подготовь ответ",
        "workflow_id": "knowledge_collection_v2",
        "approval_mode": "human",
        "run_config_id": "agent-owned-models",
    }
    uploaded = kwargs["files"]
    assert isinstance(uploaded, list)
    assert uploaded[0][0] == "files"
    assert uploaded[0][1][0] == "source.pdf"
    assert uploaded[0][1][2] == "application/pdf"


def test_synapse_client_returns_a_safe_error_when_service_is_unreachable(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "backend.app.infrastructure.synapse_client.httpx.Client", _UnavailableHttpClient
    )
    config = SimpleNamespace(
        synapse_url="https://synapse.test",
        synapse_timeout=30.0,
        synapse_user="researcher@example.test",
        synapse_password="not-exposed",
        synapse_workflow_id="default_build",
        synapse_configured=True,
        synapse_ui_url="https://dev.synapse.test",
    )

    with pytest.raises(
        RuntimeError,
        match="Не удалось подключиться к Synapse",
    ):
        SynapseClient(config).get_project("project-42")


def test_synapse_client_reports_a_timeout_separately(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.app.infrastructure.synapse_client.httpx.Client", _TimedOutHttpClient
    )
    config = SimpleNamespace(
        synapse_url="https://synapse.test",
        synapse_timeout=30.0,
        synapse_user="researcher@example.test",
        synapse_password="not-exposed",
        synapse_workflow_id="default_build",
        synapse_configured=True,
        synapse_ui_url="https://dev.synapse.test",
    )

    with pytest.raises(RuntimeError, match="Synapse не ответил вовремя"):
        SynapseClient(config).get_project("project-42")


class _ApiSynapseService:
    def __init__(self) -> None:
        self.started: list[tuple[str, list[str]]] = []

    def start_document_research(self, query: str, document_ids: list[str]) -> dict[str, object]:
        self.started.append((query, document_ids))
        return {
            "project_id": "project-42",
            "status": "running",
            "phase": "knowledge_collection",
            "title": "Исследование по документам",
            "awaiting_approval": False,
            "result_preview": "",
            "result_url": "",
            "synapse_url": "https://dev.synapse.test/monitor/project-42",
        }

    def get_project(self, project_id: str) -> dict[str, object]:
        assert project_id == "project-42"
        return {
            "project_id": project_id,
            "status": "completed",
            "phase": "completed",
            "title": "Исследование по документам",
            "awaiting_approval": False,
            "result_preview": "Готовый исследовательский ответ",
            "result_url": "https://result.synapse.test/collection-42",
            "synapse_url": "https://dev.synapse.test/monitor/project-42",
        }


def test_document_research_api_starts_and_reads_synapse_project(monkeypatch) -> None:
    service = _ApiSynapseService()
    monkeypatch.setattr(api, "synapse_service", lambda: service)
    client = TestClient(app)

    started = client.post(
        "/api/documents/research",
        json={"query": "Какие ПАВ сохраняют растворимость?", "document_ids": ["doc-1"]},
    )
    refreshed = client.get("/api/documents/research/project-42")

    assert started.status_code == 200
    assert service.started == [("Какие ПАВ сохраняют растворимость?", ["doc-1"])]
    assert started.json()["project_id"] == "project-42"
    assert refreshed.status_code == 200
    assert refreshed.json()["result_preview"] == "Готовый исследовательский ответ"
    assert refreshed.json()["result_url"] == "https://result.synapse.test/collection-42"
