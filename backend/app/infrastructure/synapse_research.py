from __future__ import annotations

import json
import mimetypes
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import urlsplit


def public_url(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    try:
        parsed = urlsplit(value.strip())
        return value.strip() if parsed.scheme in ("http", "https") and parsed.netloc and not parsed.username else ""
    except ValueError:
        return ""


def approval_details(approval: dict[str, Any]) -> dict[str, Any] | None:
    data = approval.get("data") or {}
    if not isinstance(data, dict):
        data = {}
    approval_id = data.get("approval_id") or approval.get("approval_id") or approval.get("id")
    if not approval_id:
        return None
    details = data.get("data", data.get("payload", data))
    return {
        "id": str(approval_id), "run_id": str(approval.get("run_id") or data.get("run_id") or ""),
        "title": str(data.get("label") or data.get("title") or approval.get("subtype") or "Требуется решение команды"),
        "content": str(approval.get("content") or ""), "details": details,
        "interaction_schema": data.get("interaction_schema"),
    }


def generated_file(item: dict[str, Any], report_ids: set[str]) -> dict[str, Any] | None:
    file_id = str(item.get("id") or item.get("attachment_id") or "")
    if not file_id or (item.get("source") == "user" and file_id not in report_ids):
        return None
    filename = str(item.get("filename") or item.get("name") or item.get("path") or file_id)
    filename = PurePosixPath(filename.replace("\\", "/")).name
    filename = "".join(c for c in filename if c.isprintable())[:240] or "result"
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return {
        "id": file_id, "filename": filename, "content_type": content_type,
        "size_bytes": item["size_bytes"] if isinstance(item.get("size_bytes"), int) and item["size_bytes"] >= 0 else 0,
        "is_report": file_id in report_ids or filename.lower().startswith(("report.", "report_", "result.", "result_", "research_report")),
    }


def report_attachment_ids(value: Any) -> set[str]:
    ids: set[str] = set()
    if isinstance(value, dict):
        formats = value.get("formats")
        if isinstance(formats, dict):
            for entry in formats.values():
                if isinstance(entry, dict) and isinstance(entry.get("attachment_id"), str) and entry["attachment_id"]:
                    ids.add(entry["attachment_id"])
        for child in value.values():
            ids.update(report_attachment_ids(child))
    elif isinstance(value, list):
        for child in value:
            ids.update(report_attachment_ids(child))
    return ids


def full_text(value: Any) -> str:
    if value is None:
        return ""
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)
