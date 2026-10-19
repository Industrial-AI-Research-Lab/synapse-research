from __future__ import annotations

from functools import partial
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app.application.research_service import ResearchService
from backend.app.application.synapse_service import SynapseService
from backend.app.infrastructure.research_repository import SqliteResearchRepository
from backend.app.infrastructure.synapse_client import SynapseClient, SynapseError
from backend.app.application.research_service import ResearchConflictError
from backend.app.infrastructure.synapse_research import failure_reason, report_attachment_ids
from backend.app.main import app
from backend.app.presentation import api


def make_client(monkeypatch, handler):
    client_class = httpx.Client
    monkeypatch.setattr(httpx, "Client", partial(client_class, transport=httpx.MockTransport(handler)))
    return SynapseClient(SimpleNamespace(synapse_url="https://synapse.test", synapse_ui_url="https://synapse.test", synapse_user="test@example.test", synapse_password="test-password", synapse_configured=True, synapse_timeout=5, synapse_workflow_id="research", synapse_approval_mode="human", http_trace_enabled=False))


def test_snapshot_uses_report_manifest_and_excludes_user_uploads(monkeypatch):
    def handler(request):
        path = request.url.path
        if path.endswith("/login"):
            return httpx.Response(200, json={"access_token": "test-token"})
        assert request.headers["Authorization"] == "Bearer test-token"
        if path.endswith("/pending-approval"):
            return httpx.Response(200, json={"pending_approval": {"id": "message-1", "run_id": "run-1", "content": "Утвердите запрос", "data": {"approval_id": "gate-1", "label": "Согласование", "data": {"question": "Вопрос"}}}})
        if path.endswith("/execution-trace"):
            pytest.fail("Workflow node names are not execution-trace payload IDs")
        if path.endswith("/messages"):
            assert request.url.params["run_id"] == "run-1"
            return httpx.Response(200, json={"messages": [{"type": "user", "content": '{"formats":{"html":{"attachment_id":"source"}}}'}, {"type": "assistant", "content": '{"status":"ok","formats":{"txt":{"attachment_id":"answer"},"html":{"attachment_id":"html"}}}'}]})
        if path.endswith("/attachments"):
            return httpx.Response(200, json={"attachments": [{"id": "source", "filename": "source.pdf", "source": "user"}, {"id": "answer", "filename": "arbitrary-answer.txt", "source": "agent", "size_bytes": 4000}, {"id": "html", "filename": "../полный.html", "source": "agent", "size_bytes": 2000}], "truncated": False})
        return httpx.Response(200, json={"id": "project-1", "status": "completed", "current_run_id": "run-1", "current_phase": "approve_manifest", "final_output": "A" * 5000, "deployment_url": "javascript:alert(1)"})
    snapshot = make_client(monkeypatch, handler).research_snapshot("project-1")
    assert len(snapshot["result_text"]) == 5000
    assert snapshot["status"] == "awaiting_approval"
    assert snapshot["approvals"][0]["id"] == "gate-1"
    assert snapshot["approvals"][0]["run_id"] == "run-1"
    assert snapshot["approvals"][0]["expected_data"] == {"approval_id": "gate-1", "label": "Согласование", "data": {"question": "Вопрос"}}
    assert snapshot["result_url"] == ""
    assert [file["id"] for file in snapshot["files"]] == ["answer", "html"]
    assert all(file["is_report"] for file in snapshot["files"])
    assert snapshot["files"][1]["filename"] == "полный.html"


@pytest.mark.parametrize("run_id", ["", "run-1"])
@pytest.mark.parametrize("expected_data", [None, {"approval_id": "gate-1", "context_snapshot": {"documents": ["source.pdf"]}}])
def test_resolve_uses_existing_synapse_api_with_comment(monkeypatch, run_id, expected_data):
    def handler(request):
        if request.url.path.endswith("/login"):
            return httpx.Response(200, json={"access_token": "test-token"})
        assert request.method == "POST"
        assert request.url.path == "/api/projects/project-1" + ("/runs/run-1" if run_id else "") + "/approvals/gate-1/resolve"
        import json
        expected = {"approved": False, "feedback": "Исправьте источники"}
        if expected_data is not None:
            expected["expected_data"] = expected_data
        assert json.loads(request.content) == expected
        return httpx.Response(200, json={"status": "success"})
    make_client(monkeypatch, handler).resolve_approval("project-1", {"id": "gate-1", "run_id": run_id, "expected_data": expected_data}, False, "Исправьте источники")


def test_synapse_rejecting_a_changed_approval_becomes_a_conflict_without_retry(monkeypatch):
    attempts = []
    def handler(request):
        if request.url.path.endswith("/login"):
            return httpx.Response(200, json={"access_token": "test-token"})
        attempts.append(request)
        return httpx.Response(409, json={"detail": "Approval data changed"})
    with pytest.raises(ResearchConflictError, match="Approval data changed"):
        make_client(monkeypatch, handler).resolve_approval("project-1", {"id": "gate-1", "expected_data": {}}, True, "")
    assert len(attempts) == 1


def test_download_stream_is_closed_when_file_exceeds_limit(monkeypatch):
    class LargeStream(httpx.SyncByteStream):
        closed = False
        def __iter__(self):
            for _ in range(21):
                yield b"x" * (1024 * 1024)
        def close(self):
            self.closed = True
    stream = LargeStream()
    def handler(request):
        if request.url.path.endswith("/login"):
            return httpx.Response(200, json={"access_token": "test-token"})
        assert request.url.params["raw"] == "true"
        return httpx.Response(200, stream=stream)
    with pytest.raises(SynapseError, match="20 МБ"):
        make_client(monkeypatch, handler).download_research_file("project-1", "file-1")
    assert stream.closed


def test_report_manifest_does_not_turn_malformed_ids_into_file_identifiers():
    manifest = {"formats": {"html": {"attachment_id": "report"}, "txt": {"attachment_id": {"id": "nested"}}, "pdf": {"attachment_id": []}, "docx": {"attachment_id": None}}}
    assert report_attachment_ids(manifest) == {"report"}


def test_report_manifest_is_read_from_saved_agent_json_messages():
    messages = ['```json\n{"formats":{"html":{"attachment_id":"report"}}}\n```', '{"formats":', 'ordinary explanation']
    assert report_attachment_ids(messages) == {"report"}


def test_creation_timeout_does_not_tell_the_user_to_repeat_the_creation(monkeypatch):
    def handler(request):
        if request.url.path.endswith("/login"):
            return httpx.Response(200, json={"access_token": "test-token"})
        raise httpx.ReadTimeout("no response", request=request)
    with pytest.raises(SynapseError, match="Проверьте историю Synapse перед новым запуском"):
        make_client(monkeypatch, handler).create_project("Question")


def test_active_snapshot_does_not_depend_on_final_report_or_execution_trace(monkeypatch):
    def handler(request):
        path = request.url.path
        if path.endswith("/login"):
            return httpx.Response(200, json={"access_token": "test-token"})
        if path.endswith("/pending-approval"):
            return httpx.Response(200, json={"pending_approval": None})
        if path.endswith("/attachments"):
            return httpx.Response(200, json={"attachments": [], "truncated": False})
        assert path == "/api/projects/project-1"
        return httpx.Response(200, json={"status": "running"})
    assert make_client(monkeypatch, handler).research_snapshot("project-1")["status"] == "running"


def test_failed_snapshot_uses_current_agent_report_and_ignores_user_error_text(monkeypatch):
    def handler(request):
        path = request.url.path
        if path.endswith("/login"):
            return httpx.Response(200, json={"access_token": "test-token"})
        if path.endswith("/pending-approval"):
            return httpx.Response(200, json={"pending_approval": None})
        if path.endswith("/messages"):
            assert request.url.params["run_id"] == "failed-run"
            return httpx.Response(200, json={"messages": [
                {"type": "assistant", "content": '{"task_report":{"outcome":"failed","code":"FACT_BATCHES_MIN_ITEMS_CONFLICT"}}'},
                {"type": "user", "content": '{"task_report":{"outcome":"failed","message":"Wrong reason"}}'},
            ]})
        if path.endswith("/attachments"):
            return httpx.Response(200, json={"attachments": [], "truncated": False})
        return httpx.Response(200, json={"status": "failed", "current_run_id": "failed-run"})
    snapshot = make_client(monkeypatch, handler).research_snapshot("project-1")
    assert snapshot["status"] == "failed"
    assert json.loads(snapshot["failure_reason"]) == {"outcome": "failed", "code": "FACT_BATCHES_MIN_ITEMS_CONFLICT"}


@pytest.mark.parametrize("messages, expected", [
    ([None, [], {}, "plain text", '{"task_report": []}'], ""),
    ([{"task_report": {"outcome": "ok", "message": "Not an error"}}], ""),
    ([{"task_report": {"outcome": "failed", "message": " Earlier "}}, '```json\n{"task_report":{"outcome":"failed","message":"Latest"}}\n```'], "Latest"),
])
def test_failure_reason_handles_malformed_content_and_uses_latest_failure(messages, expected):
    reason = failure_reason([{"type": "assistant", "content": content} for content in messages])
    assert (json.loads(reason)["message"].strip() if reason else "") == expected


@pytest.mark.parametrize("response_kwargs, expected", [
    ({"json": {"detail": "file type not allowed"}}, "file type not allowed"),
    ({"json": {"detail": {"error": "attachment rejected", "project_id": "created-project"}}}, '{"error": "attachment rejected", "project_id": "created-project"}'),
    ({"json": {"detail": [{"loc": ["body", "files", 0], "msg": "Недопустимый файл", "type": "value_error"}]}}, '"loc": ["body", "files", 0]'),
    ({"json": {"error": {"code": "quota_exceeded", "message": "Tenant quota reached"}}}, '"code": "quota_exceeded"'),
    ({"json": {"detail": "Request rejected", "code": "tenant_quota", "project_id": "created-project"}}, '"code": "tenant_quota"'),
    ({"text": "Upstream service unavailable\nTry later"}, "Upstream service unavailable\nTry later"),
    ({"text": ""}, "HTTP 503"),
    ({"json": {"detail": None}}, "null"),
    ({"json": {"detail": []}}, "[]"),
    ({"json": {"detail": {}}}, "{}"),
    ({"json": {"detail": False}}, "false"),
    ({"json": {"detail": 0}}, "0"),
    ({"json": "Original JSON string"}, "Original JSON string"),
    ({"json": {"detail": "Ошибка строки\n" * 1000 + "конец сообщения"}}, "Ошибка строки\n" * 1000 + "конец сообщения"),
])
def test_http_errors_preserve_the_synapse_response(monkeypatch, response_kwargs, expected):
    def handler(request):
        if request.url.path.endswith("/login"):
            return httpx.Response(200, json={"access_token": "test-token"})
        return httpx.Response(503, **response_kwargs)

    with pytest.raises(SynapseError) as caught:
        make_client(monkeypatch, handler).get_project("project-1")
    assert expected in str(caught.value)
    assert "GET /api/projects/project-1" in str(caught.value)
    assert caught.value.status_code == 503


def test_login_error_preserves_synapse_detail_and_does_not_send_project(monkeypatch):
    attempts = []
    def handler(request):
        attempts.append(request.url.path)
        return httpx.Response(401, json={"detail": "Account is disabled"})

    with pytest.raises(SynapseError, match="Account is disabled") as caught:
        make_client(monkeypatch, handler).create_project("Question")
    assert attempts == ["/api/auth/login"]
    assert caught.value.outcome_unknown is False


@pytest.mark.parametrize("operation, failed_path", [
    (lambda c: c.create_project("Question"), "/api/projects"),
    (lambda c: c.research_snapshot("p"), "/api/projects/p"),
    (lambda c: c.research_snapshot("p"), "/api/projects/p/messages/pending-approval"),
    (lambda c: c.research_snapshot("p"), "/api/projects/p/messages"),
    (lambda c: c.research_snapshot("p"), "/api/projects/p/attachments"),
    (lambda c: c.resolve_approval("p", {"id": "gate"}, True, ""), "/api/projects/p/approvals/gate/resolve"),
    (lambda c: c.download_research_file("p", "file"), "/api/projects/p/attachments/file"),
])
def test_all_synapse_operations_keep_the_upstream_error(monkeypatch, operation, failed_path):
    def handler(request):
        if request.url.path.endswith("/login"):
            return httpx.Response(200, json={"access_token": "test-token"})
        if request.url.path == failed_path:
            return httpx.Response(400, json={"detail": "Original Synapse error"})
        return httpx.Response(200, json={"status": "failed", "pending_approval": None, "messages": []})

    with pytest.raises(SynapseError, match="Original Synapse error"):
        operation(make_client(monkeypatch, handler))


@pytest.mark.parametrize("code", ["FACT_BATCHES_MIN_ITEMS_CONFLICT", "workflow_not_approved", "other_error"])
def test_failure_reason_preserves_the_entire_agent_report(code):
    report = {"outcome": "failed", "code": code, "message": "Original message", "details": {"actual": 1, "required": 2}}
    messages = [{"type": "assistant", "content": json.dumps({"task_report": report})}]
    assert json.loads(failure_reason(messages)) == report


def test_failure_reason_uses_system_error_details_and_ignores_user_messages():
    data = {"detail": "MCP connection refused", "error_type": "tool_execution_failed"}
    messages = [
        {"type": "assistant", "content": {"task_report": {"outcome": "failed", "message": "Earlier failure"}}},
        {"type": "system", "subtype": "error", "content": "Open Details", "data": data},
        {"type": "user", "subtype": "error", "data": {"detail": "Wrong reason"}},
    ]
    assert json.loads(failure_reason(messages)) == data


@pytest.mark.parametrize("kind", ["documents", "evidence"])
def test_rejected_start_preserves_synapse_error_through_history_and_api(monkeypatch, tmp_path, kind):
    attempts = []
    def handler(request):
        if request.url.path.endswith("/login"):
            return httpx.Response(200, json={"access_token": "test-token"})
        attempts.append(request)
        return httpx.Response(400, json={"detail": "file type not allowed"})

    client = make_client(monkeypatch, handler)
    client.config.synapse_document_workflow_id = "research"
    client.config.synapse_document_run_config_id = ""
    researches = ResearchService(SqliteResearchRepository(tmp_path / "researches.sqlite3"), client)
    source = tmp_path / "source.jsonl"
    source.write_text('{"text":"source"}\n', encoding="utf-8")
    documents = SimpleNamespace(open_file=lambda _: {"filename": source.name, "path": source, "media_type": "application/json"})
    evidence = SimpleNamespace(selected_rows=lambda *_: [{
        "id": "EXP-1", "formulation": {"name": "Test"},
        "conditions": {"temperature_c": 20, "salinity_g_l": 10, "rock_type": "sandstone"},
        "result": {"label": "Recovery", "value": 10, "unit": "%"},
        "source": {"document": "source", "location": "p. 1", "url": "https://source.test"},
    }])
    service = SynapseService(client, evidence, documents, researches)
    monkeypatch.setattr(api, "synapse_service", lambda: service)
    monkeypatch.setattr(api, "research_service", lambda: researches)
    monkeypatch.setattr(api, "document_config", SimpleNamespace(document_access_token=""))
    path, body = ("/api/documents/research", {"query": "Question", "document_ids": ["DOC-1"]}) if kind == "documents" else ("/api/synapse/projects", {"question": "Question", "experiment_ids": ["EXP-1"]})

    with TestClient(app) as http:
        started = http.post(path, json=body)
        assert started.status_code == 200
        assert "file type not allowed" in started.json()["sync_error"]
        record = http.get("/api/researches/" + started.json()["research_id"]).json()
        assert record["status"] == "start_failed"
        assert "file type not allowed" in record["sync_error"]
        assert http.post("/api/researches/" + record["id"] + "/refresh").json()["sync_error"] == record["sync_error"]
        assert http.get("/api/researches").json()["items"][0]["sync_error"] == record["sync_error"]
        failed_get = http.get("/api/synapse/projects/missing")
        assert failed_get.status_code == 502
        assert "file type not allowed" in failed_get.json()["detail"]
    assert len(attempts) == 2


def test_failed_refresh_does_not_hide_synapse_error_when_resolving(monkeypatch, tmp_path):
    attempts = []
    def handler(request):
        if request.url.path.endswith("/login"):
            return httpx.Response(200, json={"access_token": "test-token"})
        attempts.append(request)
        return httpx.Response(403, json={"detail": "Tenant access denied"})

    researches = ResearchService(SqliteResearchRepository(tmp_path / "researches.sqlite3"), make_client(monkeypatch, handler))
    record = researches.start("documents", "Question", [], lambda: {"project_id": "p"})
    with pytest.raises(ResearchConflictError, match="Tenant access denied"):
        researches.resolve(record["id"], "gate", True, "")
    assert len(attempts) == 1


@pytest.mark.parametrize("during_login", [False, True])
def test_upstream_errors_do_not_expose_service_credentials_or_log_response_bodies(monkeypatch, caplog, during_login):
    password = 'private-"password\\with\nnewline'
    def handler(request):
        if request.url.path.endswith("/login") and not during_login:
            return httpx.Response(200, json={"access_token": "test-token"})
        return httpx.Response(422, json={"detail": {"message": "Original validation error", "input": {"email": "test@example.test", "password": password, "token": "test-token" if not during_login else None}}})

    client = make_client(monkeypatch, handler)
    client.config.synapse_password = password
    client.config.http_trace_enabled = True
    with pytest.raises(SynapseError) as caught:
        client.create_project("Question")
    message = str(caught.value)
    assert "Original validation error" in message
    for secret in [password, json.dumps(password, ensure_ascii=False)[1:-1], "test@example.test", "test-token"]:
        assert secret not in message
        assert secret not in caplog.text
    assert "Original validation error" not in caplog.text


@pytest.mark.parametrize("message, expected", [
    ({"type": "system", "subtype": "error", "data": {}, "content": "Original plain failure"}, "Original plain failure"),
    ({"type": "system", "subtype": "error", "data": {}, "content": ""}, ""),
    ({"type": "system", "subtype": "notice", "content": "Not a failure"}, ""),
    (None, ""),
])
def test_failure_reason_handles_system_messages_without_details(message, expected):
    assert failure_reason([message]) == expected
