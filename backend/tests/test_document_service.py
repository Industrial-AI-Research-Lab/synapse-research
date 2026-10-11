from __future__ import annotations

from io import BytesIO
from typing import BinaryIO

import pytest

from backend.app.application.document_service import (
    DocumentCapacityError,
    DocumentLimits,
    DocumentNotFoundError,
    DocumentService,
    DocumentTextUnavailableError,
    ExtractedPdf,
    StagedDocument,
    UnsupportedDocumentError,
)
from backend.app.infrastructure.document_repository import JsonDocumentRepository
from backend.app.infrastructure.multiformat_text_extractor import MultiFormatTextExtractor


class FakeExtractor:
    def __init__(self, pages: list[tuple[int, str]], page_count: int | None = None) -> None:
        self._pages = pages
        self._page_count = page_count if page_count is not None else len(pages)
        self.calls = 0

    def validate_filename(self, filename: str) -> None:
        if not filename.endswith(".pdf"):
            raise UnsupportedDocumentError("Можно загрузить только PDF-файл.")

    def media_type(self, filename: str) -> str:
        del filename
        return "application/pdf"

    def extract(
        self,
        path,
        *,
        filename,
        max_pages,
        max_records,
        max_extracted_chars,
        max_page_content_bytes,
    ):
        del filename, max_pages, max_records, max_extracted_chars, max_page_content_bytes
        if not path.read_bytes().startswith(b"%PDF-"):
            raise UnsupportedDocumentError("Файл не похож на корректный PDF.")
        self.calls += 1
        return ExtractedPdf(page_count=self._page_count, pages=self._pages)


class TrackingDocumentRepository(JsonDocumentRepository):
    def __init__(self, store_dir) -> None:
        super().__init__(store_dir)
        self.stage_upload_calls = 0

    def stage_upload(
        self,
        *,
        document_id: str,
        source: BinaryIO,
        max_upload_bytes: int,
    ) -> StagedDocument:
        self.stage_upload_calls += 1
        return super().stage_upload(
            document_id=document_id,
            source=source,
            max_upload_bytes=max_upload_bytes,
        )


def make_service(tmp_path, pages, *, max_documents: int = 3) -> DocumentService:
    return DocumentService(
        JsonDocumentRepository(tmp_path / "documents"),
        FakeExtractor(pages),
        DocumentLimits(
            max_upload_bytes=1024,
            max_documents=max_documents,
            max_pages=10,
            max_extracted_chars=10_000,
            chunk_chars=120,
            chunk_overlap_chars=20,
            max_page_content_bytes=1024,
        ),
    )


def valid_pdf_bytes() -> bytes:
    return b"%PDF-1.7\nlocal fixture"


def test_upload_indexes_page_chunks_and_search_returns_a_source_citation(tmp_path):
    service = make_service(
        tmp_path,
        [
            (1, "Вязкость раствора измеряли отдельно."),
            (2, "ПАВ уменьшил натяжение при температуре 75 C."),
        ],
    )

    uploaded = service.upload(
        filename=r"C:\incoming\chemistry.pdf",
        content_type="application/pdf",
        source=BytesIO(valid_pdf_bytes()),
    )

    assert uploaded["filename"] == "chemistry.pdf"
    assert uploaded["page_count"] == 2
    assert uploaded["text_page_count"] == 2
    assert uploaded["chunk_count"] == 2
    assert service.open_file(uploaded["id"])["path"].is_file()

    result = service.search(
        query="ПАВ температура",
        document_ids=[uploaded["id"]],
        limit=10,
    )

    assert result["total"] == 1
    hit = result["items"][0]
    assert hit["page"] == 2
    assert hit["citation"]["location"] == "стр. 2"
    assert hit["citation"]["url"].endswith(f"{uploaded['id']}/file#page=2")


def test_rejected_upload_leaves_no_pdf_or_index_entry(tmp_path):
    service = make_service(tmp_path, [(1, "Текст страницы")])

    with pytest.raises(UnsupportedDocumentError):
        service.upload(
            filename="not-a-pdf.pdf",
            content_type="application/pdf",
            source=BytesIO(b"not a pdf"),
        )

    assert service.list_documents() == {"items": [], "total": 0}
    assert list((tmp_path / "documents" / "files").glob("*.pdf")) == []
    assert list((tmp_path / "documents" / "temporary").iterdir()) == []


def test_delete_document_removes_its_file_and_search_fragments(tmp_path):
    service = make_service(tmp_path, [(1, "ПАВ уменьшил натяжение.")])
    uploaded = service.upload(
        filename="chemistry.pdf",
        content_type="application/pdf",
        source=BytesIO(valid_pdf_bytes()),
    )

    deleted = service.delete_document(uploaded["id"])

    assert deleted["id"] == uploaded["id"]
    assert service.list_documents() == {"items": [], "total": 0}
    assert list((tmp_path / "documents" / "files").glob("*.pdf")) == []
    with pytest.raises(DocumentNotFoundError):
        service.search(query="ПАВ", document_ids=[uploaded["id"]], limit=10)
    with pytest.raises(DocumentNotFoundError):
        service.delete_document(uploaded["id"])


def test_pdf_without_embedded_text_is_discarded(tmp_path):
    service = make_service(tmp_path, [], max_documents=1)

    with pytest.raises(DocumentTextUnavailableError):
        service.upload(
            filename="scan.pdf",
            content_type="application/pdf",
            source=BytesIO(valid_pdf_bytes()),
        )

    assert service.list_documents()["total"] == 0
    assert list((tmp_path / "documents" / "files").glob("*.pdf")) == []


def test_jsonl_upload_indexes_each_record_with_a_record_citation(tmp_path):
    service = DocumentService(
        JsonDocumentRepository(tmp_path / "documents"),
        MultiFormatTextExtractor(),
        DocumentLimits(
            max_upload_bytes=1024,
            max_documents=3,
            max_pages=1,
            max_records=3,
            max_extracted_chars=10_000,
            chunk_chars=120,
            chunk_overlap_chars=20,
            max_page_content_bytes=1024,
        ),
    )

    uploaded = service.upload(
        filename="02-schrammllsurfactantsfunda.jsonl",
        content_type="application/x-ndjson",
        source=BytesIO(
            b'{"title":"Surfactants fundamentals","abstract":"Background"}\n'
            b'{"title":"EOR result","abstract":"Surfactant lowered IFT at 75 C"}\n'
        ),
    )

    assert uploaded["filename"] == "02-schrammllsurfactantsfunda.jsonl"
    assert uploaded["page_count"] == 2
    assert uploaded["text_page_count"] == 2
    assert service.open_file(uploaded["id"])["media_type"] == "application/json"

    result = service.search(
        query="surfactant IFT",
        document_ids=[uploaded["id"]],
        limit=10,
    )

    assert result["total"] == 2
    assert {item["citation"]["location"] for item in result["items"]} == {
        "запись 1",
        "запись 2",
    }


def test_full_corpus_rejects_upload_before_staging_or_extraction(tmp_path):
    repository = TrackingDocumentRepository(tmp_path / "documents")
    extractor = FakeExtractor([(1, "ПАВ и температура")])
    service = DocumentService(
        repository,
        extractor,
        DocumentLimits(
            max_upload_bytes=1024,
            max_documents=1,
            max_pages=10,
            max_extracted_chars=10_000,
            chunk_chars=120,
            chunk_overlap_chars=20,
            max_page_content_bytes=1024,
        ),
    )
    service.upload(
        filename="first.pdf",
        content_type="application/pdf",
        source=BytesIO(valid_pdf_bytes()),
    )

    with pytest.raises(DocumentCapacityError):
        service.upload(
            filename="second.pdf",
            content_type="application/pdf",
            source=BytesIO(valid_pdf_bytes()),
        )

    assert service.list_documents()["total"] == 1
    assert len(list((tmp_path / "documents" / "files").glob("*.pdf"))) == 1
    assert list((tmp_path / "documents" / "temporary").iterdir()) == []
    assert repository.stage_upload_calls == 1
    assert extractor.calls == 1


def test_commit_rechecks_capacity_after_parallel_preflight_checks(tmp_path):
    repository = JsonDocumentRepository(tmp_path / "documents")
    repository.ensure_capacity(max_documents=1)
    first = repository.stage_upload(
        document_id="DOC-FIRST",
        source=BytesIO(valid_pdf_bytes()),
        max_upload_bytes=1024,
    )
    repository.ensure_capacity(max_documents=1)
    second = repository.stage_upload(
        document_id="DOC-SECOND",
        source=BytesIO(valid_pdf_bytes()),
        max_upload_bytes=1024,
    )

    repository.commit(
        staged=first,
        document={"id": "DOC-FIRST", "stored_filename": "DOC-FIRST.pdf"},
        chunks=[],
        max_documents=1,
    )
    try:
        with pytest.raises(DocumentCapacityError):
            repository.commit(
                staged=second,
                document={"id": "DOC-SECOND", "stored_filename": "DOC-SECOND.pdf"},
                chunks=[],
                max_documents=1,
            )
    finally:
        repository.discard_staged(second)

    assert len(list((tmp_path / "documents" / "files").glob("*.pdf"))) == 1
    assert list((tmp_path / "documents" / "temporary").iterdir()) == []
