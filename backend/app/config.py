from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]
DATA_FILE = ROOT / "backend" / "data" / "evidence.json"
EVIDENCE_REVIEWS_FILE = ROOT / "backend" / "data" / "evidence_reviews.json"
CONTROL_QUESTIONS_FILE = ROOT / "backend" / "data" / "control_questions.json"
PUBLIC_SOURCES_FILE = ROOT / "backend" / "data" / "public_sources.json"
DEFAULT_DOCUMENT_STORE_DIR = ROOT / "backend" / "data" / "documents"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", env_file_encoding="utf-8", extra="ignore")

    host: str = Field(default="127.0.0.1", alias="HOST")
    port: int = Field(default=8091, alias="PORT")
    http_trace_enabled: bool = Field(default=False, alias="PAV_HTTP_TRACE_ENABLED")
    synapse_url: str = Field(default="", alias="SYNAPSE_URL")
    synapse_user: str = Field(default="", alias="SYNAPSE_USER")
    synapse_password: str = Field(default="", alias="SYNAPSE_PASSWORD")
    synapse_ui_url: str = Field(default="", alias="SYNAPSE_UI_URL")
    synapse_workflow_id: str = Field(default="", alias="SYNAPSE_WORKFLOW_ID")
    synapse_document_workflow_id: str = Field(
        default="", alias="SYNAPSE_DOCUMENT_WORKFLOW_ID"
    )
    synapse_document_run_config_id: str = Field(
        default="", alias="SYNAPSE_DOCUMENT_RUN_CONFIG_ID"
    )
    synapse_approval_mode: str = Field(default="human", alias="SYNAPSE_APPROVAL_MODE")
    synapse_timeout: float = Field(default=30.0, alias="SYNAPSE_TIMEOUT")
    document_store_dir: Path = Field(
        default=DEFAULT_DOCUMENT_STORE_DIR,
        alias="DOCUMENT_STORE_DIR",
    )
    document_access_token: str = Field(default="", alias="DOCUMENT_ACCESS_TOKEN")
    document_access_code_copy_enabled: bool = Field(
        default=False,
        alias="DOCUMENT_ACCESS_CODE_COPY_ENABLED",
    )
    document_max_upload_bytes: int = Field(
        default=20 * 1024 * 1024,
        gt=0,
        alias="DOCUMENT_MAX_UPLOAD_BYTES",
    )
    document_max_documents: int = Field(
        default=100,
        gt=0,
        alias="DOCUMENT_MAX_DOCUMENTS",
    )
    document_max_pages: int = Field(
        default=200,
        gt=0,
        alias="DOCUMENT_MAX_PAGES",
    )
    document_max_records: int = Field(
        default=100_000,
        gt=0,
        alias="DOCUMENT_MAX_RECORDS",
    )
    document_max_extracted_chars: int = Field(
        default=2_000_000,
        gt=0,
        alias="DOCUMENT_MAX_EXTRACTED_CHARS",
    )
    document_chunk_chars: int = Field(
        default=1200,
        ge=100,
        alias="DOCUMENT_CHUNK_CHARS",
    )
    document_chunk_overlap_chars: int = Field(
        default=150,
        ge=0,
        alias="DOCUMENT_CHUNK_OVERLAP_CHARS",
    )
    document_max_page_content_bytes: int = Field(
        default=16 * 1024 * 1024,
        gt=0,
        alias="DOCUMENT_MAX_PAGE_CONTENT_BYTES",
    )

    @property
    def synapse_configured(self) -> bool:
        return bool(self.synapse_url and self.synapse_user and self.synapse_password and self.synapse_workflow_id)


@lru_cache
def settings() -> Settings:
    return Settings()
