from __future__ import annotations

from contextlib import ExitStack
import json
import logging
from time import perf_counter
from typing import Any
from urllib.parse import quote, urlsplit

import httpx

from backend.app.application.synapse_service import SynapseAttachment
from backend.app.application.research_service import ResearchConflictError, ResearchGatewayError
from backend.app.infrastructure.synapse_research import approval_details, failure_reason, full_text, generated_file, public_url, report_attachment_ids
from backend.app.config import Settings
from backend.app.observability import request_id

logger = logging.getLogger(__name__)


class SynapseError(ResearchGatewayError):
    pass


def _response_error(response: httpx.Response, method: str, path: str, *, secrets: tuple[str, ...]) -> str:
    context = f"Synapse {method} {path}: HTTP {response.status_code}."
    try:
        payload = response.json()
    except ValueError:
        detail = response.text.strip()
    else:
        if isinstance(payload, dict) and set(payload) == {"detail"}:
            payload = payload["detail"]
        detail = payload.strip() if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    for secret in secrets:
        if secret:
            detail = detail.replace(json.dumps(secret, ensure_ascii=False)[1:-1], "[REDACTED]").replace(secret, "[REDACTED]")
    return f"{context}\n{detail}" if detail else context


def normalize_url(value: str) -> str:
    value = value.strip().rstrip("/")
    if value and "://" not in value:
        value = f"https://{value}"
    return value.removesuffix("/api")


def _log_destination(value: str) -> str:
    """Return a destination safe to write to logs, without URL credentials."""
    parsed = urlsplit(value)
    host = parsed.hostname or "<invalid-host>"
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    try:
        port = f":{parsed.port}" if parsed.port else ""
    except ValueError:
        port = ""
    return f"{parsed.scheme}://{host}{port}{parsed.path.rstrip('/')}"


class SynapseClient:
    def __init__(self, config: Settings) -> None:
        self.config = config
        self.base_url = normalize_url(config.synapse_url)
        self._access_token: str | None = None

    @property
    def configured(self) -> bool:
        return self.config.synapse_configured

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        max_bytes = kwargs.pop("max_response_bytes", None)
        if not self.configured:
            raise SynapseError("Synapse не настроен: заполните SYNAPSE_URL, SYNAPSE_USER, SYNAPSE_PASSWORD и SYNAPSE_WORKFLOW_ID.", status_code=503, outcome_unknown=False)
        trace_enabled = bool(getattr(self.config, "http_trace_enabled", False))
        request_trace_id = request_id()
        started_at = perf_counter()
        destination = _log_destination(self.base_url)
        if trace_enabled:
            logger.info(
                "pav.synapse.request.started request_id=%s destination=%s method=%s path=%s has_files=%s timeout_seconds=%s",
                request_trace_id,
                destination,
                method,
                path,
                bool(kwargs.get("files")),
                self.config.synapse_timeout,
            )
        try:
            with httpx.Client(base_url=self.base_url, timeout=self.config.synapse_timeout, follow_redirects=True) as client:
                if not self._access_token:
                    if trace_enabled:
                        login_started_at = perf_counter()
                        logger.info(
                            "pav.synapse.login.started request_id=%s destination=%s",
                            request_trace_id,
                            destination,
                        )
                    login = client.post("/api/auth/login", json={"email": self.config.synapse_user, "password": self.config.synapse_password})
                    if trace_enabled:
                        logger.info(
                            "pav.synapse.login.completed request_id=%s destination=%s status_code=%s duration_ms=%.1f",
                            request_trace_id,
                            destination,
                            login.status_code,
                            (perf_counter() - login_started_at) * 1000,
                        )
                    if login.status_code != 200:
                        raise SynapseError(
                            _response_error(login, "POST", "/api/auth/login", secrets=(self.config.synapse_password, self.config.synapse_user)),
                            status_code=login.status_code, outcome_unknown=False,
                        )
                    self._access_token = login.json().get("access_token")
                    if not self._access_token:
                        raise SynapseError("Synapse не вернул access_token.", outcome_unknown=False)
                if max_bytes is None:
                    response = client.request(method, path, headers={"Authorization": f"Bearer {self._access_token}"}, **kwargs)
                else:
                    with client.stream(method, path, headers={"Authorization": f"Bearer {self._access_token}"}, **kwargs) as streamed:
                        content = bytearray()
                        for chunk in streamed.iter_bytes():
                            if len(content) + len(chunk) > max_bytes:
                                raise SynapseError("Файл результата превышает лимит сохранения 20 МБ.", status_code=413)
                            content.extend(chunk)
                        response = httpx.Response(streamed.status_code, headers=streamed.headers, content=bytes(content))
        except httpx.TimeoutException as exc:
            logger.warning(
                "pav.synapse.request.timed_out request_id=%s destination=%s method=%s path=%s duration_ms=%.1f type=%s",
                request_trace_id,
                destination,
                method,
                path,
                (perf_counter() - started_at) * 1000,
                type(exc).__name__,
            )
            message = (
                "Synapse не ответил вовремя. Результат создания проекта неизвестен. Проверьте историю Synapse перед новым запуском."
                if method == "POST" and path == "/api/projects"
                else "Synapse не ответил вовремя. Повторите запрос или увеличьте SYNAPSE_TIMEOUT."
            )
            raise SynapseError(message) from exc
        except httpx.HTTPError as exc:
            logger.warning(
                "pav.synapse.request.failed request_id=%s destination=%s method=%s path=%s duration_ms=%.1f type=%s",
                request_trace_id,
                destination,
                method,
                path,
                (perf_counter() - started_at) * 1000,
                type(exc).__name__,
            )
            raise SynapseError(
                "Не удалось подключиться к Synapse. "
                f"Тип сетевой ошибки: {type(exc).__name__}."
            ) from exc
        if response.status_code >= 400:
            if trace_enabled:
                logger.warning(
                    "pav.synapse.request.completed request_id=%s destination=%s method=%s path=%s status_code=%s duration_ms=%.1f",
                    request_trace_id,
                    destination,
                    method,
                    path,
                    response.status_code,
                    (perf_counter() - started_at) * 1000,
                )
            raise SynapseError(
                _response_error(response, method, path, secrets=(self.config.synapse_password, self.config.synapse_user, self._access_token or "")),
                status_code=response.status_code,
            )
        if trace_enabled:
            logger.info(
                "pav.synapse.request.completed request_id=%s destination=%s method=%s path=%s status_code=%s duration_ms=%.1f",
                request_trace_id,
                destination,
                method,
                path,
                response.status_code,
                (perf_counter() - started_at) * 1000,
            )
        return response

    def create_project(self, prompt: str) -> dict[str, Any]:
        return self._request("POST", "/api/projects", json={"user_prompt": prompt, "workflow_id": self.config.synapse_workflow_id, "approval_mode": self.config.synapse_approval_mode or "human"}).json()

    def create_document_research(
        self, prompt: str, attachments: list[SynapseAttachment]
    ) -> dict[str, Any]:
        workflow_id = (
            self.config.synapse_document_workflow_id
            or self.config.synapse_workflow_id
        )
        payload = {
            "user_prompt": prompt,
            "workflow_id": workflow_id,
            "approval_mode": self.config.synapse_approval_mode or "human",
        }
        if self.config.synapse_document_run_config_id:
            payload["run_config_id"] = self.config.synapse_document_run_config_id
        if not attachments:
            return self._request("POST", "/api/projects", json=payload).json()

        try:
            with ExitStack() as stack:
                files = [
                    (
                        "files",
                        (
                            attachment.filename,
                            stack.enter_context(attachment.path.open("rb")),
                            attachment.media_type,
                        ),
                    )
                    for attachment in attachments
                ]
                response = self._request(
                    "POST", "/api/projects", data=payload, files=files
                )
        except OSError as exc:
            raise SynapseError("Не удалось подготовить документы для отправки в Synapse.", outcome_unknown=False) from exc
        return response.json()

    def get_project(self, project_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/projects/{project_id}").json()

    def project_url(self, project_id: str) -> str:
        base = normalize_url(self.config.synapse_ui_url) or self.base_url
        return f"{base}/monitor/{project_id}" if base else ""

    def research_snapshot(self, project_id: str) -> dict[str, Any]:
        path = f"/api/projects/{quote(project_id, safe='')}"
        try:
            project = self._request("GET", path).json()
            pending = self._request("GET", path + "/messages/pending-approval").json()
            approvals = project.get("pending_approvals") or []
            if isinstance(pending, dict) and pending.get("pending_approval"):
                approvals = [pending["pending_approval"]]
            normalized = [approval_details(a) for a in approvals if isinstance(a, dict)]
            report_ids: set[str] = set()
            result_failure = ""
            if project.get("status") in ("completed", "done", "output", "failed", "error"):
                params = {"limit": 1000}
                if project.get("current_run_id"):
                    params["run_id"] = project["current_run_id"]
                messages = self._request("GET", path + "/messages", params=params).json()
                rows = messages.get("messages", []) if isinstance(messages, dict) else messages
                contents = [
                    message.get("content") for message in rows
                    if isinstance(message, dict) and message.get("type") == "assistant"
                ]
                report_ids = report_attachment_ids(contents)
                if project.get("status") in ("failed", "error"):
                    result_failure = failure_reason(rows)
            files: list[dict[str, Any]] = []
            skip = 0
            while True:
                page = self._request("GET", path + "/attachments", params={"limit": 500, "skip": skip}).json()
                rows = page.get("attachments") or []
                for row in rows:
                    if isinstance(row, dict):
                        item = generated_file(row, report_ids)
                        if item:
                            files.append(item)
                if not page.get("truncated") or not rows:
                    break
                skip += len(rows)
            deployments = project.get("deployments") or []
            result_url = project.get("result_url") or project.get("deployment_url") or ""
            if not result_url and isinstance(deployments, list):
                result_url = next((d.get("url") for d in reversed(deployments) if isinstance(d, dict) and d.get("url")), "")
            if not report_ids and project.get("status") in ("completed", "done", "output"):
                for extension in (".html", ".txt", ".md"):
                    candidate = next((item for item in files if item["filename"].lower().endswith(extension)), None)
                    if candidate:
                        candidate["is_report"] = True
            return {
                "status": "awaiting_approval" if any(normalized) else str(project.get("status") or "started"),
                "phase": str(project.get("current_phase") or ""),
                "title": str(project.get("title") or "Исследование ПАВ"),
                "approvals": [a for a in normalized if a], "files": files,
                "result_text": full_text(project.get("final_output") or project.get("result") or project.get("summary")),
                "result_url": public_url(result_url),
                "failure_reason": result_failure,
            }
        except (ValueError, TypeError, AttributeError) as exc:
            raise SynapseError("Synapse вернул состояние исследования в неподдерживаемом формате.") from exc

    def resolve_approval(self, project_id: str, approval: dict[str, Any], approved: bool, feedback: str) -> None:
        path = f"/api/projects/{quote(project_id, safe='')}"
        if approval.get("run_id"):
            path += f"/runs/{quote(approval['run_id'], safe='')}"
        path += f"/approvals/{quote(approval['id'], safe='')}/resolve"
        payload = {"approved": approved, "feedback": feedback or None}
        if isinstance(approval.get("expected_data"), dict):
            payload["expected_data"] = approval["expected_data"]
        try:
            self._request("POST", path, json=payload)
        except SynapseError as exc:
            if exc.status_code == 409:
                raise ResearchConflictError(str(exc)) from exc
            raise

    def download_research_file(self, project_id: str, file_id: str) -> bytes:
        return self._request("GET", f"/api/projects/{quote(project_id, safe='')}/attachments/{quote(file_id, safe='')}", params={"raw": True}, max_response_bytes=20 * 1024 * 1024).content
