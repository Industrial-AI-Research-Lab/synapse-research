from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from backend.app.application.document_service import DocumentService
from backend.app.application.evidence_service import EvidenceService
from backend.app.domain.evidence import brief_for_synapse


@dataclass(frozen=True)
class SynapseAttachment:
    """A locally stored source file that Synapse should attach to a project."""

    filename: str
    path: Path
    media_type: str


class SynapseGateway(Protocol):
    def create_project(self, prompt: str) -> dict[str, Any]: ...
    def create_document_research(
        self, prompt: str, attachments: list[SynapseAttachment]
    ) -> dict[str, Any]: ...
    def get_project(self, project_id: str) -> dict[str, Any]: ...
    def project_url(self, project_id: str) -> str: ...


class SynapseService:
    def __init__(
        self,
        client: SynapseGateway,
        evidence_service: EvidenceService,
        document_service: DocumentService,
    ) -> None:
        self._client = client
        self._evidence_service = evidence_service
        self._document_service = document_service

    def start_research(self, question: str, experiment_ids: list[str]) -> dict[str, Any]:
        rows = self._evidence_service.selected_rows(question, experiment_ids)
        return self._public_project(self._client.create_project(brief_for_synapse(question, rows)))

    def start_document_research(
        self, question: str, document_ids: list[str]
    ) -> dict[str, Any]:
        attachments: list[SynapseAttachment] = []
        seen_document_ids: set[str] = set()
        for document_id in document_ids:
            if document_id in seen_document_ids:
                continue
            seen_document_ids.add(document_id)
            document = self._document_service.open_file(document_id)
            attachments.append(
                SynapseAttachment(
                    filename=str(document["filename"]),
                    path=Path(document["path"]),
                    media_type=str(document["media_type"]),
                )
            )

        return self._public_project(
            self._client.create_document_research(
                _document_research_brief(question, attachments), attachments
            )
        )

    def get_project(self, project_id: str) -> dict[str, Any]:
        return self._public_project(self._client.get_project(project_id))

    def _public_project(self, project: dict[str, Any]) -> dict[str, Any]:
        pending = project.get("pending_approvals") or []
        result = project.get("final_output") or project.get("result") or project.get("summary") or ""
        project_id = str(project.get("project_id") or project.get("id") or "")
        return {
            "project_id": project_id,
            "status": project.get("status") or "started",
            "phase": project.get("current_phase") or "",
            "title": project.get("title") or "Исследование ПАВ",
            "awaiting_approval": bool(pending),
            "result_preview": str(result)[:1200],
            "result_url": _project_result_url(project),
            "synapse_url": self._client.project_url(project_id),
        }


def _document_research_brief(
    question: str, attachments: list[SynapseAttachment]
) -> str:
    filenames = ", ".join(attachment.filename for attachment in attachments)
    return (
        "Подготовь исследовательский ответ на вопрос пользователя. "
        "Используй вложенные документы как первоисточники; отдели подтверждённые "
        "выводы от ограничений и приводи ссылки на файл и доступную позицию в нём.\n\n"
        f"Вопрос пользователя: {question}\n"
        f"Вложенные документы: {filenames}"
    )


def _project_result_url(project: dict[str, Any]) -> str:
    direct_url = project.get("result_url") or project.get("deployment_url")
    if isinstance(direct_url, str) and direct_url.strip():
        return direct_url.strip()

    deployments = project.get("deployments")
    if not isinstance(deployments, list):
        return ""

    for deployment in reversed(deployments):
        if not isinstance(deployment, dict):
            continue
        url = deployment.get("url")
        if isinstance(url, str) and url.strip():
            return url.strip()
    return ""
