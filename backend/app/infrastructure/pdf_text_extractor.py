from __future__ import annotations

from pathlib import Path

from backend.app.application.document_service import (
    DocumentExtractionError,
    DocumentTextUnavailableError,
    ExtractedDocument,
    UnsupportedDocumentError,
)
from backend.app.domain.document_search import normalise_text


class PypdfTextExtractor:
    """Extracts selectable text from PDFs; image OCR is deliberately out of scope."""

    def extract(
        self,
        path: Path,
        *,
        filename: str = "",
    ) -> ExtractedDocument:
        del filename
        try:
            with path.open("rb") as source:
                header = source.read(1024)
        except OSError as exc:
            raise DocumentExtractionError("Не удалось прочитать PDF.") from exc
        if b"%PDF-" not in header:
            raise UnsupportedDocumentError("Файл не похож на корректный PDF.")

        try:
            from pypdf import PdfReader

            reader = PdfReader(path, strict=False)
            if reader.is_encrypted:
                raise DocumentExtractionError(
                    "Защищённые паролем PDF пока не поддерживаются."
                )
            page_count = len(reader.pages)
            extracted_pages: list[tuple[int, str]] = []
            for number, page in enumerate(reader.pages, start=1):
                text = normalise_text(page.extract_text() or "")
                if text:
                    extracted_pages.append((number, text))
        except DocumentExtractionError:
            raise
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise DocumentExtractionError(
                "Не удалось прочитать PDF. Проверьте, что файл не повреждён."
            ) from exc
        except Exception as exc:
            raise DocumentExtractionError(
                "Не удалось безопасно извлечь текст из PDF."
            ) from exc

        if not extracted_pages:
            raise DocumentTextUnavailableError(
                "В PDF не найден извлекаемый текст. Для сканированных документов потребуется OCR."
            )
        return ExtractedDocument(
            page_count=page_count,
            pages=extracted_pages,
            location_label="стр.",
        )
