from __future__ import annotations

from pathlib import Path

from backend.app.application.document_service import (
    DocumentExtractionError,
    DocumentLimitError,
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
        max_pages: int,
        max_records: int = 0,
        max_extracted_chars: int,
        max_page_content_bytes: int,
    ) -> ExtractedDocument:
        del filename, max_records
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
            if page_count > max_pages:
                raise DocumentLimitError(
                    f"В PDF больше {max_pages} страниц — загрузите меньший документ."
                )

            extracted_pages: list[tuple[int, str]] = []
            extracted_chars = 0
            for number, page in enumerate(reader.pages, start=1):
                contents = page.get_contents()
                if contents is not None and len(contents.get_data()) > max_page_content_bytes:
                    raise DocumentLimitError(
                        "Одна из страниц PDF слишком велика для безопасного извлечения текста."
                    )
                text = normalise_text(page.extract_text() or "")
                extracted_chars += len(text)
                if extracted_chars > max_extracted_chars:
                    raise DocumentLimitError(
                        "В PDF слишком много извлекаемого текста — загрузите меньший документ."
                    )
                if text:
                    extracted_pages.append((number, text))
        except (DocumentExtractionError, DocumentLimitError):
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
