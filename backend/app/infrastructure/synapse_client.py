from __future__ import annotations

from contextlib import ExitStack
import logging
from typing import Any

import httpx

from backend.app.application.synapse_service import SynapseAttachment
from backend.app.config import Settings

logger = logging.getLogger(__name__)


class SynapseError(RuntimeError):
    pass


def normalize_url(value: str) -> str:
    value = value.strip().rstrip("/")
    if value and "://" not in value:
        value = f"https://{value}"
    return value.removesuffix("/api")


class SynapseClient:
    def __init__(self, config: Settings) -> None:
        self.config = config
        self.base_url = normalize_url(config.synapse_url)
        self._access_token: str | None = None

    @property
    def configured(self) -> bool:
        return self.config.synapse_configured

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        if not self.configured:
            raise SynapseError("Synapse не настроен: заполните SYNAPSE_URL, SYNAPSE_USER, SYNAPSE_PASSWORD и SYNAPSE_WORKFLOW_ID.")
        try:
            with httpx.Client(base_url=self.base_url, timeout=self.config.synapse_timeout, follow_redirects=True) as client:
                if not self._access_token:
                    login = client.post("/api/auth/login", json={"email": self.config.synapse_user, "password": self.config.synapse_password})
                    if login.status_code != 200:
                        raise SynapseError(f"Вход в Synapse не выполнен: HTTP {login.status_code}.")
                    self._access_token = login.json().get("access_token")
                    if not self._access_token:
                        raise SynapseError("Synapse не вернул access_token.")
                response = client.request(method, path, headers={"Authorization": f"Bearer {self._access_token}"}, **kwargs)
        except httpx.TimeoutException as exc:
            logger.warning(
                "Synapse request timed out: method=%s path=%s type=%s",
                method,
                path,
                type(exc).__name__,
            )
            raise SynapseError(
                "Synapse не ответил вовремя. Повторите запрос или увеличьте SYNAPSE_TIMEOUT."
            ) from exc
        except httpx.HTTPError as exc:
            logger.warning(
                "Synapse request failed: method=%s path=%s type=%s",
                method,
                path,
                type(exc).__name__,
            )
            raise SynapseError(
                "Не удалось подключиться к Synapse. "
                f"Тип сетевой ошибки: {type(exc).__name__}."
            ) from exc
        if response.status_code >= 400:
            raise SynapseError(f"Synapse {method} {path}: HTTP {response.status_code}.")
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
                            "application/pdf",
                        ),
                    )
                    for attachment in attachments
                ]
                response = self._request(
                    "POST", "/api/projects", data=payload, files=files
                )
        except OSError as exc:
            raise SynapseError("Не удалось подготовить PDF для отправки в Synapse.") from exc
        return response.json()

    def get_project(self, project_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/projects/{project_id}").json()

    def project_url(self, project_id: str) -> str:
        base = normalize_url(self.config.synapse_ui_url) or self.base_url
        return f"{base}/monitor/{project_id}" if base else ""
