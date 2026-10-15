from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, ContextManager, Protocol
from uuid import uuid4


class ResearchNotFoundError(Exception):
    pass


class ResearchConflictError(Exception):
    pass


class ResearchGatewayError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, outcome_unknown: bool | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.outcome_unknown = (status_code is None or status_code >= 500) if outcome_unknown is None else outcome_unknown


class ResearchRepository(Protocol):
    def begin(self, record: dict[str, Any]) -> tuple[dict[str, Any], bool]: ...
    def get(self, research_id: str) -> dict[str, Any] | None: ...
    def list(self, kind: str | None, status: str | None) -> list[dict[str, Any]]: ...
    def patch(self, research_id: str, changes: dict[str, Any]) -> dict[str, Any]: ...
    def locked(self, research_id: str) -> ContextManager[None]: ...
    def save_file(self, research_id: str, file_id: str, content: bytes) -> None: ...
    def get_file(self, research_id: str, file_id: str) -> bytes | None: ...


class ResearchGateway(Protocol):
    def research_snapshot(self, project_id: str) -> dict[str, Any]: ...
    def resolve_approval(self, project_id: str, approval: dict[str, Any], approved: bool, feedback: str) -> None: ...
    def download_research_file(self, project_id: str, file_id: str) -> bytes: ...
    def project_url(self, project_id: str) -> str: ...


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ResearchService:
    def __init__(self, repository: ResearchRepository, gateway: ResearchGateway) -> None:
        self._repository = repository
        self._gateway = gateway

    def start(
        self, kind: str, question: str, sources: list[dict[str, Any]],
        launch: Callable[[], dict[str, Any]], request_id: str | None = None,
    ) -> dict[str, Any]:
        research_id = request_id or str(uuid4())
        record, created = self._repository.begin({
            "id": research_id, "kind": kind, "question": question,
            "sources": sources, "created_at": utc_now(), "checked_at": None,
            "project_id": "", "title": question, "status": "starting",
            "phase": "", "synapse_url": "", "result_url": "",
            "result_text": "", "files": [], "approvals": [], "sync_error": "",
        })
        if not created:
            return record
        with self._repository.locked(research_id):
            try:
                project = launch()
                project_id = str(project.get("project_id") or project.get("id") or "")
                if not project_id:
                    raise ResearchGatewayError("Synapse не вернул идентификатор проекта. Результат запуска неизвестен.")
                return self._repository.patch(research_id, {
                    "project_id": project_id,
                    "title": project.get("title") or question,
                    "status": project.get("status") or "started",
                    "phase": project.get("current_phase") or "",
                    "synapse_url": self._gateway.project_url(project_id),
                    "checked_at": utc_now(),
                    "sync_error": "",
                })
            except ResearchGatewayError as exc:
                return self._repository.patch(research_id, {
                    "status": "start_unknown" if exc.outcome_unknown else "start_failed",
                    "sync_error": str(exc),
                })
            except (ValueError, TypeError, AttributeError):
                return self._repository.patch(research_id, {
                    "status": "start_unknown",
                    "sync_error": "Synapse вернул ответ на запуск в неподдерживаемом формате. Результат запуска неизвестен.",
                })

    def list(self, kind: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
        records = [self.get(record["id"]) for record in self._repository.list(kind, None)]
        return [record for record in records if status is None or record["status"] == status]

    def get(self, research_id: str) -> dict[str, Any]:
        with self._repository.locked(research_id):
            record = self._repository.get(research_id)
            if record is None:
                raise ResearchNotFoundError("Исследование не найдено в истории команды.")
            if record["status"] == "starting" and not record["project_id"] and (datetime.now(timezone.utc) - datetime.fromisoformat(record["created_at"])).total_seconds() > 120:
                record = self._repository.patch(research_id, {"status": "start_unknown", "sync_error": "Ответ на запуск не был сохранён. Проверьте историю Synapse перед повторным запуском."})
            return record

    def refresh(self, research_id: str) -> dict[str, Any]:
        with self._repository.locked(research_id):
            record = self.get(research_id)
            if not record["project_id"]:
                return record
            try:
                snapshot = self._gateway.research_snapshot(record["project_id"])
                changes = {**snapshot, "checked_at": utc_now(), "sync_error": ""}
                if not changes.get("result_text"):
                    changes.pop("result_text", None)
                cached_files = {item["id"]: item for item in record["files"]}
                cached_files.update({item["id"]: item for item in snapshot.get("files", [])})
                changes["files"] = list(cached_files.values())
                record = self._repository.patch(research_id, changes)
                errors = []
                for item in record["files"]:
                    if item.get("is_report") or record["status"] in ("completed", "done"):
                        try:
                            content = self._cache_file(record, item["id"])
                            if item.get("is_report") and (item["content_type"].startswith("text/plain") or item["filename"].lower().endswith((".txt", ".md"))):
                                record = self._repository.patch(research_id, {"result_text": content.decode("utf-8-sig", errors="replace")})
                        except ResearchGatewayError as exc:
                            errors.append(f"{item['filename']}: {exc}")
                if errors:
                    record = self._repository.patch(research_id, {"sync_error": "Не все материалы сохранены. " + " ".join(errors)})
                return record
            except ResearchGatewayError as exc:
                return self._repository.patch(research_id, {"sync_error": str(exc)})

    def resolve(self, research_id: str, approval_id: str, approved: bool, feedback: str) -> dict[str, Any]:
        with self._repository.locked(research_id):
            record = self.refresh(research_id)
            if record["sync_error"]:
                raise ResearchConflictError("Не удалось проверить актуальность запроса. Обновите состояние перед принятием решения.")
            approval = next((item for item in record["approvals"] if item["id"] == approval_id), None)
            if approval is None:
                raise ResearchConflictError("Запрос уже обработан или больше не ожидает решения. Обновите состояние.")
            self._gateway.resolve_approval(record["project_id"], approval, approved, feedback)
            self._repository.patch(research_id, {"approvals": [], "status": "running", "checked_at": utc_now()})
            return self.refresh(research_id)

    def file(self, research_id: str, file_id: str) -> tuple[dict[str, Any], bytes]:
        with self._repository.locked(research_id):
            record = self.get(research_id)
            item = next((item for item in record["files"] if item["id"] == file_id), None)
            if item is None:
                raise ResearchNotFoundError("Файл не найден в материалах исследования.")
            return item, self._cache_file(record, file_id)

    def _cache_file(self, record: dict[str, Any], file_id: str) -> bytes:
        content = self._repository.get_file(record["id"], file_id)
        if content is None:
            content = self._gateway.download_research_file(record["project_id"], file_id)
            self._repository.save_file(record["id"], file_id, content)
        return content
