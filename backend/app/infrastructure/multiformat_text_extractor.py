from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from io import StringIO
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from backend.app.application.document_service import (
    DocumentExtractionError,
    DocumentTextExtractor,
    DocumentTextUnavailableError,
    ExtractedDocument,
    UnsupportedDocumentError,
)
from backend.app.domain.document_search import normalise_text
from backend.app.infrastructure.pdf_text_extractor import PypdfTextExtractor


@dataclass(frozen=True)
class DocumentFormat:
    extensions: tuple[str, ...]
    media_type: str
    location_label: str


PDF_FORMAT = DocumentFormat((".pdf",), "application/pdf", "стр.")
JSON_FORMAT = DocumentFormat(
    (".json", ".jsonl", ".ndjson"),
    "application/json",
    "запись",
)
DELIMITED_FORMAT = DocumentFormat(
    (".csv", ".tsv"),
    "text/csv",
    "строка",
)
BIBLIOGRAPHY_FORMAT = DocumentFormat(
    (".ris", ".bib"),
    "text/plain",
    "запись",
)
MARKUP_FORMAT = DocumentFormat(
    (".xml", ".tei", ".jats", ".nxml", ".html", ".htm"),
    "application/xml",
    "фрагмент",
)
TEXT_FORMAT = DocumentFormat((".txt", ".md"), "text/plain", "фрагмент")

_FORMATS = (
    PDF_FORMAT,
    JSON_FORMAT,
    DELIMITED_FORMAT,
    BIBLIOGRAPHY_FORMAT,
    MARKUP_FORMAT,
    TEXT_FORMAT,
)
_FORMAT_BY_EXTENSION = {
    extension: document_format
    for document_format in _FORMATS
    for extension in document_format.extensions
}
_SUPPORTED_EXTENSIONS = ", ".join(sorted(_FORMAT_BY_EXTENSION))


class _HtmlTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._ignored_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if tag.casefold() in {"script", "style", "noscript"}:
            self._ignored_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() in {"script", "style", "noscript"}:
            self._ignored_depth = max(0, self._ignored_depth - 1)

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.parts.append(data)


class MultiFormatTextExtractor(DocumentTextExtractor):
    """Indexes a bounded set of text-first scientific-source formats."""

    def __init__(self, pdf_extractor: PypdfTextExtractor | None = None) -> None:
        self._pdf_extractor = pdf_extractor or PypdfTextExtractor()

    def validate_filename(self, filename: str) -> None:
        if self._format_for(filename) is None:
            raise UnsupportedDocumentError(
                "Неподдерживаемый формат файла. Можно загрузить: "
                f"{_SUPPORTED_EXTENSIONS}."
            )

    def media_type(self, filename: str) -> str:
        document_format = self._format_for(filename)
        if document_format is None:
            raise UnsupportedDocumentError(
                "Неподдерживаемый формат файла."
            )
        return document_format.media_type

    def extract(
        self,
        path: Path,
        *,
        filename: str,
    ) -> ExtractedDocument:
        document_format = self._format_for(filename)
        if document_format is None:
            self.validate_filename(filename)
            raise AssertionError("validate_filename must raise for an unknown format")

        if document_format is PDF_FORMAT:
            return self._pdf_extractor.extract(
                path,
                filename=filename,
            )

        text = self._read_text(path)
        if document_format is JSON_FORMAT:
            pages = self._extract_json(text, filename)
        elif document_format is DELIMITED_FORMAT:
            pages = self._extract_delimited(text, filename)
        elif document_format is BIBLIOGRAPHY_FORMAT:
            pages = self._extract_bibliography(text, filename)
        elif document_format is MARKUP_FORMAT:
            pages = self._extract_markup(text, filename)
        else:
            pages = [(1, text)]

        return self._normalised_document(
            pages,
            location_label=document_format.location_label,
        )

    @staticmethod
    def _format_for(filename: str) -> DocumentFormat | None:
        return _FORMAT_BY_EXTENSION.get(Path(filename).suffix.casefold())

    @staticmethod
    def _read_text(path: Path) -> str:
        try:
            raw = path.read_bytes()
        except OSError as exc:
            raise DocumentExtractionError("Не удалось прочитать загруженный файл.") from exc

        for encoding in ("utf-8-sig", "utf-16", "cp1251"):
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                continue
        raise DocumentExtractionError(
            "Не удалось прочитать текст файла: используйте UTF-8, UTF-16 или Windows-1251."
        )

    @staticmethod
    def _extract_json(text: str, filename: str) -> list[tuple[int, str]]:
        extension = Path(filename).suffix.casefold()
        try:
            if extension in {".jsonl", ".ndjson"}:
                values = [
                    json.loads(line)
                    for line in text.splitlines()
                    if line.strip()
                ]
            else:
                parsed = json.loads(text)
                if isinstance(parsed, dict):
                    values = next(
                        (
                            value
                            for key in ("articles", "records", "items", "data")
                            if isinstance((value := parsed.get(key)), list)
                        ),
                        [parsed],
                    )
                else:
                    values = parsed if isinstance(parsed, list) else [parsed]
        except json.JSONDecodeError as exc:
            raise DocumentExtractionError(
                f"Не удалось прочитать JSON: строка {exc.lineno}, столбец {exc.colno}."
            ) from exc

        return [
            (number, _json_value_to_text(value))
            for number, value in enumerate(values, start=1)
        ]

    @staticmethod
    def _extract_delimited(text: str, filename: str) -> list[tuple[int, str]]:
        delimiter = "\t" if Path(filename).suffix.casefold() == ".tsv" else ","
        try:
            rows = list(csv.reader(StringIO(text), delimiter=delimiter))
        except csv.Error as exc:
            raise DocumentExtractionError("Не удалось прочитать табличный файл.") from exc

        if not rows:
            return []
        headers = rows[0]
        return [
            (
                number,
                " ".join(
                    f"{headers[column]}: {value}"
                    if column < len(headers) and headers[column]
                    else value
                    for column, value in enumerate(row)
                    if value.strip()
                ),
            )
            for number, row in enumerate(rows[1:] or rows, start=1)
        ]

    @staticmethod
    def _extract_bibliography(text: str, filename: str) -> list[tuple[int, str]]:
        if Path(filename).suffix.casefold() == ".ris":
            records = [record for record in re.split(r"(?m)^ER  -.*$", text) if record.strip()]
        else:
            records = [
                record
                for record in re.split(r"(?m)(?=^@\w+\s*\{)", text)
                if record.strip()
            ]
        return list(enumerate(records, start=1))

    @staticmethod
    def _extract_markup(text: str, filename: str) -> list[tuple[int, str]]:
        extension = Path(filename).suffix.casefold()
        if extension in {".html", ".htm"}:
            parser = _HtmlTextParser()
            try:
                parser.feed(text)
                parser.close()
            except Exception as exc:
                raise DocumentExtractionError("Не удалось извлечь текст из HTML.") from exc
            return [(1, " ".join(parser.parts))]

        try:
            root = ElementTree.fromstring(text)
        except ElementTree.ParseError as exc:
            raise DocumentExtractionError("Не удалось прочитать XML-документ.") from exc
        return [(1, " ".join(root.itertext()))]

    @staticmethod
    def _normalised_document(
        pages: list[tuple[int, str]],
        *,
        location_label: str,
    ) -> ExtractedDocument:
        extracted_pages: list[tuple[int, str]] = []
        for number, page in pages:
            normalised = normalise_text(page)
            if normalised:
                extracted_pages.append((number, normalised))

        if not extracted_pages:
            raise DocumentTextUnavailableError(
                "В документе не найден извлекаемый текст."
            )
        return ExtractedDocument(
            page_count=len(pages),
            pages=extracted_pages,
            location_label=location_label,
        )


def _json_value_to_text(value: Any) -> str:
    if isinstance(value, dict):
        return " ".join(
            f"{key}: {_json_value_to_text(item)}"
            for key, item in value.items()
            if item is not None
        )
    if isinstance(value, list):
        return " ".join(_json_value_to_text(item) for item in value)
    if isinstance(value, (str, int, float, bool)):
        return str(value)
    return ""
