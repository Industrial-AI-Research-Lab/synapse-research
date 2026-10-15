from __future__ import annotations

from functools import partial
from types import SimpleNamespace

import httpx
import pytest

from backend.app.infrastructure.synapse_client import SynapseClient, SynapseError
from backend.app.application.research_service import ResearchConflictError
from backend.app.infrastructure.synapse_research import failure_reason, report_attachment_ids


def make_client(monkeypatch, handler):
    client_class = httpx.Client
    monkeypatch.setattr(httpx, "Client", partial(client_class, transport=httpx.MockTransport(handler)))
    return SynapseClient(SimpleNamespace(synapse_url="https://synapse.test", synapse_user="test@example.test", synapse_password="test-password", synapse_configured=True, synapse_timeout=5, synapse_workflow_id="research", synapse_approval_mode="human", http_trace_enabled=False))


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
    with pytest.raises(ResearchConflictError, match="Запрос изменился"):
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
    assert "получен один пакет" in snapshot["failure_reason"]


@pytest.mark.parametrize("messages, expected", [
    ([None, [], {}, "plain text", '{"task_report": []}'], ""),
    ([{"task_report": {"outcome": "ok", "message": "Not an error"}}], ""),
    ([{"task_report": {"outcome": "failed", "message": " Earlier "}}, '```json\n{"task_report":{"outcome":"failed","message":"Latest"}}\n```'], "Latest"),
])
def test_failure_reason_handles_malformed_content_and_uses_latest_failure(messages, expected):
    assert failure_reason(messages) == expected
