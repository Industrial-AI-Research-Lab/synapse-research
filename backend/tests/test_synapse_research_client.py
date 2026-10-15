from __future__ import annotations

from functools import partial
from types import SimpleNamespace

import httpx
import pytest

from backend.app.infrastructure.synapse_client import SynapseClient, SynapseError
from backend.app.infrastructure.synapse_research import report_attachment_ids


def make_client(monkeypatch, handler):
    client_class = httpx.Client
    monkeypatch.setattr(httpx, "Client", partial(client_class, transport=httpx.MockTransport(handler)))
    return SynapseClient(SimpleNamespace(synapse_url="https://synapse.test", synapse_user="test@example.test", synapse_password="test-password", synapse_configured=True, synapse_timeout=5, http_trace_enabled=False))


def test_snapshot_uses_report_manifest_and_excludes_user_uploads(monkeypatch):
    def handler(request):
        path = request.url.path
        if path.endswith("/login"):
            return httpx.Response(200, json={"access_token": "test-token"})
        assert request.headers["Authorization"] == "Bearer test-token"
        if path.endswith("/pending-approval"):
            return httpx.Response(200, json={"pending_approval": {"id": "message-1", "run_id": "run-1", "content": "Утвердите запрос", "data": {"approval_id": "gate-1", "label": "Согласование", "data": {"question": "Вопрос"}}}})
        if path.endswith("/execution-trace"):
            assert request.url.params["payload_node_id"] == "render_report"
            return httpx.Response(200, json={"payload": {"writes": {"report_result": {"formats": {"txt": {"attachment_id": "answer"}, "html": {"attachment_id": "html"}}}}}})
        if path.endswith("/attachments"):
            return httpx.Response(200, json={"attachments": [{"id": "source", "filename": "source.pdf", "source": "user"}, {"id": "answer", "filename": "arbitrary-answer.txt", "source": "agent", "size_bytes": 4000}, {"id": "html", "filename": "../полный.html", "source": "agent", "size_bytes": 2000}], "truncated": False})
        return httpx.Response(200, json={"id": "project-1", "status": "running", "current_phase": "approve_manifest", "final_output": "A" * 5000, "deployment_url": "javascript:alert(1)"})
    snapshot = make_client(monkeypatch, handler).research_snapshot("project-1")
    assert len(snapshot["result_text"]) == 5000
    assert snapshot["status"] == "awaiting_approval"
    assert snapshot["approvals"][0]["id"] == "gate-1"
    assert snapshot["approvals"][0]["run_id"] == "run-1"
    assert snapshot["result_url"] == ""
    assert [file["id"] for file in snapshot["files"]] == ["answer", "html"]
    assert all(file["is_report"] for file in snapshot["files"])
    assert snapshot["files"][1]["filename"] == "полный.html"


@pytest.mark.parametrize("run_id", ["", "run-1"])
def test_resolve_uses_existing_synapse_api_with_comment(monkeypatch, run_id):
    def handler(request):
        if request.url.path.endswith("/login"):
            return httpx.Response(200, json={"access_token": "test-token"})
        assert request.method == "POST"
        assert request.url.path == "/api/projects/project-1" + ("/runs/run-1" if run_id else "") + "/approvals/gate-1/resolve"
        import json
        assert json.loads(request.content) == {"approved": False, "feedback": "Исправьте источники"}
        return httpx.Response(200, json={"status": "success"})
    make_client(monkeypatch, handler).resolve_approval("project-1", {"id": "gate-1", "run_id": run_id}, False, "Исправьте источники")


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
