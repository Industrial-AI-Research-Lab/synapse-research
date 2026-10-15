from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.app.application.research_service import ResearchConflictError, ResearchGatewayError, ResearchNotFoundError, ResearchService
from backend.app.application.synapse_service import SynapseService
from backend.app.infrastructure.research_repository import SqliteResearchRepository
from backend.app.main import app
from backend.app.presentation import api


class Gateway:
    def __init__(self):
        self.launch_count = 0
        self.decisions = []
        self.offline = False
        self.snapshot = {"status": "awaiting_approval", "phase": "approve_manifest", "title": "Исследование", "approvals": [{"id": "approval-1", "run_id": "run-1", "title": "Утвердить запрос", "content": "Проверьте вопрос", "details": {"documents": ["источник.pdf"]}}], "files": [], "result_text": "", "result_url": ""}
        self.contents = {"answer": ("Полный ответ со ссылками. " * 150).encode(), "report": b"<html><body>Full report</body></html>", "collection": b'{"facts": [1, 2]}' }

    def create_project(self, prompt):
        self.launch_count += 1
        return {"id": "project-1", "status": "started"}

    def create_document_research(self, prompt, attachments):
        return self.create_project(prompt)

    def research_snapshot(self, project_id):
        if self.offline:
            raise ResearchGatewayError("Synapse недоступен")
        return deepcopy(self.snapshot)

    def project_url(self, project_id):
        return f"https://synapse.test/monitor/{project_id}"

    def resolve_approval(self, project_id, approval, approved, feedback):
        self.decisions.append((project_id, approval["id"], approved, feedback))
        self.snapshot = {**self.snapshot, "status": "completed", "approvals": [], "files": [
            {"id": "answer", "filename": "отчёт.txt", "content_type": "text/plain", "size_bytes": len(self.contents["answer"]), "is_report": True},
            {"id": "report", "filename": "отчёт.html", "content_type": "text/html", "size_bytes": len(self.contents["report"]), "is_report": True},
            {"id": "collection", "filename": "collection.json", "content_type": "application/json", "size_bytes": len(self.contents["collection"]), "is_report": False},
        ]}

    def download_research_file(self, project_id, file_id):
        if self.offline:
            raise ResearchGatewayError("Synapse недоступен")
        return self.contents[file_id]


def service(tmp_path, gateway=None):
    return ResearchService(SqliteResearchRepository(tmp_path / "researches.sqlite3"), gateway or Gateway())


def launch(researches, gateway, request_id=None, kind="documents"):
    return researches.start(kind, "Что подтверждают документы?", [{"id": "DOC-1", "filename": "источник.pdf"}], lambda: gateway.create_project("question"), request_id)


def test_restart_retains_full_answer_and_all_materials_when_synapse_is_offline(tmp_path):
    gateway = Gateway()
    researches = service(tmp_path, gateway)
    record = launch(researches, gateway)
    record = researches.refresh(record["id"])
    record = researches.resolve(record["id"], "approval-1", True, "Подтверждено")
    assert len(record["result_text"]) > 1200
    assert record["status"] == "completed"
    gateway.offline = True
    restarted = service(tmp_path, gateway)
    assert restarted.get(record["id"])["question"] == "Что подтверждают документы?"
    assert restarted.get(record["id"])["sources"][0]["filename"] == "источник.pdf"
    for file_id, content in gateway.contents.items():
        assert restarted.file(record["id"], file_id)[1] == content
    stale = restarted.refresh(record["id"])
    assert stale["status"] == "completed"
    assert stale["result_text"] == record["result_text"]
    assert stale["checked_at"] == record["checked_at"]
    assert stale["sync_error"] == "Synapse недоступен"


def test_successful_refresh_updates_the_configured_synapse_link(tmp_path):
    gateway = Gateway()
    researches = service(tmp_path, gateway)
    record = launch(researches, gateway)
    gateway.project_url = lambda project_id: f"https://dev.synapse.example/monitor/{project_id}"
    updated = researches.refresh(record["id"])
    assert updated["synapse_url"] == "https://dev.synapse.example/monitor/project-1"


def test_failure_reason_survives_restart_and_failed_synchronization(tmp_path):
    gateway = Gateway()
    gateway.snapshot.update(status="failed", approvals=[], failure_reason="Причина остановки")
    researches = service(tmp_path, gateway)
    record = researches.refresh(launch(researches, gateway)["id"])
    gateway.offline = True
    assert service(tmp_path, gateway).refresh(record["id"])["failure_reason"] == "Причина остановки"


@pytest.mark.parametrize("reviewed_data", [None, {}, {"documents": ["previous.pdf"]}])
def test_changed_approval_data_is_not_approved_under_the_same_id(tmp_path, reviewed_data):
    gateway = Gateway()
    gateway.snapshot["approvals"][0]["expected_data"] = {"documents": ["latest.pdf"]}
    researches = service(tmp_path, gateway)
    record = launch(researches, gateway)
    with pytest.raises(ResearchConflictError, match="Данные запроса изменились"):
        researches.resolve(record["id"], "approval-1", True, "", reviewed_data)
    assert gateway.decisions == []


def test_reviewed_approval_snapshot_is_accepted(tmp_path):
    gateway = Gateway()
    reviewed_data = {"documents": ["source.pdf"]}
    gateway.snapshot["approvals"][0]["expected_data"] = reviewed_data
    researches = service(tmp_path, gateway)
    record = launch(researches, gateway)
    assert researches.resolve(record["id"], "approval-1", True, "", reviewed_data)["status"] == "completed"
    assert len(gateway.decisions) == 1


def test_concurrent_duplicate_start_creates_one_external_project(tmp_path):
    gateway = Gateway()
    researches = service(tmp_path, gateway)
    request_id = str(uuid4())
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: launch(researches, gateway, request_id), range(4)))
    assert gateway.launch_count == 1
    assert {record["id"] for record in results} == {request_id}
    assert len(researches.list()) == 1


def test_request_id_cannot_be_reused_for_a_different_question(tmp_path):
    gateway = Gateway()
    researches = service(tmp_path, gateway)
    record = launch(researches, gateway)
    with pytest.raises(ResearchConflictError):
        researches.start("documents", "Другой вопрос", [], lambda: gateway.create_project("other"), record["id"])
    assert gateway.launch_count == 1


def test_ambiguous_start_stays_in_history_and_is_not_retried(tmp_path):
    researches = service(tmp_path)
    request_id = str(uuid4())
    def timeout():
        raise ResearchGatewayError("Ответ не получен")
    record = researches.start("documents", "Вопрос", [], timeout, request_id)
    assert record["status"] == "start_unknown"
    repeated = researches.start("documents", "Вопрос", [], lambda: pytest.fail("must not launch again"), request_id)
    assert repeated == record


def test_rejected_creation_is_distinct_from_a_lost_response(tmp_path):
    researches = service(tmp_path)
    def failure():
        raise ResearchGatewayError("Не настроено", status_code=503, outcome_unknown=False)
    assert researches.start("evidence", "Вопрос", [], failure)["status"] == "start_failed"


@pytest.mark.parametrize("status_code, expected", [(400, "start_failed"), (500, "start_unknown"), (503, "start_unknown")])
def test_server_creation_error_does_not_imply_no_project_was_created(tmp_path, status_code, expected):
    researches = service(tmp_path)
    def failure():
        raise ResearchGatewayError("Ошибка создания", status_code=status_code)
    assert researches.start("documents", "Вопрос", [], failure)["status"] == expected


def test_slow_successful_start_clears_a_provisional_unknown_state(tmp_path):
    repository = SqliteResearchRepository(tmp_path / "researches.sqlite3")
    gateway = Gateway()
    researches = ResearchService(repository, gateway)
    request_id = str(uuid4())
    def slow_launch():
        repository.patch(request_id, {"created_at": (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()})
        assert researches.get(request_id)["status"] == "start_unknown"
        return gateway.create_project("question")
    record = researches.start("documents", "Вопрос", [], slow_launch, request_id)
    assert record["status"] == "started"
    assert record["sync_error"] == ""


def test_interrupted_start_is_normalized_before_history_status_filter(tmp_path):
    repository = SqliteResearchRepository(tmp_path / "researches.sqlite3")
    researches = ResearchService(repository, Gateway())
    repository.begin({"id": "interrupted", "kind": "documents", "question": "Вопрос", "sources": [], "status": "starting", "project_id": "", "created_at": (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()})
    assert researches.list(status="starting") == []
    assert researches.list(status="start_unknown")[0]["id"] == "interrupted"


def test_history_read_cannot_overwrite_a_pending_successful_creation(tmp_path):
    repository = SqliteResearchRepository(tmp_path / "researches.sqlite3")
    researches = ResearchService(repository, Gateway())
    request_id = str(uuid4())
    launch_entered, release_launch, read_entered = Event(), Event(), Event()
    def pending_launch():
        repository.patch(request_id, {"created_at": (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()})
        launch_entered.set()
        assert release_launch.wait(5)
        return {"id": "project-1", "status": "started"}
    def read_history():
        read_entered.set()
        return researches.get(request_id)
    with ThreadPoolExecutor(max_workers=2) as pool:
        start = pool.submit(researches.start, "documents", "Вопрос", [], pending_launch, request_id)
        assert launch_entered.wait(5)
        reading = pool.submit(read_history)
        assert read_entered.wait(5)
        try:
            with pytest.raises(TimeoutError):
                reading.result(timeout=0.05)
        finally:
            release_launch.set()
        assert start.result()["status"] == "started"
        assert reading.result()["status"] == "started"
    assert researches.get(request_id)["sync_error"] == ""


def test_two_team_members_cannot_resolve_the_same_approval_twice(tmp_path):
    gateway = Gateway()
    researches = service(tmp_path, gateway)
    record = launch(researches, gateway)
    def decide(_):
        try:
            return researches.resolve(record["id"], "approval-1", True, "")
        except ResearchConflictError:
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(decide, range(2)))
    assert len(gateway.decisions) == 1
    assert sum(result is None for result in results) == 1


def test_file_id_from_another_research_cannot_be_downloaded(tmp_path):
    gateway = Gateway()
    researches = service(tmp_path, gateway)
    first = launch(researches, gateway)
    researches.resolve(first["id"], "approval-1", True, "")
    second = launch(researches, gateway)
    with pytest.raises(ResearchNotFoundError):
        researches.file(second["id"], "report")


def test_failed_file_download_does_not_hide_other_saved_materials(tmp_path):
    gateway = Gateway()
    researches = service(tmp_path, gateway)
    record = launch(researches, gateway)
    gateway.resolve_approval("project-1", {"id": "approval-1"}, True, "")
    download = gateway.download_research_file
    def broken_file(project_id, file_id):
        if file_id == "answer":
            raise ResearchGatewayError("Недоступен")
        return download(project_id, file_id)
    gateway.download_research_file = broken_file
    record = researches.refresh(record["id"])
    assert "Не все материалы" in record["sync_error"]
    gateway.offline = True
    assert researches.file(record["id"], "report")[1] == gateway.contents["report"]


def test_api_requires_team_access_for_history_decisions_and_files(tmp_path, monkeypatch):
    gateway = Gateway()
    expected_data = {"documents": ["source.pdf"]}
    gateway.snapshot["approvals"][0]["expected_data"] = expected_data
    researches = service(tmp_path, gateway)
    record = launch(researches, gateway)
    monkeypatch.setattr(api.document_config, "document_access_token", "test-team-code")
    monkeypatch.setattr(api, "research_service", lambda: researches)
    with TestClient(app) as client:
        for method, path in [("GET", "/api/researches"), ("GET", f"/api/researches/{record['id']}"), ("POST", f"/api/researches/{record['id']}/refresh"), ("POST", f"/api/researches/{record['id']}/approvals/approval-1"), ("GET", f"/api/researches/{record['id']}/files/report")]:
            assert client.request(method, path).status_code == 401
        headers = {"Authorization": "Bearer test-team-code"}
        assert client.get("/api/researches", headers=headers).json()["items"][0]["id"] == record["id"]
        assert "result_text" not in client.get("/api/researches", headers=headers).json()["items"][0]
        assert client.post(f"/api/researches/{record['id']}/refresh", headers=headers).json()["approvals"][0]["id"] == "approval-1"
        stale = client.post(f"/api/researches/{record['id']}/approvals/approval-1", headers=headers, json={"approved": True, "expected_data": {"documents": ["previous.pdf"]}})
        assert stale.status_code == 409
        assert gateway.decisions == []
        resolved = client.post(f"/api/researches/{record['id']}/approvals/approval-1", headers=headers, json={"approved": True, "feedback": "да", "expected_data": expected_data})
        assert resolved.status_code == 200
        file = client.get(f"/api/researches/{record['id']}/files/report", headers=headers)
        assert file.content == gateway.contents["report"]
        assert "attachment" in file.headers["content-disposition"]
        assert "sandbox" in file.headers["content-security-policy"]


def test_both_existing_launches_enter_the_same_history(tmp_path):
    gateway = Gateway()
    researches = service(tmp_path, gateway)
    source = tmp_path / "input.pdf"
    source.write_bytes(b"test")
    documents = SimpleNamespace(open_file=lambda _: {"path": source, "filename": "input.pdf", "media_type": "application/pdf"})
    evidence = SimpleNamespace(selected_rows=lambda *_: [{"id": "LAB-1", "formulation": {"name": "ПАВ"}, "conditions": {"temperature_c": 80, "salinity_g_l": 10, "rock_type": "песчаник"}, "result": {"label": "IFT", "value": 0.1, "unit": "mN/m"}, "source": {"document": "Experiment", "location": "page 1", "url": "https://source.test"}}])
    synapse = SynapseService(gateway, evidence, documents, researches)
    first = synapse.start_document_research("Вопрос о документах", ["DOC-1", "DOC-1"])
    second = synapse.start_research("Вопрос об опытах", ["LAB-1"])
    assert first["research_id"] != second["research_id"]
    assert {item["kind"] for item in researches.list()} == {"documents", "evidence"}
    assert len(researches.get(first["research_id"])["sources"]) == 1
