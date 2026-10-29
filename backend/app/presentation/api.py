from __future__ import annotations

from secrets import compare_digest
from typing import Any, Callable
from typing import Literal
from uuid import UUID
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Header, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from backend.app.application.document_service import (
    DocumentConflictError,
    DocumentExtractionError,
    DocumentChunking,
    DocumentNotFoundError,
    DocumentService,
    DocumentTextUnavailableError,
    UnsupportedDocumentError,
)
from backend.app.application.evidence_service import (
    EvidenceNotFoundError,
    EvidenceSelectionNotFoundError,
    EvidenceService,
)
from backend.app.application.evidence_review_service import (
    EvidenceReviewNotFoundError,
    EvidenceReviewService,
    EvidenceReviewStateError,
    EvidenceReviewValidationError,
)
from backend.app.application.quality_service import QualityService
from backend.app.application.public_source_service import PublicSourceService
from backend.app.application.synapse_service import SynapseService
from backend.app.application.research_service import ResearchConflictError, ResearchGatewayError, ResearchNotFoundError, ResearchService
from backend.app.config import settings
from backend.app.infrastructure.control_question_repository import JsonControlQuestionRepository
from backend.app.infrastructure.document_repository import JsonDocumentRepository
from backend.app.infrastructure.evidence_repository import JsonEvidenceRepository
from backend.app.infrastructure.evidence_review_repository import JsonEvidenceReviewRepository
from backend.app.infrastructure.public_source_gateway import HttpPublicSourceGateway
from backend.app.infrastructure.public_source_repository import JsonPublicSourceRepository
from backend.app.infrastructure.multiformat_text_extractor import MultiFormatTextExtractor
from backend.app.infrastructure.synapse_client import SynapseClient, SynapseError
from backend.app.infrastructure.research_repository import SqliteResearchRepository

router = APIRouter(prefix="/api")
evidence_repository = JsonEvidenceRepository()
evidence_service = EvidenceService(evidence_repository)
evidence_review_service = EvidenceReviewService(JsonEvidenceReviewRepository())
quality_service = QualityService(
    evidence_repository,
    JsonControlQuestionRepository(),
    evidence_service,
)
public_source_service = PublicSourceService(
    JsonPublicSourceRepository(),
    HttpPublicSourceGateway(),
)
document_config = settings()
research_repository = SqliteResearchRepository(document_config.document_store_dir / "researches.sqlite3")
document_service = DocumentService(
    JsonDocumentRepository(document_config.document_store_dir),
    MultiFormatTextExtractor(),
    DocumentChunking(
        chunk_chars=document_config.document_chunk_chars,
        chunk_overlap_chars=document_config.document_chunk_overlap_chars,
    ),
)


def require_document_access_token(authorization: str | None = Header(default=None)) -> None:
    """Require the shared team token when document access is configured."""
    expected_token = document_config.document_access_token
    if not expected_token:
        return

    scheme, separator, presented_token = authorization.partition(" ") if authorization else ("", "", "")
    if (
        scheme.casefold() != "bearer"
        or not separator
        or not presented_token
        or not compare_digest(presented_token, expected_token)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Для доступа к документам требуется токен команды.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def document_access_code_copy_is_available() -> bool:
    return bool(
        document_config.document_access_code_copy_enabled
        and document_config.document_access_token
    )


class AnalysisBody(BaseModel):
    question: str = Field(min_length=5, max_length=1200)
    experiment_ids: list[str] = Field(default_factory=list, max_length=30)
    request_id: UUID | None = None
    auto_mode: bool = False

    @field_validator("question", mode="before")
    @classmethod
    def trim_question(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value


class SourceReferenceBody(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=1200)
    url: str = Field(min_length=1, max_length=2000)


class FormulationBody(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    surfactant_class: str = Field(min_length=1, max_length=200)
    concentration_wt_pct: float = Field(ge=0)


class ConditionsBody(BaseModel):
    temperature_c: float
    salinity_g_l: float = Field(ge=0)
    rock_type: str = Field(min_length=1, max_length=200)
    permeability_md: float | None = Field(default=None, ge=0)


class ResultBody(BaseModel):
    label: str = Field(min_length=1, max_length=300)
    value: float
    unit: str = Field(min_length=1, max_length=100)


class CitationBody(BaseModel):
    location: str = Field(min_length=1, max_length=1000)
    excerpt: str = Field(min_length=1, max_length=5000)


class EvidenceReviewBody(BaseModel):
    source: SourceReferenceBody
    formulation: FormulationBody
    conditions: ConditionsBody
    method: str = Field(min_length=5, max_length=5000)
    result: ResultBody
    citation: CitationBody


class DocumentSearchBody(BaseModel):
    query: str = Field(min_length=2, max_length=1200)
    document_ids: list[str] = Field(default_factory=list, max_length=50)
    limit: int = Field(default=10, ge=1, le=20)


class DocumentResearchBody(BaseModel):
    query: str = Field(min_length=2, max_length=1200)
    document_ids: list[str] = Field(min_length=1, max_length=50)
    request_id: UUID | None = None
    auto_mode: bool = False

    @field_validator("query", mode="before")
    @classmethod
    def trim_query(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value


@router.get("/documents/access-code/availability")
def document_access_code_availability(response: Response) -> dict[str, bool]:
    """Expose whether the temporary stand-only copy action is available."""
    response.headers["Cache-Control"] = "no-store"
    return {"available": document_access_code_copy_is_available()}


@router.get("/documents/access-code")
def document_access_code(response: Response) -> dict[str, str]:
    """Return the shared document code only while the temporary stand feature is enabled."""
    if not document_access_code_copy_is_available():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Временная выдача кода доступа отключена.",
            headers={"Cache-Control": "no-store"},
        )

    response.headers["Cache-Control"] = "no-store"
    return {"access_code": document_config.document_access_token}


def synapse_service() -> SynapseService:
    client = SynapseClient(settings())
    return SynapseService(client, evidence_service, document_service, ResearchService(research_repository, client))


def research_service() -> ResearchService:
    return ResearchService(research_repository, SynapseClient(settings()))


@router.get("/health")
def health() -> dict[str, Any]:
    config = settings()
    return {"ok": True, "evidence_records": evidence_service.list_evidence()["summary"]["total"], "synapse_configured": config.synapse_configured}


@router.get("/evidence")
def evidence(min_temperature: float | None = None, max_temperature: float | None = None, max_salinity: float | None = None, rock_type: str | None = None, comparable_only: bool = False) -> dict[str, Any]:
    return evidence_service.list_evidence(min_temperature=min_temperature, max_temperature=max_temperature, max_salinity=max_salinity, rock_type=rock_type, comparable_only=comparable_only)


@router.get("/evidence/{evidence_id}")
def evidence_by_id(evidence_id: str) -> dict[str, object]:
    try:
        return evidence_service.get_evidence(evidence_id)
    except EvidenceNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Опыт не найден.") from exc


@router.post("/analysis")
def analysis(body: AnalysisBody) -> dict[str, Any]:
    try:
        return evidence_service.analyse(body.question, body.experiment_ids)
    except EvidenceSelectionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Не найдены выбранные опыты.") from exc


@router.get("/quality/report")
def quality_report() -> dict[str, Any]:
    return quality_service.report()


@router.get("/quality/control-questions")
def control_question_report() -> dict[str, Any]:
    return quality_service.control_question_report()


@router.get("/public-sources")
def public_sources() -> dict[str, Any]:
    return public_source_service.list_current_sources()


@router.post(
    "/documents",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_document_access_token)],
)
def upload_document(file: UploadFile = File(...)) -> dict[str, Any]:
    try:
        return document_service.upload(
            filename=file.filename,
            content_type=file.content_type,
            source=file.file,
        )
    except UnsupportedDocumentError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except DocumentConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (DocumentExtractionError, DocumentTextUnavailableError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/documents", dependencies=[Depends(require_document_access_token)])
def documents() -> dict[str, Any]:
    return document_service.list_documents()


@router.post("/documents/search", dependencies=[Depends(require_document_access_token)])
def search_documents(body: DocumentSearchBody) -> dict[str, Any]:
    try:
        return document_service.search(
            query=body.query,
            document_ids=body.document_ids,
            limit=body.limit,
        )
    except DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/documents/research", dependencies=[Depends(require_document_access_token)])
def start_document_research(body: DocumentResearchBody) -> dict[str, Any]:
    try:
        service = synapse_service()
        if body.request_id:
            return service.start_document_research(
                body.query, body.document_ids, str(body.request_id), auto_mode=body.auto_mode,
            )
        return service.start_document_research(body.query, body.document_ids, auto_mode=body.auto_mode)
    except DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SynapseError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ResearchConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get(
    "/documents/research/{project_id}",
    dependencies=[Depends(require_document_access_token)],
)
def document_research_project(project_id: str) -> dict[str, Any]:
    try:
        return synapse_service().get_project(project_id)
    except SynapseError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.delete("/documents/{document_id}", dependencies=[Depends(require_document_access_token)])
def delete_document(document_id: str) -> dict[str, Any]:
    try:
        return document_service.delete_document(document_id)
    except DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get(
    "/documents/{document_id}/file",
    dependencies=[Depends(require_document_access_token)],
)
def document_file(document_id: str) -> FileResponse:
    try:
        item = document_service.open_file(document_id)
    except DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        item["path"],
        media_type=item["media_type"],
        filename=item["filename"],
        content_disposition_type="inline" if item["is_inline_safe"] else "attachment",
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/evidence-reviews")
def evidence_reviews() -> dict[str, Any]:
    return {"items": evidence_review_service.list_reviews()}


@router.post("/evidence-reviews", status_code=status.HTTP_201_CREATED)
def submit_evidence_review(body: EvidenceReviewBody) -> dict[str, Any]:
    return evidence_review_service.submit(body.model_dump())


@router.post("/evidence-reviews/{review_id}/approve")
def approve_evidence_review(review_id: str) -> dict[str, Any]:
    try:
        return evidence_review_service.approve(review_id)
    except EvidenceReviewNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Заявка на проверку не найдена.") from exc
    except EvidenceReviewStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except EvidenceReviewValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/synapse/config")
def synapse_config() -> dict[str, Any]:
    config = settings()
    return {"configured": config.synapse_configured, "approval_mode": config.synapse_approval_mode}


@router.post("/synapse/projects", dependencies=[Depends(require_document_access_token)])
def start_synapse_research(body: AnalysisBody) -> dict[str, Any]:
    try:
        service = synapse_service()
        if body.request_id:
            return service.start_research(
                body.question, body.experiment_ids, str(body.request_id), auto_mode=body.auto_mode,
            )
        return service.start_research(body.question, body.experiment_ids, auto_mode=body.auto_mode)
    except EvidenceSelectionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Не найдены выбранные опыты.") from exc
    except SynapseError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ResearchConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


class ResearchApprovalBody(BaseModel):
    approved: bool
    feedback: str = Field(default="", max_length=5000)
    expected_data: dict[str, Any] | None = None


class ResearchAutoModeBody(BaseModel):
    auto_mode: bool


def research_action(action: Callable[[], Any]) -> Any:
    try:
        return action()
    except ResearchNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ResearchConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ResearchGatewayError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/researches", dependencies=[Depends(require_document_access_token)])
def list_researches(response: Response, kind: Literal["documents", "evidence"] | None = None, research_status: str | None = None) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    records = research_service().list(kind, research_status)
    items = []
    for record in records:
        item = {key: value for key, value in record.items() if key not in ("sources", "result_text", "files", "approvals")}
        item["sources"] = [{"id": source["id"], "filename": source["filename"]} for source in record["sources"]]
        item["file_count"] = len(record["files"])
        item["approval_count"] = len(record["approvals"])
        items.append(item)
    return {"items": items}


@router.get("/researches/{research_id}", dependencies=[Depends(require_document_access_token)])
def research_detail(research_id: str, response: Response) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    return research_action(lambda: research_service().get(research_id))


@router.post("/researches/{research_id}/refresh", dependencies=[Depends(require_document_access_token)])
def refresh_research(research_id: str) -> dict[str, Any]:
    return research_action(lambda: research_service().refresh(research_id))


@router.post("/researches/{research_id}/auto-mode", dependencies=[Depends(require_document_access_token)])
def set_research_auto_mode(research_id: str, body: ResearchAutoModeBody) -> dict[str, Any]:
    return research_action(lambda: research_service().set_auto_mode(research_id, body.auto_mode))


@router.post("/researches/{research_id}/approvals/{approval_id}", dependencies=[Depends(require_document_access_token)])
def resolve_research_approval(research_id: str, approval_id: str, body: ResearchApprovalBody) -> dict[str, Any]:
    return research_action(lambda: research_service().resolve(research_id, approval_id, body.approved, body.feedback.strip(), body.expected_data))


@router.get("/researches/{research_id}/files/{file_id}", dependencies=[Depends(require_document_access_token)])
def research_file(research_id: str, file_id: str) -> Response:
    item, content = research_action(lambda: research_service().file(research_id, file_id))
    return Response(content, media_type=item["content_type"], headers={
        "Content-Disposition": "attachment; filename*=UTF-8''" + quote(item["filename"], safe=""),
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
    })


@router.get("/synapse/projects/{project_id}", dependencies=[Depends(require_document_access_token)])
def synapse_project(project_id: str) -> dict[str, Any]:
    try:
        return synapse_service().get_project(project_id)
    except SynapseError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
