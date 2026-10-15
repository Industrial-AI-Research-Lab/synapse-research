from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import pytest

from backend.app.application.document_service import (
    DocumentConflictError,
    DocumentChunking,
    DocumentNotFoundError,
    DocumentService,
    DocumentTextUnavailableError,
    ExtractedPdf,
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
    ):
        del filename
        if not path.read_bytes().startswith(b"%PDF-"):
            raise UnsupportedDocumentError("Файл не похож на корректный PDF.")
        self.calls += 1
        return ExtractedPdf(page_count=self._page_count, pages=self._pages)


def make_service(tmp_path, pages) -> DocumentService:
    return DocumentService(
        JsonDocumentRepository(tmp_path / "documents"),
        FakeExtractor(pages),
        DocumentChunking(
            chunk_chars=120,
            chunk_overlap_chars=20,
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
    service = make_service(tmp_path, [])

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
        DocumentChunking(
            chunk_chars=120,
            chunk_overlap_chars=20,
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


def test_upload_accepts_more_than_one_hundred_documents(tmp_path):
    service = make_service(tmp_path, [(1, "Surfactant result")])

    for number in range(101):
        service.upload(
            filename=f"study-{number}.pdf",
            content_type="application/pdf",
            source=BytesIO(valid_pdf_bytes()),
        )

    assert service.list_documents()["total"] == 101
    assert len(list((tmp_path / "documents" / "files").iterdir())) == 101
    assert list((tmp_path / "documents" / "temporary").iterdir()) == []


def test_commit_collision_preserves_existing_file_and_index(tmp_path):
    repository = JsonDocumentRepository(tmp_path / "documents")
    first = repository.stage_upload(document_id="DOC-FIRST", source=BytesIO(b"original"))
    repository.commit(
        staged=first,
        document={"id": "DOC-FIRST", "stored_filename": "DOC-FIRST.pdf"},
        chunks=[],
    )
    second = repository.stage_upload(document_id="DOC-SECOND", source=BytesIO(b"replacement"))

    with pytest.raises(DocumentConflictError):
        repository.commit(
            staged=second,
            document={"id": "DOC-SECOND", "stored_filename": "DOC-FIRST.pdf"},
            chunks=[],
        )
    repository.discard_staged(second)

    assert repository.file_path("DOC-FIRST").read_bytes() == b"original"
    assert repository.get_document("DOC-SECOND") is None
    assert len(repository.list_documents()) == 1
    assert list((tmp_path / "documents" / "temporary").iterdir()) == []


def test_parallel_uploads_keep_all_documents_and_search_chunks(tmp_path):
    service = make_service(tmp_path, [(1, "surfactant result")])

    def upload(number):
        return service.upload(
            filename=f"study-{number}.pdf",
            content_type="application/pdf",
            source=BytesIO(valid_pdf_bytes()),
        )

    with ThreadPoolExecutor(max_workers=8) as executor:
        uploaded = list(executor.map(upload, range(16)))

    assert {item["id"] for item in service.list_documents()["items"]} == {
        item["id"] for item in uploaded
    }
    assert service.search(query="surfactant", document_ids=[], limit=20)["total"] == 16
    assert list((tmp_path / "documents" / "temporary").iterdir()) == []


def test_jsonl_extraction_accepts_more_than_one_hundred_thousand_records(tmp_path):
    path = tmp_path / "records.jsonl"
    path.write_text('{"text":"result"}\n' * 100_001, encoding="utf-8")

    extracted = MultiFormatTextExtractor().extract(path, filename=path.name)

    assert extracted.page_count == 100_001
    assert len(extracted.pages) == 100_001
    assert extracted.pages[-1] == (100_001, "text: result")


def test_jsonl_extraction_accepts_single_record_larger_than_sixteen_mib(tmp_path):
    path = tmp_path / "large-record.jsonl"
    text = "x" * (16 * 1024 * 1024 + 1)
    path.write_text('{"text":"' + text + '"}\n', encoding="utf-8")

    extracted = MultiFormatTextExtractor().extract(path, filename=path.name)

    assert extracted.pages == [(1, "text: " + text)]
