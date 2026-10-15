from __future__ import annotations

from io import BytesIO

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.application.document_service import (
    DocumentChunking,
    DocumentService,
    ExtractedPdf,
    UnsupportedDocumentError,
)
from backend.app.infrastructure.document_repository import JsonDocumentRepository
from backend.app.infrastructure.multiformat_text_extractor import MultiFormatTextExtractor
from backend.app.main import app
from backend.app.presentation import api


class FakeExtractor:
    def __init__(self, pages: list[tuple[int, str]]) -> None:
        self._pages = pages

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
        return ExtractedPdf(page_count=len(self._pages), pages=self._pages)


def make_service(tmp_path) -> DocumentService:
    return DocumentService(
        JsonDocumentRepository(tmp_path / "documents"),
        FakeExtractor(
            [
                (1, "В первом опыте измеряли вязкость раствора."),
                (2, "ПАВ уменьшил натяжение при температуре 75 C."),
            ]
        ),
        DocumentChunking(
            chunk_chars=120,
            chunk_overlap_chars=20,
        ),
    )


def make_multiformat_service(tmp_path) -> DocumentService:
    return DocumentService(
        JsonDocumentRepository(tmp_path / "documents"),
        MultiFormatTextExtractor(),
        DocumentChunking(
            chunk_chars=120,
            chunk_overlap_chars=20,
        ),
    )


@pytest.fixture
def client_with_document_store(monkeypatch, tmp_path):
    monkeypatch.setattr(api, "document_service", make_service(tmp_path))
    return TestClient(app)


@pytest.fixture
def token_protected_client_with_document_store(monkeypatch, tmp_path):
    monkeypatch.setattr(api, "document_service", make_service(tmp_path))
    monkeypatch.setattr(api, "document_config", Settings(DOCUMENT_ACCESS_TOKEN="team-document-token"))
    return TestClient(app)


@pytest.fixture
def access_code_copy_client_with_document_store(monkeypatch, tmp_path):
    monkeypatch.setattr(api, "document_service", make_service(tmp_path))
    monkeypatch.setattr(
        api,
        "document_config",
        Settings(
            DOCUMENT_ACCESS_TOKEN="team-document-token",
            DOCUMENT_ACCESS_CODE_COPY_ENABLED=True,
        ),
    )
    return TestClient(app)


def test_document_routes_upload_list_search_and_open_source(client_with_document_store):
    response = client_with_document_store.post(
        "/api/documents",
        files={"file": ("chemistry.pdf", b"%PDF-1.7\nfixture", "application/pdf")},
    )

    assert response.status_code == 201
    uploaded = response.json()
    assert uploaded["status"] == "ready"
    assert uploaded["page_count"] == 2

    listed = client_with_document_store.get("/api/documents")
    assert listed.status_code == 200
    assert listed.json()["total"] == 1

    searched = client_with_document_store.post(
        "/api/documents/search",
        json={"query": "ПАВ температура", "document_ids": [uploaded["id"]]},
    )
    assert searched.status_code == 200
    hit = searched.json()["items"][0]
    assert hit["page"] == 2
    assert hit["citation"]["url"].endswith("/file#page=2")

    file_response = client_with_document_store.get(f"/api/documents/{uploaded['id']}/file")
    assert file_response.status_code == 200
    assert file_response.headers["content-type"].startswith("application/pdf")
    assert file_response.headers["x-content-type-options"] == "nosniff"
    assert file_response.content.startswith(b"%PDF-")

    deleted = client_with_document_store.delete(f"/api/documents/{uploaded['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["id"] == uploaded["id"]
    assert client_with_document_store.get("/api/documents").json()["total"] == 0
    assert client_with_document_store.get(f"/api/documents/{uploaded['id']}/file").status_code == 404


def test_document_routes_map_invalid_and_unknown_documents(client_with_document_store):
    invalid = client_with_document_store.post(
        "/api/documents",
        files={"file": ("wrong.pdf", b"plain text", "application/pdf")},
    )
    assert invalid.status_code == 415

    unknown_search = client_with_document_store.post(
        "/api/documents/search",
        json={"query": "ПАВ температура", "document_ids": ["DOC-UNKNOWN"]},
    )
    assert unknown_search.status_code == 404
    assert client_with_document_store.get("/api/documents/DOC-UNKNOWN/file").status_code == 404


@pytest.mark.parametrize("trace_enabled", [False, True])
def test_upload_accepts_file_larger_than_twenty_mib(
    client_with_document_store, monkeypatch, trace_enabled,
):
    from backend.app import main

    monkeypatch.setattr(main, "settings", lambda: Settings(PAV_HTTP_TRACE_ENABLED=trace_enabled))
    content = b"%PDF-1.7\n" + b"x" * (21 * 1024 * 1024)

    response = client_with_document_store.post(
        "/api/documents",
        files={"file": ("large.pdf", content, "application/pdf")},
    )

    assert response.status_code == 201
    document = response.json()
    assert document["size_bytes"] == len(content)
    assert client_with_document_store.get(f"/api/documents/{document['id']}/file").content == content
    assert ("X-Request-ID" in response.headers) is trace_enabled


def test_jsonl_upload_indexes_text_beyond_two_million_characters(monkeypatch, tmp_path):
    monkeypatch.setattr(api, "document_service", make_multiformat_service(tmp_path))
    client = TestClient(app)
    text = "surfactant " * 190_000 + "finalmarker"
    content = ('{"text":"' + text + '"}\n').encode()

    response = client.post(
        "/api/documents",
        files={"file": ("handbook.jsonl", content, "application/x-ndjson")},
    )

    assert response.status_code == 201
    document = response.json()
    result = client.post(
        "/api/documents/search",
        json={"query": "finalmarker", "document_ids": [document["id"]]},
    )
    assert result.status_code == 200
    assert result.json()["total"] >= 1
    assert "finalmarker" in result.json()["items"][0]["excerpt"]
    assert result.json()["items"][0]["citation"]["location"] == "запись 1"


def test_document_routes_upload_and_download_jsonl_as_an_attachment(monkeypatch, tmp_path):
    monkeypatch.setattr(api, "document_service", make_multiformat_service(tmp_path))
    client = TestClient(app)
    content = b'{"title":"Surfactant study","abstract":"IFT result"}\n'

    response = client.post(
        "/api/documents",
        files={
            "file": (
                "02-schrammllsurfactantsfunda.jsonl",
                content,
                "application/x-ndjson",
            )
        },
    )

    assert response.status_code == 201
    uploaded = response.json()
    assert uploaded["page_count"] == 1

    file_response = client.get(f"/api/documents/{uploaded['id']}/file")
    assert file_response.status_code == 200
    assert file_response.headers["content-type"].startswith("application/json")
    assert file_response.headers["content-disposition"].startswith("attachment;")
    assert file_response.content == content


@pytest.mark.parametrize(
    ("method", "path", "request_kwargs"),
    [
        (
            "POST",
            "/api/documents",
            {"files": {"file": ("chemistry.pdf", b"%PDF-1.7\nfixture", "application/pdf")}},
        ),
        ("GET", "/api/documents", {}),
        ("POST", "/api/documents/search", {"json": {"query": "ПАВ температура"}}),
        ("DELETE", "/api/documents/DOC-UNKNOWN", {}),
        ("GET", "/api/documents/DOC-UNKNOWN/file", {}),
    ],
)
def test_every_document_route_requires_a_configured_team_token(
    token_protected_client_with_document_store,
    method,
    path,
    request_kwargs,
):
    response = token_protected_client_with_document_store.request(method, path, **request_kwargs)

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"

    wrong_token = token_protected_client_with_document_store.get(
        "/api/documents",
        headers={"Authorization": "Bearer incorrect-token"},
    )
    assert wrong_token.status_code == 401

    allowed = token_protected_client_with_document_store.get(
        "/api/documents",
        headers={"Authorization": "Bearer team-document-token"},
    )
    assert allowed.status_code == 200
    assert allowed.json()["total"] == 0


def test_document_token_does_not_guard_non_document_endpoints(token_protected_client_with_document_store):
    assert token_protected_client_with_document_store.get("/api/health").status_code == 200
    assert token_protected_client_with_document_store.post(
        "/api/analysis",
        json={"question": "Что можно сопоставить?", "experiment_ids": ["LAB-001"]},
    ).status_code == 200


def test_document_access_code_copy_is_unavailable_when_disabled(
    client_with_document_store,
    monkeypatch,
):
    monkeypatch.setattr(
        api,
        "document_config",
        Settings(
            DOCUMENT_ACCESS_TOKEN="team-document-token",
            DOCUMENT_ACCESS_CODE_COPY_ENABLED=False,
        ),
    )

    unavailable = client_with_document_store.get("/api/documents/access-code/availability")
    assert unavailable.status_code == 200
    assert unavailable.json() == {"available": False}
    assert unavailable.headers["cache-control"] == "no-store"
    assert client_with_document_store.get("/api/documents/access-code").status_code == 404



def test_document_access_code_copy_is_available_when_enabled(
    access_code_copy_client_with_document_store,
):
    available = access_code_copy_client_with_document_store.get(
        "/api/documents/access-code/availability"
    )
    assert available.status_code == 200
    assert available.json() == {"available": True}
    assert available.headers["cache-control"] == "no-store"

    code = access_code_copy_client_with_document_store.get("/api/documents/access-code")
    assert code.status_code == 200
    assert code.json() == {"access_code": "team-document-token"}
    assert code.headers["cache-control"] == "no-store"


def _minimal_text_pdf(text: str) -> bytes:
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        f"<< /Length {len(f'BT /F1 12 Tf 72 720 Td ({text}) Tj ET')} >>\nstream\nBT /F1 12 Tf 72 720 Td ({text}) Tj ET\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    result = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, object_body in enumerate(objects, start=1):
        offsets.append(len(result))
        result.extend(f"{index} 0 obj\n{object_body}\nendobj\n".encode("ascii"))
    xref_offset = len(result)
    result.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    result.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        result.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    result.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return bytes(result)


def test_pypdf_adapter_extracts_text_from_a_real_embedded_text_pdf(tmp_path):
    pytest.importorskip("pypdf")
    from backend.app.infrastructure.pdf_text_extractor import PypdfTextExtractor

    path = tmp_path / "embedded.pdf"
    path.write_bytes(_minimal_text_pdf("surfactant result"))

    extracted = PypdfTextExtractor().extract(
        path,
    )

    assert extracted.page_count == 1
    assert extracted.pages == [(1, "surfactant result")]


def test_pypdf_adapter_extracts_more_than_two_hundred_pages(tmp_path):
    pypdf = pytest.importorskip("pypdf")
    from backend.app.infrastructure.pdf_text_extractor import PypdfTextExtractor

    reader = pypdf.PdfReader(BytesIO(_minimal_text_pdf("surfactant result")))
    writer = pypdf.PdfWriter()
    for _ in range(201):
        writer.add_page(reader.pages[0])
    path = tmp_path / "handbook.pdf"
    writer.write(path)

    extracted = PypdfTextExtractor().extract(path)

    assert extracted.page_count == 201
    assert len(extracted.pages) == 201
    assert extracted.pages[-1] == (201, "surfactant result")
