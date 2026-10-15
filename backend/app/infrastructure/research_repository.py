from __future__ import annotations

from contextlib import closing, contextmanager
import json
from pathlib import Path
import sqlite3
from threading import Lock, RLock
from typing import Any, Iterator

from backend.app.application.research_service import ResearchConflictError, ResearchNotFoundError


class SqliteResearchRepository:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._locks: dict[str, RLock] = {}
        self._guard = Lock()

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self._path, timeout=30)) as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS researches (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS research_files (research_id TEXT, file_id TEXT, content BLOB NOT NULL, PRIMARY KEY (research_id, file_id))")
            with connection:
                yield connection

    @contextmanager
    def locked(self, research_id: str) -> Iterator[None]:
        with self._guard:
            lock = self._locks.setdefault(research_id, RLock())
        with lock:
            yield

    def begin(self, record: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        with self._connection() as connection:
            cursor = connection.execute("INSERT OR IGNORE INTO researches VALUES (?, ?)", (record["id"], json.dumps(record, ensure_ascii=False)))
            stored = json.loads(connection.execute("SELECT data FROM researches WHERE id = ?", (record["id"],)).fetchone()[0])
            if (stored["kind"], stored["question"], [s["id"] for s in stored["sources"]]) != (record["kind"], record["question"], [s["id"] for s in record["sources"]]):
                raise ResearchConflictError("Этот идентификатор запуска уже использован для другого вопроса или набора источников.")
            return stored, cursor.rowcount == 1

    def get(self, research_id: str) -> dict[str, Any] | None:
        with self._connection() as connection:
            row = connection.execute("SELECT data FROM researches WHERE id = ?", (research_id,)).fetchone()
            return json.loads(row[0]) if row else None

    def list(self, kind: str | None, status: str | None) -> list[dict[str, Any]]:
        with self._connection() as connection:
            records = [json.loads(row[0]) for row in connection.execute("SELECT data FROM researches")]
        return sorted((r for r in records if (kind is None or r["kind"] == kind) and (status is None or r["status"] == status)), key=lambda r: r["created_at"], reverse=True)

    def patch(self, research_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT data FROM researches WHERE id = ?", (research_id,)).fetchone()
            if row is None:
                raise ResearchNotFoundError("Исследование не найдено.")
            record = {**json.loads(row[0]), **changes}
            connection.execute("UPDATE researches SET data = ? WHERE id = ?", (json.dumps(record, ensure_ascii=False), research_id))
            return record

    def save_file(self, research_id: str, file_id: str, content: bytes) -> None:
        with self._connection() as connection:
            connection.execute("INSERT OR IGNORE INTO research_files VALUES (?, ?, ?)", (research_id, file_id, content))

    def get_file(self, research_id: str, file_id: str) -> bytes | None:
        with self._connection() as connection:
            row = connection.execute("SELECT content FROM research_files WHERE research_id = ? AND file_id = ?", (research_id, file_id)).fetchone()
            return bytes(row[0]) if row else None
