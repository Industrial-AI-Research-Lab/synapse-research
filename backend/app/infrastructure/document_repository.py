from __future__ import annotations

import hashlib
import json
from pathlib import Path
from threading import RLock
from typing import Any, BinaryIO

from backend.app.application.document_service import (
    DocumentConflictError,
    StagedDocument,
)


class JsonDocumentRepository:
    """Single-process local adapter for a small, persistent document corpus."""

    _COPY_CHUNK_BYTES = 64 * 1024

    def __init__(self, store_dir: Path) -> None:
        self._store_dir = store_dir
        self._files_dir = store_dir / "files"
        self._temporary_dir = store_dir / "temporary"
        self._index_file = store_dir / "index.json"
        self._lock = RLock()

    def stage_upload(
        self,
        *,
        document_id: str,
        source: BinaryIO,
    ) -> StagedDocument:
        self._ensure_directories()
        temporary_path = self._temporary_dir / f"{document_id}.uploading"
        digest = hashlib.sha256()
        size_bytes = 0

        try:
            with temporary_path.open("xb") as destination:
                while True:
                    part = source.read(self._COPY_CHUNK_BYTES)
                    if not part:
                        break
                    size_bytes += len(part)
                    digest.update(part)
                    destination.write(part)

            return StagedDocument(
                document_id=document_id,
                path=temporary_path,
                size_bytes=size_bytes,
                sha256=digest.hexdigest(),
            )
        except Exception:
            temporary_path.unlink(missing_ok=True)
            raise

    def discard_staged(self, staged: StagedDocument) -> None:
        staged.path.unlink(missing_ok=True)

    def commit(
        self,
        *,
        staged: StagedDocument,
        document: dict[str, Any],
        chunks: list[dict[str, Any]],
    ) -> None:
        with self._lock:
            index = self._read_index()
            final_path = self._files_dir / str(document["stored_filename"])
            if final_path.exists():
                raise DocumentConflictError("Идентификатор документа уже занят.")

            staged.path.replace(final_path)
            index["documents"].append(document)
            index["chunks"].extend(chunks)
            try:
                self._write_index(index)
            except Exception:
                final_path.unlink(missing_ok=True)
                raise

    def list_documents(self) -> list[dict[str, Any]]:
        with self._lock:
            return sorted(
                self._read_index()["documents"],
                key=lambda item: str(item.get("uploaded_at", "")),
                reverse=True,
            )

    def get_document(self, document_id: str) -> dict[str, Any] | None:
        with self._lock:
            return next(
                (
                    item
                    for item in self._read_index()["documents"]
                    if item.get("id") == document_id
                ),
                None,
            )

    def delete_document(self, document_id: str) -> dict[str, Any] | None:
        with self._lock:
            index = self._read_index()
            document = next(
                (
                    item
                    for item in index["documents"]
                    if item.get("id") == document_id
                ),
                None,
            )
            if document is None:
                return None

            next_index = {
                "documents": [
                    item for item in index["documents"] if item.get("id") != document_id
                ],
                "chunks": [
                    item
                    for item in index["chunks"]
                    if item.get("document_id") != document_id
                ],
            }
            file_path = self._stored_file_path(document)
            removed_path = self._temporary_dir / f"{document_id}.deleting"
            file_was_moved = False

            if file_path is not None and file_path.is_file():
                self._ensure_directories()
                removed_path.unlink(missing_ok=True)
                file_path.replace(removed_path)
                file_was_moved = True

            try:
                self._write_index(next_index)
            except Exception:
                if file_was_moved:
                    removed_path.replace(file_path)
                raise

            if file_was_moved:
                removed_path.unlink(missing_ok=True)

            return document

    def list_chunks(self, document_ids: set[str] | None = None) -> list[dict[str, Any]]:
        with self._lock:
            chunks = self._read_index()["chunks"]
            if document_ids is None:
                return chunks
            return [item for item in chunks if item.get("document_id") in document_ids]

    def file_path(self, document_id: str) -> Path | None:
        document = self.get_document(document_id)
        if document is None:
            return None
        candidate = self._stored_file_path(document)
        if candidate is None or not candidate.is_file():
            return None
        return candidate

    def _stored_file_path(self, document: dict[str, Any]) -> Path | None:
        stored_filename = str(document.get("stored_filename", ""))
        if not stored_filename or Path(stored_filename).name != stored_filename:
            return None
        return self._files_dir / stored_filename

    def _ensure_directories(self) -> None:
        self._files_dir.mkdir(parents=True, exist_ok=True)
        self._temporary_dir.mkdir(parents=True, exist_ok=True)

    def _read_index(self) -> dict[str, list[dict[str, Any]]]:
        if not self._index_file.exists():
            return {"documents": [], "chunks": []}
        data = json.loads(self._index_file.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Индекс документов имеет неподдерживаемый формат.")
        documents = data.get("documents")
        chunks = data.get("chunks")
        if not isinstance(documents, list) or not isinstance(chunks, list):
            raise ValueError("Индекс документов имеет неподдерживаемый формат.")
        return {"documents": documents, "chunks": chunks}

    def _write_index(self, index: dict[str, list[dict[str, Any]]]) -> None:
        self._ensure_directories()
        temporary_index = self._index_file.with_suffix(".tmp")
        temporary_index.write_text(
            json.dumps(index, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary_index.replace(self._index_file)
